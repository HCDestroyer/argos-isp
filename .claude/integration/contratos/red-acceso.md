# Contrato · Red de acceso: OLT, puertos PON, VLAN y servidores PPPoE

Dueño: **A1** (`apps/api/app/network/red_acceso/`). Lo consumen **A2** (RouterOS: descubrir, aplicar y reconciliar) y **A4** (pestaña «Red de acceso» de la ficha del router). Versión 2 (2026-11-05, respuestas del PM: gateway derivado, tomar control, bridge fuera de alcance). Implementación: `apps/api/app/network/red_acceso/`, acciones en `app/network/actions/`, rutas en `start/routes/red_acceso.ts`, pruebas en `tests/network/red_acceso.spec.ts`. Pedido del PM «núcleo de routers» (5 nov): un servidor PPPoE por VLAN, una o dos VLAN por puerto PON, y el `local-address` del perfil PPP sale del gateway de la red, nunca del perfil `default`.

Modelo explícito (lo que ningún competidor modela):

```
OLT ─┬─ puerto PON (0/1/3) ─┬─ VLAN 101 ─── servidor PPPoE «fibra-101» ─┬─ red IPv4 (gateway = local-address)
     │                      └─ VLAN 102 ─── servidor PPPoE «fibra-102» ─┤─ pool IPv6 de enlace (/64)
     └─ …                                                               └─ pool IPv6 de delegación (/56 o /48)
Router ─┴─ interfaz padre (sfp1) ── VLAN … ── servidor PPPoE ── servicios PPPoE (servidor_pppoe_id)
```

OLT y puertos PON son **datos** para ordenar y filtrar (SmartOLT queda para después): Argos nunca habla con la OLT.

## §1 Entidades (schema `network`)

Todas llevan `version` (edición con control optimista: 409 `conflicto_version`), `created_at`, `updated_at`, auditoría en `audit.acciones` y diff en `audit.cambios`.

### `network.olts`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `nombre` | text NOT NULL | único sin distinguir mayúsculas (409 `olt_duplicada`) |
| `marca`, `modelo` | text NULL | libres (`Huawei`, `MA5800-X2`…) |
| `empresa_id` | bigint NULL → `core.empresas` | dueña del equipo; null = compartida entre empresas |
| `descripcion` | text NULL | |
| `activo` | boolean NOT NULL DEFAULT true | |

### `network.olt_puertos_pon`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `olt_id` | bigint NOT NULL → `network.olts` (se borra con la OLT) | |
| `identificador` | text NOT NULL | `marco/slot/puerto` como lo escribe la OLT: `^\d{1,3}(/\d{1,3}){1,3}$` (`0/1/3`, `1/0`); único por OLT (409 `puerto_duplicado`) |
| `descripcion` | text NULL | |

La empresa es la de su OLT.

### `network.vlans`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `router_id` | bigint NOT NULL → `network.routers` | |
| `empresa_id` | bigint NULL → `core.empresas` | null = compartida |
| `interfaz_padre` | text NOT NULL | interfaz de RouterOS (`sfp-sfpplus1`, `bridge-olt`) |
| `vlan_id` | integer NOT NULL | 1–4094; único por router + interfaz padre (409 `vlan_duplicada`) |
| `nombre` | text NOT NULL | `name` de la interfaz VLAN en RouterOS; por defecto `vlan<vlan_id>`; único por router sin distinguir mayúsculas (409 `nombre_interfaz_duplicado`); `^[A-Za-z0-9._-]{1,64}$` |
| `puerto_pon_id` | bigint NULL → `network.olt_puertos_pon` | **máximo 2 VLAN por puerto PON** (422 `puerto_pon_lleno`, se valida con bloqueo de la fila del puerto) |
| `mtu` | integer NULL | null = la de RouterOS (1500) |
| `estado` | text NOT NULL | `administrado` (Argos la crea y edita en el router) o `adoptado` (existía; Argos solo la registra) |
| `ros_id` | text NULL | `.id` de RouterOS (`*1A`); lo llena la adopción o A2 al crearla |
| `descripcion` | text NULL | |

