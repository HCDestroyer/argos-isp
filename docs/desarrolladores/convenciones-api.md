---
orden: 4
---

# Convenciones de la API

Reglas que siguen todos los endpoints. La lista completa de operaciones está en la [Referencia de la API](./referencia/).

## Base y recursos

- Todas las rutas van bajo `/api/v1`. Los recursos están en español y en plural: `/clientes`, `/servicios`, `/facturas`, `/pagos`, `/promesas`, `/routers`, `/planes`.
- JSON en el cuerpo y en la respuesta (`Content-Type: application/json`), salvo las subidas de archivos (`multipart/form-data`) y las descargas.
- Claves en `snake_case`. Ids enteros positivos.
- El contrato es el OpenAPI 3.1 de [`packages/contracts/openapi.json`](../../packages/contracts/openapi.json), generado de los validadores VineJS con `pnpm contracts:build`. Los tipos TypeScript para clientes están en el mismo paquete.

## Acciones explícitas, no PATCH de estado

Un cambio de estado es una acción con su propia ruta y su propio permiso. Nunca se cambia un estado editando el recurso:

```http
POST /api/v1/servicios/42/suspender      { "motivo": "Solicitud del cliente" }
POST /api/v1/servicios/42/reactivar      { "motivo": "Pagó en ventanilla" }
POST /api/v1/facturas/1234/anular       { "motivo": "Emitida por error" }
```

`PUT` edita datos (con `version`, abajo); el estado no se acepta en el cuerpo. Una acción repetida sobre un servicio que ya está en el estado destino no hace nada y devuelve el servicio.

## Errores: RFC 9457

Toda respuesta de error tiene `Content-Type: application/problem+json` y esta forma:

| Campo      | Siempre | Qué es                                                    |
| ---------- | ------- | --------------------------------------------------------- |
| `type`     | sí      | `urn:argosisp:problema:<codigo>`: estable, decide por él. |
| `title`    | sí      | Título corto en español.                                  |
| `status`   | sí      | El mismo código HTTP.                                     |
| `detail`   | no      | Explicación para la persona que opera.                    |
| `errors[]` | no      | Errores por campo: `field`, `message` y `rule`.           |

Algunas respuestas agregan extensiones documentadas en la referencia, como `reintentar_en` cuando un servicio externo está en pausa.

Sin permiso:

```json
{
    "type": "urn:argosisp:problema:prohibido",
    "title": "Permiso insuficiente",
    "status": 403,
    "detail": "Se requiere el permiso servicios.suspender"
}
```

Datos inválidos (validación VineJS):

```json
{
    "type": "urn:argosisp:problema:validacion",
    "title": "Datos inválidos",
    "status": 422,
    "detail": "Los datos enviados no son válidos",
    "errors": [{ "field": "monto", "message": "El campo monto es obligatorio", "rule": "required" }]
}
```

Una regla de negocio impide la acción (no es un error de formato):

```json
{
    "type": "urn:argosisp:problema:transicion_invalida",
    "title": "Regla de negocio",
    "status": 422,
    "detail": "No se puede suspender un servicio en estado retirado"
}
```

Códigos frecuentes:

| Status | `type` (`urn:argosisp:problema:…`)                                                                                          | Cuándo                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 400    | `solicitud_invalida`, `idempotency_key_invalida`, `idempotency_key_requerida`                                               | Petición mal armada                                          |
| 401    | `no_autenticado`, `credenciales_invalidas`, `sesion_expirada`                                                               | Sin credencial válida                                        |
| 403    | `prohibido`, `empresa_no_permitida`, `csrf_invalido`                                                                        | Sin permiso, fuera de alcance o sin CSRF                     |
| 404    | `no_encontrado`, `ruta_no_encontrada`                                                                                       | No existe                                                    |
| 409    | `conflicto_version`, `idempotencia_en_curso`, `duplicado`, `concurrencia`, `ip_ocupada`, `user_ppp_duplicado`               | Conflicto con el estado actual                               |
| 422    | `validacion`, `regla_negocio` o un código propio, `empresa_requerida`, `idempotency_key_reutilizada`, `referencia_invalida` | Datos o reglas                                               |
| 429    | `demasiados_intentos`                                                                                                       | Límite de peticiones; trae `Retry-After`                     |
| 500    | `interno`                                                                                                                   | Error del servidor; reporta el `X-Request-Id`                |
| 501    | `no_implementado`                                                                                                           | La ruta está en el contrato pero este servidor no la atiende |

