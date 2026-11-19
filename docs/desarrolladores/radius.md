# RADIUS, accounting y CoA

Cómo ArgosIsp controla el acceso PPPoE: el servicio `aaa` (lo que FreeRADIUS consulta para autorizar y contabilizar), el worker de sesiones de `apps/api` y el servicio `coa` (CoA y Disconnect hacia el MikroTik). Fuentes: [`services/aaa/README.md`](../../services/aaa/README.md), [`services/coa/README.md`](../../services/coa/README.md), [`apps/api/app/network/sesiones/README.md`](../../apps/api/app/network/sesiones/README.md) y los contratos [`aaa.md`](../../.claude/integration/contratos/aaa.md), [`accounting.md`](../../.claude/integration/contratos/accounting.md), [`velocidad.md`](../../.claude/integration/contratos/velocidad.md) y [`pppoe-local.md`](../../.claude/integration/contratos/pppoe-local.md).

## Piezas

```
CPE ──PPPoE──▶ MikroTik ──RADIUS 1812/1813──▶ FreeRADIUS 3.2 ──rlm_rest──▶ aaa (HTTP :3100)
                  ▲                                                          │
                  │                                         Redis aaa:user:* │ GET /api/v1/internal/aaa/servicio
                  │                                                          │ accounting → BullMQ aaa-accounting
                  │                                                          ▼
                  │                                         sesiones:worker (apps/api) → network.sesiones
                  │                                                          │ sesion.iniciada / sesion.terminada
                  │ CoA / Disconnect (UDP 3799)                              ▼
                  └──────────────────────────────── coa (:3200) ◀── argos:eventos (grupo coa)
```

| Pieza             | Dónde                                                        | Qué hace                                                                                               |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| FreeRADIUS 3.2.10 | `services/aaa/freeradius/` (contenedor `freeradius`)         | Recibe el Access-Request y el accounting del NAS, llama a `aaa` y verifica PAP o CHAP. No decide nada  |
| `aaa`             | `services/aaa` (Fastify 5)                                   | `POST /aaa/authorize`, `POST /aaa/post-auth`, `POST /aaa/accounting`, `GET /health`, `GET /metrics`    |
| `sesiones:worker` | `apps/api/app/network/sesiones` (`node ace sesiones:worker`) | Consume la cola de accounting, escribe `network.sesiones`, emite `sesion.*` y detecta caídas repetidas |
| `coa`             | `services/coa`                                               | Consume eventos de servicio y manda CoA-Request o Disconnect-Request (RFC 5176) a cada sesión abierta  |
| `aaa:vigilar`     | `apps/api` (contenedor `aaa-vigia`)                          | Sondea `GET /health` de cada nodo `aaa` y emite `aaa.caido` / `aaa.recuperado`                         |

`aaa` no guarda estado propio ni escribe en Postgres: lee lo que publica el núcleo y encola el accounting. Ni `aaa` ni `coa` deciden estados; solo `evaluarEstadoServicio` (billing) y las acciones explícitas del núcleo los cambian.

## Autorización: `POST /aaa/authorize`

FreeRADIUS (`sites-enabled/default`) arma un `X-Request-Id` estable (`rad-` + md5 de `<NAS-IP>|<Acct-Session-Id>`, o `<NAS-IP>|u:<User-Name>` sin sesión) y llama a `rlm_rest` con un timeout de 0,8 s. Si `rest` devuelve `fail`, `notfound`, `invalid` o `userlock`, rechaza; si no, `chap` y `pap` verifican contra `control:Cleartext-Password`.

En `aaa`:

1. Lee `User-Name` y busca `aaa:user:<user_ppp>` en Redis (timeout 150 ms).
2. Si no está o Redis no responde, consulta `GET $API_INTERNAL_URL/internal/aaa/servicio?user_ppp=` con `Authorization: Bearer $AAA_INTERNAL_TOKEN` (timeout `AAA_API_TIMEOUT_MS`, 600 ms). Las consultas que llegan en el mismo turno viajan juntas en `POST internal/aaa/servicios` (hasta 100 por lote).
3. Cachea lo que obtuvo con `SET NX` y **sin TTL**: si el núcleo escribió mientras tanto, gana el núcleo. Los inexistentes no se cachean.
4. Descifra `pass_ppp` (formato `v1`, AES-256-GCM con `AAA_PPP_KEY`) y responde con `control:Cleartext-Password` y los atributos `reply:`.

