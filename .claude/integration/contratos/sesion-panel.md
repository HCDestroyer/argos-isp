# Contrato: sesión del panel en cookie HttpOnly

Expone: A1 (`apps/api/app/core/auth/sesion_panel.ts`, `origenes.ts`). Consume: A4 (`apps/web`).
Decisión del PM (semana 3, tanda 2): el token del panel pasa a la opción más segura sin cambiar el flujo.
Decisión del PM (semana 3, tanda 3): la sesión se renueva sola mientras se usa, con un tope absoluto de 3 días (§4).

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

Mismas credenciales, validación y límite de intentos que `POST /auth/login` (429 con `Retry-After`, expuesta por CORS: el panel la lee con `response.headers.get('Retry-After')`).

Respuesta `200` (`SesionPanel`):

```json
{
    "usuario": { "id": 7, "nombre": "…", "email": "…", "roles": ["cajero"], "permisos": ["…"], "csrf": "…" },
    "csrf": "Q2x…",
    "expira_en": "2026-10-18T06:00:00.000Z",
    "expira_max_en": "2026-10-20T18:00:00.000Z"
}
```

`expira_en` = login + `PANEL_SESION_INACTIVIDAD_H` (12 h); `expira_max_en` = login + `PANEL_SESION_MAXIMA_H` (72 h). Y la cabecera:

```
Set-Cookie: argos_sesion=oat_…; Max-Age=262800; Path=/api; HttpOnly; Secure; SameSite=Strict
```

El `Max-Age` de la cookie llega hasta `expira_max_en` + 1 h (aquí 73 h), **no** hasta `expira_en` (§4).

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

- Cabeceras expuestas (`Access-Control-Expose-Headers`): `x-request-id`, `idempotent-replayed` y `retry-after`.
- `CORS_ORIGINS` (lista separada por comas) en `apps/api/.env`: solo esos orígenes reciben `Access-Control-Allow-Origin` y `Access-Control-Allow-Credentials: true`.
- Sin lista, fuera de producción: `http(s)://localhost`, `127.0.0.1` y `[::1]` en cualquier puerto. En producción sin lista: ninguno (solo el mismo origen de la API).
- Nunca se refleja un origen cualquiera.
- En desarrollo por http con una IP o nombre que no sea `localhost`, `PANEL_COOKIE_SEGURA=false` quita `Secure` (los navegadores ya aceptan `Secure` en `http://localhost`).

## 4. Vencimiento y renovación (sesión deslizante)

Código: `apps/api/app/core/auth/sesion_deslizante.ts` (reglas) y el guard `panel` de `sesion_panel.ts`.

| Variable (`apps/api/.env`) | Por defecto | Qué es |
| --- | --- | --- |
| `PANEL_SESION_INACTIVIDAD_H` | `12` | Horas sin peticiones tras las que vence la sesión |
| `PANEL_SESION_MAXIMA_H` | `72` (3 días) | Tope absoluto desde el login: ahí vence aunque se use |

- **Cada petición autenticada con la cookie** lleva el vencimiento a `min(ahora + inactividad, login + máxima)`.
- **Sin escribir en la base en cada petición.** Solo se guarda (`expires_at` y `last_used_at` del token) cuando el vencimiento nuevo supera al guardado en al menos el **umbral**: 10 % de la ventana de inactividad, entre 1 y 15 min (con 12 h: **15 min**). Una sesión activa escribe como mucho 4 veces por hora, y la ventana real de inactividad queda entre 11 h 45 min y 12 h desde la última petición. Al acercarse al tope se hace una última escritura que lo alcanza exacto. Las peticiones sin renovación no escriben nada (el guard ya no actualiza `last_used_at` en cada una).
- **La cookie dura hasta el tope, no hasta `expira_en`:** `Max-Age` = segundos hasta `expira_max_en` + 1 h de gracia (`GRACIA_COOKIE_PANEL_S`). Si durara hasta `expira_en`, el navegador la borraría justo al vencer por inactividad, la petición siguiente llegaría sin cookie y la API respondería `no_autenticado` en vez de `sesion_expirada`. La hora de gracia hace lo mismo al llegar al tope. La validez real la decide siempre el servidor con `expires_at` del token; una cookie con un token vencido no sirve para nada y la API la borra al responder `sesion_expirada`.
- **Al renovar**, la respuesta vuelve a traer `Set-Cookie: argos_sesion=<mismo token>; Max-Age=<segundos hasta expira_max_en + 1 h>; …` (mismo criterio). El navegador la reemplaza solo; el panel no hace nada.
- **El `csrf` no cambia al renovar.** Es `HMAC(APP_KEY, token)` y el token es el mismo; rotarlo obligaría al panel a leer un `csrf` nuevo de una respuesta cualquiera y haría fallar con 403 las peticiones en vuelo con el valor viejo, sin ganar nada (el `csrf` ya muere con la sesión y cambia en cada login).
- **Vencida** (por inactividad o por el tope): `401 application/problem+json` con `type: urn:argosisp:problema:sesion_expirada` y la cookie borrada (`Max-Age` vencido). Sin cookie, con un token inválido o revocado sigue siendo `401 no_autenticado`. Con `sesion_expirada` el panel abre la ventana de bloqueo (decisión del PM); con `no_autenticado` va al login. Después de borrada la cookie (o más de 1 h después del tope) la API ya solo puede responder `no_autenticado`.
- `GET /me` trae `expira_en` (vencimiento vigente, ya renovado por esa misma petición) y `expira_max_en` (tope) para avisar si se quiere. Con Bearer de login los dos son el vencimiento fijo; con tokens de API, `null`.
- **Bearer sin cambios:** los tokens de `POST /auth/login` (API, agentes, aaa/coa, pruebas) vencen a `ACCESS_TOKEN_EXPIRA` (12 h) y no se renuevan; los tokens de API (`atk_`) no vencen; el portal tiene su propia cookie. Un token de `POST /auth/login` puesto a mano en la cookie tampoco se desliza: solo los tokens creados por `POST /auth/sesion` (nombre `sesion panel` en `core.auth_access_tokens`).
- Desactivar al usuario corta la sesión en la siguiente petición (401 `no_autenticado`).

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