Los `409 concurrencia` (bloqueo o serialización de Postgres) se pueden reintentar tal cual.

## Paginación por cursor

Las listas usan paginación por cursor (keyset), no por número de página:

- Parámetros: `?cursor=<opaco>&limit=<n>`. `limit` va de 1 a 200; por defecto 50.
- Respuesta: `{ "data": [ … ], "nextCursor": "WzEyMzRd" }`. `nextCursor` es `null` en la última página.
- Para la siguiente página, repite la misma consulta con `cursor=<nextCursor>`. El cursor es opaco: no lo armes ni lo interpretes. Un cursor dañado responde `422` con `field: "cursor"`.
- El orden por defecto es por `id` descendente (lo más nuevo primero). Una fila creada mientras recorres no aparece a mitad del recorrido.

## Idempotencia

Las operaciones que mueven dinero o estado aceptan la cabecera `Idempotency-Key` (en la referencia: **Idempotencia**). Es la forma segura de reintentar después de un timeout.

- 1 a 255 caracteres ASCII visibles; si no, `400 idempotency_key_invalida`. Usa un valor nuevo por intento lógico (un UUID, o `<sistema>:<operacion>:<id>`).
- La clave es por usuario: dos usuarios con la misma clave no se mezclan.
- **Primera vez:** se ejecuta y, si responde `2xx`, se guarda la respuesta.
- **Repetición** con la misma ruta y el mismo cuerpo: devuelve la respuesta guardada, sin ejecutar nada, con la cabecera `Idempotent-Replayed: true`.
- Misma clave con otra ruta u otro cuerpo: `422 idempotency_key_reutilizada`.
- Mientras la primera sigue en curso: `409 idempotencia_en_curso`. Espera y reintenta.
- Si la primera terminó en error (`4xx` o `5xx`), la clave se libera y puedes reintentar con la misma.
- Algunas rutas que llaman otros sistemas la exigen: sin ella, `400 idempotency_key_requerida`.

## Versiones y `409`

Las entidades editables (clientes, servicios, planes, roles, plantillas…) traen `version`. Para editar, envía en el cuerpo la `version` que leíste:

```http
PUT /api/v1/servicios/42
{ "version": 7, "plan_id": 3 }
```

Si otra sesión la cambió antes, la respuesta es:

```json
{
    "type": "urn:argosisp:problema:conflicto_version",
    "title": "Conflicto de versión",
    "status": 409,
    "detail": "El servicio 42 cambió en otra sesión; recarga y vuelve a intentar"
}
```

Vuelve a leer el recurso, aplica tu cambio sobre lo nuevo y envía la `version` actual. Cada edición exitosa sube `version` en uno.

## Fechas y montos

- **Instantes** en UTC con formato ISO 8601: `"2026-11-16T15:04:05.000Z"`. La zona `America/Guatemala` solo se usa al mostrar; los parámetros que hablan de un día del calendario lo dicen en su descripción.
- **Fechas** sin hora como `"YYYY-MM-DD"`.
- **Montos** siempre como **string decimal** con hasta 2 decimales: `"150.00"`. Nunca como número: así no se pierden centavos. En las respuestas llevan siempre 2 decimales (esquema `Dinero`).
- El saldo de un cliente no es un campo: se calcula de su estado de cuenta (`GET /clientes/:id/estado-cuenta`).

## Otras cabeceras de respuesta

| Cabecera                    | Cuándo                                   |
| --------------------------- | ---------------------------------------- |
| `X-Request-Id`              | Siempre. Cítala al reportar un error.    |
| `Idempotent-Replayed: true` | La respuesta es una repetición guardada. |
| `Retry-After`               | Con `429`.                               |