`API_INTERNAL_URL` debe terminar en `/api/v1/`: sin ese prefijo, todo usuario sale como inexistente.

### Respuesta por estado

| Estado del servicio      | HTTP | FreeRADIUS | Atributos                                                                                                                         |
| ------------------------ | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `activo`                 | 200  | Accept     | `Mikrotik-Rate-Limit` = `plan.rate_limit`; `Mikrotik-Group` según la estrategia de velocidad                                      |
| `limitado`               | 200  | Accept     | `Mikrotik-Rate-Limit` = `plan.rate_limit_limitado`; `Mikrotik-Group` como en activo                                               |
| `suspendido`             | 200  | Accept     | `Mikrotik-Rate-Limit = 2M/2M`, `Mikrotik-Group = suspendido`, `Mikrotik-Address-List = suspendidos`, `Filter-Id = argos-corte.in` |
| `pendiente_instalacion`  | 401  | Reject     | —                                                                                                                                 |
| `retirado`               | 401  | Reject     | —                                                                                                                                 |
| inexistente o lápida     | 404  | Reject     | —                                                                                                                                 |
| `pass_ppp` no descifra   | 500  | Reject     | — (`AAA_PPP_KEY` distinta de la de la API)                                                                                        |
| sin Redis, API ni perfil | 503  | Reject     | — (ver «Modo degradado»)                                                                                                          |

El suspendido **se acepta** para que llegue a la página de corte, y conserva su IPv4 y sus prefijos: el portal lo identifica por la IP de la sesión. Los valores del perfil de corte salen de `AAA_SUSPENDIDO_RATE_LIMIT`, `AAA_SUSPENDIDO_GRUPO`, `AAA_SUSPENDIDO_ADDRESS_LIST` y `AAA_SUSPENDIDO_FILTER_ID`. En RouterOS 7.24.5, `Mikrotik-Group = suspendido` aplica al conectar el perfil de corte completo (address-list e interface-list en IPv4 e IPv6); `Mikrotik-Address-List` y `Filter-Id` son los mismos atributos que `coa` usa para suspender una sesión viva. La velocidad del suspendido es `2M/2M` por defecto (`AAA_SUSPENDIDO_RATE_LIMIT` y `COA_SUSPENDIDO_RATE_LIMIT`; vacía = defecto): el corte lo hace el firewall, y con `256k/256k` la página de corte tardaba casi 2 minutos en cargar.

Además, en todo Accept:

