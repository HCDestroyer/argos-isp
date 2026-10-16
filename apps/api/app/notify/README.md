# notify · notificaciones (A6)

Avisa al cliente por correo o Telegram cuando pasa algo en su cuenta (factura emitida o vencida, cambio de estado del servicio, pago, promesa, comprobante). El aviso sale por todos los canales que el cliente tenga disponibles (correo y Telegram), para que le llegue por cualquier medio. Cada envío queda registrado en `notify.envios`.

## Flujo

```
audit.outbox ──relay (A1)──▶ ConsumidorNotify.procesar({ id, evento, payload })
                                 │  acción ProgramarNotificacion (origen = outbox:<id>)
                                 ▼
                          notify.envios (encolado) ──▶ BullMQ "notify-envios" (jobId envio-<id>)
                                                            │  worker: acción EnviarNotificacion
                                                            ▼
                                       Canal.enviar → enviado | reintentar | fallido (+ fallback a correo)
```

| Pieza                                                                           | Archivo                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Interfaz `Canal { enviar(destino, asunto, cuerpo), estado(id) }` y `ErrorCanal` | `canales/canal.ts`                                                                                                |
| Correo SMTP (nodemailer, texto plano)                                           | `canales/correo.ts`                                                                                               |
| Telegram (grammY, solo Bot API, sin `parse_mode`)                               | `canales/telegram.ts`                                                                                             |
| Canales activos según el entorno                                                | `canales/registro.ts`                                                                                             |
| Consumidor de eventos (`ConsumidorEventos`, `EventoEntrante`)                   | `consumidor.ts`                                                                                                   |
| Cola y worker BullMQ                                                            | `cola.ts`; proceso: `node ace notify:worker` (servicio `worker` del compose)                                      |
| Cron de recordatorios                                                           | `recordatorios.ts`, `actions/programar_recordatorios.ts`, `actions/editar_recordatorio.ts`                        |
| Cron mensual de particiones de `audit`                                          | `particiones.ts`, `actions/crear_particiones_auditoria.ts`                                                        |
| Acciones                                                                        | `actions/programar_notificacion.ts`, `actions/enviar_notificacion.ts`, `actions/editar_plantilla_notificacion.ts` |
| Plantillas iniciales (seeder idempotente, no pisa ediciones)                    | `plantillas_base.ts`, `database/seeders/notify_plantillas_seeder.ts`                                              |
| Rutas                                                                           | `start/routes/notify.ts`                                                                                          |

## Eventos

**Consume** (si hay plantilla activa para el evento): `factura.emitida`, `factura.vencida`, `servicio.estado_cambiado`, `pago.registrado`, `promesa.*`, `comprobante.*` (`comprobante.aprobado` y `comprobante.rechazado` tienen plantilla, pero aún no están en el catálogo de `app/shared/eventos.ts`; los agrega A3). Para alertas internas: `aaa.caido`, `aaa.recuperado`, `coa.fallido`, `caja.cerrada`.

**Emite**: `notificacion.enviada { cliente_id, canal, evento_origen, estado }` cuando un envío termina `enviado` o `fallido` (también cuando el cliente no tiene destino). Las alertas internas sin cliente no lo emiten.

## Reglas

- **Idempotencia.** `origen` identifica qué produjo el envío (`outbox:<id>` para eventos) y `(origen, cliente_id, canal)` es único. Si el relay entrega un evento dos veces, `ProgramarNotificacion` no crea otro envío: solo vuelve a encolar los que sigan `encolado`, y la cola deduplica por `jobId = envio-<id>`. `EnviarNotificacion` bloquea la fila y no hace nada si el envío ya no está `encolado`.
- **Canales.** Un envío por cada canal que sirva, con el `canal_preferido` primero (decisión del PM, 2026-10-15: que llegue por cualquier medio). Un canal sirve si el adaptador está configurado (`SMTP_HOST`, `TELEGRAM_BOT_TOKEN`), el cliente tiene destino (`email` o `telegram_chat_id`) y hay plantilla activa para ese evento y canal. WhatsApp aún no tiene adaptador. Si ningún canal sirve, queda un envío `fallido` con destino `-`.
- **Reintentos.** BullMQ reintenta `NOTIFY_INTENTOS` veces (5 por defecto), con backoff exponencial desde 5 s. Un error transitorio (red, SMTP 4xx, Telegram 429 o 5xx) deja el envío `encolado`, guarda el error y suma un intento. Un error permanente (SMTP 5xx, Telegram 400 o 403, canal no configurado) o el último intento lo marcan `fallido`. Si el canal que falló no era correo y el cliente no tenía ya un envío por correo para ese aviso (por ejemplo, la plantilla de correo se activó después), se crea uno con `fallback_de`; si ya lo tenía, no se duplica.
- **Texto.** El asunto y el cuerpo se renderizan al programar y se guardan en el envío, junto con un snapshot de `variables` que se usa para el fallback. Las plantillas son texto plano y no se escapa HTML. En Telegram el asunto va como primera línea.

