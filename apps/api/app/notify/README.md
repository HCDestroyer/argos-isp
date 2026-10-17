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

| Pieza                                                                           | Archivo                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interfaz `Canal { enviar(destino, asunto, cuerpo), estado(id) }` y `ErrorCanal` | `canales/canal.ts`                                                                                                                                                                           |
| Correo SMTP (nodemailer, texto plano)                                           | `canales/correo.ts`                                                                                                                                                                          |
| Telegram (grammY, solo Bot API, sin `parse_mode`)                               | `canales/telegram.ts`                                                                                                                                                                        |
| Configuración de canales del panel (global y por empresa, caché, interruptores) | `configuracion.ts`, `configuracion_panel.ts`, `consumidor_config.ts`, `arranque.ts`, `actions/configurar_notificaciones.ts`, `actions/probar_canal_notificacion.ts`, `actions/sembrar_configuracion_canales.ts` |
| Canales activos según la configuración                                          | `canales/registro.ts`                                                                                                                                                                        |
| Consumidor de eventos (`ConsumidorEventos`, `EventoEntrante`)                   | `consumidor.ts`                                                                                                                                                                              |
| Cola y worker BullMQ                                                            | `cola.ts`; proceso: `node ace notify:worker` (servicio `worker` del compose)                                                                                                                 |
| Cron de recordatorios                                                           | `recordatorios.ts`, `actions/programar_recordatorios.ts`, `actions/editar_recordatorio.ts`                                                                                                   |
| Cron mensual de particiones de `audit`                                          | `particiones.ts`, `actions/crear_particiones_auditoria.ts`                                                                                                                                   |
| Acciones                                                                        | `actions/programar_notificacion.ts`, `actions/enviar_notificacion.ts`, `actions/editar_plantilla_notificacion.ts`, `actions/enviar_mensaje_directo.ts`, `actions/anular_codigos_telegram.ts` |
| Plantillas iniciales (seeder idempotente, no pisa ediciones)                    | `plantillas_base.ts`, `database/seeders/notify_plantillas_seeder.ts`                                                                                                                         |
| Rutas                                                                           | `start/routes/notify.ts`                                                                                                                                                                     |
| Bot de Telegram (webhook, vinculación, `/estado`)                               | `telegram/`, `actions/generar_codigo_telegram.ts`, `actions/canjear_codigo_telegram.ts`, `commands/telegram_webhook.ts`                                                                      |

## Eventos

**Consume** (si hay plantilla activa para el evento): `factura.emitida`, `factura.vencida`, `servicio.estado_cambiado`, `pago.registrado` (también a los dueños de las facturas, ver abajo), `promesa.*`, `comprobante.recibido`, `comprobante.aprobado`, `comprobante.rechazado`. Para alertas internas: `aaa.caido`, `aaa.recuperado`, `coa.fallido`, `routeros.fallido`, `caja.cerrada`.

**Emite**: `notificacion.enviada { cliente_id, canal, evento_origen, estado }` cuando un envío termina `enviado` o `fallido` (también cuando el cliente no tiene destino). Las alertas internas sin cliente y los envíos `omitido` no lo emiten. `notificaciones.config_cambiada { configuracion_id, empresa_id, campos }` al guardar o sembrar la configuración de canales; lo consume el propio `notify:worker` (`ConsumidorConfigNotify`).

## Reglas

