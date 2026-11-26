# Contrato: tipos de servicio (internet, cable, IPTV y mixto)

Lote L0 del plan v3 (`plan-servicios-suscripciones-recordatorios.md`, §2.1, §2.2 y §3.1). Respuestas del PM del 25 y 26 nov 2026 (plan §6). Es la fuente de verdad para los lotes T1 a T6. Cambios a este contrato: en la misma PR que el código que lo cumple (regla 12 de `CLAUDE.md`).

Dueños: A1 (modelo y alta), A2 (red sin router), A3 (facturación y estado), A6 (corte por SmartOLT y aviso a Iris), A4 y A5 (pantallas). El contrato con Iris (bloques A y B) está en `iris.md` 0.15.0, propuesta aceptada por Iris con ajustes y pendiente de la PR espejo (la versión vigente sigue en 0.14.3).

## 1. Tipos

| Tipo | Qué es | Router, IP y RADIUS | Velocidad | Estado `limitado` | Cómo se corta |
| --- | --- | --- | --- | --- | --- |
| `internet` (por defecto) | Datos por PPPoE, IP estática o DHCP fija | Sí | Sí | Sí | Red (`aaa`, `coa`, `routeros`), como hoy |
| `cable` | CATV por fibra, siempre con ONU. No existe TV por coaxial | No | No | No | SmartOLT `disable_catv` / `enable_catv`. Respaldo: aviso a Iris (§4) |
| `iptv` | Servicio de datos con router y plan propios (decisión del PM, P-N10). Va sobre IP | Sí | Sí, la del perfil de IPTV | **Nunca** se limita: pasa directo de `activo` a `suspendido` | Red, igual que internet. No hay código nuevo de corte |
| `mixto` | Combinación de dos o tres componentes: `internet`, `cable`, `iptv` | Sí (siempre tiene internet o IPTV) | Sí | Solo si incluye `internet` | Cada componente por su vía: lo que va sobre IP por red, el cable por SmartOLT |

- Las capacidades viven en un solo archivo de código, `apps/api/app/core/tipos_servicio.ts` (nuevo), que es la única fuente para validadores, facturación, corte y pantallas. Nadie compara `tipo_servicio === 'cable'` fuera de ese módulo: pregunta por la capacidad (`requiereRouter`, `admiteLimitado`, `componentes`, `corteSmartolt`).
- **Mixto con deuda: se corta todo** (decisión del PM, 25 nov). Al pasar a `suspendido`, lo que va sobre IP se corta por red y el cable por SmartOLT. En `limitado` no se toca el CATV: respeta la restricción de SmartOLT de no deshabilitar la misma ONU varias veces por semana.
- **Qué tiene router y velocidad (A1 de Iris).** Un servicio tiene router y velocidad si sus `componentes` incluyen `internet` o `iptv`. Iris trata un tipo que no conoce como `internet`, salvo con `router_id` null: ahí no tiene router.
- Telefonía (VoIP) no entra en esta ronda (P-N6 sigue abierta, recomendado: no). SmartOLT tiene `enable_onu_voip_port` y `disable_onu_voip_port`; se sumarían después como un tipo más con el mismo patrón del cable.

## 2. Modelo de datos

- `network.planes.tipo_servicio` y `core.servicios.tipo_servicio`: `internet` (por defecto), `cable`, `iptv`, `mixto`. Un trigger exige que el del servicio coincida con el del plan. `planes.tipo` (`residencial`, `empresarial`, `dedicado`) es comercial y no cambia.
- `network.planes.componentes text[]`: en los tipos simples es el mismo tipo; en `mixto`, dos o tres de `internet`, `cable`, `iptv`. `core.servicios` no la duplica: se lee del plan.
- `network.planes.precio_cable` y `precio_iptv` (`numeric(14,2)` nulos): solo en `mixto`, para desglosar la factura. La línea de internet es el precio del plan menos esas dos. En un mixto sin internet (cable + IPTV), `precio_iptv` es el resto. La suma de las líneas es siempre el precio del plan.
- `network.planes.bajada_kbps` y `subida_kbps` anulables solo en `cable`: en un plan de cable pueden ser null (A2 de Iris).
- `core.servicios.router_id` anulable, con CHECK: obligatorio en todo tipo salvo `cable`.
- `core.servicios.puntos smallint NULL` (televisores o decodificadores; informativo).
- Migración: todo lo existente queda `internet` con `componentes = {internet}`. Ninguna prueba ni pantalla actual cambia.
- Validaciones (422): tipo distinto al del plan; plan `mixto` con menos de dos componentes; `precio_cable + precio_iptv` mayor o igual al precio habiendo internet; velocidad nula en un plan que no sea `cable`; router en un `cable` no se exige y, si llega, se ignora con aviso (el cable no usa router); router ausente en cualquier otro tipo.