| Atributo                                                      | Cuándo                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Framed-IP-Address`                                           | `ipv4.modo = estatico`                                                                 |
| `Framed-Pool`                                                 | `ipv4.modo = pool`                                                                     |
| `Framed-IPv6-Prefix`                                          | `ipv6.modo = radius_servicio` (/64 de enlace)                                          |
| `Delegated-IPv6-Prefix`                                       | `ipv6.modo = radius_servicio` (/56 o /48 delegado)                                     |
| `Framed-IPv6-Pool`                                            | `ipv6.modo = radius_pool` (pool de enlace)                                             |
| `Delegated-IPv6-Prefix-Pool` y `Mikrotik-Delegated-IPv6-Pool` | `ipv6.modo = radius_pool` (pool de delegación; se mandan los dos, RouterOS lee el VSA) |
| `Acct-Interim-Interval`                                       | siempre, 300 (`AAA_INTERIM_SEGUNDOS`)                                                  |

### Velocidad y `Mikrotik-Group`

`aaa` no calcula velocidades: manda tal cual la cadena completa (`rx/tx ráfaga umbral tiempo prioridad limit-at`) que calcula `rateLimitServicio()` en [`apps/api/app/network/velocidad.ts`](../../apps/api/app/network/velocidad.ts) y publica el núcleo en `plan.rate_limit` y `plan.rate_limit_limitado`. Así PPPoE y los servicios de IP estática o DHCP nunca difieren.

- Si el registro trae `velocidad` (estrategia por capas, [`control-velocidad.md`](../../.claude/integration/contratos/control-velocidad.md) §7): `Mikrotik-Group = velocidad.grupo` en activo y limitado, y `Mikrotik-Rate-Limit` solo si `velocidad.rate_limit` (activo) o `velocidad.rate_limit_limitado` (limitado) es `true`. Con `pcq_plan` y `arbol_pcq` no va rate-limit: lo pone la cola del plan.
- Sin `velocidad` (registros anteriores): reuso > 1 en modo `simple` → `Mikrotik-Group = plan-<id>` (perfil con `parent-queue`); si no, `profile_ppp` del router. En `arbol_pcq`, ni rate-limit ni grupo.
- Con `red_acceso.perfil_por_servidor = true`, un grupo `plan-<id>` se manda como `plan-<id>-s<servidor>`.
- El suspendido siempre lleva su perfil de corte completo, sin importar la estrategia.

### `POST /aaa/post-auth`

FreeRADIUS solo lo llama en `Post-Auth-Type REJECT`. Responde 204 y deja en el log la causa del rechazo (`Module-Failure-Message`): clave errónea, retirado, inexistente.

::: warning No diagnostiques con curl
La respuesta de `/aaa/authorize` trae la contraseña PPPoE en claro (`control:Cleartext-Password`). Para probar un usuario usa `radtest` o `radclient` contra FreeRADIUS ([runbook](../runbooks/radius-y-coa.md)).
:::

## Caché en Redis e invalidación por evento

- `aaa:user:<user_ppp>` (sin TTL) y `GET /internal/aaa/servicio` devuelven el mismo JSON (validador en `services/aaa/src/servicio.ts`): `servicio_id`, `version`, `user_ppp`, `pass_ppp` cifrada, `estado`, `router_id`, `plan` (con las cadenas de rate-limit, `reuso`, `profile_ppp`), `ipv4`, `ipv6`, y opcionales `velocidad` y `red_acceso`.
- **Escribe el núcleo**, nunca `aaa` (salvo el `SET NX` del primer login): después de cada COMMIT que cambia el servicio, el plan, `planes_routers`, las asignaciones o el estado, `apps/api/app/core/aaa.ts` hace un SET condicionado (Lua) que no reemplaza un registro del mismo `servicio_id` con `version` mayor. El consumidor `aaa-cache` repite la escritura con los eventos `servicio.*` y `asignacion.cambiada`.
- Baja, retiro o cambio de `user_ppp`: en la clave queda una **lápida** `{"eliminado": true, "user_ppp", "servicio_id", "version"}`, nunca un `DEL` (un `DEL` podría competir con el `SET NX` de una lectura vieja). Para `aaa`, lápida = 404.
- Con `servicio.eliminado` y `router.eliminado`, `aaa` además reemplaza por lápida lo que siga vivo de ese servicio o router y lo olvida del último perfil conocido (`src/bajas.ts`).
- Repoblado completo: `node ace aaa:repoblar [--lote=500] [--forzar]` en el contenedor de la API (en producción `sudo argosisp compose exec api node ace.js aaa:repoblar`). `--forzar` solo después de restaurar Postgres desde un respaldo.

No hay TTL como mecanismo de consistencia (regla 5 de `CLAUDE.md`): un dato viejo en Redis se corrige con el siguiente evento o borrando esa clave.

### Modo degradado

Si para un usuario fallan a la vez Redis (caído o sin la clave) y la API (error o más de 600 ms), `aaa` responde con el **último perfil conocido** de ese usuario: mismo estado y atributos que la última vez, y la contraseña se sigue verificando. Un suspendido sigue cortado; un retirado o una lápida siguen rechazados; un usuario que el nodo nunca vio, rechazado (503). El perfil sale de cada autorización normal, de un espejo de `aaa:user:*` cada `AAA_DEGRADADO_ESPEJO_S` (300 s) y del archivo `/var/lib/argosisp-aaa/ultimo-conocido.json` (0600, `pass_ppp` cifrada), que se carga al arrancar. `AAA_DEGRADADO=rechazar` lo desactiva. Fue decisión del PM (2026-10-17); detalle en el [README de `aaa`](../../services/aaa/README.md#modo-degradado-semana-3-piloto).

## FreeRADIUS y clientes por router

| Archivo del repositorio                         | En el contenedor                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `services/aaa/freeradius/mods-enabled/`         | `rest`, `pap`, `chap`, `always`, `expr` (sin EAP ni LDAP)                                    |
| `services/aaa/freeradius/sites-enabled/default` | `authorize`, `accounting` y `post-auth` contra `$ENV{AAA_URL}`                               |
| `clients.conf` + `clients.d/`                   | cliente `localhost` (`RADIUS_LOCAL_SECRET`, healthcheck y `radtest`) e `$INCLUDE clients.d/` |

El diccionario MikroTik (vendor 14988) viene en la imagen. En producción la imagen es `argosisp-freeradius` (multi-arquitectura, misma receta que la oficial).

Cada router con RADIUS es un cliente de FreeRADIUS en `clients.d/router-<id>.conf`, generado desde `network.routers` (activos, `modo_seguridad = 'radius'`, con `radius_secret` descifrado con `AAA_PPP_KEY`; `require_message_authenticator = yes`):

- **Por evento** (`AAA_CLIENTES_EVENTOS=1`, por defecto en producción): `aaa` consume `argos:eventos` con un grupo propio por nodo (`radius-clientes:<AAA_NODO>`). Con `router.radius_cambiado`, `router.conexion_registrada`, `router.conexion_rotada`, `router.conexion_eliminada` y `router.eliminado` regenera todos los clientes y, si algún archivo cambió, avisa por el FIFO `clients.d/.recargar`. El entrypoint `recargar.sh` valida (`freeradius -C`) y reinicia `radiusd` (alrededor de 1 s sin RADIUS; el router reintenta). Una configuración inválida no lo tumba: sigue con la anterior.
- **A mano:** `sudo argosisp radius-clientes` en producción (regenera y reinicia `freeradius`), `pnpm aaa:clients` en desarrollo.
- Un router `api` (sin RADIUS) no es cliente de FreeRADIUS.

## Accounting y sesiones

`POST /aaa/accounting` normaliza el paquete y lo encola en BullMQ (cola `aaa-accounting`, prefijo `COLAS_PREFIJO`; contrato en [`accounting.md`](../../.claude/integration/contratos/accounting.md)). Responde 204 al encolar (o al descartar un paquete inservible) y 503 si Redis no acepta el job en 1,5 s: FreeRADIUS no contesta y el NAS reintenta. Accounting no tiene modo degradado.

`node ace sesiones:worker` consume la cola (8 intentos con backoff exponencial desde 1 s) y llama a una acción por paquete:

| Paquete                            | Acción                | Efecto en `network.sesiones`                                                    | Evento                                                                |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Start`                            | `sesiones.iniciar`    | Abre la fila; cierra otras abiertas del mismo `user_ppp` (`Sesion-Reemplazada`) | `sesion.iniciada` (y `sesion.terminada` de las reemplazadas)          |
| `Interim-Update`                   | `sesiones.actualizar` | Contadores, IPv4 y prefijos; sin Start previo abre la fila                      | `sesion.iniciada` solo si la abre                                     |
| `Stop`                             | `sesiones.terminar`   | `fin`, contadores, `causa_fin` = `Acct-Terminate-Cause`                         | `sesion.terminada` (y `servicio.caidas_repetidas` si cruza el umbral) |
| `Accounting-On` / `Accounting-Off` | `sesiones.cerrar_nas` | Cierra todas las abiertas de ese `nas_ip` (`NAS-Reboot`)                        | `sesion.terminada` por cada una                                       |

