# network/routeros · dispatcher de servicios sin PPPoE (A2)

Controla en el MikroTik, por su API REST, los servicios WISP `ip_estatica` y `dhcp_fija` (`.claude/integration/contratos/routeros.md`): cola simple con la velocidad del plan, address-list `suspendidos`, lease DHCP y ARP estático. Para el cliente el resultado es el mismo que con PPPoE: limitar, cortar (aterriza en `/corte`) y reactivar por evento. Dueño: A2.

Vive en `apps/api` y no en `services/coa` porque usa la función de velocidad única (`#network/velocidad`, de A1), las acciones de dominio y el outbox. `services/coa` sigue siendo solo RADIUS (CoA/Disconnect).

## Piezas

| Archivo                           | Qué hace                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cliente.ts`                      | `ClienteRouterOS`: cliente REST de RouterOS 7, reutilizable (A6). `listar`, `buscar(ruta, comment)`, `asegurar(ruta, comment, props, ctx)`, `borrar(ruta, comment, ctx)`, `crear`, `actualizar`, `borrarPorId`, `probar` |
| `errores.ts`                      | `RouterOSInalcanzable` (red, timeout, TLS, 5xx), `RouterOSCredenciales` (401/403), `RouterOSSolicitud` (400/404 con el `detail` del router), `RouterOSRespuesta`. Todos con `tipo` y `reintentable`                      |
| `normalizar.ts`                   | Compara lo deseado con lo que guarda el router (`5120k` = `5120000`, `yes` = `true`, MAC sin mayúsculas, `16s` = `16`)                                                                                                   |
| `router.ts`                       | `clienteDeRouter(fila, { clave, bitacora })`: descifra `api_password` (`v1`), arma la URL y la política TLS                                                                                                              |
| `falso.ts`                        | RouterOS falso en memoria (HTTP/HTTPS) para pruebas: mismas rutas, normalizaciones y errores; `caer()`, `levantar()`, `fallar()`, `borrarAMano()`                                                                        |
| `estado_deseado.ts`               | Función pura: con los datos vigentes del servicio, qué objetos deben existir y cuáles no                                                                                                                                 |
| `consultas.ts`                    | Lecturas de Postgres (servicio con velocidad efectiva, servicios del router, router con su API)                                                                                                                          |
| `dispatcher.ts`                   | `audit.red` (`bitacoraRed`), fábrica de clientes, perfil de suspendido, routers pendientes, `aplicarEstado`                                                                                                              |
| `actions/aplicar_red_servicio.ts` | `AplicarRedServicio` (`routeros.aplicar_servicio`): un servicio en su router, y limpieza de routers anteriores                                                                                                           |
| `actions/reconciliar_router.ts`   | `ReconciliarRouterOS` (`routeros.reconciliar`): un router completo contra todos sus servicios sin PPPoE                                                                                                                  |
| `consumidor.ts`                   | Grupo `routeros` del bus                                                                                                                                                                                                 |
| `jobs.ts`                         | Crons `recuperar` y `reconciliar` (cola `routeros-cron`)                                                                                                                                                                 |
| `velocidad_router.ts`             | Función pura: objetos de velocidad del router (padres por plan, perfiles PPP `plan-<id>`) según `control_velocidad`, reuso y lo leído del router                                                                         |
| `prefijos.ts`                     | Cola `routeros-prefijos`: tras `sesion.iniciada` sin /56 (IPv6 `radius_pool`), `CompletarPrefijoDelegado` lee el binding DHCPv6-PD del router (`app/network/sesiones`)                                                   |

Comando: `node ace routeros:worker` (consumidor + crons; `--una-vez reconciliar|recuperar`, `--sin-eventos`).

## Objetos por servicio (`comment = argosisp:servicio:<id>`)

| Objeto                      | Propiedades                                                                                                                                                   | Cuándo                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/queue/simple`             | `name = argosisp-servicio-<id>`, `target = <ipv4>/32[,/64,/56]`, `max-limit`, `limit-at`, `burst-*`, `priority` de `rateLimitServicio(plan efectivo, estado)` | Siempre. Suspendido: `ROUTEROS_SUSPENDIDO_RATE_LIMIT` (`256k/256k`, igual que PPPoE) |
| `/ip/firewall/address-list` | `list = suspendidos`, `address = <ipv4>`                                                                                                                      | Solo suspendido                                                                      |
| `/ip/dhcp-server/lease`     | `address`, `mac-address`, `server` (del router o `ROUTEROS_DHCP_SERVIDOR`, por defecto `all`)                                                                 | Solo `dhcp_fija`                                                                     |
| `/ip/arp`                   | `address`, `mac-address`, `interface` (del router o `ROUTEROS_INTERFAZ_CLIENTES`)                                                                             | Solo con `amarre_ip_mac` y `mac`; sin interfaz se avisa y no se crea                 |

