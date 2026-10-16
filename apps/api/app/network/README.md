# network (A1)

Routers, IPAM IPv4 e IPv6, planes y su implementación por router.

## Routers

- `api_password` y `radius_secret` se guardan cifrados con el formato `v1` (`app/shared/cifrado.ts`, AES-256-GCM, clave `AAA_PPP_KEY`), el mismo que descifran `services/aaa` y `services/coa`. Nunca salen por la API: la respuesta trae `tiene_api_password` / `tiene_radius_secret`. En `audit.cambios` aparecen como `***`.
- Alcance del ACL por router: listas filtradas y 403 en recursos de otro router.

## IPAM IPv4 (`ipam_v4.ts`)

- `asignarIpv4(trx, { servicioId, routerId, ip?, redId? })`: la IP pedida (debe estar en una red del router, no ser red/broadcast/gateway y estar libre: 422/409) o la primera libre, prefiriendo redes `estatico` sobre `pool`. Con `redId`, solo de esa red: 422 en `red_ipv4_id` si no es del router o está llena (`rule: llena`), y 422 en `ipv4` si la IP pedida no es de esa red. Advisory lock por router.
- `liberarIpv4(trx, servicioId)`: cierra la asignación vigente (`fin = now()`); el historial queda en `network.ipv4_asignaciones`.
- Redes: no se traslapan (409 `red_traslapada`), el CIDR debe venir normalizado y el gateway dentro de la red.

## IPAM IPv6 (`ipam_v6.ts`, `ipv6.ts`)

- Bloques por router (`/routers/:id/ipv6-bloques`) y pools dentro del bloque (`/ipv6-bloques/:id/pools`): `enlace` entrega /64, `delegacion` /56 o /48. Prefijos normalizados y sin traslapes.
- `reservarPrefijo(trx, { servicioId, routerId, tipo, tamano })`: conserva el vigente si sigue en un pool válido del router; si no, recupera el anterior del servicio en ese pool si está libre; si no, el primer subprefijo libre (saltando cualquier vigente que se traslape). Advisory lock por pool.
- `asignarPrefijoEstatico` (modo `estatico`) y `liberarPrefijos` (retiro, cambio de modo). Historial en `network.ipv6_asignaciones`.

## Historial de asignaciones (`historial.ts`, tarea 12)

- `network.asignaciones_historial`: tramos `inicio`/`fin` de (router, plan, IPv4, `/64` de enlace en `prefijo_enlace_v6`, delegado en `prefijo_v6`). Un solo tramo abierto por servicio (`fin IS NULL`, índice único).
- `registrarTramo(trx, servicioId, motivo)`: si la foto vigente cambió, cierra el tramo abierto y abre otro; un retirado solo cierra. Lo llaman `CrearServicio` (`alta`), `EditarServicio` (`edicion: plan, router, ips, prefijo_v6`) y `RetirarServicio` (`retiro: <motivo>`). Usa `now()` de la transacción: el `fin` de un tramo es el `inicio` del siguiente.
- La migración `1792132594124_network_asignaciones_historial_v6` siembra un tramo `inicial` para los servicios no retirados.
- `GET /servicios/:id/asignaciones` (`listarTramos`): del más reciente al más viejo, con `router_nombre` y `plan_nombre`, cursor por `id`.
- `ipv4_asignaciones` e `ipv6_asignaciones` siguen siendo la fuente del IPAM y de `GET /ip/{ip}`; esta tabla es la vista por servicio para la ficha.

## Planes

- `global = true`: disponible en todos los routers; si no, solo donde tenga fila en `planes_routers`. Inactivos no se ofrecen.
- `obtenerImplementacionPlan(plan_id, router_id)` (`actions/obtener_implementacion_plan.ts`, interfaz pública, solo lectura): plantilla del plan + excepciones del router (`profile_ppp`, pools, `local_address`, `rate_limit_override`). `rate_limit` = override o `<subida>k/<bajada>k`; `rate_limit_limitado` = `<subida_limitada>k/<bajada_limitada>k`. 422 `plan_no_disponible` si el plan no aplica al router.
- Velocidades limitadas obligatorias y > 0 (las usa `aaa` al limitar).

| Acción                                            | Permiso                           | Eventos |
| ------------------------------------------------- | --------------------------------- | ------- |
| `CrearRouter`, `EditarRouter`                     | `routers.crear`, `routers.editar` | —       |
| `CrearRedIpv4`                                    | `redes.crear`                     | —       |
| `CrearPlan`, `EditarPlan`                         | `planes.crear`, `planes.editar`   | —       |
| `ImplementarPlan` (crea o edita `planes_routers`) | `planes.editar`                   | —       |
| `CrearBloqueIpv6`, `CrearPoolIpv6`                | `ipv6.crear`                      | —       |

Lecturas en `consultas/routers.ts` y `consultas/planes.ts`.

Eventos: los módulos de red no emiten por su cuenta; los cambios de asignación de un servicio salen de las acciones de `core` (`servicio.config_cambiada`, `asignacion.cambiada`). `EditarPlan` e `ImplementarPlan` reescriben `aaa:user:*` de los servicios afectados. No consume eventos.

## Resolver una IP (`consultas/ip.ts`, tarea 13)

- `GET /ip/{ip}` (permiso `ip.resolver`) y `resolverIp(ip, cliente?)` para uso interno: busca en `network.sesiones` activas (IPv4 igual, IPv6 dentro de `prefijo_enlace_v6`/`prefijo_delegado_v6`) y en asignaciones vigentes (`ipv4_asignaciones`, `ipv6_asignaciones`). Gana el prefijo más largo (una IPv4 cuenta como /32); a igual longitud, la sesión activa y luego la más reciente. Responde `{ servicio_id, cliente_id, prefijo }`, 404 si nadie la tiene, 422 si no es IP.
- Índices GiST parciales sobre los prefijos IPv6 de sesiones activas (`1761100000001_network_indices_ip`).