- Identidad `(nas_ip, acct_session_id)`. Paquetes repetidos o desordenados no duplican eventos; un Start o Interim tardío no reabre una sesión cerrada por el NAS.
- `servicio_id` sale de `core.servicios.user_ppp` y `router_id` de `network.routers.nas_ip`; si no existen, la sesión se registra igual con null.
- El Interim-Update que solo actualiza contadores no deja fila en `audit.acciones` (excepción declarada de la regla 9).
- Payload de `sesion.iniciada` / `sesion.terminada`: `servicio_id`, `nas_ip`, `acct_session_id`, `ipv4`, `prefijos_v6` (`[enlace, delegado]` sin nulos), `origen`; `sesion.terminada` además `motivo`. `request_id` es el mismo `rad-…` del authorize, así se sigue una sesión de punta a punta.

### IPv6: /64 de enlace y /56 delegado

- `prefijo_enlace_v6` = `Framed-IPv6-Prefix` que reporta el NAS.
- `prefijo_delegado_v6` = `Delegated-IPv6-Prefix` del NAS. **RouterOS 7.24.5 no lo manda en accounting**, así que:
    - en `radius_servicio`, el worker toma el /56 (y el /64 si falta) de la asignación vigente, el mismo que `aaa` entregó en el Accept;
    - en `radius_pool`, el /64 sale del Start; el /56 se guarda si llega en un Interim o en el Stop y, si no, `sesiones.completar_prefijo` lo lee del router por la API REST (`/ipv6/dhcp-server/binding`, `server = <pppoe-<user_ppp>>`), disparado por `sesion.iniciada` en la cola `routeros-prefijos` (reintentos a los 5, 10, 20, 40 y 80 s).
