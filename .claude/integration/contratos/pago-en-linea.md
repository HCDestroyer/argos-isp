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
- Con el proveedor real: su dominio de pago y los de sus recursos (se anotan en `a5.md` cuando A3 lo elija).
