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

- Borra `network.ipv6_pools` de sus bloques, `network.ipv6_bloques`, `network.redes_ipv4`, `network.planes_routers`, `network.routers_contacto`, `network.routers_migracion_aaa`, `network.routers_conexion` (si existe) y `core.ids_externos` del router; luego `network.routers`. Los planes se conservan.
- Outbox: `router.eliminado`.

### Auditoría (los dos)

- `audit.acciones` con `resultado: ok`, `entidad_tipo`/`entidad_id` y en `entrada.auditoria.foto` el registro y las filas dependientes borradas, con credenciales como `***` (`pass_ppp`, `credencial`, `api_password`, `radius_secret`, `api_ca`).
- `audit.cambios`: un registro por campo, `antes` → `null` (sensibles como `***`).
- Un intento rechazado (422, 409) deja su fila con `resultado: error`. `audit.*` nunca se borra: `audit.red`, `audit.acciones` y `audit.cambios` del registro eliminado se conservan.

## 5. Eventos

| Evento | Emite | Payload | Lo consume |
| --- | --- | --- | --- |
| `servicio.eliminado` | A1 (`EliminarServicio`) | `servicio_id`, `empresa_id`, `cliente_id`, `router_id` (el router donde estaba) | A2 (`routeros`): limpiar en el router lo que haya creado (hoy ya lo hace con el `asignacion.cambiada` que acompaña). A6: webhook a Iris (quitar la instantánea del servicio). `aaa-cache` lo recibe como `servicio.*` y no escribe nada (el servicio ya no existe) |
| `router.eliminado` | A1 (`EliminarRouter`) | `router_id`, `empresa_id` (`empresa_sugerida_id` del router, o `null`) | A2: regenerar los clientes de FreeRADIUS. A6: el agente WireGuard borra el peer del router |

Los consumidores son idempotentes y no deben buscar la fila: ya no existe. Un evento atrasado de ese servicio o router (`servicio.config_cambiada`, `asignacion.cambiada`) puede llegar después de `*.eliminado`; tratarlo como «no existe».

## 6. Listas «Retirados»

- `GET /api/v1/servicios?estado=retirado` (ya existía).
- `GET /api/v1/routers?activo=false` (ya existía).