- **Idempotencia.** `origen` identifica qué produjo el envío (`outbox:<id>` para eventos) y `(origen, cliente_id, canal)` es único. Si el relay entrega un evento dos veces, `ProgramarNotificacion` no crea otro envío: solo vuelve a encolar los que sigan `encolado`, y la cola deduplica por `jobId = envio-<id>`. `EnviarNotificacion` bloquea la fila y no hace nada si el envío ya no está `encolado`.
- **Canales.** Un envío por cada canal que sirva, con el `canal_preferido` primero (decisión del PM, 2026-10-15: que llegue por cualquier medio). Un canal sirve si está configurado en la configuración de canales que aplica (ver abajo), el cliente tiene destino (`email` o `telegram_chat_id`) y hay plantilla activa para ese evento y canal. WhatsApp aún no tiene adaptador. Si ningún canal sirve, queda un envío `fallido` con destino `-`.
- **Apagados.** Si el canal o el tipo de aviso están apagados en la configuración, el envío queda `omitido` con `motivo` ("Correo apagado en la configuración global", "Aviso de tipo factura apagado en la configuración de la empresa 2") y no se encola. Si se apaga con el envío ya en la cola, `EnviarNotificacion` lo marca `omitido` al tomarlo (sin fallback).
- **Reintentos.** BullMQ reintenta `NOTIFY_INTENTOS` veces (5 por defecto), con backoff exponencial desde 5 s. Un error transitorio (red, SMTP 4xx, Telegram 429 o 5xx) deja el envío `encolado`, guarda el error y suma un intento. Un error permanente (SMTP 5xx, Telegram 400 o 403, canal no configurado) o el último intento lo marcan `fallido`. Si el canal que falló no era correo y el cliente no tenía ya un envío por correo para ese aviso (por ejemplo, la plantilla de correo se activó después), se crea uno con `fallback_de`; si ya lo tenía, no se duplica.
- **Texto.** El asunto y el cuerpo se renderizan al programar y se guardan en el envío, junto con un snapshot de `variables` que se usa para el fallback. Las plantillas son texto plano y no se escapa HTML. En Telegram el asunto va como primera línea.

## Configuración de canales desde el panel

Decisión del PM (17 oct, `contratos/multiempresa.md`): correo y Telegram se configuran en el panel, no con variables de entorno.

