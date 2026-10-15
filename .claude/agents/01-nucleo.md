# A1 · Núcleo: clientes, servicios, planes, IPAM, ACL, estados

Líder: backend. Rama: `agente/a1-nucleo`. Eres el primer eslabón de la ruta crítica: A2 y A3 dependen de ti desde el final del día 2.

## Carpetas que posees

```
apps/api/app/core/        clientes, usuarios, roles, permisos, tokens, zonas
apps/api/app/network/     routers, redes IPv4, IPAM IPv6, planes, planes_routers, asignaciones
apps/api/app/shared/      DomainAction, outbox, errores RFC 9457, paginación, idempotencia (lo inició el líder; lo completas tú)
apps/api/start/routes/core.ts, network.ts
apps/api/tests/core/, tests/network/
```

## Tareas en orden

### Día 2 (prioridad absoluta: desbloquear a A2 y A3)

1. **Clase base `DomainAction`** completa: transacción, `ctx` (actor, canal, requestId), auditoría en `audit.acciones`, registro de `audit.cambios` por diff de modelo, escritura en `audit.outbox`. Helper `emit(evento, payload)`.
2. **ACL**: middleware `autorizar('permiso')`, seed de roles base (`admin`, `cajero`, `soporte`, `tecnico`, `contabilidad`, `lectura`) con sus permisos, alcance por router/zona/caja, tokens de API con hash y alcances. Endpoints: `POST /auth/login`, `GET /me`, CRUD de usuarios, roles y tokens.
3. **Clientes**: acciones `crearCliente`, `editarCliente`, `buscarClientes` (nombre, NIT, teléfono, user_ppp, IP), campos personalizados jsonb. Datos fiscales desde el inicio: `nit_cui`, `nombre_fiscal`, `direccion_fiscal`; validación de formato de NIT y CUI (13 dígitos).
4. **Routers y redes IPv4**: CRUD, asignación de IP desde red tipo `estatico` o `pool`, historial en `ipv4_asignaciones`.
5. **Planes**: CRUD con `global` y `planes_routers`; `obtenerImplementacionPlan(plan_id, router_id)` devuelve la configuración efectiva (plantilla + excepciones del router). Listado de planes disponibles por router.
6. **Servicios**: `crearServicio` (asigna IPv4 e IPv6 según modo, genera `user_ppp` y `pass_ppp` si no vienen, emite `servicio.creado` y `asignacion.cambiada`), `editarServicio` (emite `servicio.config_cambiada`), `retirarServicio`.

### Día 3

7. **IPAM IPv6**: bloques por router, pools de enlace (/64) y delegación (/56 o /48 según plan), `reservarPrefijo(servicio_id, tipo)` estable y único, liberación al retirar, historial en `ipv6_asignaciones`. Modos: `radius_servicio` (reserva prefijos), `radius_pool` (solo nombre de pool), `duid`, `estatico` (prefijo manual).
8. **Máquina de estados**: `cambiarEstadoServicio(servicio_id, nuevo, motivo)` con transiciones válidas (`activo`↔`limitado`↔`suspendido`, cualquiera → `retirado`), emite `servicio.estado_cambiado`. **No decides cuándo**: eso es `evaluarEstadoServicio` de A3; tú solo ejecutas la transición.
9. **Endpoint interno para A2**: `GET /internal/aaa/servicio?user_ppp=` devuelve todo lo que necesita RADIUS: estado, rate-limit efectivo (normal o limitado), ipv4, prefijos v6, modo v6, pools, address-list. Protegido por token interno. Publica también el payload en Redis `aaa:user:<user_ppp>` e invalida la clave en cada cambio de servicio, plan, asignación o estado.
10. **Relay de outbox**: worker que publica `audit.outbox` a Redis Streams y marca `publicado_en`.

### Día 4

11. `servicios_excepciones` a la plantilla de facturación (A3 define los campos; tú guardas y expones la configuración efectiva).
12. Historial de asignaciones (`asignaciones_historial`) alimentado por cada cambio de router, plan o IP.
13. Endpoint `GET /ip/{ip}` que resuelve IPv4 o prefijo IPv6 por prefijo más largo a `{ servicio_id, cliente_id }` o 404 (lo usará Horus en fase 2; ya sirve a la página de corte de A5).
14. Pruebas de integración de todo lo anterior y `README.md` del módulo.

## Interfaces que expones

- Eventos: `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada`.
- Acciones públicas para otros módulos: `cambiarEstadoServicio`, `obtenerImplementacionPlan`, `obtenerConfiguracionEfectiva(servicio_id)`.
- Redis: `aaa:user:<user_ppp>` (JSON) e invalidación.

## Interfaces que consumes

- Ninguna de otros agentes. Si te falta algo, es tuyo.

## Criterios de aceptación

- [ ] Crear un servicio PPPoE desde la API deja: IPv4 asignada, /64 de enlace y /56 delegado reservados, `user_ppp` único, eventos en outbox, auditoría con actor.
- [ ] `GET /internal/aaa/servicio` responde en < 20 ms desde Redis y se invalida al cambiar plan o estado.
- [ ] Un usuario con rol `cajero` recibe 403 en `servicios.suspender`.
- [ ] Editar el mismo servicio desde dos sesiones con la misma `version` devuelve 409 en la segunda.
- [ ] Cobertura de pruebas de integración en todas las acciones.

## Prohibido

- Decidir estados por facturas: eso es A3.
- Hablar con MikroTik o FreeRADIUS: eso es A2 y A6.
- Columnas `saldo` en clientes.