- `network.sesiones` es lo que usa el portal para identificar al cliente por IP en la página de corte.

### Sesiones colgadas y caídas repetidas

- Cron `cerrar_colgadas` (dentro de `sesiones:worker`, cada `SESIONES_COLGADAS_CADA_MS` = 5 min): cierra con `causa_fin = sin_interim` las sesiones sin accounting desde `SESIONES_COLGADAS_INTERVALOS` (3) × `AAA_INTERIM_SEGUNDOS` (300) = 15 min, **solo** de NAS que siguen mandando accounting. Si se cae `aaa`, Redis o el worker, no cierra nada. Un Interim posterior reabre la sesión.
- `servicio.caidas_repetidas`: `CAIDAS_REPETIDAS_SESIONES` (5) sesiones terminadas en `CAIDAS_REPETIDAS_VENTANA_MIN` (120) min, una vez por ventana. No cuentan `Admin-Reset`, `Admin-Reboot`, `NAS-Reboot`, `NAS-Request` ni `sin_interim` (`CAIDAS_REPETIDAS_CAUSAS_IGNORADAS`). Se reenvía a Iris.

## CoA y Disconnect: `coa`

`coa` lee `argos:eventos` con el grupo `coa` (`XREADGROUP` + `XACK`, `XAUTOCLAIM` de lo que lleva 60 s sin confirmar). Por cada sesión abierta del servicio (`network.sesiones.fin IS NULL`, solo `origen = 'accounting'`) manda el paquete a la `nas_ip` **actual** del router de la sesión, puerto 3799, con el secret del router.

| Cambio                                                             | Paquete                                       | Atributos además de `User-Name` y `Acct-Session-Id`                                                     |
| ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `activo` o `limitado` → `suspendido`                               | Disconnect por defecto; CoA con el modo `coa` | CoA: `Mikrotik-Rate-Limit = 2M/2M`, `Mikrotik-Address-List = suspendidos`, `Filter-Id = argos-corte.in` |
| `activo` → `limitado` y `limitado` → `activo`                      | CoA                                           | `Mikrotik-Rate-Limit` del estado nuevo                                                                  |
| `suspendido` → `activo` o `limitado` (reactivar)                   | Disconnect                                    | — (un CoA deja el IPv6 cortado en 7.24.5; al reconectar `aaa` da el perfil normal)                      |
| → `retirado`                                                       | Disconnect                                    | — (al reconectar `aaa` lo rechaza)                                                                      |
| `pendiente_instalacion` → `activo`                                 | Disconnect                                    | — (normalmente no hay sesión)                                                                           |
| config con `ips`, `prefijo_v6`, `router` o `credenciales`          | Disconnect                                    | — (al reconectar trae lo nuevo)                                                                         |
| config con `router` y `motivo: union_routers`                      | nada                                          | —                                                                                                       |
| config solo con `plan`                                             | CoA                                           | `Mikrotik-Rate-Limit` del estado actual; nada si está suspendido                                        |
| config con `plan` y perfil del plan (`Mikrotik-Group = plan-<id>`) | Disconnect                                    | — (el perfil solo se asigna al conectar)                                                                |
| velocidad con `arbol_pcq`, `pcq_plan` o `cola_simple`              | nada                                          | — (lo aplica el dispatcher de RouterOS en las colas o listas del plan)                                  |
| `sesion.velocidad_solicitada` (sincronizar plan)                   | CoA                                           | `Mikrotik-Rate-Limit` del evento, nunca Disconnect                                                      |
| `sesion.desconexion_solicitada` (panel o API)                      | Disconnect                                    | — a esa sesión, si sigue abierta                                                                        |