- **Modelo.** `notify.configuracion_canales`: una fila global (`empresa_id` nulo) y una opcional por empresa con `hereda` (por defecto `true`: usa la global). Correo: host, puerto, TLS (`auto`, `starttls`, `tls`, `ninguno`), usuario, contraseña, remitente y nombre visible. Telegram: token, id del bot (público, sale del token), nombre del bot, chat del equipo y secreto del webhook. Interruptores: `correo_activo`, `telegram_clientes_activo`, `telegram_alertas_activo` y `avisos` (tipo → encendido; una clave ausente es encendido). `empresa_id` queda **sin FK** hasta que exista `core.empresas` (A1).
- **Tipos de aviso.** `factura` (`factura.emitida`, `factura.anulada`), `vencimiento` (`factura.vencida`), `recordatorio` (`recordatorio.*`), `corte` (`servicio.estado_cambiado`), `pago` (`pago.*`), `promesa` (`promesa.*`), `comprobante` (`comprobante.*`). El mensaje directo (código del portal) solo mira el interruptor del canal; las alertas al equipo, `telegram_alertas_activo` de la global.
- **Secretos.** Contraseña SMTP, token y secreto del webhook se cifran con `app/shared/cifrado.ts` (`AAA_PPP_KEY`, la clave de cifrado de la instalación que pide el contrato; no hace falta otra: los descifra solo la API). Nunca vuelven: la API los devuelve como `***` (o `null` si no hay) y la auditoría también. Al editar, omitido = se conserva, `null` = se borra, texto = se reemplaza. Un token sin secreto del webhook genera uno.
- **Resolución.** Un aviso usa la configuración de la empresa del evento (`empresa_id` del payload o, cuando existan las columnas, la de la factura o el servicio) si tiene la suya con `hereda = false`; si no, la global; sin fila global, el entorno. `notify.envios.empresa_id` guarda cuál se aplicó.
- **Caché e invalidación (regla 5).** Cada proceso guarda la configuración descifrada en memoria. `ConfigurarNotificaciones` emite `notificaciones.config_cambiada`; el consumidor del worker la relee y lo publica en Redis (`<COLAS_PREFIJO>:notify:config`), donde escuchan la API y las otras réplicas. Al confirmar, el proceso que guardó también se invalida. Al reconectar a Redis se invalida (un aviso perdido no deja la caché vieja). Sin TTL.
- **Siembra desde el entorno.** `SembrarConfiguracionCanales` corre al arrancar la API (`start/notify.ts`, solo en `web`) y `notify:worker`: si no hay fila global y hay `SMTP_HOST` o `TELEGRAM_BOT_TOKEN`, la crea con `SMTP_*`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NOMBRE`, `TELEGRAM_CHAT_EQUIPO` y `TELEGRAM_WEBHOOK_SECRET`, una sola vez (log y bitácora, `sembrada_desde_entorno = true`). Después mandan los valores del panel.
- **Prueba.** `ProbarCanalNotificacion` arma el canal con la configuración **guardada** (no la caché) y envía en el momento, sin mirar interruptores; devuelve el error real (`535 5.7.8 Authentication failed`, `401 Unauthorized`). Queda en `notify.envios` (`evento = notificaciones.prueba`).
- **Varios bots.** Una URL de webhook por bot: `/api/v1/telegram/webhook/<id del bot>` con el secreto de ese bot; responde por el mismo bot. `node ace telegram:webhook --empresa=<id>` registra el bot de una empresa. Ver `contratos/telegram.md`.

## Bot de Telegram (semana 2)

Contrato completo en `.claude/integration/contratos/telegram.md`.

- **Vincular.** El portal (A5) llama `GenerarCodigoTelegram` (`notificaciones.telegram_codigo`) con la sesión del cliente y muestra `t.me/<bot>?start=<código>`. Solo se guarda el SHA-256 en `notify.telegram_codigos` (`pendiente` → `usado`, `reemplazado` o `anulado`; uno pendiente por cliente; vence a los `TELEGRAM_CODIGO_VIGENCIA_S`). El webhook canjea con `CanjearCodigoTelegram` (`notificaciones.telegram_vincular`), que llama `VincularTelegramCliente` de A1 en la misma transacción. Un cambio de `telegram_chat_id` posterior al código (desvincular por cualquier vía o vincular otro chat, según `audit.cambios`) lo anula.
- **Desvincular.** `/desvincular` en el bot llama `DesvincularTelegramCliente` (A1) y `AnularCodigosTelegram` (`notificaciones.telegram_anular_codigos`) en la misma transacción: los códigos `pendiente` del cliente pasan a `anulado` y un enlace viejo ya no vincula. El portal y el panel deben llamar la misma acción al desvincular (pedido a A5 en `.claude/integration/a6.md`).
- **Webhook.** `POST /api/v1/telegram/webhook`, público, con `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` (401 si no; sin secreto rechaza todo). `telegram/bot.ts` decide el comando: `/start <código>`, `/start`, `/estado` (solo chats vinculados: servicios, saldo pendiente y a favor), `/desvincular`, `/ayuda`. Solo chats privados. Responde por el canal `telegram`; si la Bot API falla, igual responde 200.
- **Registro.** `node ace telegram:webhook` (`setWebhook` con el secreto y `allowed_updates: ['message']`, más `setMyCommands`); `--info`, `--borrar`, `--url`.
- **No emite eventos.** La vinculación queda en `audit.acciones` y `audit.cambios` (`telegram_chat_id`) por la acción de A1.

## Mensaje directo (semana 3)

`EnviarMensajeDirecto` (`notificaciones.enviar_directo`, sin endpoint): **un** canal (`correo` o `telegram`) y **un** destino ya resuelto, enviado en el momento, sin cola, sin reintentos diferidos y sin caer a otro canal. Para el código de acceso del portal (A5) y avisos puntuales.

- El dato sensible va en `secreto` y el cuerpo lo usa como `{{secreto}}`: se interpola solo al enviar. `notify.envios` guarda el cuerpo **sin renderizar** y `audit.acciones` registra `secreto: ***`.
- Con `cliente_id`, el destino debe ser el correo o el chat de Telegram **registrado** del cliente (422 si no).
- Registra una fila en `notify.envios` (origen `directo:<uuid>`, `evento` = `motivo`) y emite `notificacion.enviada`.
- Si el canal falla o no está configurado no lanza: devuelve `{ estado: 'fallido', error }` y queda registrado.

```ts
const r = await new EnviarMensajeDirecto().execute(
    {
        cliente_id,
        canal: 'correo',
        destino: cliente.email,
        motivo: 'portal.codigo_acceso',
        asunto: 'Tu código de acceso',
        cuerpo: 'Tu código es {{secreto}}.',
        secreto: codigo,
    },
    ctx,
)
if (r.estado === 'fallido') throw new Error(r.error ?? 'no se pudo enviar')
```

## Avisos de pago: comprobantes y pagos de terceros

Reglas en `avisos_pago.ts`, aplicadas por `ProgramarNotificacion`.

- **Comprobante de depósito.** `comprobante.recibido` acusa recibo ("Recibimos tu comprobante de pago por Q 300.00 (referencia 123456). Lo revisaremos…"); `comprobante.rechazado` avisa con el motivo; `comprobante.aprobado` es el aviso de pago.
- **Un solo aviso de pago por pago y cliente** (decisión de A6, día 4). Al aprobar un comprobante salen `pago.registrado` y `comprobante.aprobado` del mismo pago en la misma transacción. El pagador recibe **solo `comprobante.aprobado`** ("Verificamos tu comprobante de pago por Q 300.00…"): cierra el hilo que abrió `comprobante.recibido` y lleva el monto del pago. `pago.registrado` se omite para el pagador cuando `billing.comprobantes.pago_id` apunta a ese pago y `comprobante.aprobado` tiene plantilla activa; con esa plantilla desactivada, el aviso sale por `pago.registrado`. Como el comprobante se enlaza al pago en la misma transacción que los eventos, el resultado no depende del orden de entrega. Además, cualquiera de los dos bloquea `pago:<id>` y no se programa si el cliente ya tiene un aviso de ese pago desde otro origen (`variables.pago.id`).
- **Pago de terceros.** `pago.registrado` trae `clientes[]` (pagador y dueños de las facturas; eventos viejos: `[cliente_id]`). Cada dueño distinto del pagador recibe `pago.registrado.tercero` ("Recibimos el pago de tu factura N por Q 150.00, hecho por <pagador>"), con el mismo origen `outbox:<id>`: idempotente por (evento, cliente). También cuando el pago viene de un comprobante.

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

| Origen                                                                | Clave del incidente                                                                                          | Alerta                                                                                                   | Se cierra                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `aaa.caido` (`{ nodo?, desde, ultimo_error }`)                        | `aaa:<nodo>` (`aaa` si no viene nodo)                                                                        | al abrir                                                                                                 | con `aaa.recuperado` (`{ nodo, desde, hasta, ultimo_error }`), que avisa "resuelto" con la duración `desde`→`hasta` |
| `coa.fallido`                                                         | `coa:<nas_ip>`                                                                                               | al abrir                                                                                                 | tras 30 min sin fallos de ese router (en silencio); el siguiente fallo avisa de nuevo                               |
| `routeros.fallido` (`{ servicio_id, router_id, operacion, error }`)   | `routeros:<router_id>`                                                                                       | al abrir (nombre y host del router, operación, servicio, error)                                          | tras 30 min sin fallos de ese router (en silencio)                                                                  |
| `routeros.fallido` con `operacion = validar velocidad (<validación>)` | `routeros-velocidad:<router_id>:<validación>` (configuración inválida, **no** se agrupa con el router caído) | al abrir (`alerta.routeros.velocidad`: router, validación, servicio, detalle)                            | tras 30 min sin fallos de esa validación                                                                            |
| `caja.cerrada` con `diferencia ≠ 0`                                   | `caja:<caja_id>` (puntual, nace cerrado)                                                                     | siempre, faltante o sobrante                                                                             | —                                                                                                                   |
| Vigilancia: `facturas.generar`, `facturas.vencer_pendientes`          | `cron:<accion>`                                                                                              | última corrida por cron con más de 60 min + tolerancia (o nunca)                                         | cuando vuelve a correr, con "resuelto"                                                                              |
| Vigilancia: `servicios.corte`                                         | `cron:servicios.corte:<fecha> <HH:MM>`                                                                       | hora de corte de hoy que pasó hace más de la tolerancia sin aparecer en `resultado.horas` de una corrida | cuando una corrida la procesa                                                                                       |

- **Acciones.** `RegistrarAlerta` (`notificaciones.alertar`) para los eventos; `VigilarCrons` (`notificaciones.vigilar_crons`) para los crons. Solo sistema.
- **Idempotencia.** Cada evento procesado queda en `notify.alertas_eventos` (`outbox:<id>`): una reentrega no suma ni avisa. El envío tiene origen `alerta:<incidente>:abierto|cerrado` y la unicidad de `notify.envios` impide duplicarlo.
- **Consumidor.** `ConsumidorAlertas` (`consumidor_alertas.ts`) en el grupo `notify`, junto a `ConsumidorNotify`. Un cierre cuadrado no se audita ni se registra.
- **Vigilancia.** Job `vigilancia-crons` de la cola `notify-cron`, cada 5 min, en `notify:worker` (si `billing-worker` está caído, el que avisa es otro proceso). Lee las corridas que registra A3 con `RegistrarCorrida` (`audit.acciones`, canal `cron`, resultado `ok`) y las horas de corte de `billing.plantillas_facturacion` y `core.servicios_excepciones`. Gracia: `NOTIFY_CRON_TOLERANCIA_MIN` (30).
- **Plantillas.** `alerta.aaa.caido`, `alerta.aaa.recuperado`, `alerta.coa.fallido`, `alerta.routeros.fallido`, `alerta.routeros.velocidad`, `alerta.caja.diferencia`, `alerta.cron.atrasado`, `alerta.cron.recuperado` (canal telegram, variables `alerta.*`). Si se desactiva una, esa alerta se silencia (el incidente igual se registra); si no existe, se usa el texto de `PLANTILLAS_ALERTA`.
- **Sin configurar.** Sin chat del equipo o sin token del bot en la configuración global, la alerta queda como envío `fallido` con el motivo (visible en `GET /notificaciones/envios`). Con las alertas apagadas (`telegram_alertas_activo = false`) queda `omitido`. No emite `notificacion.enviada` (no hay cliente).

## Particiones de auditoría (cron mensual)

`audit.acciones`, `audit.cambios` y `audit.red` están particionadas por mes. La acción `CrearParticionesAuditoria` (`auditoria.crear_particiones`, solo sistema) llama `audit.crear_particiones(desde, meses)` y devuelve las particiones que creó; es idempotente.

- **Cron.** En la cola `notify-cron`, id `particiones`, patrón `7 6 1 * *` UTC (día 1 de cada mes, 06:07): asegura el mes actual y los 12 siguientes. `notify:worker` además la encola una vez al arrancar. `--sin-cron` la desactiva junto con los recordatorios. Archivo: `particiones.ts`.
- **Permisos.** La función es `SECURITY DEFINER` (migración `1761100000001_audit_particiones_definer`): el worker conecta con el usuario de la aplicación (miembro de `argosisp_app`, sin DDL en `audit`) y aun así crea las particiones con los permisos del dueño. EXECUTE solo para `argosisp_app`.
- **Si el cron se detiene.** Las filas caen en la partición DEFAULT y no se pierde nada, pero crear después la partición de un mes que ya tiene filas en DEFAULT falla. Con 12 meses de adelanto hay margen de sobra.

## Variables de las plantillas (Mustache)

Siempre:

| Variable                                                                                                                                                                                    | Ejemplo                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evento`                                                                                                                                                                                    | `factura.emitida`                                                                                                                                         |
| `empresa.nombre`, `empresa.nit`, `empresa.direccion`, `empresa.telefono`, `empresa.telefono_alterno`, `empresa.whatsapp`, `empresa.correo`, `empresa.horario`, `empresa.instrucciones_pago` | de `core.empresa` (se edita en el panel; `verEmpresa` de `#portal/empresa`). Sin fila: `NOTIFY_EMPRESA_NOMBRE` y `NOTIFY_EMPRESA_TELEFONO`. Vacíos = `''` |
| `empresa.portal_url`                                                                                                                                                                        | `NOTIFY_PORTAL_URL`                                                                                                                                       |
| `cliente.id`, `cliente.nombre`, `cliente.email`                                                                                                                                             |                                                                                                                                                           |

