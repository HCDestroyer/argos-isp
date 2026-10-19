# Contrato: nodo portal remoto

Versión 1.0.0 · expone A5 (API `apps/api/app/portal`, portal `apps/portal`) · lo cumple A6 (instalador, CLI `argosisp`, `Caddyfile.nodo-portal`, rama `a6/api-portal`).

El portal del cliente y la página de corte pueden correr en otro servidor (el **nodo**) que habla con la API central por HTTPS. El nodo no tiene base de datos: la única fuente de verdad es la API central. Este contrato parte de la propuesta de A6 (`a6.md`, 2026-10-19) y usa sus nombres. Las diferencias están marcadas con **(Δ)**.

## 1. Token del nodo

- Formato: `argn_` seguido de 43 caracteres base62 (`^argn_[A-Za-z0-9]{43}$`, unos 256 bits). Cabe en el `[A-Za-z0-9._~-]{16,512}` que valida A6.
- La API guarda solo el sha256 del token (`core.nodos_portal.hash`). El valor se muestra **una sola vez**, al crearlo, y nunca entra en la auditoría.
- Cada nodo tiene un `nombre` que lo identifica: `^[a-z0-9][a-z0-9-]{0,62}$`, único aunque esté revocado.
- Un nodo revocado deja de valer desde su siguiente petición. No hay caché que invalidar: cada petición consulta `core.nodos_portal`.

## 2. Cabeceras (nodo → API central)

| Cabecera | Cuándo | Contenido |
| --- | --- | --- |
| `X-Argos-Nodo-Token` | En cada petición a `/api/v1/portal/**` y a `GET /api/v1/version` | El token `argn_…` |
| `X-Argos-Cliente-Ip` | En cada petición a `/api/v1/portal/**` | IP del navegador del cliente (IPv4 o IPv6; `::ffff:a.b.c.d` y `[…]` se normalizan) |
| `X-Argos-Cliente-Proto` **(Δ, opcional)** | En cada petición a `/api/v1/portal/**` | `https` o `http`: cómo llegó el navegador al nodo. Decide si la cookie de sesión del portal (`argos_portal`) lleva `Secure`. Si falta, se toma `http` |

Reglas de la API:

1. **Sin `X-Argos-Nodo-Token`** (o vacía), `X-Argos-Cliente-Ip` y `X-Argos-Cliente-Proto` **se ignoran siempre**. La IP sale del socket o de `X-Forwarded-For` de un proxy de `PORTAL_PROXIES_CONFIABLES`, como antes. Nadie sin token puede hacerse pasar por la IP de otro cliente (prueba: `tests/portal/nodo_portal.spec.ts`).
2. **Con un token válido**, la IP del cliente es `X-Argos-Cliente-Ip` y `X-Forwarded-For` no se mira. El límite de peticiones (`PORTAL_LIMITE_*`), la identificación por IP y la IP de la sesión del portal usan esa IP. Pendiente de A1 (`a5.md`): el alcance anónimo de `Idempotency-Key` se calcula en un middleware que corre antes y, para un nodo, todavía usa la IP del socket. Sin cookie, los clientes de un mismo nodo comparten espacio de claves. Las claves son aleatorias (UUID), así que en la práctica no chocan.
3. **(Δ) Con un token desconocido o revocado: 401** problem+json `urn:argosisp:problema:nodo_portal_invalido`, y la cabecera de IP no se usa. A6 proponía caer a la IP de siempre; el 401 hace visible un nodo mal configurado o revocado. Si no, el nodo seguiría funcionando con todos sus clientes vistos como la IP del servidor del nodo ("no identificado"). Para la seguridad da lo mismo: en los dos casos la cabecera no se cree.
4. Con token válido, si falta `X-Argos-Cliente-Ip` o no es una IP: **400** `urn:argosisp:problema:ip_cliente_invalida`.
5. El token **no autentica en ninguna otra ruta**: los guards del panel solo leen `Authorization` (`atk_`, `oat_`, cookie del panel). `X-Argos-Nodo-Token` en `/clientes`, `/me`, `/nodos-portal` o `/internal/*` responde 401. Un `atk_` válido no convierte a nadie en nodo.
6. `ultimo_uso` y `ultima_ip` (la IP del socket desde la que llamó el nodo) se actualizan como mucho una vez por minuto.

## 3. `GET /api/v1/version`

