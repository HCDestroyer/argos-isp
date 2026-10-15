# INTEGRATION.md — Dependencias entre agentes

Cada agente anota aquí lo que necesita de otro, con fecha. El PM lo revisa dos veces al día y asigna dueño. Se borra la línea cuando se resuelve.

| Fecha | Quién pide | A quién | Qué | Estado |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Líder FE | A1 | Confirmar nombres de permisos `<recurso>.ver` del menú (`apps/web/app/utils/navegacion.ts`) contra el seed del ACL (`apps/api/database/seeders/acl_seeder.ts`) | Abierto |
| 2026-10-15 | Líder FE | A1 | Panel: llamar `POST /auth/logout` (ya existe) al cerrar sesión; hoy solo borra la cookie | Abierto |
| 2026-10-15 | Líder FE | A1, A4 | Exponer `Schema<'Servicio'>` con `estado` en el OpenAPI para reemplazar el tipo local `EstadoServicio` del panel | Abierto |
| 2026-10-15 | Líder FE | A5 | Reemplazar el tipo local `DatosCorte` de `useCorte.ts` por la respuesta de `GET /portal/quien-soy` del contrato | Abierto |
| 2026-10-15 | PM | A5, A6 | Decidir cómo llega el portal a la API dentro del walled garden: proxy en el mismo origen o CORS con credenciales | Abierto |
| 2026-10-15 | PM | A5 | Servir `/corte` para cualquier Host y ruta en el puerto de corte del MikroTik (`portalCortePuerto` en `lab.rsc`) | Abierto |
| 2026-10-15 | PM | A2 | Reactivar con Disconnect-Request, no con CoA: probado en RouterOS 7.24.5, CoA de reactivación deja IPv6 cortado. Suspender por CoA sí funciona (`Mikrotik-Address-List` + `Filter-Id="argos-corte.in"` + rate-limit). Ver `infra/mikrotik/README.md` | Abierto |
| 2026-10-15 | PM | A2, A5, A6 | Suspendido por IPv6 queda bloqueado pero no redirigido a `/corte` (TCP recibe reset). Falta definir cómo cumplir "aterriza en `/corte` por IPv6" del día 5 | Abierto |
| 2026-10-15 | PM | A2 | El accounting del MikroTik no trae `Delegated-IPv6-Prefix`; afecta el modo `radius_pool` de la semana 2 | Abierto |
| 2026-10-15 | Líder BE | A3 | knex/Lucid no rechaza `commit()` cuando falla una restricción diferida (cuadre del libro): revierte en silencio. `DomainAction` ya hace `SET CONSTRAINTS ALL IMMEDIATE`; fuera de una acción llamar `verificarRestriccionesDiferidas(trx)` | Abierto |
| 2026-10-15 | Líder BE | A1 | Relay de outbox, CRUD completo del ACL con alcances y tokens de API (tarea 2 y 10 de A1) | Abierto |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a un paquete compartido en `packages/` | Abierto |
| 2026-10-20 | A2 | A1 | Publicar `aaa:user:<user_ppp>` en Redis y `GET /internal/aaa/servicio?user_ppp=` con el contrato de abajo ("Contrato aaa ← A1"). Mientras no existan, `aaa` corre con `AAA_RESPALDO=fixtures` (`services/aaa/fixtures/servicios.json`) | Abierto |
| 2026-10-20 | A2 | A1, Líder BE | Cifrar `core.servicios.pass_ppp` y `network.routers.radius_secret` con el formato `v1` de abajo y `AAA_PPP_KEY`, no con `encryption` de AdonisJS: `aaa` y `coa` no tienen `APP_KEY` y deben descifrarlos | Abierto |
| 2026-10-20 | A2 | A1 | Al limitar, `aaa` usa `planes.subida_limitada_kbps`/`bajada_limitada_kbps`; hoy pueden ser 0 (default). Con 0 `aaa` entrega la velocidad completa y avisa en el log. Pedir > 0 en el validador del plan | Abierto |
| 2026-10-20 | A2 | A6 | Compose del perfil `lab`, servicio `aaa`: agregar `AAA_RESPALDO: ${AAA_RESPALDO:-fixtures}` (cambiar a `api` cuando A1 publique el endpoint) y documentarla en `infra/.env.example` | Abierto |

## Contrato aaa ← A1 (pedido por A2, 2026-10-20)

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

- `estado`: `activo` | `limitado` | `suspendido` | `retirado` (`core.servicios.estado` tal cual; `aaa` no decide estados).
- `plan.*`: de `network.planes`; `rate_limit_override` y `profile_ppp` de `network.planes_routers` para el router del servicio (null si no hay fila o no está definido).
- `ipv4`: `{"modo":"estatico","ip":"<ipv4>"}` con la asignación vigente de `network.ipv4_asignaciones`, `{"modo":"pool","pool":"<planes_routers.pool_ipv4>"}`, o `null`.
- `ipv6`: según `core.servicios.ipv6_modo`. `radius_servicio` → `{"modo":"radius_servicio","prefijo_enlace":"<.../64>","prefijo_delegado":"<.../56|/48>"}` (asignaciones vigentes, `null` si falta alguna); `radius_pool` → `{"modo":"radius_pool","pool_enlace":"<planes_routers.pool_ipv6_enlace>","pool_delegacion":"<planes_routers.pool_ipv6_delegacion>"}`; `duid`, `estatico`, `ninguno` → `{"modo":"<modo>"}`. `null` equivale a `ninguno`.
- `pass_ppp`: siempre cifrada, nunca en claro en Redis ni en la respuesta HTTP.
- `version`: `core.servicios.version` (diagnóstico).
- Endpoint: `Authorization: Bearer <AAA_INTERNAL_TOKEN>`; 200 con el JSON; **404 si no existe el `user_ppp`**; un servicio retirado devuelve 200 con `estado: "retirado"`; cualquier otro código lo trata `aaa` como error. Debe responder en < 300 ms.
- Escritura en Redis (A1): **SET con el JSON completo** (write-through) después del commit, en cada cambio que altere cualquier campo (servicio, plan, `planes_routers`, asignaciones, estado). No usar solo `DEL`: `aaa` repuebla con `SET NX` y un `DEL` podría competir con una lectura vieja de la API. Al borrar el servicio o cambiar su `user_ppp`, escribir en la clave vieja una lápida `{"eliminado": true, "user_ppp": "<viejo>"}`.
- Cifrado `v1` (para `pass_ppp` y `network.routers.radius_secret`): AES-256-GCM con la clave `AAA_PPP_KEY` (32 bytes en base64), IV aleatorio de 12 bytes, tag de 16; texto `v1.` + base64url(iv) + `.` + base64url(tag) + `.` + base64url(cifrado), sin relleno. Referencia: `services/aaa/src/cifrado.ts` (`cifrar`/`descifrar`).
