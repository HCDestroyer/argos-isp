# Contrato: sesión del panel en cookie HttpOnly

Expone: A1 (`apps/api/app/core/auth/sesion_panel.ts`, `origenes.ts`). Consume: A4 (`apps/web`).
Decisión del PM (semana 3, tanda 2): el token del panel pasa a la opción más segura sin cambiar el flujo.

## Resumen

| Quién | Cómo se autentica |
| --- | --- |
| Panel (`apps/web`) | Cookie `argos_sesion` (`HttpOnly`) + `X-CSRF-Token` en métodos no seguros |
| Tokens de API, agentes de IA, aaa/coa, pruebas, scripts | `Authorization: Bearer` (sin cambios) |
| Portal del cliente | Su propia cookie `argos_portal` (sin cambios) |

El JavaScript del panel **nunca** ve el token de sesión: no está en el cuerpo de ninguna respuesta ni en una cookie legible.

## 1. Login

```http
POST /api/v1/auth/sesion
Content-Type: application/json
Origin: https://panel.isp.gt        (lo pone el navegador)
X-Canal: panel                      (opcional; con la cookie el canal por defecto ya es `panel`)

{ "email": "cajero@isp.gt", "password": "..." }
```

Mismas credenciales, validación y límite de intentos que `POST /auth/login` (429 con `Retry-After`).

Respuesta `200` (`SesionPanel`):

```json
{
    "usuario": { "id": 7, "nombre": "…", "email": "…", "roles": ["cajero"], "permisos": ["…"], "csrf": "…" },
    "csrf": "Q2x…",
    "expira_en": "2026-10-18T06:00:00.000Z"
}
```

y la cabecera:

```
Set-Cookie: argos_sesion=oat_…; Max-Age=43200; Path=/api; HttpOnly; Secure; SameSite=Strict
```

Errores: 401 `credenciales_invalidas`, 422 validación, 429 `demasiados_intentos`, 403 `csrf_invalido` si `Origin` no es un origen permitido o el cuerpo no es JSON (defensa contra "login CSRF").

**Por qué una ruta aparte y no `POST /auth/login` con `X-Sesion: cookie`:** la respuesta es otra (sin `token`, con `csrf`). Con una ruta propia, el OpenAPI y los tipos de `packages/contracts` quedan exactos (`SesionIniciada` sigue con `token` obligatorio para el portal, los agentes y las pruebas) y no hay uniones ni campos opcionales que el frontend tenga que adivinar.

## 2. Peticiones

- `fetch` con `credentials: 'include'` (el cliente de `packages/contracts` lo acepta: `createApiClient({ baseUrl, credentials: 'include', getCsrf })`).
- **No** mandar `Authorization`. Si llega `Authorization`, la API ignora la cookie (un Bearer explícito siempre gana y nunca se mezclan).
- En `POST`, `PUT` y `DELETE`: cabecera `X-CSRF-Token: <csrf>`. `createApiClient` la pone sola si se le pasa `getCsrf: () => csrf`. `GET` y `HEAD` no la necesitan.
- El navegador manda `Origin`; si llega, debe ser un origen permitido (abajo).
- Si falla el CSRF: `403 application/problem+json` con `type: urn:argosisp:problema:csrf_invalido`. No es un problema de permisos: el panel debe recargar el `csrf` con `GET /me` y, si persiste, volver al login.

### De dónde sale el `csrf`

`csrf = base64url(HMAC-SHA256(APP_KEY, "csrf:" + token de sesión))`. Va ligado a la sesión: cambia con cada login y muere con el logout o al vencer. El panel lo guarda **solo en memoria** (estado de Pinia/`useState`, nunca `localStorage` ni cookie). Tras recargar la página lo obtiene de nuevo con `GET /api/v1/me`, que con la cookie devuelve el `Me` con el campo `csrf` (con Bearer ese campo no viene).

### Por qué token sincronizador + `Origin` y no doble envío con cookie legible

- El panel (`localhost:3000`, `panel.isp.gt`) y la API (`localhost:3333`, `api.isp.gt`) pueden estar en orígenes distintos: el JavaScript del panel no puede leer una cookie de la API, así que el doble envío clásico no funciona sin compartir dominio. El token en el cuerpo de login y de `/me` sí funciona, y solo lo leen orígenes permitidos (CORS).
- El HMAC no guarda estado y no se puede fabricar sin `APP_KEY` y el token `HttpOnly`.
- `Origin` es una segunda capa barata. `SameSite=Strict` ya impide que la cookie viaje desde otro sitio; las dos capas cubren otros orígenes del mismo sitio (otro subdominio comprometido) y navegadores viejos.

## 3. Orígenes permitidos y CORS

- `CORS_ORIGINS` (lista separada por comas) en `apps/api/.env`: solo esos orígenes reciben `Access-Control-Allow-Origin` y `Access-Control-Allow-Credentials: true`.
- Sin lista, fuera de producción: `http(s)://localhost`, `127.0.0.1` y `[::1]` en cualquier puerto. En producción sin lista: ninguno (solo el mismo origen de la API).
- Nunca se refleja un origen cualquiera.
- En desarrollo por http con una IP o nombre que no sea `localhost`, `PANEL_COOKIE_SEGURA=false` quita `Secure` (los navegadores ya aceptan `Secure` en `http://localhost`).

## 4. Vencimiento y renovación

- La sesión vence a las `ACCESS_TOKEN_EXPIRA` (por defecto `12h`) del login; la cookie tiene el mismo `Max-Age`. `expira_en` lo dice.
- **No se renueva sola** (sin sesión deslizante). Cuando la API responde 401 (`no_autenticado`) el panel limpia su estado y vuelve al login. Puede avisar unos minutos antes de `expira_en`.
- Desactivar al usuario corta la sesión en la siguiente petición (401).

## 5. Logout

```http
POST /api/v1/auth/logout
X-CSRF-Token: <csrf>
```

`204`: revoca el token en `core.auth_access_tokens` y borra la cookie (`Set-Cookie: argos_sesion=; Max-Age=-1; Path=/api; …`). Sin `X-CSRF-Token`: 403. Con la sesión ya vencida responde 401; el panel lo trata igual que un logout correcto.

## 6. Auditoría

Las acciones hechas con la cookie quedan con `actor_tipo = usuario` y `canal = panel` (salvo que llegue otro `X-Canal` válido). El login queda como `auth.login` con canal `panel`.

## Cambios a este contrato

En la misma PR que el código que los cumple (`apps/api/app/core/auth/sesion_panel.ts`) y con aviso a A4 en `.claude/integration/a1.md`.