Según el evento:

| Grupo          | Variables                                                                                                                                                                                                                                                        | Cuándo                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `servicio`     | `id`, `usuario` (user PPP), `estado`, `direccion`, `plan`                                                                                                                                                                                                        | el payload trae `servicio_id`                                |
| `factura`      | `id`, `numero` (serie-número FEL o id), `estado`, `total`, `total_q` (`Q 1,234.50`), `saldo`, `saldo_q`, `vence` (`15/10/2026`), `vence_iso`, `periodo` (`octubre 2026`), `dias_para_vencer`, `dias_vencida`, `vence_hoy`, `vencida`, `vence_relativo`           | el payload trae `factura_id`                                 |
| `pago`         | `id`, `monto`, `monto_q`, `metodo`, `facturas` (ids separados por coma), `fecha`; en `pago.registrado.tercero` además `facturas_cliente` (números de las facturas del destinatario), `varias_facturas`, `monto_cliente`, `monto_cliente_q` (lo aplicado a ellas) | `pago.*` y `comprobante.aprobado` (datos de `billing.pagos`) |
| `pagador`      | `id`, `nombre`                                                                                                                                                                                                                                                   | `pago.*`                                                     |
| `promesa`      | `id`, `monto`, `monto_q`, `vence` (`dd/MM/yyyy HH:mm`, Guatemala), `vence_iso`                                                                                                                                                                                   | `promesa.*`                                                  |
| `estado`       | `de`, `a`, `motivo`, `es_activo`, `es_limitado`, `es_suspendido`, `es_retirado`                                                                                                                                                                                  | `servicio.estado_cambiado`                                   |
| `comprobante`  | `id`, `motivo`, `monto`, `monto_q`, `referencia`, `metodo`, `fecha_deposito` (`08/10/2026`)                                                                                                                                                                      | `comprobante.*`                                              |
| `recordatorio` | `orden`, `dias`                                                                                                                                                                                                                                                  | `recordatorio.*`                                             |