## Recordatorios de pago (tarea 6)

Hay hasta tres recordatorios, configurables en `notify.recordatorios`. Cada uno tiene `orden` (1 a 3), `dias` respecto al vencimiento (negativo es antes, 0 el mismo día, positivo después), `hora` local de Guatemala y `activo`. Por defecto son −3, 0 y +3 días a las 09:00. La plantilla de cada uno es la del evento `recordatorio.<orden>`, una por canal.

- **Cron.** Un job scheduler de BullMQ (`notify-cron`, id `recordatorios`) dispara cada minuto dentro de `node ace notify:worker`. Usa concurrencia 1 y BullMQ entrega cada disparo a un solo worker. Con `--sin-cron` el proceso no corre el cron.
- **Qué se envía.** La acción `ProgramarRecordatorios` programa todo lo pendiente hasta ahora, no "lo de hoy". Para cada factura con saldo (no pagada ni anulada) toma el recordatorio activo más reciente cuyo momento ya pasó. El momento es `vence_en + dias` a la `hora` del recordatorio. Si el cron estuvo detenido, al volver manda el último recordatorio que toca, no los tres atrasados.
- **Qué no se envía.** Momentos anteriores a la emisión de la factura, momentos de hace más de 7 días (para no avisar facturas viejas importadas ni después de una caída larga) y recordatorios sin plantilla activa.
- **Idempotencia.** El origen es `recordatorio:<orden>:factura:<id>` y es único: correr el cron dos veces no duplica el aviso. Cambiar la configuración no reenvía lo que ya salió.
- **Lotes.** Procesa 200 facturas por transacción y repite hasta agotar lo pendiente. Cada aviso pasa por `ProgramarNotificacion` (todos los canales disponibles) y se audita por fila.

Variables extra: `recordatorio.orden`, `recordatorio.dias` y `factura.vence_relativo` ("vence en 3 días", "vence hoy", "venció hace 4 días").

## Alertas internas al equipo (tarea 7)

Avisos por Telegram al chat del equipo (`TELEGRAM_CHAT_EQUIPO`), no a clientes. Cada problema es un **incidente** en `notify.incidentes` identificado por `clave`; mientras está abierto, repetir el evento solo suma `eventos`. Resultado: una alerta por incidente y, cuando aplica, un "RESUELTO" al cerrarse.

| Origen                                                       | Clave del incidente                      | Alerta                                                                                                   | Se cierra                                                                             |
| ------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `aaa.caido` (`{ nodo?, desde, ultimo_error }`)               | `aaa:<nodo>` (`aaa` si no viene nodo)    | al abrir                                                                                                 | con `aaa.recuperado`, que avisa "resuelto" con la duración                            |
| `coa.fallido`                                                | `coa:<nas_ip>`                           | al abrir                                                                                                 | tras 30 min sin fallos de ese router (en silencio); el siguiente fallo avisa de nuevo |
| `caja.cerrada` con `diferencia ≠ 0`                          | `caja:<caja_id>` (puntual, nace cerrado) | siempre, faltante o sobrante                                                                             | —                                                                                     |
| Vigilancia: `facturas.generar`, `facturas.vencer_pendientes` | `cron:<accion>`                          | última corrida por cron con más de 60 min + tolerancia (o nunca)                                         | cuando vuelve a correr, con "resuelto"                                                |
| Vigilancia: `servicios.corte`                                | `cron:servicios.corte:<fecha> <HH:MM>`   | hora de corte de hoy que pasó hace más de la tolerancia sin aparecer en `resultado.horas` de una corrida | cuando una corrida la procesa                                                         |