### `network.servidores_pppoe`

| Columna | Tipo | Defecto | Regla |
| --- | --- | --- | --- |
| `router_id` | bigint NOT NULL | | |
| `empresa_id` | bigint NULL | null | null = compartido. Un servicio de otra empresa no puede usarlo (422 `servidor_de_otra_empresa`) |
| `nombre` | text NOT NULL | | etiqueta en Argos; único por router (409 `servidor_duplicado`) |
| `vlan_id` | bigint NULL → `network.vlans` | | del mismo router (422); **un servidor por VLAN** (409 `vlan_con_servidor`) |
| `interfaz` | text NOT NULL | el `nombre` de la VLAN | con `vlan_id` se deriva (y no se acepta otra); sin VLAN, una interfaz física o bridge. **Único por router + interfaz** (409 `interfaz_con_servidor`) |
| `service_name` | text NOT NULL | el `nombre` | `service-name` del servidor en RouterOS |
| `red_ipv4_id` | bigint NULL → `network.redes_ipv4` | | del mismo router; **obligatoria en `administrado`** (422 `red_requerida`); sin gateway vale (su primera IP utilizable es el `local-address`, §2) |
| `ipv6_pool_enlace_id` | bigint NULL → `network.ipv6_pools` | | pool `enlace` de un bloque del router (422 `pool_ipv6`) |
| `ipv6_pool_delegacion_id` | bigint NULL → `network.ipv6_pools` | | pool `delegacion` de un bloque del router (422 `pool_ipv6`) |
| `perfil_base` | text NOT NULL | `default` | perfil de RouterOS del que se copian las propiedades **que no son direcciones** (DNS, `change-tcp-mss`, `use-*`…). Nunca su `local-address` ni su `remote-address` |
| `perfil_router` | text NULL | null | solo adoptado: el `default-profile` que tenía en el router (sale como `perfil`) |
| `max_mtu`, `max_mru` | integer NOT NULL | 1480, 1480 | 576–9000 (1480 = 1500 − 8 de PPPoE − 12 de margen para VLAN/QinQ) |
| `mrru` | integer NULL | null (deshabilitado) | 1500–65535 |
| `autenticacion` | text[] NOT NULL | `{pap,chap,mschap1,mschap2}` (el de RouterOS) | subconjunto no vacío de esos cuatro |
| `keepalive_timeout` | integer NOT NULL | 10 | 0–3600 s (0 = sin keepalive) |
| `una_sesion_por_host` | boolean NOT NULL | true | `one-session-per-host` |
| `max_sesiones` | integer NULL | null (sin límite) | `max-sessions` |
| `estado` | text NOT NULL | `administrado` | `administrado` o `adoptado` |
| `ros_id` | text NULL | | `.id` de RouterOS |
| `activo` | boolean NOT NULL | true | inactivo = no se ofrece a servicios nuevos; A2 lo deshabilita en el router si es `administrado` |
| `descripcion` | text NULL | | |

### Administrado o adoptado

- **`administrado`**: lo crea y edita Argos. A2 lo escribe en el router con `comment = argosisp:vlan:<id>` / `argosisp:pppoe:<id>` (el perfil del servidor: `argosisp-pppoe-<id>` con `comment = argosisp:perfil-pppoe:<id>`). Borrarlo en Argos lo borra del router (solo lo que tiene ese comment).
- **`adoptado`**: existía en el router y se importó (§4). Argos **nunca lo toca** en el router mientras siga adoptado; se puede **tomar control** (§4.1). En Argos se editan solo los campos propios de Argos: `nombre`, `descripcion`, `empresa_id`, `puerto_pon_id` (VLAN), `red_ipv4_id` y pools IPv6 (servidor), `activo`. Cambiar un campo de RouterOS de un adoptado → 422 `adoptado_solo_lectura`. Borrarlo en Argos solo borra la fila.
- `default` y `default-encrypted` nunca se tocan ni se adoptan como perfil de un servidor administrado.

