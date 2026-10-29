# Contrato · Pools de direcciones (IPv4 e IPv6)

Dueño: A1 (`apps/api/app/network`). Lo consume el panel (A4). Versión 1 (2026-10-28).

Un router tiene **redes IPv4** (`network.redes_ipv4`) y **bloques IPv6** (`network.ipv6_bloques`); de cada bloque se recortan **pools IPv6** (`network.ipv6_pools`) de enlace o de delegación. No hay límite de uno: un router admite varios bloques (por ejemplo dos /32 o /40 de proveedores distintos, cada uno con su `proveedor`) y varios pools de cada tipo y tamaño. Lo único prohibido es que dos redes, dos bloques o dos pools se traslapen (409). La red es infraestructura compartida entre empresas: ni redes ni bloques llevan `empresa_id`.

## §1 Editar

Todas las ediciones llevan `version` (409 `conflicto_version` si otra sesión cambió el registro) y dejan auditoría y diff en `audit.cambios` (`red_ipv4`, `ipv6_bloque`, `ipv6_pool`). Ninguna cambia direcciones de servicios, así que no emiten eventos de servicio: lo que dejaría una dirección asignada inválida se rechaza.

| Endpoint | Permiso | Campos | Rechazos |
| --- | --- | --- | --- |
| `PUT /redes-ipv4/:id` | `redes.editar` | `nombre`, `cidr`, `tipo`, `gateway`, `rango_inicio` + `rango_fin`, `dns_primario`, `dns_secundario` | 422 `ips_asignadas_fuera` (lista), 409 `red_traslapada`, 422 por campo |
| `PUT /ipv6-bloques/:id` | `ipv6.editar` | `nombre`, `proveedor`, `prefijo` | 422 `pools_fuera_del_bloque` (lista), 409 `bloque_traslapado` |
| `PUT /ipv6-pools/:id` | `ipv6.editar` | `nombre`, `nombre_en_router`, `prefijo`, `tipo`, `tamano_entrega` | 422 `prefijos_asignados_fuera` (lista), 422 `pool_con_asignaciones` (lista), 409 `pool_traslapado`, 422 si sale de su bloque |

- **Rango IPv4.** `rango_inicio` y `rango_fin` van juntos (o los dos `null` = toda la red) y dentro de la red. El sistema solo entrega IPs del rango, tanto la asignación automática como una IP pedida a mano (422 en `ipv4` si cae fuera). Lo que queda fuera del rango está **reservado** (infraestructura, equipos propios).
- **Achicar.** Agrandar siempre se puede si no se traslapa. Achicar la red, el rango o el pool, o mover el gateway, se rechaza si alguna dirección asignada quedaría fuera (o sería la dirección de red, el broadcast o el gateway). `errors[]` trae una entrada por dirección (hasta 100; `detail` dice el total), con `field` = el campo que la deja fuera (`cidr`, `rango_inicio`, `gateway`, `prefijo`) y `message` = `"<ip o prefijo> (servicio <id>, <user_ppp>) quedaría fuera …"`.
- **Tipo y tamaño de un pool IPv6** solo cambian si el pool no tiene prefijos asignados.

## §2 Ocupación

`RedIpv4.ocupacion` e `Ipv6Pool.ocupacion` (esquema `OcupacionPool`) salen en la lista y en el detalle, calculadas en SQL (`app/network/ocupacion.ts`), nunca cargando las direcciones:

| Campo | IPv4 (por red) | IPv6 (por pool, en unidades de `tamano_entrega`) |
| --- | --- | --- |
| `total` | hosts utilizables (sin red ni broadcast en /30 o más grandes) | prefijos que caben |
| `asignadas` | IPs vigentes de servicios | prefijos de ese tamaño entregados desde el pool |
| `libres` | las que el sistema aún puede entregar (dentro del rango, sin el gateway) | `total` − ocupadas |
| `reservadas` | el gateway y las que quedan fuera del rango | unidades ocupadas por otros prefijos vigentes que se traslapan (estáticos de otro tamaño) |
| `porcentaje` | asignadas / (asignadas + libres) × 100, un decimal | igual |

Siempre `total = asignadas + libres + reservadas`. `Ipv6Bloque.espacio` = `{ pools, porcentaje_en_pools }` (parte del bloque ya repartida en pools).

`GET /routers/:id/direccionamiento` (`routers.ver`, esquema `DireccionamientoRouter`) junta todo para la pantalla del router: redes con ocupación, bloques con sus pools, totales (`ocupacion.ipv4` y `ocupacion.ipv6[]` por tipo y tamaño) y `planes[]`.

## §3 Migrar a otro router

