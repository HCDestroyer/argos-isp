# Contrato aaa ← A1

Pedido por A2 el día 2. Lo cumple A1 en la tarea 9 (día 3). Cambios a este contrato: se acuerdan en `a1.md` o `a2.md` y se actualiza este archivo en la misma PR.

Redis `aaa:user:<user_ppp>` (sin TTL) y `GET /internal/aaa/servicio?user_ppp=<user_ppp>` devuelven el mismo JSON. Validador: `services/aaa/src/servicio.ts`.

```json
{
  "servicio_id": 101,
  "version": 3,
  "user_ppp": "cliente-101",
  "pass_ppp": "v1.<iv>.<tag>.<datos>",
  "estado": "activo",
  "router_id": 1,
  "control_velocidad": "simple",
  "plan": {
    "id": 1,
    "subida_kbps": 5120,
    "bajada_kbps": 20480,
    "subida_limitada_kbps": 1024,
    "bajada_limitada_kbps": 2048,
    "rate_limit_override": null,
    "profile_ppp": null,
    "rate_limit": "5120k/20480k 0/0 0/0 0/0 8 5120k/20480k",
    "rate_limit_limitado": "1024k/2048k 0/0 0/0 0/0 8 1024k/2048k",
    "reuso": 1
  },
  "ipv4": { "modo": "estatico", "ip": "10.10.1.10" },
  "ipv6": { "modo": "radius_servicio", "prefijo_enlace": "2001:db8:101:1::/64", "prefijo_delegado": "2001:db8:300:100::/56" }
}
```

- **Solo servicios `pppoe`** (semana 2, `contratos/routeros.md`): un servicio `ip_estatica` o `dhcp_fija` no tiene `user_ppp` ni `pass_ppp` y es inexistente para `aaa` (no está en Redis; el endpoint no lo encuentra). Al cambiar un servicio de `pppoe` a otro tipo, la clave del `user_ppp` viejo recibe la lápida (`eliminado`, `user_ppp`, `servicio_id`, `version`), nunca credenciales.
- `estado`: `pendiente_instalacion` | `activo` | `limitado` | `suspendido` | `retirado` (`core.servicios.estado` tal cual; `aaa` no decide estados). `pendiente_instalacion` y `retirado` reciben Access-Reject (`contratos/instalacion.md` §3).
- `plan.*`: de `network.planes`; `rate_limit_override` y `profile_ppp` de `network.planes_routers` para el router del servicio (null si no hay fila o no está definido).
- `plan.rate_limit` y `plan.rate_limit_limitado` (semana 2, `contratos/velocidad.md`): la cadena **completa** de `Mikrotik-Rate-Limit` (`rx/tx ráfaga-rx/ráfaga-tx umbral-rx/umbral-tx tiempo-rx/tiempo-tx prioridad limit-at-rx/limit-at-tx`) que calcula `rateLimitServicio(planEfectivo, estado)` de `apps/api/app/network/velocidad.ts` con el plan y sus excepciones del router. `rate_limit` (estado activo) ya incluye `rate_limit_override` si el router lo define; `rate_limit_limitado` va sin ráfaga. `aaa` manda una de las dos tal cual, sin recalcular (así PPPoE y WISP no difieren). Unidades: `k` = 1000, `M` = 1 000 000; un múltiplo de 1000 kbps sale en `M`. Un plan sin campos nuevos conserva su velocidad; lo único nuevo es el `limit-at` que sale del reuso (con reuso 1, `limit-at` = MIR). `subida_kbps`, `bajada_kbps`, `*_limitada_kbps` y `rate_limit_override` se siguen enviando por compatibilidad.
- `velocidad` (semana 4, `contratos/control-velocidad.md` §7): `{ aplicacion, grupo, rate_limit, rate_limit_limitado }` según la estrategia PPPoE efectiva (router + plan). `grupo` = `Mikrotik-Group` en activo y limitado; `rate_limit*` = si va `Mikrotik-Rate-Limit` en ese estado. `plan.rate_limit*` ya traen los extras aplicados (sin ráfaga, prioridad 8 o sin `limit-at` si están apagados). `aaa` y `coa` usan `velocidad` si viene; si no, lo de abajo.
- `plan.reuso` (reuso efectivo en el router) y `control_velocidad` (`network.routers`): con reuso > 1 en modo `simple`, `aaa` manda `Mikrotik-Group = plan-<plan.id>` (perfil con `parent-queue`); en `arbol_pcq` el marcado lo hace el dispatcher.
- `ipv4`: `{"modo":"estatico","ip":"<ipv4>"}` con la asignación vigente de `network.ipv4_asignaciones`, `{"modo":"pool","pool":"<planes_routers.pool_ipv4>"}`, o `null`.
- `ipv6`: según `core.servicios.ipv6_modo`. `radius_servicio` → `{"modo":"radius_servicio","prefijo_enlace":"<.../64>","prefijo_delegado":"<.../56|/48>"}` (asignaciones vigentes, `null` si falta alguna); `radius_pool` → `{"modo":"radius_pool","pool_enlace":"<planes_routers.pool_ipv6_enlace>","pool_delegacion":"<planes_routers.pool_ipv6_delegacion>"}`; `duid`, `estatico`, `ninguno` → `{"modo":"<modo>"}`. `null` equivale a `ninguno`.
- `pass_ppp`: siempre cifrada, nunca en claro en Redis ni en la respuesta HTTP.
- `version`: `core.servicios.version` (diagnóstico).
- Endpoint: `GET /api/v1/internal/aaa/servicio?user_ppp=` con `Authorization: Bearer <AAA_INTERNAL_TOKEN>` (en la API se llama `INTERNAL_TOKEN`; mismo valor). Ojo: la ruta lleva el prefijo `/api/v1`, así que `API_INTERNAL_URL` debe incluirlo; 200 con el JSON; **404 si no existe el `user_ppp`**; un servicio retirado devuelve 200 con `estado: "retirado"`; cualquier otro código lo trata `aaa` como error. Debe responder en < 300 ms.
- Escritura en Redis (A1): **SET con el JSON completo** (write-through) después del commit, en cada cambio que altere cualquier campo (servicio, plan, `planes_routers`, asignaciones, estado). No usar solo `DEL`: `aaa` repuebla con `SET NX` y un `DEL` podría competir con una lectura vieja de la API. Al borrar el servicio o cambiar su `user_ppp`, escribir en la clave vieja una lápida `{"eliminado": true, "user_ppp": "<viejo>"}`. También al **retirar** el servicio (su `user_ppp` no se reutiliza): en Redis queda la lápida y el endpoint sigue respondiendo 200 con `estado: "retirado"`; para `aaa` ambos significan rechazar.
- Implementación (A1, tarea 9): `apps/api/app/core/aaa.ts`. La escritura es un SET condicionado (script Lua): no reemplaza un registro **del mismo `servicio_id`** cuya `version` sea mayor, para que un gancho atrasado no deje datos viejos. Por eso la lápida lleva además `servicio_id` y `version` (`{"eliminado": true, "user_ppp": "...", "servicio_id": 101, "version": 7}`); `aaa` ignora esos dos campos. Escriben: cada acción después de su COMMIT (servicio, estado, asignaciones, plan, `planes_routers`) y el consumidor del grupo `aaa-cache` (eventos `servicio.*` y `asignacion.cambiada`, tarea 10). Si se restaura la base desde un respaldo, borrar `aaa:user:*` (las versiones en Redis podrían ser mayores).
- Cifrado `v1` (para `pass_ppp` y `network.routers.radius_secret`): AES-256-GCM con la clave `AAA_PPP_KEY` (32 bytes en base64), IV aleatorio de 12 bytes, tag de 16; texto `v1.` + base64url(iv) + `.` + base64url(tag) + `.` + base64url(cifrado), sin relleno. Referencia: `services/aaa/src/cifrado.ts` (`cifrar`/`descifrar`).

