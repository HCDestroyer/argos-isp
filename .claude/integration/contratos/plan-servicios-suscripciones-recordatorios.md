# Plan v2: tipos de servicio, suscripciones, cobro automático y recordatorios por lugar (ArgosIsp)

Versión 2 (25 nov 2026), completa: reemplaza a la v1 del archivo `.claude/integration/contratos/plan-servicios-suscripciones-recordatorios.md` (sha da63c834). Incorpora las respuestas del PM del §6. Solo leí código, contratos y documentación pública; no ejecuté pruebas ni edité nada.

## 0. Lo esencial

- **Qué cambió respecto a la v1:**
  - Desaparece el tipo de servicio `otro` y la cola «Cortes en campo».
  - Entra la suscripción independiente como entidad propia (carril I).
  - Entra el cobro automático con tarjeta (carril D).
  - El corte de TV va por SmartOLT (CATV) y, si no se puede, por aviso a Iris.
  - El carril R queda en espera.
- **SmartOLT sí permite cortar el CATV**, pero los endpoints se llaman `disable_catv` y `enable_catv`. Los nombres `disable_onu_catv` / `enable_onu_catv` no existen en la especificación oficial.
- **Recurrente sí permite tokenizar y cobrar después** sin que Argos vea la tarjeta: checkout `mode: "setup"` y `POST /api/one_time_payments` con `payment_method_id`.
- **La factura de una suscripción independiente no necesita cambiar el modelo de facturas:** `billing.facturas.servicio_id` ya es anulable y `clave_unica` es texto libre (los cargos únicos ya usan `cargo-<uuid>`).
- **Dependencias externas que bloquean lotes:**
  - cuenta y Sandbox de Recurrente con «cobros únicos» habilitados (D2 en adelante);
  - fusión de la rama `agente/a6-olt-acs` (T3b);
  - contrato Iris 0.15.0 (T3a).

## 1. Diagnóstico

### 1.1 Tipos de servicio
- `core.servicios` (`apps/api/database/migrations/1760900000005_crear_servicios.ts`): `router_id` y `plan_id` son `NOT NULL`. `user_ppp` y `pass_ppp` ya son anulables (migración `1792161790085_…`).
- `network.planes`: `bajada_kbps NOT NULL CHECK (> 0)`. `planes.tipo` es comercial (`residencial`, `empresarial`, `dedicado`; `apps/api/app/network/tipos_plan.ts`), no tipo de servicio.
- `apps/api/app/core/actions/crear_servicio.ts` y `crearServicioValidator` (`apps/api/app/core/validators.ts:396`) exigen router y plan.
- Acoplamiento al router: 156 archivos de `apps/api/app` mencionan `router_id`; unas 134 referencias a `s.router_id`; alrededor de 10 joins internos a `network.routers`. El alcance ACL por router filtra por `s.router_id` (`apps/api/app/core/consultas/servicios.ts:206`).
- Facturación: concepto fijo «Servicio de internet …» (`apps/api/app/billing/actions/emitir_factura.ts`, ~línea 186). Cuenta `4.1.01` para la línea `servicio` (`apps/api/app/billing/facturas.ts:75`). `facturas_lineas.cuenta_codigo` ya existe y manda sobre el tipo.
- Corte: decide `apps/api/app/billing/actions/evaluar_estado_servicio.ts`; aplica `apps/api/app/core/actions/cambiar_estado_servicio.ts`. La ejecución es solo de red (aaa, coa, routeros).

### 1.2 SmartOLT y CATV
- En `origin/main` la integración está en `apps/api/app/integraciones/equipos/` (`smartolt.ts`, `equipos.ts`, `cola.ts`, `capacidades.ts`): una sola configuración por empresa. No hay ninguna llamada de CATV.
- En `origin/agente/a6-olt-acs` (contrato `.claude/integration/contratos/equipos-olt-acs.md`, lotes 1 a 5 marcados «Hecho» en esa rama):
  - `integraciones.smartolt_instancias` (subdominio, token cifrado, `activo`, `prueba_ok`; «operativa» = activo y probado);
  - `integraciones.smartolt_olts` (ligada a `network.olts`);
  - `equipos_servicio.smartolt_instancia_id` junto a `smartolt_external_id` (`argos<servicio_id>`);
  - regla §4.2 para elegir la instancia de un servicio;
  - evento `equipos.config_cambiada`.
- API de SmartOLT. Fuente: especificación oficial OpenAPI «SmartOLT API 1.0», <https://www.smartolt.com/openapi.json>, leída el 25 nov 2026; documentación para personas en <https://api.smartolt.com/>.

| Operación | Endpoint | Lo que dice la especificación |
| --- | --- | --- |
| Cortar CATV de una ONU | `POST /api/onu/disable_catv/{onu_external_id}` | 200 `{ status: true, response: "CATV disabled" }`. 400 si no hay ONU con ese id, si «CATV not supported by ONU-Type» o si la OLT no pudo. Restricción literal: no usar para «repeteadly disabling the same ONTs multiple times per week» |
| Reconectar CATV | `POST /api/onu/enable_catv/{onu_external_id}` | 200 `"CATV enabled"`; mismos 400 |
| Modo asíncrono | cuerpo `async=1` en ambos | Responde `"queued": true`: aceptado, no ejecutado. El resultado se lee con `check_bulk_task_status`. Si la ONU ya tiene acciones en cola, una petición sin `async` también se encola. 409 `onu_busy` si otra petición cambia la ONU a la vez |
| Por lotes | `POST /api/onu/bulk_disable_catv` y `bulk_enable_catv` (`onus_external_ids` separados por coma) | Máximo 50 ids, o 10 000 con `async=1`. 400 si ya hay otra llamada al mismo método en curso. Cada ONU omitida trae su motivo |
| Estado | `GET /api/onu/get_onus_catv_statuses?olt_id=&board=&port=&zone=` | Por ONU: `unique_external_id`, `sn`, `catv_status` = `Enabled`, `Disabled` o `CATV not supported by ONU-Type` |
| Límites (del contrato `equipos-olt-acs.md` §2) | por cuenta | 1 000 llamadas por hora y 15 por segundo; las asíncronas tienen presupuesto aparte |

- También existen `enable_onu_voip_port` y `disable_onu_voip_port`; sirven a telefonía si entra más adelante.