## §2 Gateway → `local-address` (regla única)

La red IPv4 es la **única fuente** del `local-address`. Nunca se teclea en el servidor ni se copia del perfil `default` del router (el bug de `PROPIEDADES_PERFIL_BASE`).

**Gateway efectivo** de una red (decisión del PM, 5 nov): `network.redes_ipv4.gateway` o, si es null, la **primera IP utilizable** (`100.64.10.0/24` → `100.64.10.1`; en /31 y /32 la dirección de red). SQL único: `sqlGatewayEfectivo()` (`app/network/ocupacion.ts`). No se exige gateway: no hay 422 por falta de gateway.

- La IPAM **nunca entrega** el gateway efectivo a un cliente: la asignación automática lo salta y una IP pedida a mano da 422 `reservada`. Un servicio que ya la tenía de antes la conserva (no se mueve sola) y la red lo muestra en `gateway_ocupado_por`.
- La ocupación (`OcupacionPool`) lo cuenta en `reservadas`.
- Vista `RedIpv4`: `gateway_efectivo`, `gateway_derivado` (true si sale de la primera IP utilizable) y `gateway_ocupado_por` (servicio que ya tenía esa IP, o null). Opcionales en el OpenAPI hasta que las fixtures del panel los traigan; la API siempre los envía.
- `PUT /redes-ipv4/:id` que quita el gateway (o cambia la red sin gateway) y deja como derivado una IP que ya tiene un servicio → 422 `gateway_derivado_ocupado` (field `gateway`).
- Si el gateway efectivo cambia (cambiar, poner o quitar el gateway, o cambiar la red sin gateway): `red_acceso.cambiada` (`entidad: 'servidor_pppoe'`, `accion: 'editada'`, `campos: ['local_address']`) por cada servidor de la red, y `aaa:user:*` del router se reescribe.

`localAddressServicio(servicio_id)` (`#network/red_acceso/local_address`, A1) devuelve `{ local_address, derivado, origen, red_ipv4_id, servidor_pppoe_id }`:

1. El servicio tiene IPv4 vigente → gateway efectivo de la red de esa IPv4 (`origen: 'red_ipv4'`).
2. Sin IPv4 (PPPoE con pool del router) y con servidor con red → gateway efectivo de la red del servidor (`origen: 'servidor_pppoe'`).
3. Si no → `null` (`origen: null`): sin red registrada. A2 no escribe `local-address` y avisa (`routeros.fallido` con `operacion: 'local_address'`), nunca copia el del `default`.

`localAddressServidor(servidor_id)` → `{ local_address, derivado }`: gateway efectivo de su `red_ipv4_id` (null sin red).

Las vistas `ServidorPppoe` y `Servicio` traen `local_address` y `local_address_derivado`.

## §3 Servicio PPPoE → servidor

`core.servicios.servidor_pppoe_id` (bigint NULL → `network.servidores_pppoe`). Entra en `POST /servicios` y `PUT /servicios/:id`; sale en la vista `Servicio` (`servidor_pppoe_id`, `local_address`; opcionales en el OpenAPI para no romper fixtures, la API siempre los envía).

