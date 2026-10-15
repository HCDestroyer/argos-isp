# network (A1)

Routers, IPAM IPv4 e IPv6, planes y su implementación por router.

## Routers

- `api_password` y `radius_secret` se guardan cifrados con el formato `v1` (`app/shared/cifrado.ts`, AES-256-GCM, clave `AAA_PPP_KEY`), el mismo que descifran `services/aaa` y `services/coa`. Nunca salen por la API: la respuesta trae `tiene_api_password` / `tiene_radius_secret`. En `audit.cambios` aparecen como `***`.
- Alcance del ACL por router: listas filtradas y 403 en recursos de otro router.

## IPAM IPv4 (`ipam_v4.ts`)

- `asignarIpv4(trx, { servicioId, routerId, ip? })`: la IP pedida (debe estar en una red del router, no ser red/broadcast/gateway y estar libre: 422/409) o la primera libre, prefiriendo redes `estatico` sobre `pool`. Advisory lock por router.
- `liberarIpv4(trx, servicioId)`: cierra la asignación vigente (`fin = now()`); el historial queda en `network.ipv4_asignaciones`.
- Redes: no se traslapan (409 `red_traslapada`), el CIDR debe venir normalizado y el gateway dentro de la red.

| Acción | Permiso | Eventos |
| --- | --- | --- |
| `CrearRouter`, `EditarRouter` | `routers.crear`, `routers.editar` | — |
| `CrearRedIpv4` | `redes.crear` | — |

Lecturas en `consultas/routers.ts`.
