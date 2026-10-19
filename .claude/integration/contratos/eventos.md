# Contrato del bus de eventos

Define cómo viajan los eventos del catálogo (`.claude/CLAUDE.md`, sección "Catálogo de eventos") desde `audit.outbox` hasta sus consumidores. Lo implementa A1 (tarea 10, relay) y lo consumen A2 (`coa`), A3 (billing), A6 (notify) y A1 (invalidación de caché `aaa:user:*`). Cambios a este contrato: se acuerdan en el archivo de integración de quien lo pide y se actualiza este archivo en la misma PR.

## Publicación (A1)

- El relay lee `audit.outbox` con `publicado_en IS NULL`, en orden de `id`, por lotes, y hace `XADD` al stream de Redis **`argos:eventos`**.
- Campos de cada entrada del stream (todos texto):

| Campo | Valor |
| --- | --- |
| `id` | `audit.outbox.id` (identificador estable del evento; sirve para deduplicar) |
| `evento` | nombre del catálogo, p. ej. `servicio.estado_cambiado` |
| `payload` | JSON del payload tal como se escribió en el outbox |
| `request_id` | `audit.outbox.request_id` de la acción que lo emitió (puede ir vacío) |

- Después del `XADD` marca `publicado_en`. Si el proceso cae entre ambos pasos, el evento se publica dos veces: **entrega al menos una vez**.
- El stream se recorta con `XADD … MAXLEN ~ 100000`. No es un mecanismo de consistencia (regla 5): los grupos leen mucho antes de que una entrada se recorte.
- Un solo relay activo a la vez (lock en Redis `<COLAS_PREFIJO>:lock:eventos-relay` con dueño y renovación, regla 6).
- Implementación (A1, tarea 10): `apps/api/app/shared/relay_outbox.ts`, comando `node ace eventos:relay` (que además consume el grupo `aaa-cache`, `--sin-aaa-cache` lo apaga, y atiende los crons del núcleo de la cola `core-cron`, `--sin-crons` los apaga). El orden es el de `id` dentro de cada lote; una transacción que confirma tarde puede publicar un `id` menor después de uno mayor.

## Campos agregados a payloads del catálogo

| Evento | Campo | Desde | Valor |
| --- | --- | --- | --- |
| `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada` | `empresa_id` (entero) | 2026-10-17 (A1, multiempresa) | Empresa (NIT) del servicio en el momento del evento (`core.servicios.empresa_id`; `contratos/multiempresa.md`). Siempre presente desde esa fecha; los eventos anteriores no lo traen (era la empresa 1). Un consumidor que no lo lea no cambia |
| `factura.emitida`, `factura.vencida`, `factura.anulada`, `pago.registrado`, `pago.anulado`, `nota_credito.emitida`, `promesa.creada`, `promesa.cumplida`, `promesa.incumplida`, `comprobante.recibido`, `comprobante.aprobado`, `comprobante.rechazado`, `caja.cerrada` | `empresa_id` (entero) | 2026-10-17 (A3, multiempresa) | Empresa (NIT) del documento: la factura, el pago, la promesa (la del servicio), el comprobante (la de su cuenta bancaria) o la caja. Siempre presente desde esa fecha; los eventos anteriores no lo traen (era la empresa 1). `{{empresa.*}}` de notify sale de aquí |
| `pago.registrado`, `pago.anulado` | `cobro_id` (entero o null) | 2026-10-17 (A3, multiempresa) | Cobro de caja que cubrió facturas de varias empresas y se dividió en un pago por empresa (`billing.cobros`, `GET /cobros/:id`). Un evento por pago, cada uno con su `empresa_id`; null si el pago no vino de `POST /pagos` (pasarela, comprobante aprobado, histórico) |
| `servicio.config_cambiada` | `motivo` (`'plan_temporal'`, opcional) y `plan_temporal_id` (entero, opcional) | 2026-10-18 (A1, lealtad) | Solo cuando el cambio de `plan` lo hizo un plan temporal (`core.servicios_planes_temporales`, `contratos/lealtad.md` §5): al iniciar, al terminar y al cancelar uno activo. Llega con `campos: ['plan']` y se aplica como cualquier cambio de plan (CoA de velocidad sin cortar la sesión; `aaa:user:*` ya tiene el plan nuevo). Sin estos campos, el cambio de plan es una edición. Un consumidor que no los lea no cambia |
| `sesion.terminada` | `motivo` (texto o null) | semana 3 (A2) | `causa_fin` de la sesión: `Acct-Terminate-Cause` del NAS (`User-Request`, `Lost-Carrier`…), `NAS-Reboot` (Accounting-On/Off), `Sesion-Reemplazada` (otro Start del mismo usuario) o `sin_interim` (cron de sesiones colgadas: sin Stop ni Interim-Update en N intervalos). Un consumidor que no lo lea no cambia. Si después llega un Interim de una sesión cerrada por `sin_interim`, se reabre y se emite otro `sesion.iniciada`; si llega su Stop, se corrige `fin`/causa sin repetir `sesion.terminada` |

