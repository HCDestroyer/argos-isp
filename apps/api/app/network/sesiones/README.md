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
- Prefijos: `prefijo_enlace_v6` = `Framed-IPv6-Prefix` del NAS; `prefijo_delegado_v6` = `Delegated-IPv6-Prefix` del NAS. **RouterOS 7.24.5 no manda `Delegated-IPv6-Prefix` en accounting** (verificado por el PM): en modo `radius_servicio` se toma el de la asignación vigente (`network.ipv6_asignaciones`, el mismo que `aaa` entregó en el Access-Accept); igual con el /64 si el NAS no lo reporta. En `radius_pool` (semana 2) el /64 es el que reporta el NAS en el Start; el /56 lo guarda el Interim-Update o el Stop si el NAS lo reporta (se audita como cambio de la sesión) y, si no, `CompletarPrefijoDelegado` (`sesiones.completar_prefijo`) lo lee del router por la API REST (`/ipv6/dhcp-server/binding`, `server = <pppoe-<user_ppp>>`), disparado por `sesion.iniciada` en la cola `routeros-prefijos` del `routeros:worker` (reintentos a los 5, 10, 20, 40 y 80 s mientras DHCPv6-PD no termina).
- Un job inválido (contrato roto) falla sin reintentos; un error de Postgres se reintenta con el backoff que fija `aaa` (8 intentos desde 1 s).
- Cada paquete pasa por una `DomainAction`. Se audita en `audit.acciones` todo salvo el Interim-Update que solo actualiza contadores (`auditarExito()` en `ActualizarSesion`, excepción de la regla 9); si el Interim abre la sesión, o falla, sí se audita.

## Panel (tarea 8)

| Ruta                                | Permiso                 | Qué hace                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sesiones`                     | `sesiones.ver`          | `?servicio_id=&router_id=&activa=&cursor=&limit=`, contrato `Sesion`, más reciente primero; alcance por router y zona (`consultas.ts`)                                                                                                                                                                                                                                                         |
| `GET /routers/:id/resumen-sesiones` | `sesiones.ver`          | `?desde=` (por defecto, la fecha de migración marcada; 422 si no hay): `servicios` PPPoE no retirados, `con_sesion_activa`, `sesiones_activas` del router (incluye `user_ppp` desconocidos), `con_sesion_desde` y la lista `sin_sesion_desde[]` (`servicio_id`, `cliente_id`, `cliente_nombre`, `user_ppp`, `estado`, `ultima_sesion_inicio`, `ultima_sesion_fin`). 404 si el router no existe |
| `POST /sesiones/:id/desconectar`    | `sesiones.desconectar`  | `DesconectarSesion` con `{ motivo }` e `Idempotency-Key`: 202 con la sesión; 404 si no existe, 409 `sesion_terminada` si ya cerró                                                                                                                                                                                                                                                              |
| `POST /servicios/:id/desconectar`   | `servicios.desconectar` | `DesconectarServicio`: todas las sesiones abiertas del servicio; 200 con el servicio; 404 si no existe o no tiene sesión activa                                                                                                                                                                                                                                                                |

`GET /sesiones` acepta además `desde`/`hasta` (semana 3): filtran por solapamiento, la sesión estuvo viva en algún momento de `[desde, hasta)` (abierta o `fin >= desde`, e `inicio < hasta`). El resumen usa la misma regla para "con sesión desde" y busca las sesiones por `servicio_id` (índice `sesiones_servicio_inicio`).

Desconectar no habla con el NAS: emite `sesion.desconexion_solicitada` (`sesion_id`, `servicio_id`, `nas_ip`, `acct_session_id`, `user_ppp`, `motivo`) en la misma transacción que la auditoría, y `services/coa` manda el Disconnect-Request y deja envío y respuesta en `audit.red`. La sesión se cierra con el Stop que manda el NAS al cortar. No cambia el estado del servicio.

## Eventos de red para el panel (semana 3)

`GET /red/eventos` (`eventos_red.ts`, contrato `EventoRed`, permiso `red.ver`): lectura de `audit.red`, la más reciente primero (`id` descendente), cursor.

- Filtros: `router_id`, `servicio_id`, `tipo` (`coa`, `disconnect`, `routeros`), `resultado` (`ok` = `audit.red.ok`; `error` = NAK, timeout, `sin_secret`, `sin_rate_limit` o fallo de RouterOS), `desde` (inclusive) y `hasta` (exclusive).
- Alcance por router y zona (como `GET /sesiones`). Una fila sin router (NAS no dado de alta) solo la ve quien no está acotado por router.
- Credenciales: `comando` y `respuesta` salen con cada clave sensible como `***` a cualquier profundidad (`password`, `secret`, `token`, `private-key`, `User-Password`, `Authorization`…; mismas reglas que `#shared/enmascarar` más los nombres con guion de RouterOS). Hoy `coa` y el cliente de RouterOS no guardan secretos ahí: es defensa en profundidad.
- Permiso nuevo `red.ver` (no `bitacora.ver` ni `sesiones.ver`): `audit.red` trae comandos y respuestas de los equipos, que necesitan `tecnico` (sin `bitacora.ver`) y `soporte`, pero no `contabilidad` (que sí tiene `bitacora.ver`); y `sesiones.ver` es solo la tabla de sesiones. Lo tienen `admin`, `soporte`, `tecnico` y `lectura` (todos los `.ver`).

