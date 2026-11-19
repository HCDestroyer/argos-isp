---
orden: 8
---

# Ejemplos con curl

Recetas para las tareas más comunes. Todas usan un token de API en `$TOKEN` y la base de la API en `$API`; los datos son ficticios.

```bash
export API="https://<tu-api>/api/v1"
export TOKEN="atk_…"          # POST /tokens, ver Autenticación
```

Si la instalación tiene varias empresas, agrega `-H "X-Empresa-Id: <id>"` a cada llamada ([Multiempresa](./arquitectura.md#multiempresa)).

## Comprobar el token

```bash
curl -s "$API/me" -H "Authorization: Bearer $TOKEN"
```

Devuelve el usuario, `roles[]`, `permisos[]` (los efectivos del token) y `empresas[]`. Si falta un permiso de los que siguen, la llamada responde `403 prohibido`.

## Crear un cliente

Permiso `clientes.crear`.

```bash
curl -s -X POST "$API/clientes" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: alta-cliente-2026-11-16-001" \
    -d '{
        "nombre": "Ferretería El Martillo",
        "tipo": "empresa",
        "nit_cui": "CF",
        "telefono": "5512-3344",
        "email": "contacto@example.com",
        "direccion": "4a avenida 10-20, zona 1",
        "zona_id": 1
    }'
```

Responde `201` con el `Cliente`, incluidos `id`, `codigo` y `version`. El teléfono se guarda normalizado (`+502 5512-3344`). Un NIT con dígito verificador incorrecto o un CUI que no tiene 13 dígitos responde `422` con el campo `nit_cui` en `errors[]`.

## Crear un servicio PPPoE

Permiso `servicios.crear`. `user_ppp` y `pass_ppp` se generan si no vienen; la IPv4 se asigna de las redes del router y los prefijos IPv6 de sus pools, según el modo IPv6 (`ipv6_modo`).

```bash
curl -s -X POST "$API/servicios" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: alta-servicio-2026-11-16-001" \
    -d '{
        "cliente_id": 1532,
        "router_id": 3,
        "plan_id": 8,
        "direccion": "4a avenida 10-20, zona 1",
        "coordenadas": "14.6349,-90.5069"
    }'
```

Responde `201` con el `Servicio`. Fragmento:

```json
{
    "id": 4821,
    "cliente_id": 1532,
    "router_id": 3,
    "plan_id": 8,
    "estado": "activo",
    "tipo_conexion": "pppoe",
    "user_ppp": "…",
    "ipv4": "10.20.0.57",
    "prefijo_enlace_v6": "2001:db8:100:39::/64",
    "prefijo_delegado_v6": "2001:db8:200:3900::/56",
    "version": 1
}
```

La contraseña PPPoE nunca viene en el servicio: se consulta con `GET /servicios/:id/credenciales` (`servicios.ver_credenciales`), y la consulta queda auditada. El alta emite `servicio.creado` y `asignacion.cambiada`.

Errores frecuentes: `409 user_ppp_duplicado`, `409 ip_ocupada` (si mandaste `ipv4`), `422 empresa_requerida` (varias empresas y no se pudo deducir) y `422 tipo_conexion_del_router` (el tipo lo pone el router).

## Registrar un pago sin cobrar dos veces

Permiso `pagos.registrar`. El monto va como **string**. Sin `facturas`, se aplica a la factura más antigua primero. En la misma transacción se vuelve a evaluar el estado de cada servicio de las facturas que tocó: si ya no tiene deuda que lo corte, se reactiva solo.

```bash
curl -s -X POST "$API/pagos" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: caja5-recibo-000981" \
    -d '{
        "cliente_id": 1532,
        "metodo": "caja",
        "caja_id": 5,
        "monto": "150.00",
        "nota": "Pago en ventanilla"
    }'
```

Responde `201` con el `Pago`. Si la conexión se cae y no sabes si llegó, **repite exactamente la misma petición con la misma clave**:

- Si ya se registró, recibes la misma respuesta con `Idempotent-Replayed: true` y no se crea otro pago.
- Si la primera sigue en proceso, `409 idempotencia_en_curso`: espera unos segundos y repite.
- Si cambias el cuerpo con la misma clave, `422 idempotency_key_reutilizada`.

Con `deposito`, `transferencia`, `ach` o `remesa` son obligatorios `referencia` y `cuenta_bancaria_id`; con `transferencia` y `ach`, también `banco_origen_id`.

## Listar con cursor

Permiso `clientes.ver`. Recorre todas las páginas hasta que `nextCursor` sea `null`:

```bash
cursor=""
while :; do
    pagina=$(curl -s -G "$API/clientes" \
        -H "Authorization: Bearer $TOKEN" \
        --data-urlencode "limit=200" \
        --data-urlencode "q=martillo" \
        ${cursor:+--data-urlencode "cursor=$cursor"})
    echo "$pagina" | jq -c '.data[] | {id, codigo, nombre}'
    cursor=$(echo "$pagina" | jq -r '.nextCursor // empty')
    [ -z "$cursor" ] && break
done
```

`q` busca por nombre, código, NIT/CUI, teléfono, `user_ppp` o IP. La misma forma sirve para `/servicios`, `/facturas`, `/pagos` y el resto de listas.

En `/clientes` y `/servicios`, `buscar_red=false` hace que `q` no coincida por datos de red (IPv4, prefijo IPv6, `user_ppp`): sirve para integraciones que ocultan la red a quien no tiene permiso para verla. Por defecto es `true`.

## Suspender y reactivar un servicio

Permisos `servicios.suspender` y `servicios.reactivar`. El motivo es obligatorio (3 a 500 caracteres).

```bash
curl -s -X POST "$API/servicios/4821/suspender" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: suspender-4821-2026-11-16" \
    -d '{ "motivo": "Solicitud del cliente por viaje" }'
```

Responde `200` con el servicio en `estado: "suspendido"` y `suspension_manual: true`. El router recibe el cambio en segundos por el evento `servicio.estado_cambiado` (CoA o Disconnect según el modo de suspensión configurado).

- Una suspensión manual no la levanta un pago: mientras esté puesta, la evaluación automática no toca el servicio. Se quita con `POST /servicios/4821/reactivar` y un `motivo`.
- Solo se suspende desde `activo` o `limitado`. Un servicio retirado responde `422 servicio_retirado`; uno en otro estado, `422 transicion_invalida`.
- Repetirlo sobre un servicio ya suspendido no hace nada y devuelve el servicio.
- El rol base `cajero` no tiene `servicios.suspender`: un token de un cajero recibe `403`.

## Editar con `version`

```bash
curl -s -X PUT "$API/servicios/4821" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{ "version": 3, "plan_id": 9 }'
```

Si otra persona lo editó desde que lo leíste, `409 conflicto_version`: vuelve a leerlo con `GET /servicios/4821` y repite con la `version` nueva.
