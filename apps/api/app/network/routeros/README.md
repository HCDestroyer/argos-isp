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
| `prefijos.ts`                     | Cola `routeros-prefijos`: tras `sesion.iniciada` sin /56 (IPv6 `radius_pool`), `CompletarPrefijoDelegado` lee el binding DHCPv6-PD del router (`app/network/sesiones`)                                                   |

Comando: `node ace routeros:worker` (consumidor + crons; `--una-vez reconciliar|recuperar`, `--sin-eventos`).

## Objetos por servicio (`comment = argosisp:servicio:<id>`)

| Objeto                      | Propiedades                                                                                                                                                   | Cuándo                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/queue/simple`             | `name = argosisp-servicio-<id>`, `target = <ipv4>/32[,/64,/56]`, `max-limit`, `limit-at`, `burst-*`, `priority` de `rateLimitServicio(plan efectivo, estado)` | Siempre. Suspendido: `ROUTEROS_SUSPENDIDO_RATE_LIMIT` (`256k/256k`, igual que PPPoE) |
| `/ip/firewall/address-list` | `list = suspendidos`, `address = <ipv4>`                                                                                                                      | Solo suspendido                                                                      |
| `/ip/dhcp-server/lease`     | `address`, `mac-address`, `server` (del router o `ROUTEROS_DHCP_SERVIDOR`, por defecto `all`)                                                                 | Solo `dhcp_fija`                                                                     |
| `/ip/arp`                   | `address`, `mac-address`, `interface` (del router o `ROUTEROS_INTERFAZ_CLIENTES`)                                                                             | Solo con `amarre_ip_mac` y `mac`; sin interfaz se avisa y no se crea                 |

Un servicio `pppoe`, `retirado` o sin IPv4 no tiene nada. Nunca se identifica un objeto por nombre o IP; lo que no lleva `comment = argosisp:servicio:*` no se toca.

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

- Modo de velocidad: colas padre por plan (`argosisp:plan:<id>`, reuso), `arbol_pcq` (queue tree, PCQ y mangle), perfiles PPP con `parent-queue` y `router.control_cambiado`.
- IPv6 en la address-list de corte (`/ipv6/firewall/address-list`): fuera de los menús administrados de la tarea 1.

## Pruebas

- `tests/network/routeros_cliente.spec.ts`: cliente contra el RouterOS falso (idempotencia, normalización, 401, 400, 5xx, timeout, router caído, PUT con respuesta perdida, HTTPS con y sin CA).
- `tests/network/routeros_dispatcher.spec.ts`: servicios creados por la API y eventos del outbox: activo → limitado → suspendido → activo, evento duplicado y fuera de orden, `dhcp_fija` con amarre → `ip_estatica` → retirado, PPPoE sin tocar el router, reconciliador (cola borrada a mano, editada, huérfana) y router caído → `routeros.fallido` → `recuperar`.