Un servicio `pppoe`, `retirado` o sin IPv4 no tiene nada. Nunca se identifica un objeto por nombre o IP; lo que no lleva `comment = argosisp:servicio:<id>` no se toca (en particular las reglas fijas de `lab.rsc`, `argosisp: …` y `argosisp:top …`). El `target` lleva la IPv4 y el prefijo delegado propio del servicio, nunca el /64 del segmento WISP (compartido con RA).

## Control de velocidad (`contratos/velocidad.md`)

### Modo `simple` con reuso

Para cada plan con `reuso > 1` efectivo en el router (plantilla o `planes_routers`) y servicios no retirados en él:

| Objeto          | Clave                          | Propiedades                                                                                                                                                                                                                                           |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/queue/simple` | `comment = argosisp:plan:<id>` | `name = argosisp-plan-<id>`, `max-limit` / `limit-at` de `limitesPadrePlan(plan, activos)` (`#network/velocidad`), `priority` del plan, sin ráfaga, `target` = los de sus hijas                                                                       |
| `/ppp/profile`  | `comment = argosisp:plan:<id>` | `name = plan-<id>`, `parent-queue = argosisp-plan-<id>` y lo que tenga el perfil `default` en `local-address`, `remote-address`, `remote-ipv6-prefix-pool`, `dhcpv6-pd-pool`, `use-ipv6`, `dns-server`, `change-tcp-mss`… (`PROPIEDADES_PERFIL_BASE`) |

- `activos` = servicios del plan en el router (PPPoE y WISP) que no están suspendidos ni retirados. Con 0 activos se calcula como 1.
- Hijas: las colas WISP activas o limitadas del plan llevan `parent = argosisp-plan-<id>` (suspendidas, `none`); las de PPPoE cuelgan por el perfil (`aaa` manda `Mikrotik-Group = plan-<id>`; el suspendido, `suspendido`).
- `target` del padre = los `target` de las colas WISP hijas más los de las colas dinámicas de PPPoE que el router ya puso bajo el padre (se leen del router; por eso se recalcula también con `sesion.iniciada` / `sesion.terminada`). Un `target` amplio (la red de clientes) haría que el padre capture el tráfico de clientes de otros planes. Sin hijas: `192.0.2.255/32` (RFC 5737, ningún cliente la tiene). **Verificar en el laboratorio** que la cola dinámica de PPPoE cuelga del padre y que RouterOS acepta el `target` con la lista de hijas.
- El padre existe mientras el plan tenga servicios no retirados en el router o colas dinámicas colgando de él. Orden: padres y perfiles primero, después las colas del servicio, al final se borran los sobrantes (perfiles antes que su cola). El `RouterOSFalso` rechaza un `parent`/`parent-queue` inexistente y el borrado de un padre con hijas, así que una prueba detecta un orden que dejaría hijas colgando.
- Recálculo **por evento**, nunca por intervalo: `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada` (plan, router, tipo), retiro, `sesion.iniciada` / `sesion.terminada` y `plan.velocidad_cambiada` (reconcilia los routers del plan). Un router que no necesita control de velocidad (sin planes con reuso en `simple`) no se toca con eventos de PPPoE, salvo un cambio de plan, router o tipo o un retiro, que pueden dejar un padre sobrante.
- Un cambio de plan de una sesión PPPoE con reuso: `coa` manda Disconnect (el perfil solo se asigna al conectar). Si solo el plan viejo tenía reuso, la sesión sigue bajo el padre viejo hasta reconectar (el padre no se borra mientras tenga hijas).
- El reconciliador repone padres y perfiles borrados a mano, corrige los editados y borra los de planes sin reuso o sin servicios.

### Modo `arbol_pcq`