Responde 200 a una sesión del panel, como siempre, **o** a `X-Argos-Nodo-Token` válido sin sesión. Así `argosisp actualizar` del nodo compara versiones. Con un token inválido o revocado: 401 `nodo_portal_invalido`. Sin ninguna de las dos: 401.

## 4. Gestión de nodos

Las rutas del CLI y las del panel llaman a las **mismas acciones**: `nodos_portal.crear` y `nodos_portal.revocar` (`DomainAction`, con fila en `audit.acciones` y diff en `audit.cambios`, `entidad_tipo = nodo_portal`).

### CLI (`argosisp nodo-portal crear|listar|revocar`), token interno

`Authorization: Bearer <INTERNAL_TOKEN>` (middleware `interno`). Actor `sistema`, canal `interno`.

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `POST /api/v1/internal/nodos-portal` | `{ "nombre": "xela-1" }` | 201 `{ nombre, token, creado_en }` · 409 `nodo_portal_existe` · 422 si el nombre no cumple el patrón |
| `GET /api/v1/internal/nodos-portal` | — | 200 `{ data: [{ nombre, creado_en, ultimo_uso_en, revocado_en }], nextCursor }` (hasta 200 por página; `?cursor=&limit=`) |
| `POST /api/v1/internal/nodos-portal/:nombre/revocar` | — | 200 `{ nombre, revocado_en }` · 404 si no existe. Repetirla no cambia la fecha |

### Panel (A4), permiso `nodos_portal.administrar` (solo `admin`)

| Método y ruta | Respuesta |
| --- | --- |
| `POST /api/v1/nodos-portal` `{ nombre }` | 201 `NodoPortalCreado` `{ token, datos: NodoPortal }` · 409 · 422 |
| `GET /api/v1/nodos-portal?cursor=&limit=` | 200 `{ data: NodoPortal[], nextCursor }` |
| `POST /api/v1/nodos-portal/:id/revocar` | 200 `NodoPortal` · 404 |

`NodoPortal`: `{ id, nombre, ultimo_uso, ultima_ip, revocado_en, creado_por, created_at }`. Nunca incluye el token ni el hash.

## 5. El nodo (lo que cumple A6)

Camino de una petición con el instalador de A6: navegador → Caddy del nodo (`:80`/`:443`) → portal (Nitro) → Caddy del nodo (`:8081`, solo red interna) → `https://api.<dominio>` con `X-Argos-Nodo-Token` y `X-Argos-Cliente-Ip: {client_ip}`.

- El portal (Nitro), **sin** `NUXT_NODO_PORTAL_TOKEN`, reenvía como siempre: `X-Forwarded-For` con la IP de su socket al final. Con `NUXT_PORTAL_PROXIES_CONFIABLES`, reenvía también el `X-Forwarded-Proto` que le puso el Caddy del nodo.
- El portal **borra siempre** las cabeceras `X-Argos-Nodo-Token`, `X-Argos-Cliente-Ip` y `X-Argos-Cliente-Proto` que mande el navegador. El Caddy `:8081` las sobrescribe con `header_up`.
- **(Δ) Pedido a A6:** en `:8081`, `header_up X-Argos-Cliente-Proto {http.request.header.X-Forwarded-Proto}`, para que la cookie del portal lleve `Secure` cuando el cliente entra por HTTPS. Sin esa línea, todo funciona, pero la cookie va sin `Secure`.
- En el central, Caddy es el borde y no confía en ningún `X-Forwarded-For` entrante. Las cabeceras `X-Argos-*` pasan sin tocarse.

Alternativa sin proxy de salida (también soportada): el portal con `NUXT_NODO_PORTAL_TOKEN=argn_…` y `NUXT_API_BASE_INTERNAL=https://api.<dominio>` resuelve él la IP del cliente (socket, o `X-Forwarded-For` de `NUXT_PORTAL_PROXIES_CONFIABLES`) y manda las tres cabeceras. No manda el token por `http://`, salvo a una API local (`localhost`, `127.0.0.0/8`, `::1`): en ese caso responde 502 al navegador y lo avisa en el log.

## 6. Pruebas

- API: `apps/api/tests/portal/nodo_portal.spec.ts`. Cubre administración, permisos, el CLI, `/version`, IPv4 e IPv6, suplantación sin token, token inválido o revocado, 400 sin IP, límite por cliente y cookie `Secure`.
- Portal: `apps/portal/tests/nuxt/utils-corte.test.ts` y `apps/portal/tests/servidor/portal.test.ts` (bloque «nodo portal remoto»).
