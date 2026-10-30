# Contrato · Eliminar sin historial

Decisión del PM (29 oct): **«Eliminar» solo procede cuando el registro nunca se usó.** Si tiene historial, solo se retira (servicio) o se desactiva (router), como hasta ahora. Así se respetan el libro contable inmutable, las facturas FEL y la auditoría (`.claude/CLAUDE.md` §4 y §9). Lo expone A1; lo consumen A2 (FreeRADIUS, RouterOS), A4 (panel) y A6 (Iris, WireGuard). Se cambia en la misma PR que el código que lo cumple.

## 1. Saber de antemano si se puede

```
GET /api/v1/servicios/:id/eliminable   (permiso servicios.ver)
GET /api/v1/routers/:id/eliminable     (permiso routers.ver)
→ 200 { "eliminable": false,
        "motivos": [ { "codigo": "facturas", "cantidad": 3, "mensaje": "tiene 3 facturas" },
                     { "codigo": "sesiones", "cantidad": 12, "mensaje": "tiene 12 sesiones PPPoE" } ] }
→ 404 si no existe · 403 fuera del alcance (router, zona, empresa)
```

`eliminable: true` ⇔ `motivos: []`. El panel muestra «Eliminar» solo si `eliminable`; si no, «Retirar» (servicio) o «Desactivar» (router) y, en el tooltip o el diálogo, los `mensaje`. `codigo` es estable; `mensaje` es texto para mostrar.

## 2. Eliminar

```
DELETE /api/v1/servicios/:id?version=N   (permiso servicios.eliminar, solo admin)
DELETE /api/v1/routers/:id?version=N     (permiso routers.eliminar, solo admin)
Idempotency-Key opcional (la repetición devuelve el mismo 204 con Idempotent-Replayed: true)
→ 204 sin cuerpo
→ 409 conflicto_version · 404 · 403
→ 422 servicio_con_historial | router_con_historial (application/problem+json)
     { "type": "urn:argosisp:problema:servicio_con_historial", "title": "Servicio con historial", "status": 422,
       "detail": "El servicio 7 tiene historial y no se puede eliminar; retíralo (POST /servicios/7/retirar)",
       "errors": [ { "field": "facturas", "message": "tiene 3 facturas", "rule": "historial" } ] }
```

`version` va en la query (un `DELETE` no lleva cuerpo). `errors[].field` es el `codigo` de §1.

## 3. Qué impide eliminar

### Servicio (`app/core/eliminacion.ts`)

| `codigo` | Qué |
| --- | --- |
| `facturas`, `notas_credito` | `billing.facturas` / `billing.notas_credito` del servicio |
| `pagos` | `billing.pagos_aplicaciones` sobre sus facturas |
| `promesas`, `bonificaciones`, `cargos`, `comprobantes`, `cobros_en_linea` | `billing.promesas`, `billing.bonificaciones`, `billing.conceptos_recurrentes`, `billing.comprobantes`, `billing.pasarela_cobros` |
| `asientos` | `ledger.asientos` con origen en sus facturas o notas de crédito |
| `dte` | `fiscal.dte` de sus facturas o notas de crédito |
| `sesiones`, `caidas` | `network.sesiones`, `network.caidas_repetidas` |
| `equipos`, `inventario` | `inventario.unidades` (comodato o entregadas) y `inventario.movimientos` del servicio |
| `lealtad`, `canjes`, `sorteos` | `lealtad.movimientos`, `lealtad.canjes`, `lealtad.sorteos_participantes` |
| `horus`, `horus_recibidos` | `integraciones.horus_datos`, `integraciones.horus_recibidos` |
| `importacion` | `importacion.filas_origen` que apunta al servicio (vino de una importación) |

El estado no importa: un servicio `activo`, `pendiente_instalacion` o `retirado` sin nada de lo anterior se elimina. Los comandos de RouterOS del servicio (`audit.red`) no lo impiden: el dispatcher limpia lo que creó (§4).

### Router (`app/network/eliminacion.ts`)

| `codigo` | Qué |
| --- | --- |
| `servicios` | `core.servicios` en el router, **también retirados** |
| `sesiones` | `network.sesiones` con ese `router_id`, o sin router con su `nas_ip` |
| `historial_asignaciones` | `network.asignaciones_historial` con ese `router_id` |
| `asignaciones_ipv4`, `asignaciones_ipv6` | Asignaciones (vigentes o cerradas) en sus redes IPv4 o en los pools de sus bloques IPv6 |
| `routeros` | `audit.red` del router: CoA/Disconnect o comandos que escribieron (`PUT`, `PATCH`, `DELETE`, `POST`). Las lecturas (`sondear`, `probar_conexion`) no cuentan |
| `bodegas` | `inventario.bodegas` del router |
| `alcance_roles`, `alcance_tokens` | `core.usuarios_roles` con alcance en el router; `core.tokens_api` sin revocar con el router en `alcances.routers` |
| `importacion` | `importacion.filas_origen` que apunta al router |