## Carga por lotes y repoblado (semana 3, pedido de A2)

- `POST /api/v1/internal/aaa/servicios` con el mismo Bearer. Cuerpo, una de tres formas:
  - `{ "user_ppp": ["a", "b"] }` (1 a 100): los registros de los que existen, en el orden pedido y sin repetidos; los inexistentes (o sin PPPoE) se omiten. `nextCursor: null`.
  - `{ "servicio_ids": [101, 102] }` (1 a 100): igual, por id de servicio.
  - `{ "cursor": "...", "limit": 200 }` (ambos opcionales; `limit` 1 a 200, por defecto 50): página de todos los servicios `pppoe`, retirados incluidos, por `servicio_id` ascendente.
  - Respuesta 200 `{ "data": [<registro>...], "nextCursor": "..." | null }`; cada registro es exactamente el JSON del GET (un retirado trae `estado: "retirado"`, no la lápida). 422 si llegan las dos listas, una lista con `cursor`, una lista vacía o de más de 100. No escribe en Redis: si `aaa` quiere cachear lo que recibió, usa `SET NX` como con el GET.
- `node ace aaa:repoblar [--lote=500] [--forzar]` (en el contenedor de la API): reescribe todas las claves `aaa:user:*` desde Postgres por lotes, con el mismo SET condicionado por `version` (idempotente; se puede correr con todo en marcha). Los retirados quedan como lápida. `--forzar` escribe sin comparar versiones: solo tras restaurar la base desde un respaldo. Al final imprime el resumen (servicios, lápidas, escritas, omitidas, lotes, ms) y avisa de claves huérfanas (sin servicio `pppoe` y sin lápida), que no borra.
