# network (A1)

Routers, IPAM IPv4 e IPv6, planes y su implementación por router.

## Routers

- `api_password` y `radius_secret` se guardan cifrados con el formato `v1` (`app/shared/cifrado.ts`, AES-256-GCM, clave `AAA_PPP_KEY`), el mismo que descifran `services/aaa` y `services/coa`. Nunca salen por la API: la respuesta trae `tiene_api_password` / `tiene_radius_secret`. En `audit.cambios` aparecen como `***`.
- Alcance del ACL por router: listas filtradas y 403 en recursos de otro router.
- Conexión de la API REST de RouterOS (`api_url`, `api_tls_verificar`, `api_ca`, `dhcp_servidor`, `interfaz_clientes`): columnas y precedencias en `.claude/integration/contratos/routeros.md`, "Conexión del router". La CA nunca sale por la API (fila 57 de `a4.md`): la vista solo trae `tiene_api_ca`; el dispatcher la lee de su propia consulta. En `audit.cambios` va como `***`, también cuando se reemplaza por otra.
- En línea y último contacto (`contacto_router.ts`, pedido de A4): `Router.ultimo_contacto` = lo más reciente entre `network.routers_contacto` (fuentes periódicas: accounting del NAS y sondeo de RouterOS, escritas con `registrarContactoRouter(trx, { routerId } | { nasIp }, fuente, en?)` dentro de la acción que las recibe; nunca retrocede y reescribe a lo sumo cada 30 s; sin auditoría, es telemetría) y la última respuesta buena del router en `audit.red` (CoA/Disconnect con ACK, comando de RouterOS con `ok`). `Router.en_linea`: null si ninguna fuente periódica lo mide (sin fila: no se sabe); si no, `ultimo_contacto` dentro de `SESIONES_COLGADAS_INTERVALOS` × `AAA_INTERIM_SEGUNDOS` (15 min). Quién escribe las fuentes periódicas (A2): `.claude/integration/a1.md`.

## IPAM IPv4 (`ipam_v4.ts`)

- `asignarIpv4(trx, { servicioId, routerId, ip?, redId? })`: la IP pedida (debe estar en una red del router, no ser red/broadcast/gateway y estar libre: 422/409) o la primera libre, prefiriendo redes `estatico` sobre `pool`. Con `redId`, solo de esa red: 422 en `red_ipv4_id` si no es del router o está llena (`rule: llena`), y 422 en `ipv4` si la IP pedida no es de esa red. Advisory lock por router.
- `liberarIpv4(trx, servicioId)`: cierra la asignación vigente (`fin = now()`); el historial queda en `network.ipv4_asignaciones`.
- Redes: no se traslapan (409 `red_traslapada`), el CIDR debe venir normalizado y el gateway dentro de la red.

## IPAM IPv6 (`ipam_v6.ts`, `ipv6.ts`)

- Bloques por router (`/routers/:id/ipv6-bloques`) y pools dentro del bloque (`/ipv6-bloques/:id/pools`): `enlace` entrega /64, `delegacion` /56 o /48. Prefijos normalizados y sin traslapes.
- `reservarPrefijo(trx, { servicioId, routerId, tipo, tamano })`: conserva el vigente si sigue en un pool válido del router; si no, recupera el anterior del servicio en ese pool si está libre; si no, el primer subprefijo libre (saltando cualquier vigente que se traslape). Advisory lock por pool.
- `asignarPrefijoEstatico` (modo `estatico`) y `liberarPrefijos` (retiro, cambio de modo). Historial en `network.ipv6_asignaciones`.

## Pools editables, ocupación y migración (`contratos/pools.md`)

- Redes IPv4 con `nombre`, `rango_inicio`/`rango_fin` (solo se entregan IPs del rango, también a mano; fuera quedan reservadas) y DNS. Bloques IPv6 con `nombre` y `proveedor`; un router admite varios bloques y pools de cada tipo.
- Editar (`PUT /redes-ipv4/:id`, `/ipv6-bloques/:id`, `/ipv6-pools/:id`, con `version`): achicar dejando direcciones asignadas fuera responde 422 con la lista (`reglas_pools.ts`).
- Ocupación (`ocupacion.ts`) en SQL: `total`, `asignadas`, `libres`, `reservadas`, `porcentaje` en cada red y pool; `GET /routers/:id/direccionamiento` lo resume con lo que recibe cada plan (`consultas/direccionamiento.ts`).
- Migrar (`migrar_pools.ts`): 422 `pool_con_servicios` si hay servicios y no se pidió `mover_servicios`; con él, `EditarServicio` anidada por servicio (conserva las direcciones de lo que se muda); `simular` revierte todo (`simularEnTransaccion`).
- Vistas previas IPv6: `POST /ipv6-pools/vista-previa`, `POST /ipv6-bloques/vista-previa`.
- Mensajes de los campos obligatorios con su motivo (`conMensajes` de `#shared/mensajes_validacion`).

