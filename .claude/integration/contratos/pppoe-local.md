# Contrato: PPPoE sin RADIUS (secrets locales por la API REST)

Pedido del PM (30 oct), ya decidido: **PPPoE sin RADIUS como opción por router**. En un router con `network.routers.modo_seguridad = 'api'`, ArgosIsp maneja los clientes PPPoE con `/ppp secret` locales por la API REST de RouterOS 7. Dueño: A2 (`apps/api/app/network/routeros`, `apps/api/app/network/sesiones`). Base de A1: `app/network/modo_seguridad.ts` y README de `network`, «Modo de seguridad».

Con RADIUS (`modo_seguridad = 'radius'`, el valor por defecto) nada cambia.

## 1. Qué cambia para cada pieza

| Pieza | Router `radius` | Router `api` |
| --- | --- | --- |
| Autenticación | FreeRADIUS → `aaa` (`aaa:user:*`) | `/ppp/secret` local, uno por servicio |
| Velocidad | `Mikrotik-Rate-Limit` / `Mikrotik-Group` | Perfil `plan-<id>` o `plan-<id>-limitado` del secret |
| Corte | CoA con `Mikrotik-Address-List = suspendidos` y perfil `suspendido` | Secret con `profile = suspendido` + `/ppp active remove` |
| Cambio de plan, estado, IP | CoA o Disconnect (`coa`) | Editar el secret + `/ppp active remove` (dispatcher de RouterOS) |
| Sesiones | Accounting Start / Interim / Stop | Sondeo de `/ppp/active` (`origen = 'sondeo'`), sin contadores |
| Desconexión manual | `coa` (Disconnect-Request) | Dispatcher de RouterOS (`/ppp active remove`) |

`services/aaa` no cambia: un router `api` no es cliente de FreeRADIUS (`leerRouters`). `services/coa` ignora las sesiones de sondeo (solo lee `origen = 'accounting'`).

## 2. Secret por servicio

`/ppp/secret`, identificado **solo** por `comment = argosisp:servicio:<id>` (el mismo de las colas y listas del servicio):

| Propiedad | Valor |
| --- | --- |
| `name` | `core.servicios.user_ppp` |
| `password` | `pass_ppp` descifrada (`AAA_PPP_KEY`). Va en claro dentro del router (inevitable): en `audit.red`, `audit.acciones` y logs siempre `***` (§8) |
| `service` | `pppoe` |
| `profile` | `plan-<id>` (activo), `plan-<id>-limitado` (limitado), perfil de corte `suspendido` (`AAA_SUSPENDIDO_GRUPO`, suspendido) |
| `remote-address` | IPv4 fija del servicio (asignación vigente). Sin ella, la da el pool del perfil (`planes_routers.pool_ipv4`) |
| `remote-ipv6-prefix` | /64 de enlace del servicio (modo IPv6 `radius_servicio`) |
| `comment` | `argosisp:servicio:<id>` |
| `disabled` | `no` |

**Limitación del /56 delegado.** `/ppp secret` de RouterOS 7 no tiene atributo para un prefijo DHCPv6-PD estático (solo `remote-ipv6-prefix`, el /64 de enlace). El /56 lo entrega el `dhcpv6-pd-pool` del perfil (copiado de `default`, o `planes_routers.pool_ipv6_delegacion`): **el cliente no recibe el /56 que le asignó el IPAM** sino uno del pool del router. Es la misma limitación que ya resolvió `operacion/secrets_emergencia.ts` para los secrets de emergencia. El sondeo (§6) lee el /56 real de `/ipv6/dhcp-server/binding` (`server = <pppoe-<user_ppp>>`) y lo guarda en la sesión: el portal identifica al cliente igual. Recomendación al operador: que el pool de PD del router no se traslape con los bloques del IPAM.

Sin secret: servicio retirado, pendiente de instalación, eliminado, no PPPoE, en otro router, o router con RADIUS.

Un secret **sin** el comment de ArgosIsp (puesto a mano, los de emergencia `argosisp-emergencia`) nunca se toca. Si uno ajeno tiene el mismo `name` que un servicio, el alta falla con 400 (`already have such name`) → `routeros.fallido`; el ajeno queda intacto.

Contraseña: solo se compara si el router la devuelve. El usuario de la API necesita la política **`sensitive`** para leerla; sin ella, se escribe al crear y en cada cambio del secret, pero un cambio solo de contraseña no se detecta hasta que A1 lo avise por evento (pedido en `a2.md`).

## 3. Estados

| Estado | Secret | Sesión viva |
| --- | --- | --- |
| `activo` | `profile = plan-<id>` | Se quita si cambió el perfil o las direcciones (reconecta con lo nuevo) |
| `limitado` | `profile = plan-<id>-limitado` (rate-limit reducido; en el árbol, `address-list = argosisp-plan-<id>-limitado`) | Se quita |
| `suspendido` | `profile = suspendido` (el perfil de corte: `rate-limit` mínimo, `address-list = suspendidos`, `interface-list = suspendidos`) | Se quita |
| `retirado` / eliminado | Se borra | Se quita |