- **Acciones.** `RegistrarAlerta` (`notificaciones.alertar`) para los eventos; `VigilarCrons` (`notificaciones.vigilar_crons`) para los crons. Solo sistema.
- **Idempotencia.** Cada evento procesado queda en `notify.alertas_eventos` (`outbox:<id>`): una reentrega no suma ni avisa. El envío tiene origen `alerta:<incidente>:abierto|cerrado` y la unicidad de `notify.envios` impide duplicarlo.
- **Consumidor.** `ConsumidorAlertas` (`consumidor_alertas.ts`) en el grupo `notify`, junto a `ConsumidorNotify`. Un cierre cuadrado no se audita ni se registra.
- **Vigilancia.** Job `vigilancia-crons` de la cola `notify-cron`, cada 5 min, en `notify:worker` (si `billing-worker` está caído, el que avisa es otro proceso). Lee las corridas que registra A3 con `RegistrarCorrida` (`audit.acciones`, canal `cron`, resultado `ok`) y las horas de corte de `billing.plantillas_facturacion` y `core.servicios_excepciones`. Gracia: `NOTIFY_CRON_TOLERANCIA_MIN` (30).
- **Plantillas.** `alerta.aaa.caido`, `alerta.aaa.recuperado`, `alerta.coa.fallido`, `alerta.caja.diferencia`, `alerta.cron.atrasado`, `alerta.cron.recuperado` (canal telegram, variables `alerta.*`). Si se desactiva una, esa alerta se silencia (el incidente igual se registra); si no existe, se usa el texto de `PLANTILLAS_ALERTA`.
- **Sin configurar.** Sin `TELEGRAM_CHAT_EQUIPO` o sin `TELEGRAM_BOT_TOKEN`, la alerta queda como envío `fallido` con el motivo (visible en `GET /notificaciones/envios`). No emite `notificacion.enviada` (no hay cliente).

## Particiones de auditoría (cron mensual)

`audit.acciones`, `audit.cambios` y `audit.red` están particionadas por mes. La acción `CrearParticionesAuditoria` (`auditoria.crear_particiones`, solo sistema) llama `audit.crear_particiones(desde, meses)` y devuelve las particiones que creó; es idempotente.

- **Cron.** En la cola `notify-cron`, id `particiones`, patrón `7 6 1 * *` UTC (día 1 de cada mes, 06:07): asegura el mes actual y los 12 siguientes. `notify:worker` además la encola una vez al arrancar. `--sin-cron` la desactiva junto con los recordatorios. Archivo: `particiones.ts`.
- **Permisos.** La función es `SECURITY DEFINER` (migración `1761100000001_audit_particiones_definer`): el worker conecta con el usuario de la aplicación (miembro de `argosisp_app`, sin DDL en `audit`) y aun así crea las particiones con los permisos del dueño. EXECUTE solo para `argosisp_app`.
- **Si el cron se detiene.** Las filas caen en la partición DEFAULT y no se pierde nada, pero crear después la partición de un mes que ya tiene filas en DEFAULT falla. Con 12 meses de adelanto hay margen de sobra.

## Variables de las plantillas (Mustache)

Siempre:

| Variable                                                   | Ejemplo                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `evento`                                                   | `factura.emitida`                                                          |
| `empresa.nombre`, `empresa.telefono`, `empresa.portal_url` | de `NOTIFY_EMPRESA_NOMBRE`, `NOTIFY_EMPRESA_TELEFONO`, `NOTIFY_PORTAL_URL` |
| `cliente.id`, `cliente.nombre`, `cliente.email`            |                                                                            |

Según el evento:

