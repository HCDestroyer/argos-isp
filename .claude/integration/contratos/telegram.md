# Contrato: vinculación de Telegram (portal A5 ↔ bot A6 ↔ cliente A1)

Escrito por A6 (semana 2, tarea 1). Lo cumplen `apps/api/app/notify/telegram/*` (A6), la pantalla y la ruta del portal (A5) y `VincularTelegramCliente` / `DesvincularTelegramCliente` (A1). Se cambia solo con acuerdo y en la misma PR que el código.

## Flujo

```
Portal (sesión del cliente) ── GenerarCodigoTelegram ──▶ { codigo, enlace, bot, vence_en }
          │  muestra el botón "Abrir Telegram" (enlace) y, como respaldo, "/start <codigo>"
          ▼
Telegram: el cliente abre t.me/<bot>?start=<codigo> ── Telegram ──▶ POST /api/v1/telegram/webhook
          │  header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET
          ▼
CanjearCodigoTelegram ── (misma transacción) ──▶ VincularTelegramCliente (A1): core.clientes.telegram_chat_id
          │
          ▼
bot responde "Listo, <primer nombre>…"; el portal ve `telegram_chat_id` en la cuenta del cliente
```

## Lo que llama el portal (A5)

```ts
import GenerarCodigoTelegram, { TelegramNoConfigurado } from '#notify/actions/generar_codigo_telegram'

const r = await new GenerarCodigoTelegram().execute({ cliente_id }, ctx.contextoAccion('portal'))
// r = { codigo: 'K7QX2M9PTA', enlace: 'https://t.me/<bot>?start=K7QX2M9PTA', bot: '<bot>', vence_en: '2026-10-16T18:15:00.000Z' }
```

| Campo | Qué es |
| --- | --- |
| `codigo` | 10 caracteres de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O/1/I/L). Un solo uso. Mostrarlo solo al cliente; no guardarlo ni registrarlo. |
| `enlace` | `https://t.me/<TELEGRAM_BOT_NOMBRE>?start=<codigo>`: abre el bot y manda `/start <codigo>`. Sirve como botón y como QR. |
| `bot` | usuario del bot sin `@` (para "Busca @<bot> en Telegram"). |
| `vence_en` | ISO 8601 UTC. Vigencia `TELEGRAM_CODIGO_VIGENCIA_S` (900 s por defecto). |

- **Permiso y auditoría.** Nombre de la acción: `notificaciones.telegram_codigo` (queda en `audit.acciones` con `entidad = cliente`, sin el código). El portal la llama con la sesión del cliente, no por el ACL. Si el panel la expone algún día, A1 agrega el permiso con ese nombre.
- **Un código pendiente por cliente.** Pedir otro marca el anterior `reemplazado`; el viejo ya no sirve.
- **Desvincular anula los códigos.** Un código solo vale si `telegram_chat_id` del cliente no cambió (en `audit.cambios`) después de emitirlo; uno ya usado tampoco revincula si el cliente se desvinculó después del canje. Cubre cualquier camino (portal, panel, `/desvincular` del bot) sin que nadie tenga que avisar a notify: tras desvincular, el portal pide un código nuevo.
- **Errores.** `503 telegram_no_configurado` (`TelegramNoConfigurado`) si faltan `TELEGRAM_BOT_TOKEN` o `TELEGRAM_BOT_NOMBRE`: la pantalla muestra el error, nunca un enlace inventado. `404` si el cliente no existe.
- **Límite.** La ruta del portal debe ir `limitada` (el código es de ~49 bits y vence en 15 min, así que adivinarlo no es práctico, pero cada código nuevo invalida el anterior).
- **Ver si ya quedó.** El portal consulta el contacto del cliente (`telegram_vinculado` de `app/portal/cuenta.ts`); puede preguntar cada 3 a 5 s mientras la pantalla de vinculación está abierta y el código no venció. No hay evento nuevo.
- **Desvincular desde el portal.** `DesvincularTelegramCliente` de A1 (`{ id }`). El bot también tiene `/desvincular`.

## Lo que hace el bot (A6)