- Solo `pppoe` (otro tipo con servidor → 422 `servidor_pppoe`; al dejar PPPoE queda null). Debe ser del router del servicio y estar activo (422).
- **Si no se elige** (alta, cambio de router o servicio que aún no tiene): candidatos = servidores activos del router; si se pidió `ipv4` o `red_ipv4_id`, solo los que tienen esa red (si ninguno la tiene, todos). Uno → ese. Ninguno → null (router sin servidores: lo de antes). **Varios → 422 `servidor_pppoe_requerido`** con los candidatos en el mensaje.
- **IPv4:** sin `ipv4` ni `red_ipv4_id`, la IPv4 sale de la red del servidor (si la tiene). Al cambiar de servidor, si la IPv4 vigente no es de la red del servidor nuevo, se cambia por una de esa red. Una `ipv4` a mano de otra red del router se acepta (el `local-address` es el gateway de su red, §2).
- **IPv6 (`radius_servicio`):** los prefijos se reservan primero en los pools del servidor (si el tamaño coincide; si no, en los del router, como antes). Un prefijo vigente se conserva (estable). `radius_pool` sigue con los nombres de pool del plan en el router.
- Evento: cambiar el servidor emite `servicio.config_cambiada` con `campos` ⊇ `['servidor_pppoe']` (aditivo; junto con `ips`/`prefijo_v6` si cambiaron) y `asignacion.cambiada` si cambió una dirección. El alta va en `servicio.creado` como siempre.
- `aaa:user:*` (aditivo, `contratos/aaa.md`): `red_acceso: { servidor_pppoe_id, local_address }`. Un registro viejo sin el campo = `null`.

## §4 API (`/api/v1`, todo en `packages/contracts`)

| Método y ruta | Permiso | Cuerpo / query | Respuesta |
| --- | --- | --- | --- |
| `GET /olts` | `red_acceso.ver` | `?cursor&limit&activo&empresas` | `{ data: Olt[], nextCursor }` |
| `POST /olts` | `olts.crear` | `nombre, marca?, modelo?, empresa_id?, descripcion?` | 201 `Olt` |
| `GET /olts/:id` | `red_acceso.ver` | | `Olt` (con `puertos[]`) |
| `PUT /olts/:id` | `olts.editar` | `version` + los de crear, `activo?` | `Olt` |
| `DELETE /olts/:id` | `olts.eliminar` | | 204; 409 `olt_con_vlans` si algún puerto tiene VLAN |
| `POST /olts/:id/puertos-pon` | `olts.editar` | `identificador, descripcion?` | 201 `PuertoPon` |
| `PUT /puertos-pon/:id` | `olts.editar` | `version, identificador?, descripcion?` | `PuertoPon` |
| `DELETE /puertos-pon/:id` | `olts.editar` | | 204; 409 `puerto_con_vlans` |
| `GET /routers/:id/red-acceso` | `red_acceso.ver` | | `RedAccesoRouter` (VLAN, servidores con `local_address` y `servicios`, OLT/puertos usados, `servicios_sin_servidor`) |
| `GET /routers/:id/vlans` | `red_acceso.ver` | `?olt_id&puerto_pon_id` | `Vlan[]` |
| `POST /routers/:id/vlans` | `vlans.crear` | `interfaz_padre, vlan_id, nombre?, puerto_pon_id?, mtu?, empresa_id?, descripcion?` | 201 `Vlan` (`administrado`) |
| `PUT /vlans/:id` | `vlans.editar` | `version` + los de crear | `Vlan` |
| `DELETE /vlans/:id` | `vlans.eliminar` | | 204; 409 `vlan_con_servidor` |
| `GET /routers/:id/servidores-pppoe` | `red_acceso.ver` | | `ServidorPppoe[]` |
| `POST /routers/:id/servidores-pppoe` | `servidores_pppoe.crear` | `nombre, vlan_id? \| interfaz?, service_name?, red_ipv4_id, ipv6_pool_enlace_id?, ipv6_pool_delegacion_id?, perfil_base?, max_mtu?, max_mru?, mrru?, autenticacion?, keepalive_timeout?, una_sesion_por_host?, max_sesiones?, empresa_id?, descripcion?` | 201 `ServidorPppoe` (`administrado`) |
| `PUT /servidores-pppoe/:id` | `servidores_pppoe.editar` | `version` + los de crear, `activo?` | `ServidorPppoe` |
| `DELETE /servidores-pppoe/:id` | `servidores_pppoe.eliminar` | | 204; 409 `servidor_con_servicios` (servicios no retirados) |
| `GET /vlans/:id/vista-previa-tomar-control`, `GET /servidores-pppoe/:id/vista-previa-tomar-control` | `red_acceso.tomar_control` | | `VistaPreviaTomarControl` (lee el router; 501 `descubrir_no_disponible` mientras A2 no lo conecte) |
| `POST /vlans/:id/tomar-control`, `POST /servidores-pppoe/:id/tomar-control` | `red_acceso.tomar_control` | `version, huella`; acepta `Idempotency-Key` | `Vlan` / `ServidorPppoe` ya `administrado`; 409 `conflicto_version` o `router_cambio`; 422 `ya_administrado`, `red_requerida` |
| `GET /routers/:id/red-acceso/descubrir` | `red_acceso.descubrir` | | `DescubrimientoRedAcceso` (lee el router; 501 `descubrir_no_disponible` mientras A2 no lo conecte; 502 `router_no_responde`) |
| `POST /routers/:id/red-acceso/adoptar` | `red_acceso.adoptar` | `vlans[]: { ros_id, puerto_pon_id?, empresa_id?, descripcion? }`, `servidores_pppoe[]: { ros_id, nombre?, red_ipv4_id?, ipv6_pool_enlace_id?, ipv6_pool_delegacion_id?, empresa_id?, descripcion? }`; acepta `Idempotency-Key` | `ResultadoAdopcion { vlans: Vlan[], servidores_pppoe: ServidorPppoe[] }` |