| Grupo          | Variables                                                                                                                                                                                                                                              | Cuándo                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `servicio`     | `id`, `usuario` (user PPP), `estado`, `direccion`, `plan`                                                                                                                                                                                              | el payload trae `servicio_id` |
| `factura`      | `id`, `numero` (serie-número FEL o id), `estado`, `total`, `total_q` (`Q 1,234.50`), `saldo`, `saldo_q`, `vence` (`15/10/2026`), `vence_iso`, `periodo` (`octubre 2026`), `dias_para_vencer`, `dias_vencida`, `vence_hoy`, `vencida`, `vence_relativo` | el payload trae `factura_id`  |
| `pago`         | `id`, `monto`, `monto_q`, `metodo`, `facturas` (ids separados por coma), `fecha`                                                                                                                                                                       | `pago.*`                      |
| `promesa`      | `id`, `monto`, `monto_q`, `vence` (`dd/MM/yyyy HH:mm`, Guatemala), `vence_iso`                                                                                                                                                                         | `promesa.*`                   |
| `estado`       | `de`, `a`, `motivo`, `es_activo`, `es_limitado`, `es_suspendido`, `es_retirado`                                                                                                                                                                        | `servicio.estado_cambiado`    |
| `comprobante`  | `id`, `motivo`                                                                                                                                                                                                                                         | `comprobante.*`               |
| `recordatorio` | `orden`, `dias`                                                                                                                                                                                                                                        | `recordatorio.*`              |

Las fechas se muestran en `America/Guatemala`. Los montos llegan como string con 2 decimales y su versión `_q` ya formateada en quetzales. Para condicionar texto se usan secciones: `{{#estado.es_suspendido}}…{{/estado.es_suspendido}}`.

## API

| Ruta                                                                                                                                                                                         | Permiso                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /api/v1/notificaciones/plantillas`                                                                                                                                                      | `notificaciones.ver`    |
| `PUT /api/v1/notificaciones/plantillas/:id` (`version`, `asunto?`, `cuerpo?`, `activa?`). Valida Mustache (422), devuelve 409 si la `version` cambió y registra el cambio en `audit.cambios` | `notificaciones.editar` |
| `GET /api/v1/notificaciones/envios?cliente_id=&evento=&canal=&estado=&cursor=&limit=`                                                                                                        | `notificaciones.ver`    |
| `GET /api/v1/notificaciones/recordatorios`                                                                                                                                                   | `notificaciones.ver`    |
| `PUT /api/v1/notificaciones/recordatorios/:id` (`version`, `dias?`, `hora?` HH:MM, `activo?`). Devuelve 409 si la `version` cambió y registra el cambio en `audit.cambios`                   | `notificaciones.editar` |

## Conexión con el relay (A1)

El relay del outbox debe llamar, por cada evento publicado:

```ts
import { ConsumidorNotify } from '#notify/consumidor'
import { ColaEnviosBullmq } from '#notify/cola'

const notify = new ConsumidorNotify(new ColaEnviosBullmq())
if (notify.acepta(fila.evento)) {
    await notify.procesar({
        id: fila.id,
        evento: fila.evento,
        payload: fila.payload,
        requestId: fila.request_id,
    })
}
```

`procesar` lanza si falla, y en ese caso el relay debe reintentar la entrega. La entrega es _at-least-once_: repetirla es seguro.

## Variables de entorno

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_ROOT`, `NOTIFY_INTENTOS`, `NOTIFY_EMPRESA_*`, `NOTIFY_PORTAL_URL`, `COLAS_PREFIJO`, `REDIS_*`. Están documentadas en `apps/api/.env.example`.

## Pruebas

`tests/notify/*.spec.ts` corren contra Postgres y Redis reales. Cada corrida usa un prefijo de BullMQ propio (`a6test-*`) y lo borra al terminar. Telegram se prueba con un `fetch` simulado. La prueba de aceptación con Mailpit (factura emitida → correo en menos de 10 s) corre si están definidas `MAILPIT_API` y `SMTP_HOST`/`SMTP_PORT`; en CI corre siempre.

```sh
docker compose -f infra/docker-compose.yml up -d mailpit
MAILPIT_API=http://127.0.0.1:8025 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 pnpm --filter @argosisp/api test
```
