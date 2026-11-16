---
orden: 6
---

# Webhooks

Argos avisa a otros sistemas con webhooks firmados con HMAC-SHA256. Hoy los destinos son los conectores de **Horus** e **Iris**: no hay webhooks configurables a una URL cualquiera. Los dos usan el mismo motor ([`webhooks_salientes.ts`](../../apps/api/app/integraciones/webhooks_salientes.ts)): mismas cabeceras, mismo cuerpo y mismos reintentos.

## Petición

```http
POST <url del receptor>
Content-Type: application/json
X-Webhook-Id: argos-evt-81234
X-Webhook-Timestamp: 1763305445
X-Webhook-Signature: v1=5d41402abc4b2a76b9719d911017c592…

{
    "id": "argos-evt-81234",
    "evento": "servicio.estado_cambiado",
    "ocurrido_en": "2026-11-16T15:04:05.000Z",
    "payload": { "servicio_id": 42, "empresa_id": 1, "…": "…" }
}
```

- `id` y `X-Webhook-Id` valen lo mismo: `argos-evt-<id del outbox>`. Es estable entre reintentos y entre entregas repetidas del bus; **deduplica por él**.
- `ocurrido_en` es el instante en que se escribió el evento (UTC), no el del envío.
- `payload` no es siempre el del bus: cada conector arma el suyo con una lista cerrada de campos (ids, estados, IPs), sin secretos, según su contrato. Los campos desconocidos se ignoran.

## Firma

```text
X-Webhook-Signature: v1=<hex(HMAC-SHA256(secreto, timestamp + "." + cuerpo))>
```

- `timestamp` es el valor de `X-Webhook-Timestamp` (segundos Unix) y `cuerpo` los bytes exactos del cuerpo recibido.
- El **secreto lo genera el receptor** y se entrega al emisor al conectar (enlace de conexión o configuración manual).
- El receptor rechaza una firma inválida y un timestamp con más de 5 minutos de desfase. Puede aceptar varias firmas separadas por coma o espacio (`v1=…,v1=…`) durante una rotación de secreto.

Verificación en Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function webhookValido(secreto, cabeceras, cuerpoCrudo) {
    const ts = cabeceras['x-webhook-timestamp']
    const firma = cabeceras['x-webhook-signature'] ?? ''
    if (!/^\d{1,12}$/.test(ts ?? '')) return false
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
    const esperada = Buffer.from(
        `v1=${createHmac('sha256', secreto).update(`${ts}.${cuerpoCrudo}`).digest('hex')}`,
    )
    return firma
        .split(/[\s,]+/)
        .filter(Boolean)
        .some((f) => f.length === esperada.length && timingSafeEqual(Buffer.from(f), esperada))
}
```

Calcula la firma sobre el cuerpo **sin parsear**: si lo vuelves a serializar, no coincide.

## Reintentos

- Un `2xx` marca el envío como `enviado`. Cualquier otra respuesta, un error de red o no responder en **5 s** cuenta como fallo.
- Tras un fallo se reintenta a 1 min, 5 min, 30 min, 2 h y 12 h: seis intentos en total. Después queda `fallido`, con el último error visible en el panel.
- No se siguen redirecciones: un `3xx` es un fallo.
- Si el conector no tiene destino (apagado o sin receptor), los envíos pendientes quedan `descartado`.
- Responde `2xx` rápido y procesa en segundo plano: el timeout es corto.

Cada sistema tiene su tabla de envíos y su consulta:

| Conector | Envíos                                                                                    | Permiso     |
| -------- | ----------------------------------------------------------------------------------------- | ----------- |
| Horus    | `GET /api/v1/integraciones/horus/envios`                                                  | `horus.ver` |
| Iris     | `GET /api/v1/integraciones/iris/envios` y `GET /api/v1/integraciones/iris/envios/resumen` | `iris.ver`  |

## Qué eventos se envían

**A Horus** (solo con el conector activo; contrato Horus §2.3): `asignacion.cambiada`, `sesion.iniciada`, `sesion.terminada`, `cliente.actualizado`, `servicio.estado_cambiado` y `servicio.config_cambiada` (solo si cambió el plan o la empresa).

**A Iris** (solo con el conector activo con receptor y para empresas del alcance del usuario técnico; contrato Iris §2.3): `cliente.actualizado`, `servicio.creado`, `servicio.config_cambiada`, `asignacion.cambiada`, `servicio.estado_cambiado`, `servicio.datos_cambiados`, `servicio.caidas_repetidas`, `servicio.eliminado`, `router.eliminado`, `catalogo.cambiado`, `inventario.equipo_por_recuperar`, `inventario.traslado_enviado`, `inventario.traslado_recibido`, `inventario.traslado_cancelado`, `comprobante.aprobado`, `comprobante.rechazado`, `promesa.creada`, `promesa.cumplida`, `promesa.incumplida` y `promesa.cancelada`. Los que nacieron en versiones posteriores del contrato solo van a un conector que declaró esa versión (por ejemplo, `servicio.datos_cambiados`, `catalogo.cambiado` y los de traslados desde 0.5.0; comprobantes y promesas desde 0.6.0).

## Webhooks que Argos recibe

| Ruta                                       | De quién | Notas                                                                                                                                                                                                                                                |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/integraciones/horus/webhook` | Horus    | Misma firma, con el secreto que generó Argos. `401 firma_invalida` o `401 timestamp_fuera_de_ventana`; `503 horus_apagado` con el conector apagado. Cuerpo de Horus `{ id, event, occurred_at, tenant, data }`; deduplica por `id` y responde `202`. |
| `POST /api/v1/integraciones/iris/webhook`  | Iris     | Igual, con el secreto de entrada que Argos entregó en el canje; `503 iris_apagado`. Cuerpo `{ id, evento, ocurrido_en, payload }`; deduplica por `X-Webhook-Id` y responde `202`.                                                                    |

Los eventos y campos desconocidos se ignoran. También existen receptores para la pasarela de pago (`/pasarela/webhook/:proveedor`) y Telegram (`/telegram/webhook/:bot`), cada uno con la verificación de su proveedor; ver la [referencia](./referencia/).
