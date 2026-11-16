---
orden: 2
---

# Autenticación

La API acepta tres credenciales para las rutas con sesión, en este orden: el token de una sesión de login (`oat_…`), un token de API (`atk_…`) y la cookie del panel. Las dos primeras van siempre en `Authorization: Bearer`, nunca en el cuerpo ni en la URL.

| Credencial       | Prefijo        | Cómo se obtiene            | Vence                                    | Para qué                                     |
| ---------------- | -------------- | -------------------------- | ---------------------------------------- | -------------------------------------------- |
| Sesión de login  | `oat_`         | `POST /api/v1/auth/login`  | `ACCESS_TOKEN_EXPIRA` (12 h por defecto) | Scripts y pruebas con un usuario real        |
| Token de API     | `atk_`         | `POST /api/v1/tokens`      | No vence; se revoca                      | Integraciones, agentes de IA, otros sistemas |
| Cookie del panel | `argos_sesion` | `POST /api/v1/auth/sesion` | 12 h sin uso, 72 h como máximo           | Solo el panel web                            |

Sin credencial válida la respuesta es `401` con `type` `urn:argosisp:problema:no_autenticado`. Un usuario desactivado responde igual (`El usuario está desactivado`).

## Tokens de API

Un token de API es **su usuario con alcances más acotados**: pasa por el mismo ACL, sus acciones se auditan con actor `token` y nunca tiene más permisos que su usuario. Es lo que se usa para conectar otro sistema.

### Crear

`POST /api/v1/tokens` (permiso `tokens.crear`):

```json
{
    "usuario_id": 7,
    "nombre": "Integración contable",
    "alcances": {
        "permisos": ["clientes.ver", "facturas.ver", "pagos.ver"],
        "routers": [3],
        "zonas": [1, 2],
        "cajas": [5]
    }
}
```