## 3. Alta y ciclo de vida

- **Cable:** se da de alta sin router, IP ni PPPoE. Sin clave AAA y sin filas en `audit.red`. `pendiente_instalacion` y `activar-instalacion` funcionan igual, sin IPAM. La ONU la registra la instalación por el flujo de equipos que ya existe (`integraciones.equipos_servicio` con `smartolt_external_id`). **El alta no se bloquea** si aún no tiene ONU: la ficha lo advierte.
- **IPTV y mixto:** se dan de alta como un internet (router, IP, usuario PPP, velocidad).
- **ACL:** un usuario con alcance por router no ve servicios de cable (no tienen router). Por zona y por empresa sí. Se documenta en `core/README.md`.
- **Consumidores de red:** `coa` y `routeros` ignoran `servicio.estado_cambiado` de un cable sin fallar y sin emitir `coa.fallido`.
- **Eventos con el tipo:** `servicio.creado` suma `tipo_servicio` y `componentes[]` (`router_id` puede ser null). `servicio.config_cambiada` admite `tipo_servicio` en `campos[]`. `catalogo.cambiado` de plan admite `tipo_servicio` y `componentes` en `campos[]`. **Si cambia el tipo de un plan o de un servicio, cada servicio afectado emite `servicio.config_cambiada` con `tipo_servicio` en `campos[]`** (A5 de Iris): `catalogo.cambiado` solo no alcanza. Todo aditivo; el detalle está en `eventos.md`.
- **Lecturas y rutas con Iris (A3, A6 de Iris).** `GET /planes` suma el filtro `tipo_servicio` (`GET /planes?tipo_servicio=cable` lista los planes de cable). `GET /servicios` (lista, ficha y relectura de la primera sincronización) trae siempre `tipo_servicio` y `componentes[]`. Con un servicio de cable, `POST /servicios/:id/reservar-ip`, `POST /servicios/:id/aprovisionar`, `GET /planes?router_id=` y `POST /servicios/:id/cambiar-plan` responden `422 tipo_sin_router` y no hacen ningún cambio. La factibilidad de un cable en Iris es `indeterminado` con motivo `tipo_sin_router` hasta que Argos exponga la planta CATV.

## 4. Facturación y estado (T4)

- Misma plantilla de facturación y mismo IVA. El concepto de la línea sale del tipo: «Servicio de internet …», «Servicio de cable …», «Servicio de IPTV …». El mixto emite **una línea por componente**.
- Cuentas de ingreso: internet `4.1.01` (sin cambios). Cable e IPTV necesitan **cuentas nuevas**: `4.1.05` y `4.1.06` ya son de lealtad en la localización de Guatemala. Las confirma el contador (P-N14); **T4 no se fusiona sin ellas**. El paquete fiscal sube de versión al agregarlas y instalarlo dos veces no agrega nada.
- Prorrateo y descuentos de lealtad van proporcionales a cada línea; la suma de las líneas es el precio del plan. Una factura de internet queda idéntica a la actual (regresión byte a byte de líneas y asiento).
- **`evaluarEstadoServicio` sigue siendo la única que decide el estado.** Lee las capacidades del tipo: en `cable` e `iptv` no existe `limitado` y `facturas_para_limitar` se ignora; al llegar a `facturas_para_cortar` pasan a `suspendido`.
- FEL y libro: sin cambios de mecanismo, solo descripción y cuenta por línea. Cualquier tratamiento fiscal distinto para la TV lo confirma el contador.
- Los avisos de un cable o un IPTV no mencionan plan de velocidad (T6).

## 5. Corte del cable por SmartOLT (T3b, A6)

