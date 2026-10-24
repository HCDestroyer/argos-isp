# Pago en línea desde el portal (A5 ↔ A3)

Dueños: A5 (portal) consume; A3 (billing) es dueño del cobro, el webhook y el pago.

## Flujo

1. `/corte` (o `/cuenta`) → `POST /api/v1/portal/pagos/iniciar` con `Idempotency-Key`.
   - Cuerpo: `{}` (servicio por la IP de origen), `{ servicio_id }` (sesión del portal) o `{ facturas: [id…] }` (sesión; facturas del cliente).
   - Monto por defecto: facturas **vencidas** con saldo del servicio (vencida = estado `vencida` o `vence_en` anterior a hoy en Guatemala); si no hay vencidas, todo lo pendiente del servicio.
   - El portal llama `CrearCobroPasarela` (`pasarela.crear_cobro`) con `{ cliente_id, servicio_id, facturas }`, `ctx = { actor: sistema, canal: 'portal' }`.
   - Respuesta 201 `PortalPagoEnLinea`: `{ id, estado, monto, url_pago, expira_en, pagado_en }`.
   - Errores: 401 (sin sesión con `servicio_id`/`facturas`), 404 (servicio o factura de otro cliente), 422 `no_identificado`, 422 `sin_deuda`, 422 `facturas.<i>` (sin saldo), 429, 503 `pasarela_no_configurada`.
2. Antes de ir a `url_pago`, el portal reemplaza su URL por `/corte?pago=<id>` (`history.replaceState`): el "Atrás" del navegador vuelve ahí; si el navegador restaura la página de su caché (bfcache), el portal recarga para leer `?pago`.
   - Con un cobro `pendiente` o `pagado` en curso, `/corte` no ofrece "Pagar en línea" otra vez (evita cobros dobles) y ofrece "Volver a la página de pago" (`url_pago`, solo mientras está pendiente).
3. El proveedor notifica `POST /api/v1/pasarela/webhook/<proveedor>` (firma HMAC). A3 registra el pago y reactiva el servicio en la misma transacción.
4. `/corte?pago=<id>` consulta cada 5 s `GET /api/v1/portal/pagos/en-linea/:id` y `GET /api/v1/portal/estado`:
   - cobro `pendiente` → "Procesando tu pago…"
   - servicio `activo` → "Ya tienes servicio"
   - cobro `fallido` / `expirado` → error claro con "Intentar de nuevo"
   - cobro `pagado` y el servicio aún no activo (queda otra deuda) → "Recibimos tu pago".
   - `GET /portal/pagos/en-linea/:id` responde solo si el cobro es del cliente de la sesión o del servicio de la IP; si no, 404.

## URL de retorno

- `CrearCobroPasarela` acepta `url_retorno` opcional (también `POST /pasarela/cobros` del panel). El portal manda `<PORTAL_URL_PUBLICA>/corte?pago={cobro_id}`: A3 reemplaza `{cobro_id}` por el id del cobro (existe recién al crearlo) y guarda la URL resuelta en `CobroPasarela.url_retorno`.
- Solo se aceptan orígenes (`esquema://host[:puerto]`) de `PASARELA_RETORNO_ORIGENES` (API, separados por comas; vacía = el origen de `NOTIFY_PORTAL_URL`). Otro origen, otro esquema que no sea http/https, usuario o clave en la URL, o una ruta relativa → 422 con `errors[].field = url_retorno` (`rule`: `origen_no_permitido` o `url`), sin crear el cobro. Evita que el cobro sirva de redirección abierta.
- El adaptador recibe la URL resuelta en `EntradaCrearCobro.url_retorno` (el proveedor real la recibe como `return_url`).
- Pasarela falsa: los botones de su página ("Pagar (simulado)", "Rechazar tarjeta (simulado)") envían `POST /api/v1/pasarela/falsa/<id_proveedor>/formulario`, que procesa el webhook firmado y responde **303** a `url_retorno` con `estado=<pagado|fallido|pendiente>` agregado (p. ej. `/corte?pago=42&estado=pagado`). Sin `url_retorno`, el 303 vuelve a la página de la pasarela. `POST …/pagar` sigue respondiendo JSON (scripts y pruebas).
- Portal (A5): `POST /portal/pagos/iniciar` arma la plantilla con `PORTAL_URL_PUBLICA` de la API (vacía = `NOTIFY_PORTAL_URL`; sin ninguna no manda `url_retorno` y el cliente vuelve con "Atrás"). Si A3 rechaza la URL (configuración: origen fuera de `PASARELA_RETORNO_ORIGENES`), el portal responde 503 `pasarela_no_configurada` y lo deja en el log; nunca 422 al cliente.
- Al volver, `/corte` muestra `estado=fallido` como "Tu pago no se completó" y `estado=pagado` como "Tu pago fue aprobado" mientras el cobro siga `pendiente` en la API; en cuanto la API diga otra cosa, gana la API.
- `estado` en la URL de retorno es solo una pista para la pantalla: el portal sigue leyendo el estado real con `GET /api/v1/portal/pagos/en-linea/:id` (el pago puede llegar después por webhook).