## Historial de asignaciones (`historial.ts`, tarea 12)

- `network.asignaciones_historial`: tramos `inicio`/`fin` de (router, plan, IPv4, `/64` de enlace en `prefijo_enlace_v6`, delegado en `prefijo_v6`). Un solo tramo abierto por servicio (`fin IS NULL`, índice único).
- `registrarTramo(trx, servicioId, motivo)`: si la foto vigente cambió, cierra el tramo abierto y abre otro; un retirado solo cierra. Lo llaman `CrearServicio` (`alta`), `EditarServicio` (`edicion: plan, router, ips, prefijo_v6`) y `RetirarServicio` (`retiro: <motivo>`). Usa `now()` de la transacción: el `fin` de un tramo es el `inicio` del siguiente.
- La migración `1792132594124_network_asignaciones_historial_v6` siembra un tramo `inicial` para los servicios no retirados.
- `GET /servicios/:id/asignaciones` (`listarTramos`): del más reciente al más viejo, con `router_nombre` y `plan_nombre`, cursor por `id`.
- `ipv4_asignaciones` e `ipv6_asignaciones` siguen siendo la fuente del IPAM y de `GET /ip/{ip}`; esta tabla es la vista por servicio para la ficha.

## Planes

- `global = true`: disponible en todos los routers; si no, solo donde tenga fila en `planes_routers`. Inactivos no se ofrecen.
- `obtenerImplementacionPlan(plan_id, router_id)` (`actions/obtener_implementacion_plan.ts`, interfaz pública, solo lectura): plantilla del plan + excepciones del router (`profile_ppp`, pools, `local_address`, `rate_limit_override`). `rate_limit` y `rate_limit_limitado` = `Mikrotik-Rate-Limit` completo de `rateLimitServicio` (ver "Velocidad"). Los campos de velocidad del resultado ya traen las excepciones del router aplicadas. 422 `plan_no_disponible` si el plan no aplica al router.
- Velocidades limitadas obligatorias y > 0 (las usa `aaa` al limitar).

| Acción                                            | Permiso                           | Eventos         |
| ------------------------------------------------- | --------------------------------- | --------------- |
| `CrearRouter`, `EditarRouter`                     | `routers.crear`, `routers.editar` | ver "Velocidad" |
| `CrearRedIpv4`                                    | `redes.crear`                     | —               |
| `CrearPlan`, `EditarPlan`                         | `planes.crear`, `planes.editar`   | ver "Velocidad" |
| `ImplementarPlan` (crea o edita `planes_routers`) | `planes.editar`                   | —               |
| `CrearBloqueIpv6`, `CrearPoolIpv6`                | `ipv6.crear`                      | —               |
| `EditarRedIpv4`                                   | `redes.editar`                    | —               |
| `EditarBloqueIpv6`, `EditarPoolIpv6`              | `ipv6.editar`                     | —               |
| `MigrarRedIpv4`                                   | `redes.migrar`                    | los de `EditarServicio` por cada servicio movido |
| `MigrarBloqueIpv6`                                | `ipv6.migrar`                     | los de `EditarServicio` por cada servicio movido |

Lecturas en `consultas/routers.ts` y `consultas/planes.ts`.

Eventos: salvo los de velocidad (sección "Velocidad"), los cambios de asignación de un servicio salen de las acciones de `core` (`servicio.config_cambiada`, `asignacion.cambiada`). `EditarPlan` e `ImplementarPlan` reescriben `aaa:user:*` de los servicios afectados. No consume eventos.

### Tipo de plan (`tipos_plan.ts`, decisión del PM 19 oct)

- `network.planes.tipo` ∈ `residencial` (por defecto; los planes que ya existían quedaron así), `empresarial`, `dedicado`. Se crea y edita con el plan (`version`, diff en `audit.cambios`). No cambia la velocidad: no emite `plan.velocidad_cambiada` ni otro evento.
- Visible en `Plan.tipo`, `PlanEfectivo.tipo` y, de solo lectura, en `Servicio.plan_tipo`. Filtro `?tipo=` en `GET /planes` y `GET /servicios` (tipo del plan del servicio).
- **Reglas, solo advertencias** (`warnings[]` = `{ codigo, mensaje }` en las respuestas de crear y editar; nunca 422):
    - `plan_dedicado_asimetrico`: plan `dedicado` con `bajada_kbps` ≠ `subida_kbps`.
    - `plan_dedicado_compartido`: plan `dedicado` con `reuso` (compartición 1:N) ≠ 1.
    - `servicio_cliente_cf`: servicio (`POST /servicios`, `PUT /servicios/:id`) de un plan `empresarial` o `dedicado` cuyo cliente factura como CF (`tipo_documento_fiscal = 'cf'`).

