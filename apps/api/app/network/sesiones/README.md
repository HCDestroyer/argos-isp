# network/sesiones (A2)

Sesiones PPPoE a partir del accounting RADIUS. `services/aaa` recibe el accounting de FreeRADIUS y lo encola en BullMQ (`aaa-accounting`, contrato en `.claude/integration/contratos/accounting.md`); el proceso `node ace sesiones:worker` (`commands/sesiones_worker.ts`, `cola.ts`) llama a la acción que corresponde.

| Paquete                            | Acción              | Permiso (nombre)      | Efecto en `network.sesiones`                                                                              | Evento                                                       |
| ---------------------------------- | ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Start`                            | `IniciarSesion`     | `sesiones.iniciar`    | abre la fila; cierra otras abiertas más viejas del mismo `user_ppp` (`Sesion-Reemplazada`)                | `sesion.iniciada` (y `sesion.terminada` de las reemplazadas) |
| `Interim-Update`                   | `ActualizarSesion`  | `sesiones.actualizar` | contadores (`GREATEST`), IPv4 y prefijos si llegan; sin Start previo abre la fila                         | `sesion.iniciada` solo si la abre                            |
| `Stop`                             | `TerminarSesion`    | `sesiones.terminar`   | `fin`, contadores finales, `causa_fin` = `Acct-Terminate-Cause`; sin Start previo crea la fila ya cerrada | `sesion.terminada`                                           |
| `Accounting-On` / `Accounting-Off` | `CerrarSesionesNas` | `sesiones.cerrar_nas` | cierra todas las abiertas de ese `nas_ip` (`NAS-Reboot`)                                                  | `sesion.terminada` por cada una                              |

Payload de ambos eventos: `servicio_id` (null si el `user_ppp` no existe), `nas_ip`, `acct_session_id`, `ipv4`, `prefijos_v6` (`[enlace, delegado]` sin nulos).

## Reglas

- Identidad: `(nas_ip, acct_session_id)`. Los paquetes pueden llegar repetidos o desordenados (el NAS reintenta; el worker corre con concurrencia 4): cada evento se emite una sola vez, un Start o Interim tardío no reabre una sesión cerrada y un Stop repetido no hace nada.
- Si el NAS reutiliza un `acct_session_id` (Start posterior al fin de la sesión vieja con el mismo id), la vieja se archiva como `<id>~<fila>` y se abre otra.
- `servicio_id` sale de `core.servicios.user_ppp` y `router_id` de `network.routers.nas_ip`; si no existen quedan en null y la sesión se registra igual.
- Prefijos: `prefijo_enlace_v6` = `Framed-IPv6-Prefix` del NAS; `prefijo_delegado_v6` = `Delegated-IPv6-Prefix` del NAS. **RouterOS 7.24.5 no manda `Delegated-IPv6-Prefix` en accounting** (verificado por el PM): en modo `radius_servicio` se toma el de la asignación vigente (`network.ipv6_asignaciones`, el mismo que `aaa` entregó en el Access-Accept); igual con el /64 si el NAS no lo reporta. En `radius_pool` solo vale lo que reporte el NAS, así que el /56 queda en null (pendiente de la semana 2).
- Un job inválido (contrato roto) falla sin reintentos; un error de Postgres se reintenta con el backoff que fija `aaa` (8 intentos desde 1 s).
- Cada paquete pasa por una `DomainAction`. Se audita en `audit.acciones` todo salvo el Interim-Update que solo actualiza contadores (`auditarExito()` en `ActualizarSesion`, excepción de la regla 9); si el Interim abre la sesión, o falla, sí se audita.

## Panel (tarea 8)

| Ruta                              | Permiso                 | Qué hace                                                                                                                               |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sesiones`                   | `sesiones.ver`          | `?servicio_id=&router_id=&activa=&cursor=&limit=`, contrato `Sesion`, más reciente primero; alcance por router y zona (`consultas.ts`) |
| `POST /sesiones/:id/desconectar`  | `sesiones.desconectar`  | `DesconectarSesion` con `{ motivo }` e `Idempotency-Key`: 202 con la sesión; 404 si no existe, 409 `sesion_terminada` si ya cerró      |
| `POST /servicios/:id/desconectar` | `servicios.desconectar` | `DesconectarServicio`: todas las sesiones abiertas del servicio; 200 con el servicio; 404 si no existe o no tiene sesión activa        |

Desconectar no habla con el NAS: emite `sesion.desconexion_solicitada` (`sesion_id`, `servicio_id`, `nas_ip`, `acct_session_id`, `user_ppp`, `motivo`) en la misma transacción que la auditoría, y `services/coa` manda el Disconnect-Request y deja envío y respuesta en `audit.red`. La sesión se cierra con el Stop que manda el NAS al cortar. No cambia el estado del servicio.

## Vigía de `aaa` (tarea 9)

`node ace aaa:vigilar` (`commands/aaa_vigilar.ts`, `vigia_aaa.ts`) hace `GET <url>/health` a cada nodo de `AAA_SALUD_NODOS` (`nombre=url,…`) cada `AAA_SALUD_CADA_MS` (5 s, timeout 2 s, conexión nueva por sondeo).

| Condición                                                           | Acción                     | Evento                                                |
| ------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| `AAA_CAIDO_TRAS_MS` (60 s) seguidos sin 2xx (timeout, rechazo, 5xx) | `RegistrarCaidaAaa`        | `aaa.caido { nodo, desde, ultimo_error }`             |
| primer 2xx de un nodo caído                                         | `RegistrarRecuperacionAaa` | `aaa.recuperado { nodo, desde, hasta, ultimo_error }` |

- Un solo vigía activo: lock `<COLAS_PREFIJO>:lock:aaa-vigia` con dueño y renovación (30 s). Se pueden correr varios; el que no tiene el lock no sondea.
- "Está caído" sale del último `aaa.caido`/`aaa.recuperado` del nodo en `audit.outbox`; las acciones toman un advisory lock por nodo y no repiten el evento. En Redis solo está la racha de fallos en curso (`<COLAS_PREFIJO>:aaa-salud:<nodo>`, sin TTL, se borra con el primer 2xx), para que otro vigía siga contando desde el mismo primer fallo.
- Las dos acciones se auditan en `audit.acciones` (canal `cron`, actor `sistema`).

## Pruebas

- `tests/network/sesiones_panel.spec.ts`: listado (filtros, cursor, permiso, alcance) y desconexión (auditoría, evento, `Idempotency-Key`, 404/409/422).
- `tests/network/vigia_aaa.spec.ts`: caída a los 60 s, una sola alerta, recuperación, fallo corto sin alerta, dos vigías con lock y racha compartida, racha perdida sin duplicar, `sondeoHttp` contra un servidor real.
- `tests/network/sesiones.spec.ts`: acciones de accounting (Postgres real) y worker (BullMQ real con prefijo propio).
- `tests/network/coa.spec.ts` (tarea 6, de punta a punta): `CambiarEstadoServicio` → `audit.outbox` → XADD a un stream propio (lo que hará el relay de A1) → `services/coa` como proceso → NAS simulado por UDP (`services/coa/test/nas_simulado.ts`, también proceso) → `audit.red` y `coa.fallido`. La sesión la abre `IniciarSesion`. Cubre suspender (CoA, ACK en < 5 s, evento duplicado sin reenvío), reactivar (Disconnect), limitar y volver (CoA de velocidad), cambio de prefijo (Disconnect), desconexión manual (Disconnect), NAK y NAS que no responde.