- **Modo de suspensión:** sale de **Configuración → Portal de corte** (`modo_suspension`: `desconectar` o `coa`), que `coa` lee de `GET internal/corte/configuracion` al arrancar y relee con `portal.config_cambiada`. Si la API no responde al arrancar, vale `COA_SUSPENDER` del entorno (por defecto `disconnect`) y reintenta en segundo plano. Con `desconectar`, el CPE reconecta con el perfil `suspendido` y sus conexiones abiertas (incluidas las de FastTrack, que no pasan por el filtro) se cortan. Con `coa`, `COA_SUSPENDER_CON_IPV6` (por defecto `disconnect`) manda Disconnect a las sesiones con /64 o /56; las solo IPv4 van por CoA.
- Un `servicio.estado_cambiado` cuyo `a` ya no es el estado actual se ignora (llegó tarde). Sin sesión abierta no manda nada: el próximo login sale de `aaa` con el perfil correcto.
- Las cadenas de rate-limit salen de `aaa:user:<user_ppp>` o, si faltan, de la API interna. `coa` nunca arma una propia: sin cadena, no envía, deja `resultado = sin_rate_limit` en `audit.red` y emite `coa.fallido`.

### Envío, reintentos y auditoría

- Todo paquete lleva `Message-Authenticator`; las firmas se calculan en `src/firma.ts` (el paquete `radius` 1.1.4 firma mal las peticiones con Message-Authenticator). Las respuestas se verifican con el secret.
- Timeout por intento `COA_TIMEOUT_MS` (2 s). Ante timeout o error de red, hasta `COA_REINTENTOS` (3) reintentos con espera de 0,5 s, 1 s y 2 s: en el peor caso unos 11,5 s antes de darlo por fallido. Un NAK es definitivo y no se reintenta.
- `audit.red`: una fila por intento, `tipo` `coa` o `disconnect`, `comando` = `{evento_id, evento, razon, sesion_id, nas_ip, puerto, atributos, intento}`, `respuesta` = `{resultado: ack|nak|timeout|error|sin_secret, codigo, atributos, error, rtt_ms, final}`, `ok` = ACK. Se lee con `GET /api/v1/red/eventos` (permiso `red.ver`).
- Sin ACK al final (NAK, reintentos agotados, router sin secret) → **`coa.fallido`** `{servicio_id, nas_ip, tipo, error}` por `audit.outbox`, en la misma transacción que la última fila de `audit.red`. Notify lo manda a Telegram («ALERTA · … sin respuesta del router …») y no repite los fallos del mismo router durante 30 min.
- Idempotente por `id` del evento: una sesión con fila final para ese evento no se vuelve a enviar.
- El router solo acepta CoA desde la dirección de una de sus entradas `/radius`. `COA_ORIGEN_IP` fija la IP de origen.

## Desconexión manual