API de SmartOLT (especificación oficial OpenAPI «SmartOLT API 1.0», <https://www.smartolt.com/openapi.json>, leída el 25 nov 2026):

| Operación | Endpoint | Notas |
| --- | --- | --- |
| Cortar CATV | `POST /api/onu/disable_catv/{onu_external_id}` | 200 `{ status: true, response: "CATV disabled" }`. 400 si no hay ONU, si «CATV not supported by ONU-Type» o si la OLT no pudo. No usar para deshabilitar repetidamente la misma ONU varias veces por semana |
| Reconectar CATV | `POST /api/onu/enable_catv/{onu_external_id}` | 200 `"CATV enabled"`; mismos 400 |
| Asíncrono | cuerpo `async=1` | Responde `"queued": true`: aceptado, no ejecutado. El resultado se lee con `check_bulk_task_status`. 409 `onu_busy` si otra petición cambia la ONU a la vez |
| Por lotes | `bulk_disable_catv` y `bulk_enable_catv` (`onus_external_ids` separados por coma) | Máximo 50 ids, o 10 000 con `async=1`. 400 si ya hay otra llamada al mismo método en curso |
| Estado | `GET /api/onu/get_onus_catv_statuses` | `catv_status`: `Enabled`, `Disabled` o `CATV not supported by ONU-Type` |

Los nombres `disable_onu_catv` / `enable_onu_catv` **no existen**. Límites por cuenta (`equipos-olt-acs.md` §2): 1 000 llamadas por hora y 15 por segundo.

### 5.1 Datos (sobre el modelo de `equipos-olt-acs.md`, rama `agente/a6-olt-acs`)

- `integraciones.catv_ordenes`: `empresa_id`, `servicio_id`, `smartolt_instancia_id`, `accion` (`cortar` | `reconectar`), `estado` (`pendiente`, `en_curso`, `aplicado`, `fallido`, `cancelada`, `derivada`), `origen_outbox_id` (único: idempotencia), `intentos`, `error`, `tarea_smartolt`, `aplicado_en`, `version`.
- `integraciones.equipos_servicio.catv_estado` (`habilitado` | `deshabilitado` | `no_soportado` | null): lo último que confirmó SmartOLT. Se borra cuando cambia el equipo del servicio, por evento y sin TTL.
- **CATV gestionable** = el servicio tiene `smartolt_external_id`, su instancia está operativa (activa y probada) y `catv_estado` no es `no_soportado`.

### 5.2 Flujo

1. Un consumidor de `servicio.estado_cambiado` en `integraciones/equipos`, idempotente por id de outbox, crea la orden si el servicio tiene el componente `cable`. Internet e IPTV nunca llaman a SmartOLT. Paso a `limitado`: cero llamadas.
2. El worker existente la ejecuta con lock por pedido (regla 6). Gestionable: llama a `disable_catv` o `enable_catv` en la instancia correcta.
3. `queued: true` o 409 `onu_busy`: no se da por hecho; se confirma con `check_bulk_task_status` o `get_onus_catv_statuses`. 429: reintento con espera.
4. 400 «CATV not supported»: marca `no_soportado`, deja la orden `derivada` y crea la solicitud de respaldo a Iris (§6).
5. Reintentos agotados, instancia no operativa o servicio sin ONU: orden `derivada` (o ninguna orden) y solicitud de respaldo.
6. **Corridas masivas:** el worker agrupa por instancia y usa `bulk_disable_catv` con `async=1` para no agotar las 1 000 llamadas por hora.
7. **Reactivación:** viaja por evento, nunca espera al cron. Una orden de corte aún pendiente se cancela (nunca hubo corte). Una aplicada genera la reconexión. Lo mismo con la solicitud a Iris (`servicio.corte_manual_cancelado`).
8. El token de SmartOLT nunca aparece en auditoría, eventos ni respuestas.

### 5.3 Eventos, permisos y endpoints

- Eventos: `catv.estado_cambiado` y `catv.fallido` (payloads en `eventos.md`).
- Permisos: `servicios.ver_equipo` (existe en la rama `a6-olt-acs`) para ver el estado; `catv.reintentar` (admin, soporte) para reintentar una orden fallida.
- Endpoints: `GET /servicios/:id/catv` (estado, última orden y solicitud de respaldo) y `POST /servicios/:id/catv/reintentar`.

## 6. Respaldo: corte manual avisado a Iris (T3a, A6; Iris 0.15.0 bloque B, aceptado con ajustes)

Decisión del PM (25 nov): Argos solo avisa a Iris; Iris lleva las órdenes; **no hay cola en Argos**, solo un registro de estado que Argos muestra.

Solo en tres casos: el servicio de cable no tiene ONU registrada, su instancia de SmartOLT no está operativa, o la orden agotó sus reintentos (incluye «CATV not supported by ONU-Type»).

- `integraciones.cortes_manuales`: `empresa_id`, `servicio_id`, `catv_orden_id` (o null si no hubo orden), `componente` (`cable`), `accion` (`corte` | `reconexion`), `causa` (`sin_onu` | `instancia_no_operativa` | `smartolt_fallo` | `catv_no_soportado`), `estado` (`solicitada`, `en_curso`, `resuelta`, `cancelada`, `no_realizada`, `sin_iris`, `sin_respuesta`), `motivo_codigo` (solo con `no_realizada`: `sin_acceso`, `equipo_no_encontrado`, `otro`), `referencia` y `referencia_tipo` (`orden` | `ticket`; reemplazan a `iris_ticket_numero`), `solicitada_en`, `resuelta_en`, `version` (la de la solicitud, creciente). Único parcial: una abierta por servicio y acción. Sin pantalla de cola.
- Argos → Iris (solo a conectores con contrato ≥ 0.15.0 y la marca `corte_manual`): `servicio.corte_manual_solicitado` y `servicio.corte_manual_cancelado`, ambos con `version`, `solicitada_en` y `accion`. Sin datos personales. Iris abre una orden de trabajo nueva de tipo `corte_catv` o `reconexion_catv`.
- Iris → Argos, por el receptor existente `/integraciones/iris/webhook`: `corte_manual.estado_cambiado` (`solicitud_id`, `empresa_id`, `version`, `estado` = `en_curso` | `resuelta` | `cancelada` | `no_realizada`, `motivo_codigo`, `referencia`, `referencia_tipo`, `ocurrido_en`). Se deduplica por `X-Webhook-Id`. Argos **solo aplica una `version` mayor** que la que tiene y los estados terminales (`resuelta`, `cancelada`, `no_realizada`) no retroceden. Un `solicitud_id` de otra empresa da 404.
- Cancelaciones fuera de orden: si llega tarde y el corte ya se hizo, Iris informa `resuelta` y Argos pide la reconexión con una solicitud nueva; si llega antes que `solicitado`, Iris la guarda y no abre nada.
- `sin_respuesta` es solo de Argos: si a las 24 h de `solicitada_en` Iris no avisó `en_curso`, la ficha muestra `sin_respuesta`. Si la empresa está fuera del alcance del conector o el servicio es desconocido, Iris guarda la solicitud sin abrir nada y sin devolver error, y se ve igual como `sin_respuesta`.
- `sin_respuesta` no es terminal: lo reemplaza un `en_curso` o un estado final que llegue después. Un nuevo intento después de `no_realizada` es una solicitud nueva, con otro `solicitud_id`. Las `version` son dos contadores independientes por `solicitud_id` (el de Argos en `solicitado`/`cancelado`, el de Iris en `estado_cambiado`); cada lado solo compara entre sí los del otro.
- `no_realizada` es terminal: la ficha muestra el `motivo_codigo` y sale una alerta interna de notify.
- Sin conector de Iris o con contrato anterior: la solicitud queda `sin_iris`, se ve en la ficha del servicio y sale una alerta interna de notify.
- Reactivación con un corte `resuelta`: nueva solicitud de `reconexion` (la reconexión tiene siempre prioridad alta en Iris). Cancelar antes de resolver: `servicio.corte_manual_cancelado`.
- La orden de corte de Iris no aparece en el portal de Argos ni genera `ticket.*` hacia Argos; Iris no avisa al cliente por su cuenta (esos avisos los pide Argos); cerrar la orden no activa ni retira el servicio. En un `mixto` solo se toca el componente `cable`.

## 7. Lotes y dependencias

| Lote | Qué | Dueño | Depende de |
| --- | --- | --- | --- |
| T1 | Modelo de tipo de servicio | A1 | L0 |
| T2 | Cable sin router (`router_id` anulable, `coa`, `routeros`, ACL, Iris) | A1 + A2 | T1 |
| T3a | Respaldo: corte manual a Iris | A6 | L0, Iris 0.15.0 bloque B |
| T3b | Corte y reconexión de CATV por SmartOLT | A6 | T1, T3a, fusión de `agente/a6-olt-acs` (hoy no fusionada) |
| T4 | Facturación, libro y FEL por tipo | A3 + auditor | T1, S1, cuentas del contador |
| T5 | Panel y portal de tipos | A4 + A5 | T2, T3b, T4 |
| T6 | Bordes: textos, importación (todo se importa como `internet`), demo | A6 | T1 |

## 8. Preguntas del PM que siguen abiertas (se aplica lo recomendado)

- P-N6: ¿entra telefonía ahora? Recomendado: no.
- P-N14: cuentas contables de cable e IPTV, las confirma el contador.