## Fecha de migración al nuevo `aaa` (semana 3)

Tabla propia `network.routers_migracion_aaa` (`router_id`, `aaa_desde`, `motivo`, `version`); no es columna de `network.routers` (de A1).

| Ruta                               | Permiso                  | Qué hace                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /routers/:id/migracion-aaa`   | `routers.ver`            | `aaa_desde` (null si no se marcó), `motivo`, `version` (0 si nunca), `updated_at` y `primer_accounting` (inicio de la primera sesión del router, como referencia)                                                                                                                                                                       |
| `POST /routers/:id/marcar-migrado` | `routers.marcar_migrado` | `MarcarRouterMigrado` con `{ desde?, motivo, version? }`: `desde` omitido = ahora, `null` = desmarcar (vuelta atrás). 409 con `version` vieja, 422 si `desde` es futura (> 5 min), `Idempotency-Key`. Auditoría en `audit.acciones` y `audit.cambios` (`router`, campo `aaa_desde`). Sin evento: no cambia el estado de ningún servicio |

**Decisión: marca explícita, no derivada del primer accounting.** El primer accounting de un NAS llega antes del corte real (`radtest`, un PPPoE de laboratorio, un `Accounting-On` con el `aaa` ya configurado como secundario) y un piloto puede volver atrás y repetirse; derivada, la primera prueba fijaría la fecha para siempre. La marca queda auditada (quién, cuándo, motivo, valor anterior) y se puede corregir. `GET /routers/:id/resumen-sesiones` la usa como `desde` por defecto (422 si no hay marca ni `desde`). Permiso nuevo `routers.marcar_migrado` (admin y tecnico): no es editar el router (`routers.editar` incluye credenciales) y se audita con su propio nombre.

## Vigía de `aaa` (tarea 9)

`node ace aaa:vigilar` (`commands/aaa_vigilar.ts`, `vigia_aaa.ts`) hace `GET <url>/health` a cada nodo de `AAA_SALUD_NODOS` (`nombre=url,…`) cada `AAA_SALUD_CADA_MS` (5 s, timeout 2 s, conexión nueva por sondeo).

| Condición                                                           | Acción                     | Evento                                                |
| ------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| `AAA_CAIDO_TRAS_MS` (60 s) seguidos sin 2xx (timeout, rechazo, 5xx) | `RegistrarCaidaAaa`        | `aaa.caido { nodo, desde, ultimo_error }`             |
| primer 2xx de un nodo caído                                         | `RegistrarRecuperacionAaa` | `aaa.recuperado { nodo, desde, hasta, ultimo_error }` |

- Un solo vigía activo: lock `<COLAS_PREFIJO>:lock:aaa-vigia` con dueño y renovación (30 s). Se pueden correr varios; el que no tiene el lock no sondea.
- "Está caído" sale del último `aaa.caido`/`aaa.recuperado` del nodo en `audit.outbox`; las acciones toman un advisory lock por nodo y no repiten el evento. En Redis solo está la racha de fallos en curso (`<COLAS_PREFIJO>:aaa-salud:<nodo>`, sin TTL, se borra con el primer 2xx), para que otro vigía siga contando desde el mismo primer fallo.
- Las dos acciones se auditan en `audit.acciones` (canal `cron`, actor `sistema`).

## Verificación previa a migrar un router (semana 3)

`node ace aaa:verificar-router <router_id> [--salida informe.md]` (`pnpm aaa:verificar-router <id>` desde la raíz; lógica en `verificacion_migracion.ts`). Solo lee Postgres y Redis. Informe en Markdown con OK / AVISO / FALLA por comprobación; sale con 1 si hay alguna falla:

| Comprobación           | Falla si                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router                 | no existe, está inactivo o no está en modo `radius`                                                                                                                                                                                 |
| Secreto RADIUS         | no hay `radius_secret`, no descifra con `AAA_PPP_KEY` o `pnpm aaa:clients` lo rechazaría (< 8 caracteres, caracteres de control)                                                                                                    |
| Registros `aaa:user:*` | un servicio PPPoE no retirado no tiene clave, tiene lápida, JSON inválido, `version` menor que Postgres, u otra `pass_ppp`, estado o plan                                                                                           |
| Contraseñas PPPoE      | `pass_ppp` no descifra con `AAA_PPP_KEY` (`aaa` respondería 500)                                                                                                                                                                    |
| Planes con perfil      | un plan en uso no tiene fila en `planes_routers` con `profile_ppp` (salvo reuso > 1 en `simple`: perfil `plan-<id>`), o hay servicios en `radius_pool` sin pools IPv6. Avisos: sin velocidad limitada, sin IPv4 fija ni `pool_ipv4` |
| `user_ppp` únicos      | dos servicios no retirados (de cualquier router) con el mismo `user_ppp` sin distinguir mayúsculas ni espacios, o con espacios o caracteres de control                                                                              |

Uso en la migración del piloto: `services/aaa/RUNBOOK.md`.

## Pruebas

- `tests/network/sesiones_resumen.spec.ts`: `desde`/`hasta` de `GET /sesiones` y `GET /routers/:id/resumen-sesiones` (conteos, retirados fuera, 404/422/403, alcance).
- `tests/network/migracion_aaa.spec.ts`: marcar, volver a marcar, desmarcar, auditoría, 409/422/404/403, alcance, `Idempotency-Key` y `desde` por defecto del resumen.
- `tests/network/eventos_red.spec.ts`: `GET /red/eventos` (filtros, fechas, cursor, credenciales como `***`, permiso y alcance).
- `tests/network/sesiones_panel.spec.ts`: listado (filtros, cursor, permiso, alcance) y desconexión (auditoría, evento, `Idempotency-Key`, 404/409/422).
- `tests/network/freeradius.spec.ts` (tarea 10): FreeRADIUS en Docker + `aaa` + `coa` como procesos: authorize de los cuatro estados, accounting completo, CoA ACK y NAK, Disconnect. Cómo correrla en `services/aaa/README.md`.
- `tests/network/vigia_aaa.spec.ts`: caída a los 60 s, una sola alerta, recuperación, fallo corto sin alerta, dos vigías con lock y racha compartida, racha perdida sin duplicar, `sondeoHttp` contra un servidor real.
- `tests/network/sesiones.spec.ts`: acciones de accounting (Postgres real) y worker (BullMQ real con prefijo propio).
- `tests/network/coa.spec.ts` (tarea 6, de punta a punta): `CambiarEstadoServicio` → `audit.outbox` → XADD a un stream propio (lo que hará el relay de A1) → `services/coa` como proceso → NAS simulado por UDP (`services/coa/test/nas_simulado.ts`, también proceso) → `audit.red` y `coa.fallido`. La sesión la abre `IniciarSesion`. Cubre suspender (CoA, ACK en < 5 s, evento duplicado sin reenvío), reactivar (Disconnect), limitar y volver (CoA de velocidad), cambio de prefijo (Disconnect), desconexión manual (Disconnect), NAK y NAS que no responde.