### 1.3 Suscripciones y adicionales
- Adicionales (`apps/api/app/core/adicionales.ts`, contrato `adicionales.md`): catálogo por empresa, asignación por servicio (`incluido`, `cortesia`, `cobrado`), `primer_periodo`, bloqueo al suspender, eventos. Cobro en `lineasAdicionales` de `emitir_factura.ts` (línea tipo `otro`, hoy `4.1.03`).
- Falta: pausa por asignación, baja programada, categoría, cuenta propia y vista general.
- `billing.conceptos_recurrentes`: se lee al emitir (`emitir_factura.ts:195`), pero no encontré quién lo escriba.
- No existe ninguna entidad recurrente ligada al cliente sin servicio.
- Facturas sin servicio ya existen: `apps/api/app/billing/actions/emitir_cargo_unico.ts` emite con `servicio_id` opcional y `clave_unica = cargo-<uuid>`. `billing.facturas.servicio_id` es anulable y `clave_unica` es `text UNIQUE` (`1760900000008_crear_billing.ts`).
- `billing.promesas.servicio_id` es `NOT NULL`: hoy no hay promesa sin servicio.

### 1.4 Cobro con tarjeta
- Contrato `.claude/integration/contratos/pago-en-linea.md`; código en `apps/api/app/billing/pasarelas/` (`pasarela.ts` interfaz, `recurrente.ts`, `falsa.ts`, `cobros.ts`) y acciones `crear_cobro_pasarela.ts`, `procesar_webhook_pasarela.ts`, `conciliar_pasarela.ts`.
- Lo que existe: checkout de pago único en Recurrente, webhook con firma Svix e idempotente, pago con asiento y comisión, retención de IVA de la emisora, reembolsos, contracargos como diferencia, conciliación diaria.
- Lo que no existe: tokenización, método guardado, cliente en la pasarela ni cargo sin presencia del cliente. `pagos.metodo` ya admite `debito` en el modelo base, pero no hay flujo. El débito automático está en la fase 2 de `PLAN.md` (punto 8).
- Pendientes ya anotados en el contrato:
  - no hay cuenta ni Sandbox de Recurrente (bloqueo externo en `STATUS.md`);
  - una sola llave por instalación (multiempresa pendiente);
  - la facturación electrónica propia de Recurrente debe estar apagada.
