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
  "plan": {
    "id": 1,
    "subida_kbps": 5120,
    "bajada_kbps": 20480,
    "subida_limitada_kbps": 1024,
    "bajada_limitada_kbps": 2048,
    "rate_limit_override": null,
    "profile_ppp": null
  },
  "ipv4": { "modo": "estatico", "ip": "10.10.1.10" },
  "ipv6": { "modo": "radius_servicio", "prefijo_enlace": "2001:db8:101:1::/64", "prefijo_delegado": "2001:db8:300:100::/56" }
}
```

- **Solo servicios `pppoe`** (semana 2, `contratos/routeros.md`): un servicio `ip_estatica` o `dhcp_fija` no tiene `user_ppp` ni `pass_ppp` y es inexistente para `aaa` (no está en Redis; el endpoint no lo encuentra). Al cambiar un servicio de `pppoe` a otro tipo, la clave del `user_ppp` viejo recibe la lápida (`eliminado`, `user_ppp`, `servicio_id`, `version`), nunca credenciales.
- `estado`: `activo` | `limitado` | `suspendido` | `retirado` (`core.servicios.estado` tal cual; `aaa` no decide estados).
- `plan.*`: de `network.planes`; `rate_limit_override` y `profile_ppp` de `network.planes_routers` para el router del servicio (null si no hay fila o no está definido).
- `ipv4`: `{"modo":"estatico","ip":"<ipv4>"}` con la asignación vigente de `network.ipv4_asignaciones`, `{"modo":"pool","pool":"<planes_routers.pool_ipv4>"}`, o `null`.
- `ipv6`: según `core.servicios.ipv6_modo`. `radius_servicio` → `{"modo":"radius_servicio","prefijo_enlace":"<.../64>","prefijo_delegado":"<.../56|/48>"}` (asignaciones vigentes, `null` si falta alguna); `radius_pool` → `{"modo":"radius_pool","pool_enlace":"<planes_routers.pool_ipv6_enlace>","pool_delegacion":"<planes_routers.pool_ipv6_delegacion>"}`; `duid`, `estatico`, `ninguno` → `{"modo":"<modo>"}`. `null` equivale a `ninguno`.
- `pass_ppp`: siempre cifrada, nunca en claro en Redis ni en la respuesta HTTP.
- `version`: `core.servicios.version` (diagnóstico).
- Endpoint: `GET /api/v1/internal/aaa/servicio?user_ppp=` con `Authorization: Bearer <AAA_INTERNAL_TOKEN>` (en la API se llama `INTERNAL_TOKEN`; mismo valor). Ojo: la ruta lleva el prefijo `/api/v1`, así que `API_INTERNAL_URL` debe incluirlo; 200 con el JSON; **404 si no existe el `user_ppp`**; un servicio retirado devuelve 200 con `estado: "retirado"`; cualquier otro código lo trata `aaa` como error. Debe responder en < 300 ms.
- Escritura en Redis (A1): **SET con el JSON completo** (write-through) después del commit, en cada cambio que altere cualquier campo (servicio, plan, `planes_routers`, asignaciones, estado). No usar solo `DEL`: `aaa` repuebla con `SET NX` y un `DEL` podría competir con una lectura vieja de la API. Al borrar el servicio o cambiar su `user_ppp`, escribir en la clave vieja una lápida `{"eliminado": true, "user_ppp": "<viejo>"}`. También al **retirar** el servicio (su `user_ppp` no se reutiliza): en Redis queda la lápida y el endpoint sigue respondiendo 200 con `estado: "retirado"`; para `aaa` ambos significan rechazar.
- Implementación (A1, tarea 9): `apps/api/app/core/aaa.ts`. La escritura es un SET condicionado (script Lua): no reemplaza un registro **del mismo `servicio_id`** cuya `version` sea mayor, para que un gancho atrasado no deje datos viejos. Por eso la lápida lleva además `servicio_id` y `version` (`{"eliminado": true, "user_ppp": "...", "servicio_id": 101, "version": 7}`); `aaa` ignora esos dos campos. Escriben: cada acción después de su COMMIT (servicio, estado, asignaciones, plan, `planes_routers`) y el consumidor del grupo `aaa-cache` (eventos `servicio.*` y `asignacion.cambiada`, tarea 10). Si se restaura la base desde un respaldo, borrar `aaa:user:*` (las versiones en Redis podrían ser mayores).
- Cifrado `v1` (para `pass_ppp` y `network.routers.radius_secret`): AES-256-GCM con la clave `AAA_PPP_KEY` (32 bytes en base64), IV aleatorio de 12 bytes, tag de 16; texto `v1.` + base64url(iv) + `.` + base64url(tag) + `.` + base64url(cifrado), sin relleno. Referencia: `services/aaa/src/cifrado.ts` (`cifrar`/`descifrar`).