## Eventos fuera de la tabla de `CLAUDE.md`

El catálogo ejecutable es `apps/api/app/shared/eventos.ts` (`CatalogoEventos` + `EVENTOS`). Eventos agregados después de la primera tabla de `CLAUDE.md`, con su detalle (desde 2026-10-17 todos están también en esa tabla, con `empresa_id` y `cobro_id`):

| Evento | Emite | Payload | Lo consume |
| --- | --- | --- | --- |
| `sesion.desconexion_solicitada` | A2 (`DesconectarSesion`, `DesconectarServicio`) | `sesion_id`, `servicio_id` (null si el `user_ppp` no existe), `nas_ip`, `acct_session_id`, `user_ppp`, `motivo` | `coa`: Disconnect-Request a esa sesión si sigue abierta; envío y respuesta en `audit.red` (`comando.evento` = este nombre, `comando.razon` = `manual: <motivo>`), `coa.fallido` si no hay ACK |

| `aaa.caido` | A2 (`node ace aaa:vigilar`, `RegistrarCaidaAaa`) | `nodo`, `desde` (ISO, primer health check fallido), `ultimo_error` (p. ej. `ECONNREFUSED`, `HTTP 503`, `sin respuesta en 2000 ms`) | A6 (`notify`): alerta por Telegram al equipo |
| `routeros.fallido` | A2 (`AplicarRedServicio`, `ReconciliarRouterOS` en `apps/api/app/network/routeros`) | `servicio_id` (null en la reconciliación de un router completo), `router_id`, `operacion` (comando legible que falló, estilo RouterOS: `queue/simple add`, `ip/firewall/address-list remove`, `queue/simple print` si el router no respondió; `credenciales del router` si no tiene usuario o contraseña descifrable; `reconciliar` en la reconciliación del router entero), `error` (mensaje del cliente REST: `ECONNREFUSED`, `sin respuesta en 5000 ms`, `credenciales de la API rechazadas`, `Bad Request: failure: …`, `sin api_usuario o api_password`) | A6 (`notify`): alerta por Telegram al equipo. Se emite al agotar los 3 reintentos; el router queda pendiente y el job `recuperar` lo reconcilia cuando responde |
| `cliente.actualizado` | A1 (`EditarCliente`) | `cliente_id`, `campos[]` (`nombre`, `tipo`, `codigo`, `nit_cui`, `tipo_documento_fiscal`; los que cambiaron. `tipo_documento_fiscal` también cuando se reclasifica solo al cambiar el NIT/CUI). Sin `empresa_id`: el cliente no es de una empresa | A6 (worker de webhooks a Horus, grupo `horus`): Horus refresca nombre y código de sus identidades (contrato Horus §2.3). No se emite al crear |
| `cliente.actualizado` | A1 (`EditarCliente`) | `cliente_id`, `campos[]` (`nombre`, `tipo`, `codigo`; los que cambiaron). Sin `empresa_id`: el cliente no es de una empresa | A6 (worker de webhooks a Horus, grupo `horus`): Horus refresca nombre y código de sus identidades (contrato Horus §2.3). No se emite al crear |
| `servicio.adicional_agregado` / `servicio.adicional_cambiado` / `servicio.adicional_quitado` | A1 (`AgregarAdicionalServicio`, `EditarAdicionalServicio`, `QuitarAdicionalServicio`; alta, cambio de plan, cambio de empresa y retiro del servicio; `contratos/adicionales.md`) | `servicio_id`, `cliente_id`, `empresa_id` (la de la asignación), `adicional_id`, `asignacion_id`, `modalidad` (`incluido`, `cortesia`, `cobrado`); agregado: `origen` (`manual`, `plan`); cambiado: `campos[]` (`modalidad`, `identificador`, `credencial`, `precio`, `motivo`) y `modalidad_anterior`; quitado: `origen` (`manual`, `cambio_plan`, `retiro`, `cambio_empresa`) y `motivo`. **Nunca la credencial** | A3 (facturación de los `cobrado`), A5 (portal). `aaa-cache` y `routeros` los ignoran: no cambian la red |
| `aaa.recuperado` | A2 (`RegistrarRecuperacionAaa`) | `nodo`, `desde` (el de la caída), `hasta` (ISO, primer health check bueno), `ultimo_error` | A6 (`notify`): aviso de recuperación |
| `fiscal.localizacion_instalada` | A3 (`ActualizarLocalizacion`, `fiscal.instalar`; contrato de localización fiscal §10.3) | `empresa_id`, `pais` (`GT`), `codigo` (`gt-2026.1`), `de_codigo` (versión anterior o null). Solo si cambió la versión de la empresa: instalar dos veces no lo repite | A4 (pantalla de configuración fiscal). La migración que instala `gt-2026.1` en las empresas existentes no lo emite |
| `fiscal.parametros_cambiados` | A3 (`EditarParametro`, `EditarImpuesto`, `CambiarRegimen`, `ActualizarLocalizacion`) | `empresa_id` (null = valor global o del paquete: afecta a todas), `claves[]` (claves de parámetros; un impuesto va como `impuesto:<codigo>`), `vigente_desde` (YYYY-MM-DD, la más antigua de lo insertado) | A3 (`billing-worker`, `ConsumidorFiscal`): invalida la caché de parámetros y lo avisa por Redis Pub/Sub (`<COLAS_PREFIJO>:fiscal:parametros`) a los demás procesos (regla 5) |
| `fiscal.config_cambiada` | A3 (`CambiarRegimen`, `EditarParametro` con `fel_modo`, `CrearEstablecimiento`, `EditarEstablecimiento`, `AgregarFrase`) | `empresa_id`, `campos[]` de `regimen`, `fel_modo`, `proveedor`, `credenciales`, `establecimientos`, `frases` (los dos de FEL llegan en la fase 3). Nunca lleva valores secretos | A4 y A6 (avisos de configuración) |
| `libro.integridad_rota` | A3 (`SellarAsientos` al encadenar, `VerificarIntegridad` del cron diario; contrato de localización fiscal §10.10) | `empresa_id`, `sello` (número del sello roto en la cadena de la empresa), `asiento_id` (o null si el sello falta o es el último hash de un cierre), `esperado` (hash o valor guardado), `obtenido` (recalculado o encontrado). Una sola vez por (empresa, sello) | A6 (`notify`): alerta al equipo y a contabilidad (Telegram y correo); A4: pantalla de integridad (`GET /libro/integridad`) |
| `dte.certificado` | A3 (`CertificarDte`, worker `fiscal:worker`; contrato de localización fiscal §8.2) | `dte_id`, `empresa_id`, `documento_tipo` (`factura`, `nota_credito`, `nota_debito`), `documento_id`, `tipo_dte` (`FACT`, `FPEQ`, `NCRE`, `NDEB`), `autorizacion` (UUID SAT), `serie`, `numero`, `contingencia` | A5 (portal: el aviso pasa a «Factura» con autorización; PDF FEL), A6 (opcional: avisar al cliente) |
| `dte.rechazado` | A3 (`CertificarDte`, `AnularDte`, emisión con receptor faltante, anulación de un documento con DTE sin enviar) | `dte_id`, `empresa_id`, `documento_tipo`, `documento_id`, `error` (texto de la SAT, `receptor_requerido`, `aviso_sin_cubrir`, `documento_anulado` o reintentos agotados), `definitivo` (false = se agotaron los reintentos automáticos; sigue en error temporal) | A6 (alerta al equipo y a contabilidad si `definitivo` o agotado), A4 (estado del DTE) |
| `dte.anulado` | A3 (`AnularDte`, segundo paso de `facturas.anular`) | `dte_id`, `empresa_id`, `documento_tipo`, `documento_id`, `motivo`. La factura emite además `factura.anulada` en la misma transacción | A5, A6 |
| `fel.contingencia_cambiada` | A3 (`CambiarContingenciaFel`, `POST /fel/activar-contingencia` y `/desactivar-contingencia`) | `empresa_id`, `activa`, `motivo` | A6 (alerta al equipo y a contabilidad) |
| `factura.sustituida` | A3 (`SustituirFactura`, `POST /facturas/:id/sustituir`) | `factura_id` (la original), `nueva_factura_id`, `empresa_id`, `servicio_id`, `cliente_id`, `motivo`. La original emite además `factura.anulada` o `nota_credito.emitida`, y la nueva su `factura.emitida` (o nada si nace `por_certificar`) | A5 (portal: la sustituta), A6 |
| `cobros.liquidados` | A3 (`LiquidarCobros`, `POST /cobros/liquidaciones`; localización fiscal §10.3) | `liquidacion_id`, `empresa_id`, `proveedor` (código: `falsa`, `agente`, `debito`), `bruto`, `comision`, `neto`, `pagos[]` (ids incluidos, sin los contracargos) | Nadie aún (A6 puede avisar a contabilidad) |
| `caja.depositada` | A3 (`DepositarCaja`, `POST /cajas/:id/depositar`) | `deposito_id`, `empresa_id`, `caja_id`, `cuenta_bancaria_id` (o null si fue a un banco del libro), `cuenta_id` (subcuenta 1.1.02.NN), `monto` | Nadie aún (A4: cierre de caja; A6 opcional) |
| `banco.extracto_importado` | A3 (`ImportarExtracto`, `POST /bancos/extractos`; lo llaman los adaptadores por banco de A6) | `extracto_id`, `empresa_id`, `cuenta_bancaria_id` (o null), `cuenta_id`, `lineas` (número), `monto` (Σ con signo) | Nadie aún |
| `banco.conciliado` | A3 (`ConciliarLinea`, también desde `RegistrarDesdeExtracto` y `AplicarReglasConciliacion`) | `conciliacion_id` (primera fila del grupo), `empresa_id`, `cuenta_bancaria_id` (o null), `cuenta_id`, `linea_id`, `lineas` (1), `monto` | Nadie aún |
| `cartera.castigada` | A3 (`CastigarCartera`, `POST /cartera/castigos`; §10.9) | `castigo_id`, `empresa_id`, `cliente_id`, `facturas[]`, `monto` | A6 (aviso a contabilidad, opcional). El servicio ya se re-evaluó dentro de la acción |
| `nota_credito.anulada` | A3 (`AnularNotaCredito`, `POST /notas-credito/:id/anular`; contrato de localización fiscal §17) | `nota_credito_id`, `empresa_id`, `factura_id`, `cliente_id`, `monto`, `motivo`. Solo cuando la SAT rechazó en definitivo la NCRE de la nota: su asiento se revierte y el monto vuelve al saldo de la factura | A6 (opcional: avisar), A4 (estado de la nota) |
| `lealtad.programa_cambiado` | A3 (acciones de programa y reglas, `contratos/lealtad.md` §13) | `programa_id`, `empresa_id`, `campos[]` (columnas del programa, o `reglas`) | Quien guarde reglas o premios en caché las relee (regla 5); hoy nadie |
| `lealtad.puntos_acumulados` | A3 (consumidor `lealtad`, cron `lealtad:antiguedad`, `lealtad.ajustar`) | `movimiento_id`, `empresa_id`, `cliente_id`, `servicio_id`, `regla_id` (null en ajustes), `puntos` (entero), `vence_en` (YYYY-MM-DD o null) | A6 (aviso opcional) |
| `lealtad.puntos_revertidos` | A3 (reversos y ajustes negativos) | `movimiento_id`, `empresa_id`, `cliente_id`, `puntos` (positivo), `origen_tipo`, `origen_id` | A6 |
| `lealtad.puntos_por_vencer` | A3 (cron `lealtad:vencer`) | `empresa_id`, `cliente_id`, `puntos`, `vence_en`, `lote_id`; una vez por lote | A6 (aviso al cliente) |
| `lealtad.puntos_vencidos` | A3 (cron `lealtad:vencer`) | `movimiento_id`, `empresa_id`, `cliente_id`, `puntos` | A6 |
| `lealtad.referido_calificado` | A3 (consumidor `lealtad`) | `referido_id` (`lealtad.referidos.id`), `empresa_id`, `referidor_id`, `cliente_id` (el referido) | A6 |
| `nota_credito.anulada` | A3 (`AnularNotaCredito`, `POST /notas-credito/:id/anular`; contrato de localización fiscal §17) | `nota_credito_id`, `empresa_id`, `factura_id`, `cliente_id`, `monto`, `motivo`. Solo cuando la SAT rechazó en definitivo la NCRE de la nota: su asiento se revierte y el monto vuelve al saldo de la factura | A6 (`notify`): aviso al equipo y a contabilidad (Telegram y correo), una vez por nota; A4 (estado de la nota) |
| `comprobante.recibido` | A3 (`RegistrarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id: null`, `motivo: null` | A6 (`notify`): "Recibimos tu comprobante de pago" |
| `comprobante.aprobado` | A3 (`AprobarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id` (el pago creado), `motivo: null` | A6 (`notify`): "Comprobante de pago aprobado" (el único aviso de pago del pagador) |
| `comprobante.rechazado` | A3 (`RechazarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id: null`, `motivo` (texto del revisor) | A6 (`notify`): "Comprobante de pago rechazado" con `{{comprobante.motivo}}` |
| `notificaciones.config_cambiada` | A6 (`ConfigurarNotificaciones`, `SembrarConfiguracionCanales`) | `configuracion_id`, `empresa_id` (null = global), `campos` (columnas que cambiaron; nunca valores ni secretos) | A6 (`notify:worker`, `ConsumidorConfigNotify`): descarta y relee la configuración de canales y lo avisa por Redis Pub/Sub (`<COLAS_PREFIJO>:notify:config`) a los demás procesos |
| `nota_credito.emitida` | A3 (`EmitirNotaCredito`, `POST /facturas/:id/notas-credito`) | `nota_credito_id`, `factura_id`, `servicio_id` (null en facturas sin servicio, p. ej. de apertura), `cliente_id` (dueño de la factura), `monto`, `motivo` | A3 (`billing`): revisa las promesas activas del cliente (la nota puede dejarlo sin deuda vencida). El servicio ya se re-evaluó dentro de la acción (reactivación inmediata, `servicio.estado_cambiado`). A6 puede avisar al cliente si quiere (no está en `EVENTOS_NOTIFICABLES`) |
| `horus.config_cambiada` | A6 (`ConfigurarHorus`, `CanjearEnlaceHorus`, `ConectarConEnlaceHorus`) | `activo`, `campos` (columnas que cambiaron; nunca valores ni secretos) | A6 (`horus:worker`, `ConsumidorHorus`): descarta la configuración del conector y avisa por Pub/Sub `<COLAS_PREFIJO>:horus:config` |
| `horus.hallazgo_abierto` / `horus.hallazgo_resuelto` | A6 (`RecibirWebhookHorus`, webhook `finding.opened` / `finding.resolved` de Horus) | `webhook_id`, `servicio_id`, `cliente_id`, `empresa_id` (de `external` verificado contra `core.servicios`; null sin identidad), `ip`, `hallazgo` (`id`, `tipo`, `severidad`, `resumen`, `abierto_en`, `reabierto`) | A6 (`notify`, `ConsumidorAlertas`): alerta al equipo si la severidad es `high` o `critical`, con la configuración de la empresa del servicio; aviso de resuelto. **No cambia el estado del servicio** |
| `horus.estado_seguridad_cambiado` | A6 (`customer.security_state_changed`) | `webhook_id`, `servicio_id`, `cliente_id`, `empresa_id`, `ip`, `estado` (`clean`, `suspected`, `infected`, `mitigated`; contrato Horus 1.3.0), `estado_anterior`, `hallazgos_abiertos` | Nadie aún (línea de tiempo y columna "Seguridad" leen `integraciones.horus_*`) |
| `horus.router_estado_cambiado` | A6 (`router.status_changed`) | `webhook_id`, `router` (`id` de Horus, `nombre`, `estado`, `estado_anterior`, `motivo`) | A6 (`notify`): incidente `horus-router:<id>` abierto mientras no esté `online`; aviso al recuperar |
| `horus.servicio_infra_cambiado` | A6 (`infra_service.state_changed`) | `webhook_id`, `servicio_infra` (`id`, `nombre`, `estado`, `estado_anterior`, `motivo`) | A6 (`notify`): incidente `horus-infra:<id>`, igual que el router |

Horus no decide cortes (ADR-0030): ningún consumidor cambia el estado de un servicio por un evento `horus.*`.

`aaa.caido` se emite cuando un nodo lleva `AAA_CAIDO_TRAS_MS` (60 s) sin responder `GET /health` con 2xx; una sola vez por caída (las acciones miran el último evento del nodo en `audit.outbox`), y `aaa.recuperado` solo después de un `aaa.caido`. El payload de la tabla de `CLAUDE.md` (`nodo`, `desde`) sigue valiendo: `ultimo_error` es un campo más.

`coa.fallido` admite `servicio_id: null` solo en una desconexión manual de una sesión sin servicio conocido.

## Consumo

- Cada consumidor usa su propio **grupo** de Redis Streams sobre `argos:eventos` (`XREADGROUP` + `XACK`). Nombres de grupo:

| Grupo | Dueño | Eventos que le interesan |
| --- | --- | --- |
| `coa` | A2 (`services/coa`) | `servicio.estado_cambiado`, `servicio.config_cambiada`, `sesion.desconexion_solicitada` |
| `routeros` | A2 (`node ace routeros:worker`, `apps/api/app/network/routeros`) | `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada`, `sesion.iniciada`, `sesion.terminada` (estado deseado del servicio y control de velocidad de su router), `plan.velocidad_cambiada` (reconcilia los routers del plan) y `router.control_cambiado` (cambio de modo por lotes, o padres globales si solo cambió la capacidad) |
| `billing` | A3 | `pago.registrado` (cumplir promesas), `servicio.creado` (fecha de instalación / prorrateo) |
| `billing` | A3 | `pago.registrado` y `nota_credito.emitida` (cumplir promesas); `factura.*`, `pago.*`, `promesa.*`, `servicio.estado_cambiado`, `servicio.creado` (refrescar las vistas del dashboard, `ConsumidorResumenes`) |
| `lealtad` | A3 (`billing:worker`, `ConsumidorLealtad`) | `pago.registrado`, `pago.anulado`, `factura.emitida`, `factura.anulada`, `nota_credito.emitida`, `nota_credito.anulada`, `servicio.creado` (referidos), `servicio.estado_cambiado` (`retirado`) → `lealtad.evaluar_evento`; solo empresas con programa (salvo el `servicio.creado` de un referido) |
| `notify` | A6 | los de `EVENTOS_NOTIFICABLES` en `apps/api/app/notify/consumidor.ts` |
| `horus` | A6 (`node ace horus:worker`, `apps/api/app/integraciones/horus`) | `asignacion.cambiada`, `sesion.iniciada`, `sesion.terminada`, `cliente.actualizado` (A1), `servicio.estado_cambiado`, `servicio.config_cambiada` (solo si cambian `plan` o `empresa`, contrato Horus 1.7.0) → webhooks firmados a Horus (`contratos/horus.md` §2.3), solo con el conector activo; `horus.config_cambiada` |
| `aaa-cache` | A1 | `servicio.*`, `asignacion.cambiada` y `plan.velocidad_cambiada` (reescribe `aaa:user:<user_ppp>`) |

- Dentro de `apps/api` el consumidor implementa la interfaz `ConsumidorEventos` (en `apps/api/app/shared/eventos_bus.ts`; `apps/api/app/notify/consumidor.ts` la reexporta):

```ts
interface EventoEntrante { id: number | string; evento: string; payload: Record<string, unknown>; requestId?: string | null }
interface ConsumidorEventos { readonly nombre: string; acepta(evento: string): boolean; procesar(e: EventoEntrante): Promise<void> }
```

- Ejecutor genérico para `apps/api`: `new EjecutorGrupo({ grupo, consumidores })` de `#shared/eventos_bus` (`iniciar()`, `detener()`, `procesarLote()`). Crea el grupo con `XGROUP CREATE ... 0 MKSTREAM` (un grupo nuevo lee el stream desde el principio), lee con `XREADGROUP`, confirma con `XACK` cuando todos los consumidores que `acepta`n terminaron bien y reclama con `XAUTOCLAIM` lo pendiente hace más de 60 s. Lo usan `node ace eventos:relay` (`aaa-cache`) y `node ace notify:worker` (`notify`); A3 lo usa igual para `billing`.
- `procesar` es **idempotente por `id`**: el mismo evento puede llegar dos veces. Si lanza, el worker no hace `XACK` y el evento se reintenta (reclamado con `XAUTOCLAIM` tras 60 s).
- Los consumidores no deciden estados ni mueven dinero por su cuenta: llaman acciones de dominio (regla 1).

## Payloads del núcleo (A1)

`servicio.config_cambiada`: `{ servicio_id, empresa_id, campos[], empresa_anterior_id?, motivo?, plan_temporal_id? }`. Valores de `campos`:

| Campo | Cuándo |
| --- | --- |
| `plan`, `router`, `ips`, `prefijo_v6` | Cambió el plan, el router, la IPv4 o los prefijos/modo IPv6 (desde el día 2). `plan` también al iniciar, terminar o cancelar un plan temporal (lealtad, 2026-10-18), con `motivo: 'plan_temporal'` y `plan_temporal_id`; nunca mueve IPs ni prefijos |
| `tipo_conexion` | Semana 2 (WISP, `contratos/routeros.md`): el servicio pasó entre `pppoe`, `ip_estatica` y `dhcp_fija`. El dispatcher limpia en el router lo del tipo anterior. Al dejar `pppoe`, `aaa:user:<user_ppp viejo>` queda con lápida |
| `mac`, `amarre_ip_mac` | Semana 2: cambió la MAC (lease de `dhcp_fija`, ARP) o el amarre IP-MAC |
| `empresa` | Multiempresa (2026-10-17): `servicios.cambiar_empresa` pasó el servicio a otra empresa; `empresa_id` es la nueva y `empresa_anterior_id` la de antes (solo en este caso). No cambia nada en la red; las facturas siguientes salen con el NIT nuevo |

Eventos de velocidad (semana 2, `contratos/velocidad.md`). Decisión de A1: eventos propios por plan y por router en vez de un `servicio.config_cambiada` por cada servicio afectado (un plan con 500 servicios serían 500 eventos, y A2 recalcula por plan y router, no por servicio):

| Evento | Emite | Payload | Lo consume |
| --- | --- | --- | --- |
| `plan.velocidad_cambiada` | A1 (`EditarPlan`, `ImplementarPlan`) | `plan_id`, `router_id` (null = cambió la plantilla del plan y afecta todos los routers; un id = cambió la excepción de ese router), `campos[]` (`bajada_kbps`, `subida_kbps`, `bajada_limitada_kbps`, `subida_limitada_kbps`, `reuso`, `garantizado_pct`, `rafaga_bajada_kbps`, `rafaga_subida_kbps`, `rafaga_umbral_pct`, `rafaga_segundos`, `prioridad`; en una excepción también `rate_limit_override` y `profile_ppp`) | A2: recalcula padres (`limitesPadrePlan`), PCQ y perfiles PPP del plan; `aaa-cache` (A1): reescribe `aaa:user:*` de los servicios del plan |
| `router.control_cambiado` | A1 (`CambiarControlVelocidad`, `EditarRouter`) | `router_id`, `de`, `a` (`simple` o `arbol_pcq`; iguales si solo cambió la capacidad), `capacidad_bajada_kbps`, `capacidad_subida_kbps` (null = sin techo), `campos[]` (`control_velocidad` o `capacidad`), `motivo` (null si no vino) | A2: ejecuta el cambio de modo por lotes (sin colas huérfanas) o ajusta el padre global |

Los consumidores no deben fallar con un campo que no conocen: el dispatcher recalcula el estado deseado completo del servicio con cualquier `servicio.config_cambiada`.

## Payloads de pagos (A3)

`pago.registrado` y `pago.anulado`: `{ pago_id, empresa_id, cobro_id, cliente_id, monto, metodo, facturas[], clientes[] }`.

- Multiempresa (2026-10-17): un pago es de una sola empresa y sus `facturas[]` son de esa empresa. Un cobro en caja que cubre facturas de varias empresas emite **un `pago.registrado` por empresa**, con el mismo `cobro_id`. Decisión de A6 (17 oct): notify **no** los agrupa; manda un aviso por empresa (cada uno con su marca, su configuración y su bot) y la plantilla puede decir que es parte de un cobro mayor con `{{#cobro.repartido}}` (`{{cobro.monto_q}}`, `{{cobro.otras_empresas}}`; `apps/api/app/notify/README.md`, "Avisos de pago").

- `cliente_id` es **quien paga**. `clientes` (desde 2026-10-16, decisión del PM) es el pagador seguido de los dueños de las facturas a las que se aplicó (pago de terceros: una persona paga con una sola transferencia su factura y la de un familiar). Eventos anteriores no lo traen: los consumidores usan `clientes ?? [cliente_id]`.
- `metodo`: `caja`, `pasarela`, `deposito`, `transferencia`, `ach`, `remesa`, `agente`, `debito`.
- Consumidores: `billing` revisa las promesas de cada cliente de `clientes`; `notify` avisa al pagador (`pago.registrado`) y a cada dueño de factura distinto del pagador (`pago.registrado.tercero`: "Recibimos el pago de tu factura N, hecho por <pagador>"), idempotente por (evento, cliente).

## Payloads de notas de crédito (A3)

`nota_credito.emitida`: `{ nota_credito_id, empresa_id, factura_id, servicio_id, cliente_id, monto, motivo }` (semana 3). Una por nota; `monto` es lo acreditado (parcial o total del saldo de la factura). `nota_credito.anulada` (fase 3): `{ nota_credito_id, empresa_id, factura_id, cliente_id, monto, motivo }`, solo cuando la SAT rechazó en definitivo la NCRE de la nota y se anuló con `facturas.anular_nota_credito` (reverso espejo de su asiento; el monto vuelve al saldo de la factura; una vez por nota). Una nota interna (sin NCRE) no se anula: se corrige con otra nota o un cargo.

## Payloads de comprobantes (A3)

`comprobante.recibido`, `comprobante.aprobado` y `comprobante.rechazado`: `{ comprobante_id, empresa_id, cliente_id, pago_id, motivo }`, siempre con todas las claves (`null` cuando no aplica). `empresa_id` es la de la cuenta bancaria de destino.

- `cliente_id` es el dueño del comprobante (quien depositó); notify no necesita resolverlo por `billing.pagos` (un comprobante pendiente o rechazado no tiene pago).
- Al aprobar, el pago emite además su propio `pago.registrado` en la misma transacción. Decisión de A6 (día 4): el pagador recibe un solo aviso, el de `comprobante.aprobado`; notify omite `pago.registrado` para el pagador cuando `billing.comprobantes.pago_id` es ese pago (y la plantilla de `comprobante.aprobado` está activa), y deduplica por `pago_id`. Los dueños de facturas distintos del pagador reciben igual su aviso de `pago.registrado` (`pago.registrado.tercero`). Detalle en `apps/api/app/notify/README.md`, "Avisos de pago".

## Pruebas

- Los consumidores se prueban alimentando `procesar()` directamente con un `EventoEntrante`, sin Redis.
- La prueba de integración del relay (A1) usa un prefijo de stream propio (`<COLAS_PREFIJO>:argos:eventos`; con `NODE_ENV=test` es el valor por defecto; en otros entornos `EVENTOS_STREAM`) para no chocar con otros agentes que prueban en paralelo.