| Objeto                                                                                      | Clave                                                                                            | Propiedades                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/queue/type` `argosisp-plan-<id>[-limitado]-<sentido>`                                     | `name` (el menú no tiene `comment`)                                                              | `kind = pcq`, `pcq-rate` = MIR del plan (o el limitado), `pcq-classifier = dst-address` (bajada) / `src-address` (subida), `pcq-dst-address6-mask` / `pcq-src-address6-mask = 64`          |
| `/queue/tree` `argosisp-global-bajada` / `-subida`                                          | `comment = argosisp:global:<sentido>`                                                            | `parent = global`, `max-limit` = `capacidad_*_kbps` del router (null → `0`, sin techo)                                                                                                     |
| `/queue/tree` `argosisp-plan-<id>[-limitado]-<sentido>`                                     | `comment = argosisp:plan:<id>[:limitado]:<sentido>`                                              | `parent` = el global, `packet-mark` y `queue` = el tipo PCQ, `max-limit` / `limit-at` de `limitesPadrePlan` (activos del plan, o limitados con la velocidad limitada), `priority` del plan |
| `/ip/firewall/mangle` y `/ipv6/firewall/mangle`                                             | el mismo `comment` que el nodo                                                                   | `chain = forward`, `action = mark-packet`, `dst-address-list` (bajada) o `src-address-list` (subida) = `argosisp-plan-<id>[-limitado]`, `new-packet-mark` = el nodo, `passthrough = no`    |
| `/ip/firewall/address-list` y `/ipv6/firewall/address-list` `argosisp-plan-<id>[-limitado]` | `comment = argosisp:servicio:<id>` (IPv4) y `argosisp:servicio:<id>:enlace` / `:delegado` (IPv6) | IPv4, /64 y /56 de cada servicio activo o limitado                                                                                                                                         |

- Sin colas simples por servicio: `aaa` no manda `Mikrotik-Rate-Limit` a un activo o limitado de un router en `arbol_pcq`, y `coa` no manda CoA de velocidad (el cambio de estado o de plan es mover la entrada de lista). El suspendido conserva el rate-limit mínimo: en PPPoE la cola dinámica que crea `aaa`/`coa`, en WISP una cola simple igual (`argosisp-servicio-<id>`, 256k) más la lista `suspendidos`.
- Listas: en WISP, la IPv4 y el prefijo delegado del servicio (nunca el /64 compartido del segmento); en PPPoE, las direcciones de la sesión abierta (`network.sesiones`: IPv4, /64 y /56), por `sesion.iniciada`, `sesion.terminada` y `asignacion.cambiada`.
- Orden: tipos → globales → nodos → mangle → listas por servicio; los sobrantes se borran al revés (mangle, nodos de plan, globales, tipos). El falso rechaza un nodo con `parent` o `queue` inexistente y el borrado de un tipo en uso o de un nodo con hijos.
- Los tipos se reconocen por nombre (`argosisp-plan-<id>-…`, `id > 0`): el ejemplo de `lab.rsc` (plan `0`) no se toca.

## Eventos

| Consume (grupo `routeros`)                                                                       | Hace                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada` | `AplicarRedServicio` del servicio: estado deseado completo con los datos **vigentes** de Postgres (no del payload), así que un evento repetido o fuera de orden no escribe de más |
| `plan.velocidad_cambiada`                                                                        | `ReconciliarRouterOS` de los routers del plan (o el de la excepción)                                                                                                              |
| `sesion.iniciada` sin prefijo delegado                                                           | Job en `routeros-prefijos` (solo lectura en el router; `/ipv6/dhcp-server/binding` y `/ppp/active` son menús de solo lectura del cliente)                                         |

| Emite (outbox)                                                  | Cuándo                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeros.fallido { servicio_id, router_id, operacion, error }` | El router no respondió tras 1 + 3 intentos (backoff 0,5 · 1 · 2 s), rechazó las credenciales, respondió 400 o no tiene credenciales. El router queda pendiente y la acción **no lanza** (reintentar el evento no arregla el router) |

## Garantías

- **Idempotencia:** `asegurar` busca por comment, crea si falta, hace `PATCH` solo de lo que difiere (comparación normalizada) y borra duplicados. Un reintento repite la búsqueda: un `PUT` que llegó pero perdió la respuesta no duplica.
- **Auditoría:** cada escritura (y cada intento) en `audit.red` (`tipo = 'routeros'`, comando con método, ruta, propiedades, valores anteriores, `evento_id`, `request_id`; respuesta del equipo). Un fallo deja además una fila final con `ok = false`. `audit.acciones` solo cuando hubo cambios o errores (un evento de un servicio PPPoE no toca el router ni deja fila).
- **Concurrencia:** `pg_advisory_xact_lock(4102, router_id)` por router en las dos acciones; los crons, además, `pg_try_advisory_xact_lock` por job.
- **Reconciliador:** lee cada menú una vez, repone lo que falta (una cola borrada a mano), corrige lo que difiere y borra huérfanos (servicios retirados, movidos o pasados a PPPoE). `recuperar` (30 s) sondea los routers pendientes con `/system/resource` y los reconcilia al volver; `reconciliar` (15 min) recorre todos los routers con servicios sin PPPoE. No es una caché: el estado deseado sale de Postgres cada vez.
- **Credenciales y TLS:** `api_usuario` y `api_password` (`v1`, `AAA_PPP_KEY`); HTTPS con verificación de certificado (`ROUTEROS_TLS_VERIFICAR`, por defecto `true`; por router `api_tls_verificar` y `api_ca` cuando A1 los agregue). La contraseña nunca llega a `audit.red`.

## Pendiente (tanda 2)

- `router.control_cambiado` (cambio de modo por lotes con vista previa).
- IPv6 en la address-list de corte (`/ipv6/firewall/address-list`): fuera de los menús administrados de la tarea 1.

## Pruebas

- `tests/network/routeros_cliente.spec.ts`: cliente contra el RouterOS falso (idempotencia, normalización, 401, 400, 5xx, timeout, router caído, PUT con respuesta perdida, HTTPS con y sin CA).
- `tests/network/routeros_dispatcher.spec.ts`: servicios creados por la API y eventos del outbox: activo → limitado → suspendido → activo, evento duplicado y fuera de orden, `dhcp_fija` con amarre → `ip_estatica` → retirado, PPPoE sin tocar el router, reconciliador (cola borrada a mano, editada, huérfana) y router caído → `routeros.fallido` → `recuperar`.