`POST /redes-ipv4/:id/migrar` (`redes.migrar`) y `POST /ipv6-bloques/:id/migrar` (`ipv6.migrar`). Cuerpo: `{ version, router_id, mover_servicios?, simular?, bloques_ipv6? | redes_ipv4? }`. Respuesta `MigracionPools`: `{ router_origen_id, router_destino_id, redes_ipv4[], bloques_ipv6[], servicios[]: { servicio_id, user_ppp, antes, despues }, simulado }` (`antes`/`despues` = `router_id`, `ipv4`, `prefijo_enlace_v6`, `prefijo_delegado_v6`).

Un pool IPv6 se muda con su bloque (vive dentro de él y el bloque es del router). Para mudar IPv4 e IPv6 juntos en una sola operación, la red acepta `bloques_ipv6` y el bloque `redes_ipv4` (del mismo router de origen; piden además el permiso de esa familia).

**Regla segura: un servicio nunca queda en un router distinto al de sus direcciones.**

1. Sin `mover_servicios` (por defecto), si algún servicio no retirado usa direcciones de lo que se migra, responde **422 `pool_con_servicios`** con un `errors[]` por servicio (`field: mover_servicios`, `message: "Servicio <id> (<user_ppp>): <direcciones>"`) y no cambia nada. Sin servicios, la red o el bloque se mudan y listo.
2. Con `mover_servicios: true` (pide además `servicios.editar` con alcance sobre los dos routers), en la misma transacción: la red o el bloque pasan al destino y cada servicio pasa al router de destino con `EditarServicio` anidada. Eso deja por servicio: auditoría `servicios.editar`, diff, `servicio.config_cambiada` con `campos` ⊇ `[router]`, `asignacion.cambiada` si cambió alguna dirección, el registro `aaa:user:<user_ppp>` reescrito al confirmar y RouterOS por evento. El servicio **conserva** las direcciones de lo que se muda; las demás se reservan de nuevo en el destino con las reglas de siempre (por ejemplo, si solo se muda la red IPv4, sus prefijos IPv6 salen de los pools del destino; `servicios[].despues` lo muestra).
3. Si un servicio no puede pasar (el plan no está disponible en el destino, el destino no tiene pool o direcciones libres, la empresa del servicio está fuera del acceso del usuario…), responde **422 `servicio_no_migrable`** con el motivo en `detail` y no cambia nada.
4. `simular: true` corre todo y lo revierte: misma respuesta con `simulado: true`, sin cambios, sin auditoría, sin eventos.

Otros rechazos: 422 en `router_id` si el destino no existe o es el mismo router, 422 `router_inactivo`, 409 `conflicto_version`, 403 sin alcance sobre alguno de los routers.

## §4 Explicar IPv6

- `Ipv6Pool.entrega` (esquema `EntregaPoolIpv6`): `atributo_radius` (`Framed-IPv6-Prefix` en enlace, `Delegated-IPv6-Prefix` en delegación), `redes_lan_por_cliente` (/64 que el router del cliente reparte en su LAN: 256 con /56, 65536 con /48, 1 en enlace), `clientes_maximos`, `primer_prefijo`, `segundo_prefijo`, `ultimo_prefijo`.
- `POST /ipv6-pools/vista-previa` (`ipv6.ver`) `{ prefijo, tipo, tamano_entrega }` → lo mismo sin guardar, más `traslapa_con` (pool existente o null).
- `POST /ipv6-bloques/vista-previa` (`ipv6.ver`) `{ prefijo, tamano_delegado }` → división sugerida del bloque: la segunda mitad para delegación (un `tamano_delegado` por cliente) y, al inicio de la primera, el pool de enlace /64 justo para los mismos clientes; `clientes`, `redes_lan_por_cliente`, `pools_sugeridos[]`, `ejemplos[]` (lo que reciben los dos primeros servicios) y `traslapa_con`. Ejemplo: `2001:db8:4000::/40` con /56 → 32768 clientes, enlace `2001:db8:4000::/49`, delegación `2001:db8:4080::/41`; el primer servicio recibe `2001:db8:4000::/64` y `2001:db8:4080::/56`.
- `DireccionamientoRouter.planes[]`: por cada plan disponible en el router, de dónde sale la IPv4 (`redes`, `pool_router` con su nombre, o `ninguna`), los prefijos que recibe un servicio nuevo en modo `radius_servicio` (`prefijo_enlace` 64, `prefijo_delegado`, `redes_lan_por_cliente`, `enlaces_libres`, `delegados_libres`) y `avisos[]` (`sin_ipv4`, `sin_ipv4_libres`, `sin_pool_enlace`, `sin_pool_delegacion`, `sin_prefijos_enlace_libres`, `sin_prefijos_delegados_libres`) con un `mensaje` para el operador.
