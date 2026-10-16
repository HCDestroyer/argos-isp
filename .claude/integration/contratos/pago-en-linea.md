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

## Pendiente (pedido a A3 en `a5.md`)

- `url_retorno` en `CrearCobroPasarela` / `EntradaCrearCobro` para que el proveedor (y la página de la pasarela falsa, tras "Pagar (simulado)") devuelva al cliente a `/corte?pago=<id>`. Mientras tanto el retorno es con "Atrás".

## Walled garden (A6)

- Con la pasarela falsa no hace falta nada: su página sale de la API (`PASARELA_URL_PUBLICA`).
- Con el proveedor real: su dominio de pago y los de sus recursos (se anotan en `a5.md` cuando A3 lo elija).