**Por qué el suspendido va con el perfil de corte y no con el secret deshabilitado:** un secret deshabilitado no deja conectar, y sin sesión el cliente nunca ve `/corte`. Con el perfil `suspendido` el router pone su IP en la lista `suspendidos` al conectar (como hace RADIUS con `Mikrotik-Address-List`) y las reglas del corte (`corte_router.ts`, las mismas de `lab.rsc`) lo llevan al portal; el portal lo identifica por la IP de la sesión de sondeo. Si el perfil de corte todavía no existe (router recién dado de alta, sin reconciliar), el dispatcher lo crea antes de apuntar el secret a él.

## 4. Sin CoA: editar el secret y quitar la sesión

RouterOS solo toma el perfil y las direcciones al conectar. Tras cambiar `profile`, `remote-address`, `remote-ipv6-prefix`, `name`, `service` o `disabled`, o al borrar el secret, el dispatcher hace `/ppp active remove` (`DELETE /rest/ppp/active/<id>`) de las sesiones de ese `name`; el cliente reconecta y toma lo nuevo. Un cambio solo de contraseña no corta. Cada `remove` queda en `audit.red` (`ruta = /ppp/active`, `metodo = DELETE`) y la fila de `network.sesiones` se cierra en el acto con causa `Admin-Reset` (no cuenta para caídas repetidas).

Las reactivaciones viajan por evento (`servicio.estado_cambiado` → consumidor `routeros` → `AplicarRedServicio`), nunca esperan al cron.

`sesion.desconexion_solicitada` (desconexión manual, cambio de estrategia con `reconectar`) de una sesión de sondeo lleva `origen: 'sondeo'`: la ejecuta `routeros.desconectar_sesion` con `/ppp active remove` y cierra la fila (`Admin-Reset`); `coa` la ignora.

Sincronizar plan y `plan.velocidad_cambiada` actualizan el perfil `plan-<id>`, pero **no** cortan las sesiones: la velocidad nueva rige al reconectar (no hay CoA de velocidad). Para forzarla: `POST /sesiones/:id/desconectar`.

## 5. Velocidad (matriz y perfiles)

En un router `api`, para `pppoe`:

| Aplicación | Sin RADIUS | Objetos |
| --- | --- | --- |
| `perfil_ppp` (cualquier `padre`) | ✔ | `/ppp/profile plan-<id>` y `plan-<id>-limitado` con `rate-limit` (activo / limitado), `parent-queue` si hay padre y `queue-type` si hay tipo de cola propio |
| `arbol_pcq` (también con QoS) | ✔ | Los mismos perfiles con `address-list = argosisp-plan-<id>` / `argosisp-plan-<id>-limitado` (el router mete la IPv4 de la sesión en la lista al conectar; el mangle del árbol la marca) |
| `radius_rate_limit` | ✘ 422 `pppoe_sin_radius` | Sin RADIUS no hay `Mikrotik-Rate-Limit` |
| `pcq_plan` | ✘ 422 `pppoe_sin_radius` | La cola PCQ del plan necesita las direcciones de la sesión al conectar; sin accounting llegarían con el sondeo |

- Regla 12 de `validarEstrategias` (`modo_seguridad`), en `routers.cambiar_control_velocidad`, la vista previa y la excepción por plan.
- Datos de antes (la estrategia por defecto de un router es `radius_rate_limit`): el dispatcher aplica `estrategiaLocal()` — `radius_rate_limit` y `pcq_plan` → `perfil_ppp` con el mismo padre y extras — así un router pasado a `api` funciona sin editar su estrategia. Al cambiar la del router, la API exige una válida.
- Los perfiles copian pools, DNS e IPv6 de `default` (`PROPIEDADES_PERFIL_BASE`) y ponen los pools del plan en el router (`planes_routers.pool_ipv4` → `remote-address`, `pool_ipv6_enlace` → `remote-ipv6-prefix-pool`, `pool_ipv6_delegacion` → `dhcpv6-pd-pool`).
- Árbol: el IPv6 (/64 y /56 de la sesión) entra a las listas del plan por el dispatcher con `sesion.iniciada` del sondeo (`comment = argosisp:servicio:<id>:enlace|delegado`), hasta ~1 sondeo de demora. La IPv4 no se escribe a mano (chocaría con la entrada dinámica del perfil).
- Orden: padres y tipos de cola → perfiles → secrets → borrado de perfiles sobrantes (un perfil en uso por un secret no se borra).

## 6. Sesiones por sondeo

Sin accounting no hay Start ni Stop. El cron `sesiones_ppp` (cola `routeros-cron`, lock de cron + advisory lock por router, `ROUTEROS_SESIONES_PPP_CADA_MS`, **60 s** por defecto; 0 lo apaga) corre `sesiones.sondear_ppp` en cada router activo con credenciales y `modo_seguridad = 'api'` (y en los que pasaron a `radius` con sesiones de sondeo abiertas, hasta cerrarlas):