Las fechas se muestran en `America/Guatemala`. Los montos llegan como string con 2 decimales y su versión `_q` ya formateada en quetzales. Para condicionar texto se usan secciones: `{{#estado.es_suspendido}}…{{/estado.es_suspendido}}`.

## API

| Ruta                                                                                                                                                                                         | Permiso                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /api/v1/notificaciones/plantillas`                                                                                                                                                      | `notificaciones.ver`    |
| `PUT /api/v1/notificaciones/plantillas/:id` (`version`, `asunto?`, `cuerpo?`, `activa?`). Valida Mustache (422), devuelve 409 si la `version` cambió y registra el cambio en `audit.cambios` | `notificaciones.editar` |
| `GET /api/v1/notificaciones/envios?cliente_id=&evento=&canal=&estado=&cursor=&limit=`                                                                                                        | `notificaciones.ver`    |
| `GET /api/v1/notificaciones/recordatorios`                                                                                                                                                   | `notificaciones.ver`    |
| `PUT /api/v1/notificaciones/recordatorios/:id` (`version`, `dias?`, `hora?` HH:MM, `activo?`). Devuelve 409 si la `version` cambió y registra el cambio en `audit.cambios`                   | `notificaciones.editar` |
| `GET /api/v1/notificaciones/configuracion`, `GET .../configuracion/empresas`, `GET .../configuracion/empresas/:empresaId`                                                                     | `notificaciones.ver`    |
| `PUT /api/v1/notificaciones/configuracion`, `PUT .../configuracion/empresas/:empresaId` (`version`, 0 si no existe; 409)                                                                      | `notificaciones.configurar` |
| `POST /api/v1/notificaciones/configuracion/probar`, `POST .../configuracion/empresas/:empresaId/probar` (`canal`, `destino?`)                                                                  | `notificaciones.probar` |

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

`TELEGRAM_API_ROOT`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_CODIGO_VIGENCIA_S`, `NOTIFY_INTENTOS`, `NOTIFY_EMPRESA_*`, `NOTIFY_PORTAL_URL`, `COLAS_PREFIJO`, `REDIS_*`, `AAA_PPP_KEY` (cifrado de los secretos). Opcionales, solo valor inicial de la configuración global: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NOMBRE`, `TELEGRAM_CHAT_EQUIPO`, `TELEGRAM_WEBHOOK_SECRET`. Están documentadas en `apps/api/.env.example`.

## Pruebas

`tests/notify/*.spec.ts` corren contra Postgres y Redis reales. Cada corrida usa un prefijo de BullMQ propio (`a6test-*`) y lo borra al terminar. Telegram se prueba con un `fetch` simulado y el correo de la configuración con un SMTP en memoria (`tests/notify/smtp_falso.ts`). `configuracion.spec.ts` vacía `notify.configuracion_canales` antes y después de cada prueba: el resto de la suite corre con el entorno. La prueba de aceptación con Mailpit (factura emitida → correo en menos de 10 s) corre si están definidas `MAILPIT_API` y `SMTP_HOST`/`SMTP_PORT`; en CI corre siempre.

```sh
docker compose -f infra/docker-compose.yml up -d mailpit
MAILPIT_API=http://127.0.0.1:8025 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 pnpm --filter @argosisp/api test
```