## 4. Qué hace al eliminar

### Servicio (`servicios.eliminar`)

- Borra lo que depende solo de él: `network.ipv4_asignaciones` y `network.ipv6_asignaciones` (la IP y los prefijos quedan libres para el siguiente), `network.asignaciones_historial`, `core.servicios_adicionales` y sus bloqueos, `core.servicios_planes_temporales`, `core.servicios_excepciones`, `core.ids_externos` del servicio; luego `core.servicios`.
- Redis: lápida en `aaa:user:<user_ppp>` (`{"eliminado": true, "user_ppp", "servicio_id", "version": version+1}`), como pide `contratos/aaa.md` («al borrar el servicio… lápida; no usar solo `DEL`»). Para `aaa` significa rechazar; el endpoint interno responde 404.
- Outbox, en la misma transacción: `servicio.eliminado` y `asignacion.cambiada` (ips vacías, `inicio = fin`), para que el dispatcher de RouterOS limpie lo que creó (con el servicio ya borrado, `AplicarRedServicio` deja vacío cada router donde escribió) y se invaliden los mapas IP → servicio.

### Router (`routers.eliminar`)

- Borra `network.ipv6_pools` de sus bloques, `network.ipv6_bloques`, `network.redes_ipv4`, `network.planes_routers`, `network.routers_contacto`, `network.routers_migracion_aaa`, `network.routers_conexion` y `core.ids_externos` del router; luego `network.routers`. Los planes se conservan.
- Outbox: `router.eliminado` y, si tenía túnel registrado (`routers_conexion.public_key`), antes `router.conexion_eliminada` (lo que ya escuchan el `wireguard-agente` y los clientes de FreeRADIUS, `contratos/conexion-routers.md`).
- Los dos eventos salen en la misma transacción y no duplican trabajo: el `wireguard-agente` (`infra/wireguard/agente.sh`) y los clientes de FreeRADIUS (`services/aaa/src/clientes/consumidor.ts`) reconcilian la lista completa una vez por lote y solo escriben o recargan si algo cambió; si llegan en lotes distintos, la segunda pasada no cambia nada.

### Auditoría (los dos)

- `audit.acciones` con `resultado: ok`, `entidad_tipo`/`entidad_id` y en `entrada.auditoria.foto` el registro y las filas dependientes borradas, con credenciales como `***` (`pass_ppp`, `credencial`, `api_password`, `radius_secret`, `api_ca`).
- `audit.cambios`: un registro por campo, `antes` → `null` (sensibles como `***`).
- Un intento rechazado (422, 409) deja su fila con `resultado: error`. `audit.*` nunca se borra: `audit.red`, `audit.acciones` y `audit.cambios` del registro eliminado se conservan.

## 5. Eventos

| Evento | Emite | Payload | Lo consume |
| --- | --- | --- | --- |
| `servicio.eliminado` | A1 (`EliminarServicio`) | `servicio_id`, `empresa_id`, `cliente_id`, `router_id` (el router donde estaba), `user_ppp` (null si no era PPPoE; nunca `pass_ppp` ni otra credencial) | A2 (`routeros`): limpiar en el router lo que haya creado (hoy ya lo hace con el `asignacion.cambiada` que acompaña). A2 (`aaa`, §7) y A2 (`sesiones`, §7). A6: webhook a Iris (quitar la instantánea del servicio). `aaa-cache` lo recibe como `servicio.*` y no escribe nada (el servicio ya no existe) |
| `router.eliminado` | A1 (`EliminarRouter`) | `router_id`, `empresa_id` (`empresa_sugerida_id` del router, o `null`) | A2 (`aaa`, grupo `radius-clientes:<nodo>`): regenerar los clientes de FreeRADIUS (sale `router-<id>.conf`) y recargar; lápida en las claves `aaa:user:*` con ese `router_id`. A6: el agente WireGuard borra el peer del router |

Los consumidores son idempotentes y no deben buscar la fila: ya no existe. Un evento atrasado de ese servicio o router (`servicio.config_cambiada`, `asignacion.cambiada`) puede llegar después de `*.eliminado`; tratarlo como «no existe».

## 6. Listas «Retirados»

- `GET /api/v1/servicios?estado=retirado` (ya existía).
- `GET /api/v1/routers?activo=false` (ya existía).

## 7. Lo que hace A2 con los eventos

### `aaa` (grupo `radius-clientes:<nodo>`, uno por nodo; `services/aaa/src/bajas.ts`)