- Lee `/ppp/active` (solo `service = pppoe`) y `/ipv6/dhcp-server/binding` (solo lectura, no va a `audit.red`).
- Nueva → `network.sesiones` con `origen = 'sondeo'`, `acct_session_id = sondeo:<session-id>`, `nas_ip` = la del router (o null), `inicio = ahora − uptime`, IPv4, /64 de la asignación (`radius_servicio`), /56 del binding; `sesion.iniciada` (con `origen: 'sondeo'`); cierra otras abiertas del mismo usuario (`Sesion-Reemplazada`).
- Ya no está → `fin = ahora`, causa `sondeo_sin_sesion`, `sesion.terminada` y su diff en `audit.cambios`.
- Sigue → completa IPv4 y /56 si cambiaron (sin evento).
- Router caído → no abre ni cierra nada (no se sabe qué pasó).
- **Sin consumo:** `bytes_in` / `bytes_out` quedan en 0; no hay Interim. El cron de sesiones colgadas, `Accounting-On/Off` y `coa` solo miran `origen = 'accounting'`.
- Resolución de `fin`: el corte o la caída se ve en el siguiente sondeo (≤ 1 min por defecto); una sesión que dura menos que el intervalo puede no registrarse.
- Auditoría: `sesiones.sondear_ppp` solo deja fila si abrió o cerró algo, o falló (telemetría, como `sesiones.cerrar_colgadas`).

Migración: `network.sesiones.origen` (`accounting` | `sondeo`, NOT NULL, por defecto `accounting`), `nas_ip` admite NULL solo con `sondeo` (`sesiones_nas_ip_accounting_check`) y `sesiones_sondeo_unica (router_id, acct_session_id) WHERE origen = 'sondeo'`. API: `Sesion.origen` y `Sesion.nas_ip` nullable.

## 7. Reconciliador

`routeros.reconciliar` (periódico cada 15 min, `recuperar`, manual, y con `router.radius_cambiado` que traiga `modo_seguridad`): lee `/ppp/secret` una vez y

- crea el secret que falta (borrado a mano), corrige el distinto (perfil, dirección, contraseña si es legible) y quita la sesión si cambió algo que se toma al conectar;
- borra los sobrantes con `comment = argosisp:servicio:<id>` (retirado, eliminado, movido a otro router, pasado a otro tipo) y quita su sesión;
- deja los perfiles `plan-<id>[-limitado]` y el perfil de corte;
- nunca toca un secret sin ese comment. Cada escritura en `audit.red`.

## 8. Contraseña

`bitacoraRed` pasa `comando` y `respuesta` por `limpiarCredenciales` antes de escribir `audit.red`: el `password` del PUT, del PATCH, del objeto que devuelve el router y de `antes` queda `***`. Un error de descifrado va a los avisos sin el valor. Las acciones nunca reciben la contraseña en su entrada.

## 9. Cambio de modo con servicios

| Cambio | Decisión | Por qué |
| --- | --- | --- |
| `radius` → `api` con PPPoE no retirados | **Bloqueado** (422 `servicios_pppoe_en_router`, A1) | `router.radius_cambiado` saca al router de FreeRADIUS (consumidor `aaa`) y el dispatcher crea los secrets (consumidor `routeros`, otro equipo que puede no responder): no hay orden garantizado; en el hueco ningún cliente reconecta y las sesiones RADIUS vivas quedan sin accounting ni CoA. Camino: mover los servicios a un router `api` o retirarlos. Una migración asistida en dos fases (crear secrets, verificar, cambiar modo) queda pendiente |
| `api` → `radius` | **Permitido**: el reconciliador (por `router.radius_cambiado`) borra los secrets de ArgosIsp **sin cortar** las sesiones | Con `/ppp aaa use-radius=yes` RouterOS busca primero en `/ppp secret`: un secret que quede saltaría RADIUS (sin corte ni CoA). Las sesiones vivas siguen hasta caerse y reconectan por RADIUS; el sondeo cierra sus filas. Antes de cambiar, el router debe tener `/radius` configurado (script de A6, «Probar conexión») |
| Crear o mover un PPPoE a un router `api` | Permitido si el router tiene `api_usuario` y `api_password`; si no, 422 `pppoe_local_requiere_api` (`field = router_id`) | Sin credenciales no hay cómo crear el secret |

## 10. Eventos

| Evento | Cambio |
| --- | --- |
| `sesion.iniciada` / `sesion.terminada` | `origen?: 'sondeo'` (ausente = `accounting`); `nas_ip` puede ser null en una de sondeo; `motivo` nuevo `sondeo_sin_sesion` |
| `sesion.desconexion_solicitada` | `origen?: 'sondeo'`; `nas_ip` puede ser null |
| `routeros.fallido` | También por el secret (`ppp/secret add` con nombre ajeno, router caído) y `ppp/active remove` |

Consumidor `routeros`: además `servicio.eliminado`, `sesion.desconexion_solicitada` (solo `origen: 'sondeo'`) y `router.radius_cambiado` (solo con `modo_seguridad` en `campos`).