| Ruta                                       | Permiso                 | Qué hace                                                                                                            |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/sesiones`                     | `sesiones.ver`          | `?servicio_id=&router_id=&activa=&desde=&hasta=&cursor=&limit=`, la más reciente primero, alcance por router y zona |
| `POST /api/v1/sesiones/:id/desconectar`    | `sesiones.desconectar`  | `{ motivo }` e `Idempotency-Key`: 202; 404 si no existe; 409 `sesion_terminada` si ya cerró                         |
| `POST /api/v1/servicios/:id/desconectar`   | `servicios.desconectar` | Todas las sesiones abiertas del servicio; 404 si no tiene sesión activa                                             |
| `GET /api/v1/routers/:id/resumen-sesiones` | `sesiones.ver`          | Servicios PPPoE, conectados, sesiones activas y quién no volvió desde una fecha                                     |

Desconectar no habla con el NAS: emite `sesion.desconexion_solicitada` en la misma transacción que la auditoría y `coa` manda el Disconnect (en una sesión de sondeo, el consumidor `routeros` hace `/ppp active remove`). No cambia el estado del servicio.

## Routers sin RADIUS

Con `network.routers.modo_seguridad = 'api'` no intervienen FreeRADIUS, `aaa` ni `coa` ([`pppoe-local.md`](../../.claude/integration/contratos/pppoe-local.md)):

- El dispatcher de RouterOS (`apps/api/app/network/routeros`) mantiene un `/ppp secret` por servicio (`comment = argosisp:servicio:<id>`) con perfil `plan-<id>`, `plan-<id>-limitado` o `suspendido`. El suspendido usa el perfil de corte, no el secret deshabilitado, para que llegue a `/corte`.
- Cada cambio de perfil o direcciones va seguido de `/ppp active remove` (no hay CoA); la fila se cierra con `Admin-Reset`. Un cambio solo de velocidad del plan (`plan.velocidad_cambiada`) no corta: rige al reconectar.
- Las sesiones salen del cron `sesiones.sondear_ppp` cada `ROUTEROS_SESIONES_PPP_CADA_MS` (60 s): `origen = 'sondeo'`, sin contadores, causa `sondeo_sin_sesion` cuando desaparece.
- `/ppp secret` no tiene atributo para el /56 fijo: el cliente recibe uno del `dhcpv6-pd-pool` del perfil, que el sondeo lee del binding.
- El reconciliador (`routeros.reconciliar`, cada 15 min) corrige secrets distintos o faltantes.

## Alta disponibilidad y `aaa.caido`

- Los nodos `aaa` son intercambiables: comparten Redis y la API, y cada uno tiene su propio último perfil conocido y su propio grupo de clientes (`AAA_NODO`). El MikroTik usa `timeout=1s` y una segunda entrada `/radius` cuando la plantilla trae `radiusAddr2` (`infra/mikrotik/README.md`). La conmutación a la segunda entrada está **pendiente de laboratorio**, y el compose de producción levanta hoy un solo nodo (`aaa`).
- Vigía: `node ace aaa:vigilar` (contenedor `aaa-vigia`) hace `GET /health` a cada nodo de `AAA_SALUD_NODOS` (`nombre=url,…`; por defecto `aaa=http://aaa:3100`) cada 5 s. Tras `AAA_CAIDO_TRAS_MS` (60 s) sin un 2xx emite **`aaa.caido`** `{nodo, desde, ultimo_error}`; con el primer 2xx, `aaa.recuperado` `{nodo, desde, hasta, ultimo_error}`. Un solo vigía activo por lock en Redis; las dos acciones se auditan. Notify los manda a Telegram.
- `/health` sigue en 200 en modo degradado (con `modo: degradado`): ese caso lo avisa la alerta `AaaDegradado` de Prometheus, no `aaa.caido`.

Qué hacer cuando cae: [RADIUS caído](../runbooks/aaa-caido.md).

## Métricas

| Servicio | Métrica                                                             | Qué dice                                                        |
| -------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `aaa`    | `argosisp_aaa_autorizaciones_total{resultado}`                      | `accept`, `reject`, `notfound`, `error`                         |
| `aaa`    | `argosisp_aaa_autorizacion_duracion_segundos{resultado}`            | Latencia; objetivo p95 < 100 ms                                 |
| `aaa`    | `argosisp_aaa_accounting_total{tipo,resultado}`                     | `encolado`, `descartado`, `error`                               |
| `aaa`    | `argosisp_aaa_redis_arriba`, `argosisp_aaa_degradado`               | 0 = sin Redis; 1 = modo degradado                               |
| `coa`    | `argosisp_coa_envios_total{tipo,resultado}`                         | Uno por intento: `ack`, `nak`, `timeout`, `error`, `sin_secret` |
| `coa`    | `argosisp_coa_rtt_segundos{tipo}`                                   | Tiempo de respuesta del NAS                                     |
| `coa`    | `argosisp_coa_eventos_pendientes`, `argosisp_coa_consumidor_activo` | Eventos sin confirmar y consumidor vivo                         |

Con `METRICS_TOKEN`, `/metrics` exige `Authorization: Bearer`.

## Pruebas

- `pnpm --filter @argosisp/aaa test` y `pnpm --filter @argosisp/coa test` (Redis local, base 2, prefijo propio; Docker opcional para FreeRADIUS y `radclient`).
- De punta a punta, con FreeRADIUS en Docker, `aaa` y `coa` como procesos y Postgres real: `DB_DATABASE=argosisp_test_<agente> PORT=34<n> node ace test --files tests/network/freeradius.spec.ts` en `apps/api` (authorize de cada estado, accounting completo, CoA ACK y NAK, Disconnect).
- Carga: `pnpm aaa:carga` (200 reconexiones simultáneas dual-stack).
- Con el MikroTik físico: [validación física](../laboratorio/validacion-fisica.md).