- Lista y detalle filtran por la empresa activa: lo de esa empresa **y lo compartido** (`empresa_id` null). Un `empresa_id` explícito exige acceso a esa empresa (403 `empresa_no_permitida`). Rutas con router aplican el alcance por router (`exigirAlcance`).
- `ServidorPppoe` trae `local_address` (calculado, §2), `perfil` (nombre del perfil en RouterOS: `argosisp-pppoe-<id>` si es administrado; el `default-profile` leído si es adoptado), `servicios` (no retirados) y `vlan` (`{ id, nombre, vlan_id }` o null).
- **Adoptar** relee el inventario (no confía en el cuerpo): toma los valores de RouterOS por `ros_id` y crea las filas `adoptado`. Un `ros_id` que ya no está → 409 `inventario_cambio`; uno ya registrado → 409 `ya_registrado`. La VLAN que usa un servidor adoptado en el mismo lote queda enlazada (`vlan_id`). Una VLAN de servidor no adoptada se adopta sola con él.
- `DescubrimientoRedAcceso`: `{ router_id, leido_en, interfaces[], vlans[], servidores_pppoe[], perfiles[], pools_ipv4[], pools_ipv6[], sin_router[] }`. Cada VLAN y servidor trae `argos: { estado: 'nuevo' | 'adoptado' | 'administrado', id, diferencias: [{ campo, argos, router }] }` (emparejado por `ros_id`, luego por `comment argosisp:…`, luego por interfaz) y el servidor `red_ipv4_sugerida_id` (la red del router cuyo gateway = `local-address` de su perfil). `sin_router[]`: filas de Argos que el router ya no tiene (`{ entidad, id, nombre }`, deriva).

### §4.1 Tomar control de lo adoptado (decisión del PM, 5 nov)

Pasa una VLAN o un servidor PPPoE `adoptado` a `administrado`: desde ahí Argos lo escribe (comment `argosisp:…`, perfil `argosisp-pppoe-<id>` con `local-address` = gateway efectivo, MTU/MRU, autenticación de la fila).

1. **Vista previa** `GET /…/:id/vista-previa-tomar-control` → `VistaPreviaTomarControl`: `{ entidad, id, router_id, version, estado, huella, cambios[], sesiones, advertencias[], faltan[] }`.
   - `cambios[]`: `{ ruta, ros_id, nombre, accion: 'crear' | 'actualizar', propiedades: [{ propiedad, actual, deseado }] }` por objeto de RouterOS (el servidor, su perfil nuevo, la VLAN).
   - `faltan[]`: requisitos de Argos (`{ field, rule, message }`, hoy `red_requerida` en un servidor sin red); con alguno la acción da 422.