- `alcances` es opcional. Sin él, el token tiene todos los permisos y alcances del usuario.
- `alcances.permisos` recorta los permisos del usuario a esa lista. Un nombre que no existe responde `422` (`Permiso desconocido: …`).
- `routers`, `zonas` y `cajas` restringen además los recursos sobre los que actúa. Se combinan con Y entre sí y con los alcances de los roles del usuario ([Permisos](./permisos.md#alcances)).
- El usuario técnico de Iris solo admite alcance por empresas: `routers` o `zonas` en su token responden `422 usuario_tecnico_solo_empresas`.

Respuesta `201`:

```json
{
    "token": "atk_…",
    "datos": {
        "id": 12,
        "usuario_id": 7,
        "nombre": "Integración contable",
        "alcances": {
            "permisos": ["clientes.ver", "facturas.ver", "pagos.ver"],
            "routers": [3],
            "zonas": [1, 2],
            "cajas": [5]
        },
        "ultimo_uso": null,
        "revocado_en": null,
        "created_at": "2026-11-16T15:04:05.000Z"
    }
}
```

::: warning
El valor de `token` se muestra **una sola vez**. Argos guarda solo su SHA-256; si se pierde, se crea otro y se revoca el anterior.
:::

### Usar

```bash
curl https://<tu-api>/api/v1/me -H "Authorization: Bearer atk_…"
```

`GET /api/v1/me` devuelve el usuario, sus roles, los permisos **efectivos del token** (ya recortados) y su alcance de empresas. Con un token de API, `expira_en` y `expira_max_en` son `null`. `ultimo_uso` se actualiza a lo sumo una vez por minuto.

### Listar y revocar

- `GET /api/v1/tokens` (permiso `tokens.ver`): página de tokens, sin su valor.
- `POST /api/v1/tokens/:id/revocar` (permiso `tokens.revocar`): desde ese momento el token responde `401`. No se puede deshacer.
- `POST /api/v1/auth/logout` no sirve para un token de API: responde `400 no_es_sesion`.

Los tokens de las integraciones tienen sus propias rutas, que crean el usuario técnico con los permisos del contrato: `POST /integraciones/horus/tokens` (`horus.generar_token`) y `POST /integraciones/iris/tokens` (`iris.generar_token`), con su `…/revocar`. Ver [Integraciones](./integraciones.md).

## Sesión de login (Bearer)

```bash
curl -X POST https://<tu-api>/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"ana@example.com","password":"…"}'
```

Responde `{ token, usuario }` con `token` = `oat_…`. Se cierra con `POST /api/v1/auth/logout` (`204`).

Límite de intentos: por IP (todos, también los de cuerpo inválido) y por usuario (los fallidos). Al pasarlo, `429 demasiados_intentos` con `Retry-After`. Lo configuran `LOGIN_LIMITE_IP` (30), `LOGIN_LIMITE_USUARIO` (5) y `LOGIN_LIMITE_VENTANA_S` (900). Correo o contraseña incorrectos: `401 credenciales_invalidas`.

## Sesión del panel (cookie)

El panel no guarda el token en el navegador. `POST /api/v1/auth/sesion` recibe las mismas credenciales y deja el token en la cookie `argos_sesion` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`). El cuerpo de la respuesta trae `csrf`, `expira_en` y `expira_max_en`.

- La cookie solo cuenta si la petición **no** trae `Authorization`.
- `POST`, `PUT` y `DELETE` exigen la cabecera `X-CSRF-Token` con ese `csrf` (también lo devuelve `GET /me`) y, si llega `Origin`, que sea un origen permitido (`CORS_ORIGINS`). Si no, `403 csrf_invalido`.
- El login por cookie exige `Content-Type: application/json`.
- La sesión se renueva sola con el uso (`PANEL_SESION_INACTIVIDAD_H`, 12 h) hasta el tope `PANEL_SESION_MAXIMA_H` (72 h desde el login). Vencida: `401 sesion_expirada` y la cookie se borra.

Contrato: [`sesion-panel.md`](../../.claude/integration/contratos/sesion-panel.md). Para integraciones usa un token de API, no la cookie.

## Autologin con Iris y Horus (SSO)

Desde Iris u Horus un usuario puede abrir Argos sin volver a iniciar sesión, y al revés. Ningún sistema da privilegios en el otro: el usuario entra con **su** usuario local de Argos y sus permisos.

1. El **servidor** del otro sistema pide un ticket con su token de integración (permiso `sso.emitir`): `POST /api/v1/integraciones/iris/sso/tickets` o `POST /api/v1/integraciones/horus/sso/tickets`, con `{ usuario: { id_externo, correo?, nombre? }, destino? }`. `destino` es `{ tipo: "cliente" | "servicio", id_externo }` con el id de Argos; en Iris es opcional (sin él, el inicio del panel).
2. Responde `201 { url, expira_en }`: la URL del panel `…/sso/entrar#<ticket>`. El ticket va en el fragmento, dura 60 s y es de un solo uso.
3. El panel canjea con `POST /api/v1/auth/sso/canjear` `{ ticket }`. Si la cuenta ya está vinculada, abre la sesión del panel igual que `POST /auth/sesion`. Si no, responde `vinculacion_requerida` con un token de vinculación.
4. El usuario escribe su correo y contraseña de Argos y el panel llama `POST /api/v1/auth/sso/vincular` (token de vinculación de 10 min y un uso). Si entra, la vinculación queda guardada.

- Argos **nunca crea usuarios** ni vincula por coincidir el correo.
- Un ticket vencido, usado o de un conector desconectado responde `410 ticket_invalido`; un token de vinculación vencido, `410 vinculacion_invalida`.
- Si el conector se preparó con un enlace y sigue apagado: `409 iris_apagado` o `409 horus_apagado`.
- Cada usuario ve y quita sus vinculaciones con `GET /api/v1/me/vinculaciones` y `POST /api/v1/me/vinculaciones/:id/quitar`. Un administrador las revoca en bloque con `POST /api/v1/vinculaciones/revocar` (`vinculaciones.revocar`).

Detalle en el contrato de Horus §1.5 y el de Iris §1.3 ([Integraciones](./integraciones.md)).

## Empresa activa: `X-Empresa-Id`

En una instalación con varias empresas, cada petición con sesión puede mandar `X-Empresa-Id: <id>`:

- Debe ser una empresa activa a la que el usuario (o el usuario del token) tenga acceso. Si no, `403 empresa_no_permitida`. Un valor que no es un número, `400`.
- Sin la cabecera, la empresa activa es la única del usuario. Si tiene varias, no hay empresa activa: las listas muestran todas las suyas y las altas que necesitan empresa responden `422 empresa_requerida`.

Ver [Multiempresa](./arquitectura.md#multiempresa).

## Otras cabeceras

| Cabecera          | Para qué                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Request-Id`    | Id de la petición (1 a 128 caracteres `A-Za-z0-9._:-`). Si no llega o no es válido se genera un UUID. Vuelve en la respuesta y queda en `audit.acciones` y en los eventos (`request_id`). |
| `X-Canal`         | Canal con el que se audita la acción (`panel`, `portal`, `api`, `ia`, …). Por defecto `panel` con la cookie y `api` con Bearer.                                                           |
| `Idempotency-Key` | Ver [Convenciones](./convenciones-api.md#idempotencia).                                                                                                                                   |

Las rutas `/api/v1/internal/*` no aceptan estas credenciales: son para `aaa` y `coa` y usan `Authorization: Bearer <INTERNAL_TOKEN>`.