- `router.eliminado`: regenera `clients.d` desde `network.routers` (el router ya no está: su archivo se borra) y recarga FreeRADIUS con `recargar.sh`, sin reiniciar el contenedor. Toda clave `aaa:user:*` con ese `router_id` que no sea lápida pasa a lápida y se olvida del último perfil conocido del nodo.
- `servicio.eliminado`: si `aaa:user:<user_ppp>` sigue con el registro completo de ese `servicio_id` (la lápida de A1 no llegó), lo reemplaza por la lápida `{eliminado, user_ppp, servicio_id, version + 1}`; y olvida el servicio del último perfil conocido (modo degradado). Invalidación por evento, sin TTL.
- El reemplazo es atómico (solo si la clave sigue con el valor leído) y nunca pisa una lápida: la de A1 gana. Idempotente; un payload sin id se confirma sin efecto.

### API (grupo `sesiones`, `node ace sesiones:worker`)

- `servicio.eliminado`: si quedó una sesión abierta del `user_ppp` del servicio (solo puede ser una sin `servicio_id`, abierta por accounting después del borrado), `sesiones.desconectar_eliminado` emite `sesion.desconexion_solicitada` (`motivo: servicio_eliminado`) y `coa` manda el Disconnect. Sin sesión, no hace nada.
- El `user_ppp` se toma de `payload.user_ppp` si viene; si no, del `antes` de `audit.cambios` del servicio (`campo = user_ppp`, `despues = null`). A1 ya lo manda (`user_ppp` o null si no es PPPoE, sin credenciales); el respaldo por `audit.cambios` queda para eventos viejos.

## 8. A6 · Iris, WireGuard y notify

### 8.1 Webhooks a Iris (propuesta para `contratos/iris.md` 0.3.1, §2.3)

Mismo conector que el resto de §2.3 (`integraciones.iris_envios`, `node ace iris:worker`): cuerpo `{ id, evento, ocurrido_en, payload }`, `id = argos-evt-<id del outbox>` (estable; Iris deduplica), firma `X-Webhook-Signature: v1=…` (HMAC-SHA256 con `X-Webhook-Timestamp`) y reintentos a 1 min, 5 min, 30 min, 2 h y 12 h; después `fallido`, visible en el panel.

| Evento | Payload exacto (lista cerrada) | Alcance del usuario técnico «Iris» | Efecto en Iris |
| --- | --- | --- | --- |
| `servicio.eliminado` | `servicio_id`, `empresa_id`, `cliente_id`, `router_id` (enteros; el router donde estaba) | Solo si `empresa_id` está en su alcance (o alcance global) | Quita la instantánea del servicio (`integracion.argos_servicios`) y, con `cliente_id`, refresca la lista de servicios del cliente. Una orden o ticket abierto que apunte al servicio queda con su copia local y la marca «ya no existe en Argos» |
| `router.eliminado` | `router_id`, `empresa_id` (`empresa_sugerida_id` del router, o `null`) | Con `empresa_id`, solo si está en su alcance. Con `null` (router compartido) a cualquier conector, igual que `GET /routers` muestra esos routers a cualquier alcance | Quita el router de lo que use para factibilidad (router o nodo sugerido); una factibilidad ya evaluada conserva el id |

- El payload se arma solo con el evento: la fila ya no existe en Argos y A6 no la busca. Nunca lleva `user_ppp`, contraseñas, `radius_secret`, credenciales de la API ni claves WireGuard (ni la pública).
- Orden: `servicio.eliminado` sale con un `asignacion.cambiada` de ips vacías en la misma transacción; los dos van a Iris. Un `servicio.*` o `asignacion.cambiada` atrasado de un servicio eliminado sale igual con el `empresa_id` de su payload (`cliente_id` null si el evento no lo trae); Iris lo trata como «no existe» y no recrea la instantánea.
- Un `GET /servicios/:id` o `GET /routers/:id` de Iris después del webhook responde 404: es el estado esperado, no un error que reintentar.

### 8.2 Peer WireGuard (`wireguard-agente`)

- El agente reconcilia la lista completa con `router.conexion_registrada`, `router.conexion_rotada`, `router.conexion_eliminada` y **`router.eliminado`** (grupo `wireguard`). `EliminarRouter` borra `network.routers_conexion` en su transacción, así que `GET /internal/wireguard/peers` ya no trae el peer; `wg syncconf` lo quita sin tocar los demás túneles (el handshake de los otros routers se conserva).
- La /32 del túnel queda libre: `asignarIpTunel` la entrega al siguiente router (la menor libre). El agente no asigna IPs.
- Idempotente: un `router.eliminado` repetido, perdido o atrasado deja el mismo `peers.conf` (la lista es la fuente, no el evento).

### 8.3 Notify

- `servicio.eliminado` y `router.eliminado` no avisan al cliente ni al equipo.
- Un `servicio.*` atrasado de un servicio que ya no existe (`servicio.estado_cambiado`, también la bienvenida de instalación) no se avisa al cliente: ni error ni envío (`app/notify/eliminados.ts`).
- Las alertas internas de la limpieza (`routeros.fallido`, `coa.fallido`) salen igual, con el servicio y el router por su id (`#812`).