2. **Acción** `red_acceso.tomar_control` (`POST /…/:id/tomar-control`, `{ version, huella }`): bloquea la fila, exige `version` (409), que siga `adoptado` (422 `ya_administrado`) y lo de `faltan`; **vuelve a pedir el diff** a A2 y si la `huella` no coincide → 409 `router_cambio` (vuelve a pedir la vista previa). Pone `estado = 'administrado'` (diff en `audit.cambios`, `audit.acciones` con la huella y cuántos cambios) y emite `red_acceso.cambiada` con `accion: 'tomar_control'`, `estado: 'administrado'`, `campos: ['estado']`.
3. **A2 da** `vistaPreviaTomarControl(objeto, requestId): Promise<DiffTomarControl>` en `app/network/routeros/inventario_acceso.ts`, con `objeto = { router_id, entidad: 'vlan' | 'servidor_pppoe', id, ros_id }` y `DiffTomarControl = { huella, cambios[], sesiones, advertencias[] }` (tipos en `#network/red_acceso/inventario`). Lee el router (cada GET en `audit.red`), compara con lo que escribiría para esa fila como administrada y no escribe nada. `huella` = sha256 de lo leído que importa (las propiedades de los objetos de `cambios`): estable si el router no cambió. `sesiones`: sesiones abiertas en ese servidor (un cambio de perfil no las corta; las nuevas entran con el perfil de Argos). Al recibir `accion: 'tomar_control'`, aplica como un administrado (crear → mover → borrar), sin cortar sesiones.
4. **A4 muestra** el botón «Tomar control» en lo adoptado; la vista previa con la tabla por objeto y propiedad (actual → deseado), las sesiones y advertencias, `faltan[]` con su enlace (p. ej. «Asignar red»), y confirma con `version` + `huella`; con 409 `router_cambio` vuelve a pedir la vista previa; con 501 muestra el error con «Reintentar».

### Fuera de alcance

- **Bridge con horizon** (varias VLAN y un solo servidor PPPoE con `horizon` en los puertos del bridge): más adelante (PM, 5 nov). Hoy un bridge es una interfaz más y lleva su propio servidor.

## §5 Eventos (outbox)

| Evento | Emite | Payload |
| --- | --- | --- |
| `red_acceso.cambiada` | A1 (acciones de §4, tomar control, cambio del gateway efectivo, unir routers) | `router_id` (null en OLT y puerto PON), `empresa_id` (o null), `entidad` (`olt`, `puerto_pon`, `vlan`, `servidor_pppoe`), `entidad_id`, `accion` (`creada`, `editada`, `eliminada`, `adoptada`, `tomar_control`), `estado` (`administrado`, `adoptado` o null en OLT/puerto), `campos[]` (columnas que cambiaron, más `local_address` cuando cambia el gateway de su red; nunca valores) |
| `servicio.config_cambiada` | A1 | campo nuevo `servidor_pppoe` en `campos[]` (aditivo) |

Lo consumen: `routeros` (A2) para `vlan` y `servidor_pppoe` **administrados** (aplica y reconcilia; ignora `adoptado`, `olt` y `puerto_pon`); `aaa-cache` no lo necesita (A1 reescribe `aaa:user:*` al confirmar). Con `accion: 'eliminada'`, la fila ya no existe: A2 borra del router lo que tenga `comment = argosisp:vlan:<entidad_id>` / `argosisp:pppoe:<entidad_id>` / `argosisp:perfil-pppoe:<entidad_id>`.

## §6 Lo que hace A2 (RouterOS)