## Walled garden (A6)

- Con la pasarela falsa no hace falta nada: su página sale de la API (`PASARELA_URL_PUBLICA`).
- Con Recurrente (proveedor real, decisión del PM): el cliente cortado debe poder abrir **`app.recurrente.com`** (la página de pago es `https://app.recurrente.com/checkout-session/<ch_…>` y la API es la misma; https://docs.recurrente.com/referencia-api/api-reference/checkouts/create-checkout.md). Pendiente de confirmar en el laboratorio con un checkout del Sandbox: los dominios de recursos que cargue esa página (CDN, analítica) y el 3-D Secure del banco emisor de la tarjeta, que no se pueden listar de antemano. El webhook llega del lado del servidor (Svix), no del cliente: no va en el walled garden, pero el firewall de la API debe aceptar las IP de Svix (https://docs.svix.com/webhook-ips).

## Recurrente (A3, adaptador real)

Decisión del PM (2026-10-24). Adaptador `app/billing/pasarelas/recurrente.ts` (`PASARELA_PROVEEDOR=recurrente`); el resto del flujo (cobro, webhook idempotente, pago, asiento `Bancos (neto) + 5.1.02 Comisiones / CxC`, reactivación, conciliación) es el mismo de la pasarela falsa.

Fuentes (documentación oficial, consultada el 2026-10-24):
- Índice: https://docs.recurrente.com/llms.txt
- Autenticación: https://docs.recurrente.com/guias-espanol/comenzar/autenticacion.md (cabecera `X-SECRET-KEY`; `sk_live_…` producción, `sk_test_…` solo en un Sandbox; URL base `https://app.recurrente.com/api` para los dos; `GET /test` dice el ambiente).
- Crear checkout: https://docs.recurrente.com/referencia-api/api-reference/checkouts/create-checkout.md
- Ver checkout: https://docs.recurrente.com/referencia-api/api-reference/checkouts/get-checkout.md
- Intents (formato unificado): https://docs.recurrente.com/referencia-api/api-reference/intents/get-intent.md y https://docs.recurrente.com/referencia-api/api-reference/intents/list-intents.md
- Webhooks y firma: https://docs.recurrente.com/guias-espanol/comenzar/webhooks.md; eventos legacy: https://docs.recurrente.com/webhooks-legacy-en.md
- Registrar el endpoint de webhooks: https://docs.recurrente.com/referencia-api/api-reference/webhook-endpoints/create-webhook-endpoint.md

Correspondencia:
- **Cobro** → `POST /checkouts` con un ítem en línea (`name`, `currency: GTQ`, `amount_in_cents`, `quantity: 1`, `charge_type: one_time`, `tax_category: service`), `success_url` = `url_retorno` + `estado=pagado`, `cancel_url` = `url_retorno` + `estado=pendiente`, `metadata` `{ referencia: <cobro_id>, cliente_id }`, `expires_at` (ahora + `RECURRENTE_EXPIRA_HORAS`, 24 por defecto). `id_proveedor` = `id` (`ch_…`), `url_pago` = `checkout_url`. Mínimo de Recurrente: Q5.00 (500 centavos): menos → 422 `monto` (`rule: minimo_pasarela`). Error del proveedor → 502 `pasarela_error`; sin respuesta → 503.
- **Webhook** `POST /api/v1/pasarela/webhook/recurrente`: firma Svix. Cabeceras `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>`, varias separadas por espacio); firma = base64(HMAC-SHA256(base64decode(secreto sin `whsec_`), `<svix-id>.<svix-timestamp>.<cuerpo crudo>`)), comparación en tiempo constante, ventana ± 5 min → si no, 401 `firma_invalida`. `id_evento` = `svix-id` (el mismo en los reintentos: idempotencia). `intent.succeeded` / `payment_intent.succeeded` → pagado; `intent.failed`, `intent.canceled`, `payment_intent.failed` → fallido; los demás → pendiente (no cambian el cobro). Cobro = `checkout.id`; monto = `amount_in_cents` / 100; comisión = `details.fee` (unificado) o `fee` (legacy), en centavos.
- **Monto distinto** del cobro: no se registra el pago (`ignorado: monto_distinto`, aviso en el log); la conciliación lo reporta como `pago_sin_registrar`.
- **Retención de IVA de la emisora** (`details.vat_withheld` o `vat_withheld`, centavos; H51): el pago entra por `monto − retención` con una constancia `RET_IVA_TAR` (número `recurrente:<checkout>`) a `1.1.05 IVA retenido por clientes`; aplica el bruto a la deuda y el banco queda por el neto real (bruto − comisión − retención).
- **Reembolso** (`refund.*` con `refund.status = succeeded`; el cobro sale de `intentable`; monto `refund.customer_refunded_amount_in_cents`): total (≥ el pago vigente, o sin monto) → `AnularPago` anidada (la deuda vuelve, el servicio se re-evalúa). Parcial (H60) → en la misma transacción anula el pago vigente y registra otro por `pago − reembolsado` a las mismas facturas, con la misma comisión (§15 #104) y sus constancias, referencia `<referencia>:reembolso:<id>`; el cobro apunta al pago nuevo (`pago_reemplazo_id` en la respuesta). H65: se aplica aunque lo que queda sea menor que la comisión (la comisión sigue de gasto y el banco recibe un neto negativo en el haber: la pasarela lo descuenta). H70: las constancias del reemplazo van siempre en proporción a lo que queda (retenido × queda / pago, §15 #105, provisional); el total las deja en 0.
  - **H71 · montos del reembolso.** El objeto `refund` de Recurrente ([Obtener un reembolso](https://docs.recurrente.com/referencia-api/api-reference/refunds/get-refund.md), [Crear un reembolso](https://docs.recurrente.com/referencia-api/api-reference/refunds/create-refund.md)) trae `customer_refunded_amount_in_cents` («Monto devuelto al cliente»), `account_refunded_amount_in_cents` («Monto debitado de la cuenta del comercio») y `refund_application_fee` (booleano: «Si las comisiones de plataforma se devolvieron con el reembolso»; al crear, `true` regresa a la cuenta las comisiones de plataforma antes de reembolsar, por defecto `false`). El adaptador lo pasa como `monto` (cliente) y `monto_cuenta` (cuenta). La deuda vuelve por lo del cliente; el banco baja por lo de la cuenta; la diferencia (cliente − cuenta) es comisión devuelta y sale de 5.1.02: en el parcial, el pago de reemplazo lleva `comisión − devuelta`; en el total, la anulación revierte la comisión entera y la no devuelta (`comisión − devuelta`, si es > 0) vuelve a gasto con un asiento `ajuste` 5.1.02 / banco del pago. Una devuelta negativa o mayor que la comisión del pago es 422 `reembolso_monto_cuenta` (aviso `error_de_negocio`, la conciliación lo lista `reembolso_sin_aplicar`). Sin `account_refunded_amount_in_cents`, lo de antes. Con proveedor de cobro no se ajusta: la comisión real sale en la liquidación. `refund_application_fee` solo se guarda en el payload. Idempotente por id del reembolso (`reembolso_ya_aplicado`). La conciliación da por cuadrado el cobro si lo vigente es lo pagado menos lo reembolsado (el checkout sigue `paid`); un aviso de reembolso rechazado por una regla de negocio (`ignorado: error_de_negocio`) y nunca aplicado sale como diferencia `reembolso_sin_aplicar`.
- **Errores de negocio** (H61): un aviso auténtico que no se puede aplicar (referencia repetida, periodo cerrado…) se deshace entero (savepoint), responde **2xx** con `ignorado: error_de_negocio` y `error`, queda en `billing.pasarela_eventos` y en el log; la conciliación lo reporta. Ningún webhook válido queda reintentándose.
- **Proveedor de cobro** (H61): con Recurrente configurado como proveedor de cobro (`1.1.10.NN`), la retención de IVA de la emisora va igual a `1.1.05` en el pago y el puente recibe `monto − retenido`; la liquidación suma cada pago por `monto − retenido`.
- **Contracargo** (`dispute.*`): sin acción automática; queda en `billing.pasarela_eventos` (estado `disputa`), aviso en el log y la conciliación del día lo lista como diferencia `disputa` para contabilidad. Un aviso por notificación (evento del catálogo) queda para cuando el líder lo agregue a `CLAUDE.md`.
- **Factura de comisiones de Recurrente**: no se registra como compra (la comisión ya entró por pago a `5.1.02`); runbook `docs/runbooks/pago-en-linea-recurrente.md`, IVA de esa factura en `localizacion-fiscal.md` §15 #102.
- **Conciliación** (`pasarela.conciliar`) → `GET /checkouts/{id}`: `paid` → pagado, `expired` → expirado, `unpaid`/`payment_in_progress` → pendiente; monto = `total_in_cents`. La comisión del pagado sale de `GET /intents/{payment.id}` (`details.fee`); si no responde queda 0.00 (la conciliación compara estado y monto).

Variables de entorno (`apps/api/.env.example`, nunca en el repo): `RECURRENTE_SECRET_KEY`, `RECURRENTE_WEBHOOK_SECRETO` (`whsec_…`), `RECURRENTE_API_URL` (opcional), `RECURRENTE_EXPIRA_HORAS` (opcional).

Pendiente del PM (sin esto no se activa en producción):
1. Cuenta de Recurrente de la empresa y un **Sandbox** con su `sk_test_…` (para la prueba real `tests/billing/pasarela_recurrente.spec.ts`, que se salta sola sin ella) y después la `sk_live_…`.
2. **URL pública de la API** para registrar el webhook (`<API>/api/v1/pasarela/webhook/recurrente`, eventos `intent.succeeded`, `intent.failed`, `intent.canceled`) y el `whsec_…` que devuelve Recurrente.
3. **Facturación electrónica de Recurrente apagada** en la cuenta: Recurrente puede emitir su propio DTE por cada pago (ver `details.tax_invoicing_fee` y «Corregir y reemitir el DTE de un intent» en la referencia). ArgosIsp certifica con INFILE; dos DTE por el mismo cobro serían un error fiscal.
4. Confirmar con el contador si `details.fee` trae el IVA de la comisión (hoy todo `fee` va a `5.1.02`) y si la retención de la emisora es `RET_IVA_TAR` (hoy así, a `1.1.05`).
5. Multiempresa: una llave por instalación. Si cada empresa (NIT) tiene su cuenta de Recurrente, hace falta la llave por empresa (o `X-ACCOUNT-ID` de cuentas conectadas); hoy el adaptador usa una sola cuenta.