### Adicionales incluidos en el plan

`GET/PUT /planes/:id/adicionales` (`DefinirAdicionalesPlan`, permiso `planes.editar`): lista de adicionales con su cantidad; el PUT reemplaza la lista y sube la `version` del plan. Reglas en `.claude/integration/contratos/adicionales.md` y `app/core/README.md`.

## Velocidad (`velocidad.ts`, semana 2)

Contrato: `.claude/integration/contratos/velocidad.md`. Única fuente del rate-limit para PPPoE y WISP.

- Plan: `reuso` (1..64), `garantizado_pct` (null = `100 / reuso`), `rafaga_bajada_kbps` / `rafaga_subida_kbps` (null = sin ráfaga), `rafaga_umbral_pct` (75), `rafaga_segundos` (16), `prioridad` (8). `planes_routers` los puede sobrescribir (null hereda).
- Router: `control_velocidad` (`simple` | `arbol_pcq`, reemplaza `modo_velocidad`, que sigue en la vista derivado y obsoleto), `capacidad_bajada_kbps`, `capacidad_subida_kbps`.
- `rateLimitServicio(planEfectivo, estado)` → `rx/tx ráfaga umbral tiempo prioridad limit-at`; `limitesPadrePlan(plan, activos)` → `max_limit` y `limit_at` del padre; `validarVelocidad` → 422 por campo (CIR ≤ MIR / reuso, umbral < MIR < ráfaga, rangos).
- Cambio de comportamiento: un plan sin campos nuevos conserva su velocidad, pero `rate_limit` pasa de `5000k/20000k` a la cadena completa `5M/20M 0/0 0/0 0/0 8 5M/20M` (el `limit-at` sale del reuso; con reuso 1 es el MIR).

| Acción                                                                           | Permiso                                          | Eventos                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `EditarPlan` (campos de velocidad)                                               | `planes.editar`                                  | `plan.velocidad_cambiada` (`router_id: null`)       |
| `ImplementarPlan` (excepción de velocidad, `rate_limit_override`, `profile_ppp`) | `planes.editar`                                  | `plan.velocidad_cambiada` (`router_id`)             |
| `CambiarControlVelocidad` (`POST /routers/:id/cambiar-control-velocidad`)        | `routers.cambiar_control_velocidad` (solo admin) | `router.control_cambiado`                           |
| `EditarRouter` (capacidad)                                                       | `routers.editar`                                 | `router.control_cambiado` (`campos: ['capacidad']`) |

## Resolver una IP (`consultas/ip.ts`, tarea 13)

- `GET /ip/{ip}` (permiso `ip.resolver`) y `resolverIp(ip, cliente?)` para uso interno: busca en `network.sesiones` activas (IPv4 igual, IPv6 dentro de `prefijo_enlace_v6`/`prefijo_delegado_v6`) y en asignaciones vigentes (`ipv4_asignaciones`, `ipv6_asignaciones`). Gana el prefijo más largo (una IPv4 cuenta como /32); a igual longitud, la sesión activa y luego la más reciente. Responde `{ servicio_id, cliente_id, prefijo }`, 404 si nadie la tiene, 422 si no es IP.
- Índices GiST parciales sobre los prefijos IPv6 de sesiones activas (`1761100000001_network_indices_ip`).

## Vista previa del rate-limit (semana 3)

- `POST /api/v1/planes/vista-previa` (`planes.ver`): recibe los campos de velocidad del formulario de planes (`bajada_kbps`, `subida_kbps`, `*_limitada_kbps`, `reuso`, `garantizado_pct`, `rafaga_*`, `prioridad`, opcionales `rate_limit_override` y `activos`, por defecto 1) y devuelve `vistaPreviaVelocidad` de `velocidad.ts`: `rate_limit`, `rate_limit_limitado`, `garantizado_pct_efectivo`, `limit_at_servicio_kbps` y `padre` (`limitesPadrePlan` con `activos`). 422 por campo con `validarVelocidad`, igual que crear el plan. No guarda ni audita (es una lectura).