1. **`local-address`**: dejar de copiarlo del perfil `default` (`PROPIEDADES_PERFIL_BASE` sin `local-address` ni `remote-address`). Los perfiles que escribe Argos (`plan-<id>`, `argosisp-pppoe-<id>`, `suspendido`, `plan-<id>-limitado`) llevan `local-address` = `localAddressServidor(id).local_address` / `localAddressServicio(id).local_address` (§2: el gateway efectivo, derivado si la red no tiene gateway). Con `Mikrotik-Group = plan-<id>` el perfil del plan manda sobre el del servidor: si el router tiene servidores con gateways distintos, un perfil por plan y servidor (nombre a elegir por A2; `aaa:user:*.red_acceso` trae `servidor_pppoe_id` y `local_address` para que `aaa` elija el grupo). En `pppoe-local` (sin RADIUS) el secret toma el perfil que corresponda.
2. **Descubrir**: exportar `leerInventarioAcceso(routerId, requestId): Promise<InventarioRedAcceso>` desde `apps/api/app/network/routeros/inventario_acceso.ts` (A1 lo carga por import dinámico; mientras no exista, 501). Tipos en `#network/red_acceso/inventario` (A1). Lee `/interface`, `/interface/vlan`, `/interface/pppoe-server/server`, `/ppp/profile`, `/ip/pool`, `/ipv6/pool`; cada GET en `audit.red`. Router caído → lanzar `RouterNoResponde` (502).
3. **Aplicar** `vlan` y `servidor_pppoe` administrados con `red_acceso.cambiada` (crear → mover → borrar, nunca corta; borrar un servidor solo sin sesiones o con aviso) y en `routeros.reconciliar` (deriva en la vista previa). Nunca toca lo adoptado ni lo que no tiene comment de Argos.
4. **Tomar control** (§4.1): exportar también `vistaPreviaTomarControl` en el mismo módulo y aplicar `accion: 'tomar_control'` como un administrado.
5. **Modo `api`** (`pppoe-local.md`): el servidor PPPoE local usa el mismo perfil y `local-address`.

## §7 Lo que hace A4 (panel)

- Pestaña «Red de acceso» en la ficha del router con `GET /routers/:id/red-acceso`: árbol interfaz → VLAN → servidor PPPoE → red/pools, con el `local-address` (solo lectura, «sale del gateway de la red») y servicios por servidor; filtros por OLT y puerto PON.
- Altas y ediciones con los endpoints de §4; los campos de RouterOS de un `adoptado` se ven deshabilitados con el porqué.
- «Detectar en el router»: `GET …/descubrir` → tabla con `nuevo` / `adoptado` / `administrado` y las diferencias; seleccionar y «Importar» → `POST …/adoptar` (la red sugerida ya elegida).
- Catálogo de OLT y puertos PON (`/olts`), con «máximo 2 VLAN por puerto» visible.
- En la red IPv4 y en el servidor: el gateway efectivo con la marca «derivado (primera IP utilizable)» cuando `gateway_derivado` / `local_address_derivado`, y el aviso si `gateway_ocupado_por` no es null.
- «Tomar control» en lo adoptado (§4.1 punto 4).
- En el alta y edición del servicio PPPoE: selector «Servidor PPPoE» (obligatorio solo cuando la API responde `servidor_pppoe_requerido`), y el `local-address` en la ficha.

## §8 Permisos (`app/core/permisos.ts`)

`red_acceso.ver` (todos los roles que tienen `routers.ver`), `red_acceso.descubrir`, `red_acceso.adoptar`, `red_acceso.tomar_control`, `olts.crear`, `olts.editar`, `olts.eliminar`, `vlans.crear`, `vlans.editar`, `vlans.eliminar`, `servidores_pppoe.crear`, `servidores_pppoe.editar`, `servidores_pppoe.eliminar` (`admin` y `tecnico`).

## Decisiones del PM (5 nov)

1. Red sin gateway: no se exige; el `local-address` es la primera IP utilizable (derivado) y la IPAM nunca la entrega (§2).
2. Tomar control de lo adoptado: sí, con vista previa y huella (§4.1).
3. Bridge con horizon: fuera de alcance por ahora.