- Recurrente, guía «Guardar y reutilizar métodos de pago» (<https://docs.recurrente.com/guias-espanol/guias/guardar-y-reutilizar-metodos-de-pago.md>, leída el 25 nov 2026):
  - `POST /api/customers` devuelve `cus_…`.
  - `POST /api/checkouts` con `mode: "setup"` y `customer_id` tokeniza sin cobrar (autorización de monto cero). La tarjeta se escribe solo en la página de Recurrente.
  - Resultado: webhook `setup_intent.succeeded` con `data.checkout.payment_method.id` (`pay_m_…`), o `setup_intent.cancelled`. Alternativa: `GET /api/checkouts/{id}`.
  - `GET /api/customers/{id}/payment_methods` devuelve `last4`, `network`, vencimiento y `status`.
  - Cobro: `POST /api/one_time_payments` con `customer_id`, `payment_method_id`, `items[]` y cabecera `Idempotency-Key`; responde `{ id: "on_…", status: "paid" }`.
  - Si el banco rechaza, no se reusa la misma `Idempotency-Key`: un intento nuevo lleva clave nueva.
  - Requiere «cobros únicos» habilitados en la cuenta.
  - «Los webhooks reales solo se envían para eventos de producción»: la tokenización completa se valida con llave LIVE.
  - Recurrente también ofrece suscripciones propias; no las propongo, porque el monto de Argos varía y la factura la certifica Argos.

### 1.5 Recordatorios y lugar (carril en espera)
- `notify.recordatorios`: 3 filas globales fijas respecto a `vence_en`. Plantillas globales `recordatorio.1..3` (`notify.plantillas`, `UNIQUE (evento, canal)`). Cron en `apps/api/app/notify/actions/programar_recordatorios.ts`.
- En WhatsApp el cuerpo es el código de Iris. No hay «corte próximo» ni «promesa por vencer». A52 está pendiente en Argos.
- La zona vive en el cliente. No hay precio ni reglas por zona.

## 2. Modelo propuesto

### 2.1 Tipos de servicio
- `network.planes.tipo_servicio` y `core.servicios.tipo_servicio`: `internet` (por defecto), `tv`, `mixto`. `telefonia` es opcional (P-N6). Un trigger exige que el del servicio coincida con el del plan.
- `network.planes.precio_tv numeric(14,2) NULL`: solo en mixto, para desglosar la factura. Velocidades anulables salvo en tipos con internet.
- `core.servicios.router_id` anulable, con CHECK: obligatorio en `internet` y `mixto`. `core.servicios.puntos smallint NULL` (televisores).
- Capacidades en código (`apps/api/app/core/tipos_servicio.ts`, nuevo):

| Tipo | Router, IP, RADIUS | Velocidad y «limitado» | Corte de la TV |
| --- | --- | --- | --- |
| internet | sí | sí | no aplica |
| tv | no | no | SmartOLT CATV si es gestionable; si no, aviso a Iris |
| mixto | sí | sí (internet) | internet por red; TV igual que arriba |

- Migración: todo lo existente queda `internet`.
- Eventos: `servicio.creado` suma `tipo_servicio` (`router_id` puede ser null). `servicio.config_cambiada` admite `tipo_servicio` en `campos`.

### 2.2 Corte de TV

**Por SmartOLT (sobre el modelo de `equipos-olt-acs.md`)**
- `integraciones.catv_ordenes`: `empresa_id`, `servicio_id`, `smartolt_instancia_id`, `accion` (`cortar` | `reconectar`), `estado` (`pendiente`, `en_curso`, `aplicado`, `fallido`, `cancelada`, `derivada`), `origen_outbox_id` único, `intentos`, `error`, `tarea_smartolt`, `aplicado_en`, `version`.
- `integraciones.equipos_servicio.catv_estado` (`habilitado` | `deshabilitado` | `no_soportado` | null): lo último que confirmó SmartOLT. Se borra cuando cambia el equipo del servicio, por evento y sin TTL.
- **CATV gestionable** = el servicio tiene `smartolt_external_id`, su instancia está operativa y `catv_estado` no es `no_soportado`.
- Eventos nuevos: `catv.estado_cambiado` (`servicio_id`, `empresa_id`, `cliente_id`, `de`, `a`, `orden_id`) y `catv.fallido` (`servicio_id`, `empresa_id`, `orden_id`, `accion`, `error`).
- Permisos: `servicios.ver_equipo` (existe en la rama) para ver el estado; `catv.reintentar` (admin, soporte) para reintentar una orden fallida.
- Endpoints: `GET /servicios/:id/catv` (estado y última orden) y `POST /servicios/:id/catv/reintentar`.

**Sin CATV gestionable: aviso a Iris (aditivo, contrato 0.15.0)**
- `core.solicitudes_corte_manual`: `empresa_id`, `servicio_id`, `componente` (`tv`), `accion` (`corte` | `reconexion`), `estado` (`solicitada`, `en_curso`, `resuelta`, `cancelada`, `sin_iris`), `motivo`, `iris_ticket_numero`, `resuelta_en`, `version`. Único parcial: una abierta por servicio y acción. Es un registro de estado; no hay pantalla de cola.
- Webhooks Argos → Iris (solo a conectores ≥ 0.15.0), ambos con `solicitud_id`, `servicio_id`, `empresa_id`, `cliente_id`, `componente`, `accion`, `motivo` y sin datos personales:
  - `servicio.corte_manual_solicitado`;
  - `servicio.corte_manual_cancelado`.
- Webhook Iris → Argos, por el receptor existente `/integraciones/iris/webhook`: `corte_manual.estado_cambiado` (`solicitud_id`, `empresa_id`, `estado` = `en_curso` | `resuelta` | `cancelada`, `ticket_numero`, `ocurrido_en`). Se deduplica por `X-Webhook-Id`.
- Sin conector de Iris o con contrato anterior: la solicitud queda `sin_iris`, se ve en la ficha del servicio y sale una alerta interna de notify.

### 2.3 Adicionales (suscripción dentro de la factura del servicio)
- `core.adicionales`: `categoria` (`streaming`, `canales_premium`, `ip_publica`, `seguro_equipo`, `membresia`, `otro`), `cuenta_codigo text NULL` (null = `4.1.03`) y `admite_independiente boolean DEFAULT false`.
- `core.servicios_adicionales.baja_programada date NULL`.
- `core.servicios_adicionales_pausas`: `asignacion_id`, `empresa_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- Eventos: `servicio.adicional_pausado` y `servicio.adicional_reanudado`.
- Permisos: `servicios.pausar_adicional` y `servicios.reanudar_adicional`.
- Endpoints: `POST /servicios/:id/adicionales/:asignacionId/pausar` y `/reanudar`; `efectiva: "ahora" | "fin_periodo"` en `quitar`; `GET /adicionales/asignaciones` (lista general).

### 2.4 Suscripciones independientes (entidad propia)

**Tablas (schema `billing`, dueño A3)**
- `billing.suscripciones`:
  - `empresa_id NOT NULL`, `cliente_id NOT NULL`, `codigo` (lo pone la base);
  - `producto_id NULL → core.adicionales` (catálogo con `admite_independiente`);
  - `descripcion`, `precio numeric(14,2) > 0`, `cantidad`, `ciclo_meses` (1, 3, 6 o 12; por defecto 1);
  - `plantilla_facturacion_id NOT NULL` (da ciclo, día, gracia, mora, `facturas_para_cortar` y `certificar_al`);
  - `inicio date`, `primer_periodo` (`prorrateado` | `completo` | `sin_costo`);
  - `estado` (`activa`, `pausada`, `suspendida`, `cancelada`), `suspension_manual bool`;
  - `baja_programada date NULL`, `cancelada_en`, `motivo_cancelacion`, `identificador`, `notas`, `version`.
  - Un trigger exige que producto y plantilla sean de la misma empresa.
- `billing.suscripciones_pausas`: `suscripcion_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- `billing.facturas.suscripcion_id bigint NULL`, con CHECK: nunca `servicio_id` y `suscripcion_id` a la vez. `facturas.tipo` suma `suscripcion`.

**Idempotencia.** `clave_unica = 'sus-<suscripcion_id>-<YYYY-MM-DD del periodo>'`. No choca con `<servicio_id>-<periodo>` (empieza con dígito) ni con `cargo-<uuid>`. Se inserta con `ON CONFLICT DO NOTHING`, igual que hoy.

**Eventos**
- `suscripcion.creada` (`suscripcion_id`, `empresa_id`, `cliente_id`, `producto_id`).
- `suscripcion.cambiada` (`campos[]`).
- `suscripcion.estado_cambiada` (`de`, `a`, `motivo`).
- `factura.*`, `pago.*` y `nota_credito.*` suman `suscripcion_id` (null en las demás).

**Permisos:** `suscripciones.ver`, `.crear`, `.editar`, `.pausar`, `.reanudar`, `.suspender`, `.reactivar`, `.cancelar`, `.emitir`. Admin, todos. Soporte: ver, crear, pausar, reanudar. Cajero y contabilidad: ver. Lectura: ver.

**Endpoints**
- `GET /suscripciones`, `POST /suscripciones`, `GET /suscripciones/:id`, `PUT /suscripciones/:id`.
- `POST /suscripciones/:id/pausar | reanudar | suspender | reactivar | cancelar`.
- `POST /suscripciones/generar` (manual del cron).
- `GET /clientes/:id/suscripciones`.

### 2.5 Cobro automático con tarjeta

**Tablas**
- `billing.pasarela_clientes`: `empresa_id`, `cliente_id`, `proveedor`, `id_proveedor` (`cus_…`); único por empresa, cliente y proveedor.
- `billing.metodos_pago`:
  - `empresa_id`, `cliente_id`, `proveedor`, `token_cifrado` (el `pay_m_…`, con `#shared/cifrado`; en auditoría `***`);
  - `marca`, `ultimos4`, `vence_mes`, `vence_anio`;
  - `estado` (`pendiente`, `activo`, `revocado`, `vencido`), `checkout_id`;
  - `consentimiento_en`, `consentimiento_version`, `consentimiento_canal`, `version`.
  - Nunca el número, el CVV ni el nombre impreso.
- `billing.debitos_automaticos`: `empresa_id`, `cliente_id`, `metodo_pago_id`, `alcance` (`cliente` | `servicio` | `suscripcion`), `servicio_id`, `suscripcion_id`, `momento` (`al_emitir` | `al_vencer`), `activo`, `desactivado_motivo`, `version`.
- `billing.debito_intentos` (solo inserción más cambio de estado): `factura_id`, `metodo_pago_id`, `cobro_id → billing.pasarela_cobros`, `intento_n`, `clave_idempotencia`, `estado` (`pendiente`, `pagado`, `rechazado`, `error`), `codigo_error`, `proximo_intento_en`. `UNIQUE (factura_id, intento_n)`.

**Interfaz del adaptador** (`pasarelas/pasarela.ts`), tres operaciones opcionales; un proveedor que no las tenga responde 503 `debito_no_soportado`:
- `crearTokenizacion`;
- `cobrarMetodoGuardado`;
- `consultarMetodo`.

**Eventos**
- `metodo_pago.guardado` y `metodo_pago.revocado` (`metodo_pago_id`, `empresa_id`, `cliente_id`, `marca`, `ultimos4`).
- `debito.activado` y `debito.desactivado`.
- `debito.fallido` (`factura_id`, `empresa_id`, `cliente_id`, `intento_n`, `codigo_error`, `reintenta`).
- El éxito sale como el `pago.registrado` de siempre.

**Permisos:** `debitos.ver`, `debitos.enviar_enlace`, `debitos.desactivar`, `debitos.reintentar` (admin, cajero, soporte). Activar es solo del cliente, desde el portal.

**Endpoints**
- Portal: `POST /portal/metodos-pago/iniciar`, `GET /portal/metodos-pago`, `POST /portal/metodos-pago/:id/quitar`, `POST /portal/debito/activar | desactivar`.
- Panel: `GET /clientes/:id/debito`, `POST /clientes/:id/debito/enviar-enlace`, `POST /debitos/:id/desactivar`, `POST /facturas/:id/debito/reintentar`.

### 2.6 Recordatorios por lugar (EN ESPERA)
Se conserva el modelo de la v1 sin cambios, pendiente de la aclaración del PM:
- `notify.recordatorios` ampliada con `empresa_id`, `zona_id`, `disparador`, `canales[]`, `evento_plantilla` y `clave_origen`.
- `notify.recordatorios_ambitos`.
- Jerarquía zona > empresa > global, con sustitución completa del conjunto.
- A52 y dos códigos nuevos de Iris (`corte_proximo`, `promesa_por_vencer`).

## 3. Reglas de negocio e impacto

### 3.1 Tipos de servicio y corte
- **Facturación.** Misma plantilla y mismo IVA. El concepto sale del tipo. El mixto emite dos líneas (internet con `4.1.01`; TV con cuenta nueva a confirmar con el contador). Prorrateo y descuentos de lealtad van sobre la línea de internet.
- **Decisión de estado.** `evaluarEstadoServicio` sigue siendo la única. En tv no existe «limitado».
- **Mixto con deuda (decisión del PM): se corta todo.** Al pasar a `suspendido`, el internet se corta por red como hoy y la TV por SmartOLT. En `limitado` no se toca el CATV, lo que respeta la restricción de SmartOLT de no deshabilitar la misma ONT varias veces por semana.
- **Flujo del corte de TV.** Un consumidor de `servicio.estado_cambiado` en `integraciones/equipos`, idempotente por id de outbox, crea la orden. El worker existente la ejecuta con lock por pedido.
  - Gestionable: llama a `disable_catv` o `enable_catv`.
  - 400 «CATV not supported»: marca `no_soportado`, deja la orden `derivada` y crea la solicitud a Iris.
  - 409 `onu_busy` o `queued: true`: no se da por hecho; se confirma con `check_bulk_task_status` o con `get_onus_catv_statuses`.
- **Corridas masivas.** El worker agrupa por instancia y usa `bulk_disable_catv` con `async=1` para no agotar las 1 000 llamadas por hora.
- **Reactivación.** Viaja por evento. Una orden de corte aún pendiente se cancela: nunca hubo corte. Una aplicada genera la reconexión. Lo mismo con la solicitud a Iris (`servicio.corte_manual_cancelado`).
- **Alta.** El tv va sin router, IP ni PPPoE. `pendiente_instalacion` y `activar-instalacion` funcionan igual, sin IPAM. Los decodificadores usan el comodato actual.
- **FEL y libro.** Sin cambios de mecanismo; solo descripción y cuenta por línea. Cualquier tratamiento fiscal distinto para TV debe confirmarlo el contador (no lo verifiqué).
- **ACL.** Un usuario con alcance por router no ve servicios sin router. Hay que documentarlo.
- **Iris.** `tipo_servicio` en la ficha y en los webhooks es aditivo (0.15.0).

### 3.2 Adicionales
Como en la v1:
- Pausa: no se cobra el periodo que empieza en pausa. Tope: `ajustes_cobro.pausa_tope_dias`.
- Baja inmediata sin reembolso, o programada a fin de periodo.
- Bloqueo al suspender el servicio.
- Cuenta de ingreso por línea.

### 3.3 Suscripciones independientes
- **Emisión.** El cron `suscripciones.generar` procesa todo lo pendiente hasta ahora, por lotes y con lock. Una factura por suscripción y periodo de `ciclo_meses`, con una línea «<nombre> del … al …», tipo `otro` y la cuenta del producto. Reusa `emitirDocumento`, igual que el cargo único sin servicio.
- **Qué no se emite.** Periodos en pausa, anteriores a `inicio`, posteriores a la cancelación, con la suscripción `suspendida` (recomendado, P-N2) o de monto cero (bonificación, nunca factura de Q0).
- **Vencimiento y mora.** `vence_en = periodo + dias_gracia` de la plantilla. Hoy `vencer_factura.ts` toma la configuración por servicio; hay que darle el camino por suscripción. No verifiqué el detalle.
- **FEL.** La regla de `certificar_al` de su plantilla y los datos fiscales del cliente. Sin cambios en `fiscal`.
- **Libro.** CxC del cliente contra ingreso (cuenta del producto) más IVA; `empresa_id` de la suscripción. Los anticipos del cliente en esa empresa se aplican como hoy.
- **Qué se suspende si no paga.**
  - No hay nada de red. `suscripciones.evaluar_estado` es la única que decide: con facturas vencidas de esa suscripción ≥ `facturas_para_cortar` pasa a `suspendida` y emite `suscripcion.estado_cambiada`.
  - La llaman el cron de corte, `registrarPago` y `anularPago`. El pago la reactiva en la misma transacción.
  - La suspensión manual solo se quita con `reactivar`.
  - Quien presta el servicio actúa con el evento. Mandarlo a Iris es opcional y aditivo.
  - La deuda de una suscripción no corta los servicios de red del cliente, y al revés (recomendado, P-N1).
- **Promesas.** No aplican en esta ronda: `billing.promesas.servicio_id` es obligatorio.
- **Baja.** Inmediata o programada a fin de periodo; sin reembolso del periodo ya facturado (nota de crédito manual si hace falta).
- **Portal.** «Mis suscripciones» (nombre, precio, ciclo, estado, próximo cobro) y sus facturas en la cuenta. Se pagan con el pago en línea existente (`{ facturas: [ids] }`). Ni alta ni baja desde el portal; nunca credenciales.
- **Notify.** `factura.emitida` y `factura.vencida` con `servicio_id` null ya ocurren con cargos únicos. Hay que agregar la variable `suscripcion.*` y el aviso de `suscripcion.estado_cambiada`.

### 3.4 Cobro automático
- **Sin datos de tarjeta en Argos.** El cliente escribe la tarjeta solo en el checkout alojado de Recurrente. Argos guarda el token cifrado, la marca, los últimos 4 y el vencimiento. El panel nunca captura tarjetas: solo envía el enlace.
- **Consentimiento.** Antes de redirigir, el portal muestra y registra el texto (versión, fecha, canal) con frecuencia, monto variable, momento del cargo y cómo cancelar. El texto legal lo aprueba el PM (P-N4).
- **Qué se cobra.** El saldo pendiente de cada factura dentro del alcance del débito (servicio, suscripción o todo el cliente), en el `momento` elegido.
- **Qué nunca se cobra.** Facturas `por_certificar`, anuladas, sustituidas, con saldo 0, con promesa activa o de un pago en disputa, ni montos bajo el mínimo de la pasarela (Q5.00).
- **Idempotencia.** El cron `debitos.cobrar` procesa todo lo pendiente, con lock.
  - Crea primero el `pasarela_cobros` y el `debito_intentos`; el `UNIQUE (factura_id, intento_n)` impide dos cargos entre réplicas.
  - Luego llama a la pasarela con `Idempotency-Key = argos:debito:<factura_id>:<intento_n>`.
  - El pago se registra con la misma acción interna del webhook, idempotente por cobro. Webhook y conciliación quedan de respaldo.
- **Rechazo.** El intento queda `rechazado`, sale `debito.fallido` y un aviso al cliente con enlace para pagar o cambiar la tarjeta. La factura sigue su vencimiento y corte normales. Reintento con clave nueva según la política (P-N3). Tras N rechazos seguidos o `setup_intent.cancelled`, el débito se desactiva solo, con evento.
- **Reactivación.** El pago del débito llama a `evaluarEstadoServicio` o a `suscripciones.evaluar_estado`, como cualquier pago.
- **Contracargo.** Usa el camino actual (`pago.disputa_abierta`) y además desactiva el débito de ese método.
- **Libro.** El mismo asiento del pago en línea (banco neto + `5.1.02` comisión / CxC, retención de IVA de la emisora). `pagos.metodo`: `debito`.
- **FEL.** Argos certifica con INFILE. La facturación electrónica de Recurrente debe seguir apagada: la guía dice que `one_time_payments` puede certificar FEL en cuentas que la usan.
- **Multiempresa.** Método y débito llevan `empresa_id`. Hoy hay una llave por instalación: con varios NIT hace falta llave por empresa o cuentas conectadas (`X-ACCOUNT-ID`), pendiente 5 de `pago-en-linea.md`.
- **Depende de la pasarela:**
  1. Cuenta y Sandbox, que hoy no existen.
  2. «Cobros únicos» habilitados en la cuenta.
  3. Forma exacta del webhook de un `one_time_payment` con método guardado y de `setup_intent.*`. La guía muestra `eventType` y `data.checkout.payment_method`; el resto hay que verlo en el Sandbox.
  4. Los webhooks reales de tokenización solo salen en producción.
  5. Cómo se revoca un método: no encontré el endpoint en la guía.
  6. Si un cargo sin presencia puede pedir 3-D Secure y qué responde entonces.
  7. El comercio no almacena tarjetas; el alcance PCI que resulte para el comercio no lo verifiqué.

## 4. Lotes ordenados

Carriles: T (tipos y corte), S (adicionales), I (suscripciones independientes), D (débito), R (en espera). Las migraciones se fusionan de una en una.

### Lote 0 · Contratos (líder)
- **Archivos:** este plan; nuevos `contratos/tipos-servicio.md`, `contratos/suscripciones.md`, `contratos/debito-automatico.md`; `adicionales.md`; `pago-en-linea.md`; `equipos-olt-acs.md` (sección CATV); `iris.md` (0.15.0: `tipo_servicio`, corte manual); `eventos.md`; catálogo de `CLAUDE.md`; `modelo-datos.md`.
- **Complejidad:** baja. **Dependencias:** P-N1 a P-N6.

### T1 · Modelo de tipo de servicio (A1)
- **Archivos:** migración; `apps/api/app/core/tipos_servicio.ts` (nuevo); `core/validators.ts`; `core/esquemas.ts`; `core/consultas/servicios.ts`; `network/consultas/planes.ts`; `network/validators.ts`; acciones de plan; `shared/eventos.ts`; `packages/contracts`.
- **Pruebas**
  - Tras migrar, todo es `internet`.
  - Tipo distinto al del plan da 422.
  - Plan mixto con `precio_tv` ≥ precio da 422.
  - Los filtros funcionan.
  - La suite actual no cambia.
- **Complejidad:** media. **Dependencias:** L0.

### T2 · Servicio de TV sin router (A1 + A2)
- **Archivos:** migración (`router_id` anulable y CHECK); `core/actions/crear_servicio.ts`; `editar_servicio.ts`; `activar_instalacion_servicio.ts`; `core/asignaciones_servicio.ts`; `core/aaa.ts`; `core/consumidor_aaa.ts`; `network/routeros/*`; `network/sesiones/*`; `services/coa`; `core/acl.ts`; consultas con join a routers.
- **Pruebas**
  - Crear un tv sin router devuelve 201, sin clave AAA y sin filas en `audit.red`.
  - Aparece en la lista, en la ficha del cliente, en reportes y en la exportación a Iris.
  - Internet sin router da 422.
  - Activar la instalación no pide IP.
  - Alcance por router no lo ve; por zona sí.
  - Retirar y eliminar funcionan.
- **Complejidad:** alta. **Dependencias:** T1.

### T3a · Corte manual avisado a Iris (A1 + integraciones Iris)
- **Archivos:** migración `core.solicitudes_corte_manual`; acción nueva `core/actions/solicitar_corte_manual.ts` (anidada, no por API); `integraciones/iris/envios.ts` (lista de eventos ≥ 0.15.0); `integraciones/iris/configuracion.ts`; receptor de webhooks de Iris; alerta en `notify/alertas.ts`; `contratos/iris.md`.
- **Pruebas**
  - Tv no gestionable suspendido: una solicitud y un webhook a un conector 0.15.0.
  - Conector 0.14.x: no recibe el evento y la solicitud queda `sin_iris`, con alerta.
  - Pago antes de resolver: `servicio.corte_manual_cancelado`.
  - Pago con corte `resuelta`: solicitud de `reconexion`.
  - Webhook `corte_manual.estado_cambiado` repetido no cambia nada.
  - `solicitud_id` de otra empresa: 404.
- **Complejidad:** media. **Dependencias:** T2 y acuerdo con Iris (el evento sale igual; Iris lo consume cuando llegue a 0.15.0).

### T3b · Corte y reconexión de CATV por SmartOLT (A6)
- **Archivos:** migración `integraciones.catv_ordenes` y `equipos_servicio.catv_estado`; `integraciones/equipos/smartolt.ts` (`deshabilitarCatv`, `habilitarCatv`, por lotes, `estadoCatv`, estado de tarea); consumidor nuevo de `servicio.estado_cambiado`; `integraciones/equipos/cola.ts`; acciones `aplicar_catv.ts` y `reintentar_catv.ts`; `capacidades.ts`; rutas; `tests/integraciones/equipos_simulado.ts`.
- **Pruebas (con el SmartOLT simulado)**
  - Mixto suspendido: Disconnect y `disable_catv` a la instancia correcta; la otra instancia recibe 0 peticiones.
  - Reactivado: `enable_catv` y `catv.estado_cambiado`.
  - Evento duplicado: una sola orden.
  - 400 «CATV not supported»: `no_soportado` y solicitud a Iris.
  - `queued: true`: no queda `aplicado` hasta confirmar la tarea.
  - 409 `onu_busy` y 429: reintento.
  - Instancia no operativa: deriva a Iris.
  - Paso a `limitado`: 0 llamadas.
  - 120 cortes de una instancia: una llamada por lotes.
  - El token no aparece en auditoría.
- **Complejidad:** alta. **Dependencias:** T1, T3a y la fusión de `agente/a6-olt-acs`.

### T4 · Facturación, libro y FEL por tipo (A3 + auditor)
- **Archivos:** `billing/actions/emitir_factura.ts`; `billing/facturas.ts`; `billing/configuracion.ts`; `ledger/plan_cuentas.ts`; versión nueva del paquete fiscal; descripción del ítem en `fiscal`; `billing/reportes/*`; `apps/api/tests/contabilidad/`.
- **Pruebas**
  - Factura de tv con su concepto y su cuenta.
  - Mixto: dos líneas que suman el precio, prorrateado y con descuento de lealtad.
  - Instalar el paquete dos veces no agrega nada.
  - Factura de internet idéntica a la actual.
  - Invariantes del auditor en verde.
- **Complejidad:** alta. **Dependencias:** T1 (mixto), T2 (tv), cuenta confirmada por el contador.

### T5 · Panel y portal (A4 + A5)
- **Archivos:** `apps/web/app/pages/servicios/nuevo.vue` y el asistente de alta; `servicios/[id]/index.vue` (bloque «TV»: estado CATV, última orden, solicitud a Iris con su ticket, «Reintentar»); `servicios/index.vue`; `planes/nuevo.vue`; `planes/[id]`; portal `index.vue` y `cuenta.vue`.
- **Pruebas**
  - Alta de tv sin router ni IP.
  - La ficha muestra el estado CATV o «Corte pendiente en Iris TK-…».
  - Un error del endpoint se ve con «Reintentar», nunca como un estado inventado.
  - 390 y 1280 px, claro y oscuro.
  - `pnpm verificar:permisos` pasa.
- **Complejidad:** media. **Dependencias:** T2, T3a, T3b. **Tablero:** sí (variantes de `FlujoAlta`, `NuevoAltaCliente`, `OperServicioFicha`). Ya no hay tablero de cola.

### T6 · Bordes (A6)
- **Archivos:** `notify/variables.ts` y `plantillas_base.ts` (textos por tipo); `importacion/origenes/mikrowisp.ts` (todo se importa como internet); datos de demostración.
- **Complejidad:** baja. **Dependencias:** T2.

### S1 · Catálogo de adicionales ampliado (A1 + A3)
- **Archivos:** migración; `core/adicionales.ts`; `crear_adicional.ts`; `editar_adicional.ts`; validadores; `lineasAdicionales` en `emitir_factura.ts`; `adicionales.md`.
- **Pruebas**
  - Línea con `cuenta_codigo` y asiento cuadrado.
  - Sin cuenta: `4.1.03`.
  - Cuenta inexistente: 422.
  - Los existentes quedan `otro` o `ip_publica`.
- **Complejidad:** media. **Dependencias:** L0.

### S2 · Pausa y baja programada de adicionales (A1 + A3)
- **Archivos:** migración; `pausar_adicional_servicio.ts` y `reanudar_adicional_servicio.ts` (nuevas); `quitar_adicional_servicio.ts`; `core/jobs.ts`; `emitir_factura.ts`.
- **Pruebas**
  - Periodo en pausa no cobra; el siguiente sí.
  - Pausar un `incluido`: 422.
  - Pausa sobre el tope: 422.
  - Baja programada cobra el periodo en curso y no el siguiente.
  - El job dos veces no duplica.
- **Complejidad:** media. **Dependencias:** S1.

### S3 · Panel de adicionales (A4)
- **Archivos:** `apps/web/app/pages/adicionales/index.vue`; `AdicionalModal.vue`; `AdicionalServicioModal.vue`; pestaña «En servicios» de la página de I4.
- **Complejidad:** baja a media. **Dependencias:** S2. **Tablero:** el mismo de I4.

### I1 · Modelo y ciclo de vida de la suscripción independiente (A3)
- **Archivos:** migración (`billing.suscripciones`, pausas, `facturas.suscripcion_id`, tipo); `billing/suscripciones.ts` (nuevo); acciones nuevas en `billing/actions/` (`crear_suscripcion`, `editar_suscripcion`, `pausar_suscripcion`, `reanudar_suscripcion`, `cancelar_suscripcion`); `billing/validators.ts`; `billing/esquemas.ts`; ruta nueva `start/routes/suscripciones.ts`; `core/permisos.ts`; `core/eliminacion.ts` (un cliente con suscripciones no se elimina).
- **Pruebas**
  - Crear con producto de otra empresa: 422.
  - Producto sin `admite_independiente`: 422.
  - Edición con `version` vieja: 409.
  - Cancelar dos veces: 422.
  - La lista se filtra por empresa activa y alcance.
  - Cada acción deja auditoría y evento.
  - `Idempotency-Key` repetida devuelve la misma respuesta.
- **Complejidad:** media. **Dependencias:** S1 (catálogo).

### I2 · Emisión, FEL, libro y mora (A3 + auditor)
- **Archivos:** acciones nuevas `emitir_factura_suscripcion.ts` y `generar_facturas_suscripciones.ts`; `billing/periodos.ts` (ciclo de N meses); `billing/jobs.ts`; `billing/emision.ts`; `billing/actions/vencer_factura.ts` y `vencer_facturas.ts`; `billing/estado_cuenta.ts`; `billing/reportes/*`; `tests/contabilidad/`.
- **Pruebas**
  - Correr el cron dos veces: una sola factura con clave `sus-<id>-<periodo>`.
  - Dos réplicas a la vez: una factura.
  - Tras una caída de 3 meses emite los 3 periodos.
  - Pausada, cancelada o anterior a `inicio`: no emite.
  - Ciclo de 3 meses: una factura cada 3.
  - Primer periodo prorrateado.
  - Monto cero: bonificación.
  - `certificar_al = emitir` con FEL obligatoria: nace `por_certificar`.
  - Asiento con la cuenta del producto y la empresa correcta.
  - La factura vence y recibe mora según su plantilla.
  - No cuenta para el corte de ningún servicio.
  - Invariantes: CxC = facturas pendientes; saldo del cliente = auxiliar.
- **Complejidad:** alta. **Dependencias:** I1.

### I3 · Estado por mora y pagos (A3)
- **Archivos:** acciones nuevas `evaluar_estado_suscripcion.ts`, `suspender_suscripcion.ts`, `reactivar_suscripcion.ts`; `registrar_pago.ts`; `anular_pago.ts`; `ejecutar_corte.ts`; `aprobar_comprobante.ts`.
- **Pruebas**
  - Vencidas ≥ umbral: `suspendida`, con evento, y no emite el periodo siguiente.
  - El pago la reactiva en la misma transacción.
  - Anular ese pago la vuelve a suspender.
  - La suspensión manual no se quita con un pago.
  - Un servicio del mismo cliente no cambia de estado.
  - Cobro repartido entre empresas con una factura de suscripción.
- **Complejidad:** media. **Dependencias:** I2.

### I4 · Panel, portal y avisos (A4 + A5 + A6)
- **Archivos:** página nueva `apps/web/app/pages/suscripciones/` (pestañas «Independientes» y «En servicios»); pestaña en la ficha del cliente; composable `useSuscripciones`; portal `cuenta.vue` y página nueva «Mis suscripciones»; consultas en `apps/api/app/portal/`; `notify/variables.ts`, `plantillas_base.ts` y `catalogo.ts`.
- **Pruebas**
  - El total mensual coincide con la suma de activas.
  - El portal no muestra suscripciones de otro cliente (404).
  - Pagar en línea la factura de una suscripción la reactiva.
  - El aviso de factura de suscripción no menciona plan ni velocidad.
  - 390 y 1280 px, claro y oscuro.
- **Complejidad:** media. **Dependencias:** I3. **Tablero:** sí (lista, ficha y alta de suscripción; bloque del portal).

### D1 · Tokenización: modelo, adaptador y webhook (A3)
- **Archivos:** migración (`pasarela_clientes`, `metodos_pago`); `billing/pasarelas/pasarela.ts`; `recurrente.ts`; `falsa.ts`; acciones nuevas `iniciar_metodo_pago.ts`, `registrar_metodo_pago.ts`, `revocar_metodo_pago.ts`; `procesar_webhook_pasarela.ts`; `shared/enmascarar` (token); `pago-en-linea.md`.
- **Pruebas (con la pasarela falsa)**
  - Iniciar devuelve URL y método `pendiente`.
  - Webhook de éxito: `activo` con últimos 4 y evento.
  - Webhook repetido no duplica.
  - Cancelado: no queda activo.
  - Firma inválida: 401.
  - El token no aparece en respuestas, auditoría ni eventos.
  - `url_retorno` fuera de los orígenes permitidos: 422.
  - La prueba real con Sandbox se salta sola sin llave.
- **Complejidad:** media. **Dependencias:** L0. Verificarlo contra Recurrente depende de la cuenta.

### D2 · Cargo recurrente (A3 + auditor)
- **Archivos:** migración (`debitos_automaticos`, `debito_intentos`); acciones nuevas `activar_debito.ts`, `desactivar_debito.ts`, `cobrar_debitos.ts`, `cobrar_factura_debito.ts`, `reintentar_debito.ts`; `billing/jobs.ts`; `billing/cobros.ts`; `registrar_pago.ts` (método `debito`); `conciliar_pasarela.ts`.
- **Pruebas**
  - Factura emitida con débito `al_emitir`: un cargo, pago, asiento con comisión y reactivación del servicio.
  - Cron dos veces y dos réplicas: un solo cargo.
  - Rechazo: `debito.fallido`, la factura sigue pendiente y el reintento usa otra clave.
  - N rechazos desactivan el débito.
  - Promesa activa, `por_certificar` o monto bajo Q5: no cobra.
  - Timeout de la pasarela: se reintenta con la misma clave y no duplica.
  - Contracargo desactiva el débito.
  - Pago manual antes del cron: no cobra.
  - Dos empresas: nunca un cargo que mezcle facturas de dos NIT.
  - Invariantes del auditor.
- **Complejidad:** alta. **Dependencias:** D1; cuenta de Recurrente con cobros únicos para la verificación real; I2 si debe cubrir suscripciones.

### D3 · Portal, panel y avisos (A5 + A4 + A6)
- **Archivos:** portal, página nueva «Pago automático» (consentimiento, tarjeta `•••• 4242`, cambiar, quitar); `apps/api/app/portal/` (rutas); ficha del cliente en el panel (estado, enviar enlace, desactivar, historial de intentos); plantillas de notify (`debito.fallido`, tarjeta por vencer); walled garden para el checkout de tokenización.
- **Pruebas**
  - Sin aceptar el consentimiento no se inicia.
  - El portal nunca tiene un campo de tarjeta.
  - Volver con `estado=cancelado` muestra el error con «Intentar de nuevo».
  - El panel no puede activar el débito por el cliente.
  - 390 y 1280 px, claro y oscuro.
- **Complejidad:** media. **Dependencias:** D2. **Tablero:** sí (portal y bloque de la ficha).

### R1 a R5 · Recordatorios por lugar (EN ESPERA)
No arrancan hasta que el PM aclare qué significa «personalizado según el lugar»; preguntó si se refería a Firebase. Se conservan como en la v1:
- **R1:** reglas y ámbitos en `notify`, complejidad alta.
- **R2:** disparadores corte próximo y promesa por vencer, alta.
- **R3:** A52, plantillas de WhatsApp de Iris, media.
- **R4:** panel, media, con tablero.
- **R5:** opcionales por lugar.

Si la respuesta es notificaciones push (Firebase), el carril cambia de forma: sería un canal nuevo de `notify` y no reglas por zona.

**Orden sugerido:** L0 → (T1, S1, D1 en paralelo) → (T2, I1, S2) → (T3a, I2, T4, D2) → (T3b, I3) → (T5, T6, I4, S3, D3).

**Modelo del ejecutor:** alto en T2, T3b, T4, I2 y D2; medio en el resto; bajo en L0 y T6.

**Riesgos**
- Joins a routers en T2.
- Límites y restricción semanal de SmartOLT en T3b.
- Cuenta nueva del paquete fiscal en T4.
- Doble cargo en D2.
- Dependencias externas: Recurrente, Iris 0.15.0 y la rama `a6-olt-acs`.

## 5. Preguntas nuevas para el PM

1. **P-N1. ¿La deuda de una suscripción independiente corta también los servicios de internet o TV del mismo cliente?** *Recomendado: no; cada una se suspende por su propia deuda.*
2. **P-N2. Suscripción independiente suspendida por mora: ¿sigue facturando los periodos siguientes?** *Recomendado: no; se reanuda al pagar.*
3. **P-N3. Cargo rechazado: ¿cuántos reintentos automáticos?** *Recomendado: uno a los 3 días y, después, solo cuando el cliente cambie la tarjeta; tras 3 rechazos seguidos se desactiva.*
4. **P-N4. ¿Quién redacta y aprueba el texto de consentimiento del cobro automático?** *Recomendado: el PM con su asesor legal; Argos guarda la versión aceptada.*
5. **P-N5. ¿Cuándo se hace el cargo: al emitir la factura o el día que vence?** *Recomendado: al emitir, con opción «al vencer» por cliente.*
6. **P-N6. ¿Entra telefonía ahora?** *Recomendado: no; SmartOLT tiene puerto VoIP y se puede sumar después con el mismo patrón del CATV.*
7. **P-N7. ¿Cada empresa (NIT) tendrá su propia cuenta de Recurrente?** *Recomendado: sí, llave por empresa; sin eso el débito solo sirve con una empresa.*
8. **P-N8. Servicio de solo TV por coaxial (sin ONU): ¿existe en la operación?** *Recomendado: confirmar; si no existe, T2 se reduce y todo tv tendría ONU.*
9. **P-N9 (carril R). ¿«Según el lugar» es zona o empresa, o se refería a notificaciones push con Firebase?** *Sin recomendación: decide el alcance del carril.*

## 6. Respuestas del PM (25 nov 2026)

- **P1 Suscripciones: ambas.** Cobros extra dentro de la factura del servicio, suscripciones propias sin servicio de red con su propia factura, y cobro automático con tarjeta. Sustituye la idea de servicio tipo `otro`.
- **P4 Mixto con deuda: se corta todo.** En fibra con CATV, la TV se corta y reconecta por SmartOLT; solo sin SmartOLT o sin CATV va a campo.
- **P5 Corte en campo: Argos solo avisa a Iris.** Iris lleva tickets y órdenes; no hay cola en Argos; Argos muestra el estado que Iris devuelva.
- **P7/P8 Recordatorios por lugar:** pendiente de aclarar. El carril R no arranca.

### 6.1 Respuestas del PM (26 nov 2026) a las preguntas nuevas del §5

- **P-N1 → la suscripción también puede ir sobre un servicio.** Una suscripción puede ser independiente o colgar de un servicio de internet o de TV. El PM no dijo si la deuda de una corta a las demás; mientras no lo diga, vale lo recomendado: cada una se suspende por su propia deuda.
- **Cable e IPTV son tipos distintos.**
  - Cable (CATV) llega por fibra, con ONU, y se corta por SmartOLT.
  - IPTV va sobre IP: se corta como un servicio de datos, por RADIUS o RouterOS.
  - Por eso los tipos quedan así: `internet`, `cable` (CATV), `iptv` y `mixto`. Mixto es una combinación de los anteriores, por ejemplo internet + cable.
- **P-N3/P-N5 → cobro al emitir, con un reintento.** Se cobra al emitir la factura. Si el banco la rechaza, se reintenta una vez a los 3 días. Después de 3 rechazos seguidos, el débito se desactiva y se avisa al cliente.
- **P-N7 → el débito no es solo para Recurrente.** Recurrente es una pasarela más.
  - La tokenización y el cargo recurrente se diseñan independientes de la pasarela: un adaptador por proveedor (Recurrente, NeoNet y las que vengan) detrás de una interfaz común.
  - La llave va por empresa y por pasarela (regla 14).
- **P-N8 → no hay TV por coaxial; todo es fibra.**
  - T2 no necesita un caso «TV sin ONU».
  - El corte de cable siempre va por SmartOLT.
  - El aviso a Iris (T3a) queda solo de respaldo: cuando SmartOLT falla o el servicio no tiene ONU registrada.
- **Sin respuesta todavía:** P-N2 (seguir facturando una suscripción suspendida), P-N4 (texto de consentimiento) y P-N6 (telefonía). Mientras tanto se aplica lo recomendado.
- **Recordatorios (P-N9):** son plantillas como las de facturación, con nombre, asignadas por servicio o suscripción y con una por defecto en cada empresa. El cliente puede tener recordatorios personalizados por servicio. No van por zona ni son notificaciones push con Firebase. El carril R puede arrancar con ese alcance.

### Critical Files for Implementation
- /home/user/wt-plan-servicios/apps/api/app/billing/actions/emitir_factura.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/actions/emitir_cargo_unico.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/pasarelas/pasarela.ts
- /home/user/wt-plan-servicios/apps/api/app/integraciones/equipos/smartolt.ts
- /home/user/wt-plan-servicios/apps/api/app/core/actions/cambiar_estado_servicio.ts