`POST /api/v1/telegram/webhook/:bot` (público, fuera del ACL, en el OpenAPI como `telegramWebhookBot`): **una URL por bot**. `:bot` es el id público del bot (la parte numérica del token, `telegram.bot_id` de la configuración). Con varias empresas con bots distintos (configuración propia, `hereda = false`), el webhook sabe de qué bot viene cada actualización y responde por ese mismo bot. `POST /api/v1/telegram/webhook` (sin id, `telegramWebhook`) queda para el bot de la configuración global registrado antes de este cambio.

- **Configuración.** Token, nombre del bot y secreto del webhook se guardan desde el panel (`PUT /notificaciones/configuracion`, cifrados; ver `apps/api/app/notify/README.md`). Las variables `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NOMBRE` y `TELEGRAM_WEBHOOK_SECRET` solo siembran la configuración global la primera vez.
- **Autenticación.** Header `X-Telegram-Bot-Api-Secret-Token` comparado en tiempo constante con el secreto del webhook de ese bot (si el panel guarda un token sin secreto, se genera uno); si falta, no coincide, el bot no está configurado o el secreto es de otro bot: `401`. El webhook se registra con `node ace telegram:webhook [--empresa=<id>]` (`setWebhook` en `<TELEGRAM_WEBHOOK_URL>/<id del bot>` con `secret_token`, `allowed_updates: ['message']`, y los comandos en español con `setMyCommands`); `--info` y `--borrar`.
- **Solo chats privados.** En grupos el bot responde "solo atiendo en un chat privado" a los comandos y no vincula ni muestra cuentas; el texto libre del grupo no se contesta.
- **Comandos.**

| Comando | Qué hace |
| --- | --- |
| `/start <código>` | `CanjearCodigoTelegram` (`notificaciones.telegram_vincular`, canal `webhook`, actor `sistema`) → `VincularTelegramCliente` (`clientes.vincular_telegram`) en la misma transacción. Responde "Listo, <primer nombre>…". Mayúsculas, espacios y guiones no importan. |
| `/start` | Bienvenida con cómo vincular desde el portal (`NOTIFY_PORTAL_URL`). |
| `/estado` | Solo si el chat está vinculado: por cada cuenta del chat, servicios no retirados (número, plan, estado, promesa vigente), saldo pendiente y saldo a favor. Si no está vinculado, "Este chat no está vinculado…". Si no se pudo leer la cuenta, "No pude consultar tu cuenta…" (nunca un saldo inventado). |
| `/desvincular` | `DesvincularTelegramCliente` para cada cuenta del chat. |
| `/ayuda` o cualquier otro texto | Ayuda. |

- **Idempotencia.** Telegram reintenta el webhook si no recibe 2xx: el mismo chat canjeando el mismo código responde lo mismo sin otro cambio. Un código usado, vencido o reemplazado, o usado por otro chat, responde "Ese código no es válido o ya venció…" (422 `codigo_invalido` auditado como error) y el webhook responde 200.
- **Fallos.** Si la Bot API no acepta la respuesta, el webhook igual responde 200 (la vinculación queda) y el error va al log. Si falla la base de datos, responde 500 y Telegram reintenta.
- **Privacidad.** Los textos del bot no llevan NIT, usuario ni contraseña PPPoE, IPs, direcciones ni apellidos: solo el primer nombre, número de servicio, plan, estado y montos. Sin `parse_mode` (texto plano).

## Variables

| Variable | Dónde | Qué |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | api, worker | Opcional: valor inicial del token (se siembra una vez en la configuración global; después manda el panel) |
| `TELEGRAM_BOT_NOMBRE` | api | Opcional: valor inicial del usuario del bot sin `@` |
| `TELEGRAM_WEBHOOK_SECRET` | api | Opcional: valor inicial del secreto (16 a 256 caracteres `A-Z a-z 0-9 _ -`) |
| `TELEGRAM_WEBHOOK_URL` | api (comando) | Base pública: `https://<dominio>/api/v1/telegram/webhook`; el comando registra `<base>/<id del bot>` (Telegram exige HTTPS) |
| `TELEGRAM_CODIGO_VIGENCIA_S` | api | Vigencia del código (900, mínimo 60) |
| `NOTIFY_PORTAL_URL` | api | Enlace al portal en los textos del bot |
