# Contrato: vinculación de Telegram (portal → bot)

Lo exponen A5 (código y acción de canje, en `apps/api/app/portal/`) y A6 (bot y webhook, en `apps/api/app/notify/`). La vinculación final la hace `VincularTelegramCliente` de A1 (`clientes.vincular_telegram`). Cambios: en la misma PR que el código, y avisando en `a5.md` / `a6.md`.

## Flujo

1. El cliente, con sesión del portal, pulsa "Vincular Telegram" en "Mis datos".
2. El portal llama `POST /api/v1/portal/telegram/vincular` y recibe `{ enlace, bot, expira_en }`.
3. El portal abre `enlace` = `https://t.me/<bot>?start=<código>`. Telegram abre el chat con el bot y, al pulsar "Iniciar", el bot recibe el mensaje `/start <código>`.
4. El webhook del bot (A6) llama la acción `CanjearVinculoTelegram` con el código y el `chat.id`.
5. La acción valida el código y vincula con `VincularTelegramCliente` en la misma transacción.
6. El bot responde al chat con el texto según el resultado (abajo).
7. El portal consulta `GET /api/v1/portal/telegram` cada 3 s mientras el código siga vigente y muestra "Vinculado" cuando `vinculado: true`.

## Código

| Campo | Valor |
| --- | --- |
| Formato | `vt_` + 32 caracteres base64url (24 bytes aleatorios de `randomBytes`). Expresión: `^vt_[A-Za-z0-9_-]{32}$` (35 caracteres; Telegram admite hasta 64 en `start`, solo `A-Z a-z 0-9 _ -`) |
| Guardado | Solo `sha256(código)` en hex en `core.portal_vinculos_telegram.codigo_hash`. Nunca el código |
| Vigencia | `PORTAL_TELEGRAM_VIGENCIA_S` (900 s por defecto, mínimo 60) |
| Uso | Único. Un código nuevo del mismo cliente reemplaza a los anteriores sin usar |
| Cliente | Lo decide el código. El bot nunca manda `cliente_id` |
| Bot | `PORTAL_TELEGRAM_BOT` en `apps/api` (usuario del bot sin `@`, p. ej. `ArgosIspBot`). Sin él, `POST /portal/telegram/vincular` responde 503 `telegram_no_configurado` y el portal muestra el botón apagado |

## Lo que llama el bot

```ts
import CanjearVinculoTelegram, { VinculoTelegramInvalido } from '#portal/actions/canjear_vinculo_telegram'

// Solo chats privados (`message.chat.type === 'private'`) y solo si el texto es `/start <código>`
// con el código del formato de arriba. `/start` sin código o con otro texto: mensaje de bienvenida.
const resultado = await new CanjearVinculoTelegram().execute(
    { secreto: codigo, chat_id: String(message.chat.id) },
    { actor: { tipo: 'sistema', id: null }, canal: 'webhook', requestId },
)
```

- El campo se llama `secreto` para que `audit.acciones.entrada` lo guarde como `***`.
- `chat_id` es el id del chat privado (entero positivo, como texto).
- Idempotente para el bot: si Telegram reintenta el mismo update después de un canje exitoso, el código ya está usado y responde `vinculo_invalido`. Para no confundir al cliente, si el chat que reintenta es el mismo que ya lo canjeó, la acción devuelve el mismo resultado con `ya_vinculado: true` en lugar del error.

### Respuesta

```json
{ "cliente_id": 101, "nombre_parcial": "María G.", "ya_vinculado": false }
```

Texto sugerido para el bot: "Listo, María G. Desde ahora te avisaremos por aquí de tus facturas y pagos. Puedes cambiar tu canal preferido en el portal."

### Errores

| Error | Cuándo | Texto sugerido al cliente |
| --- | --- | --- |
| `VinculoTelegramInvalido` (422, type `vinculo_invalido`) | El código no existe, venció, fue reemplazado o ya lo usó otro chat | `error.message` (ya viene en palabras del cliente: "El enlace venció o ya se usó. Abre el portal y pulsa Vincular Telegram otra vez.") |
| `ValidacionFallida` (422, `chat_id`, rule `privado`) | `chat_id` negativo (grupo o canal) | "Para vincular tu cuenta escríbeme por mensaje privado." |

Cualquier otro error es un fallo del sistema: el bot responde "No pudimos vincular tu cuenta. Intenta de nuevo en unos minutos." y no reintenta en bucle.

## Desvincular

- Desde el portal: `POST /api/v1/portal/telegram/desvincular` (sesión). Llama `DesvincularTelegramCliente` de A1; si el canal preferido era `telegram`, lo cambia a `correo` en la misma transacción.
- Desde el bot (si A6 lo quiere, p. ej. `/salir` o cuando Telegram responde 403 "bot was blocked by the user"): `DesvincularTelegramCliente` de A1 directamente, buscando al cliente por `telegram_chat_id`.

## Varios clientes en un chat

Un mismo chat puede quedar vinculado a más de un cliente (una persona con el servicio de su casa y el de su negocio): no es un error. Cada cliente se vincula con su propio código.
