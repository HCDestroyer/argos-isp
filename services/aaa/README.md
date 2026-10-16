# @argosisp/aaa

Endpoints REST que FreeRADIUS 3.2 (`rlm_rest`) llama para autorizar y contabilizar sesiones PPPoE. Dueño: A2 (`.claude/agents/a2-radius.md`). Servidor HTTP con Fastify 5 (antes `node:http`; ver "Dependencias").

| Ruta                   | Llamada desde                     | Estado                       |
| ---------------------- | --------------------------------- | ---------------------------- |
| `GET /health`          | healthcheck de compose            | hecho (incluye estado Redis) |
| `GET /metrics`         | Prometheus (A6)                   | hecho (semana 2, tarea 5)    |
| `POST /aaa/authorize`  | `authorize` de FreeRADIUS         | hecho (tarea 1)              |
| `POST /aaa/post-auth`  | `post-auth`, solo en Reject       | 204, registra el rechazo     |
| `POST /aaa/accounting` | `accounting` (Start/Interim/Stop) | hecho (tarea 4): encola      |

Eventos: `sesion.iniciada` y `sesion.terminada` los emite el worker de accounting de `apps/api` (`app/network/sesiones`) a partir de lo que encola `aaa`; `aaa.caido` / `aaa.recuperado` los emite el vigía de `apps/api` (`node ace aaa:vigilar`, que sondea `GET /health` de cada nodo; ver `apps/api/app/network/sesiones/README.md`). No consume eventos: la caché la mantiene A1.

## `/aaa/authorize`

1. Lee `User-Name` del cuerpo de `rlm_rest`.
2. Busca `aaa:user:<user_ppp>` en Redis. Si no está, o Redis no responde (timeout 150 ms), consulta el respaldo: `GET $API_INTERNAL_URL/internal/aaa/servicio?user_ppp=` con `Authorization: Bearer $AAA_INTERNAL_TOKEN` o, mientras A1 no lo publique, `fixtures/servicios.json` (`AAA_RESPALDO=fixtures`).
3. Cachea lo obtenido con `SET NX` y **sin TTL**: si A1 escribió mientras se consultaba, gana A1. Los inexistentes no se cachean.
4. Descifra `pass_ppp` (`v1.<iv>.<tag>.<datos>`, AES-256-GCM, `AAA_PPP_KEY`) y responde a FreeRADIUS, que autentica PAP o CHAP contra `control:Cleartext-Password`.

| Estado del servicio        | HTTP | rlm_rest → FreeRADIUS | Atributos `reply:`                                                                                                                               |
| -------------------------- | ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activo`                   | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `plan.rate_limit` (cadena completa de A1); `Mikrotik-Group` = `plan-<id>` con reuso > 1 en `simple`, si no `profile_ppp` |
| `limitado`                 | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `plan.rate_limit_limitado`; `Mikrotik-Group` como en activo                                                              |
| `suspendido`               | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `256k/256k`, `Mikrotik-Group` = `suspendido`, `Mikrotik-Address-List` = `suspendidos`, `Filter-Id` = `argos-corte.in`    |
| `retirado`                 | 401  | reject → Reject       | —                                                                                                                                                |
| inexistente o lápida       | 404  | notfound → Reject     | —                                                                                                                                                |
| Redis y respaldo sin datos | 503  | fail → Reject         | —                                                                                                                                                |
| `pass_ppp` no descifrable  | 500  | fail → Reject         | —                                                                                                                                                |

Además, en todo Accept:

| Atributo                       | Cuándo                                             |
| ------------------------------ | -------------------------------------------------- |
| `Framed-IP-Address`            | `ipv4.modo = estatico`                             |
| `Framed-Pool`                  | `ipv4.modo = pool`                                 |
| `Framed-IPv6-Prefix`           | `ipv6.modo = radius_servicio` (/64 de enlace)      |
| `Delegated-IPv6-Prefix`        | `ipv6.modo = radius_servicio` (/56 o /48 delegado) |
| `Framed-IPv6-Pool`             | `ipv6.modo = radius_pool` (pool de enlace)         |
| `Delegated-IPv6-Prefix-Pool`   | `ipv6.modo = radius_pool` (pool de delegación) ¹   |
| `Mikrotik-Delegated-IPv6-Pool` | `ipv6.modo = radius_pool` (pool de delegación) ¹   |
| `Acct-Interim-Interval`        | siempre, 300                                       |

¹ El "Delegated-IPv6-Pool" del brief es `Delegated-IPv6-Prefix-Pool` (RFC 6911, atributo 171) en FreeRADIUS 3.2; RouterOS lee el VSA `Mikrotik-Delegated-IPv6-Pool` (vendor 14988, atributo 22). Se mandan los dos. El /56 que eligió el router no llega en el accounting de RouterOS 7.24.5: lo lee `apps/api` del binding DHCPv6-PD (`app/network/sesiones/README.md`).

`Mikrotik-Rate-Limit` (semana 2): si el registro trae `plan.rate_limit` / `plan.rate_limit_limitado` (cadena completa de `apps/api/app/network/velocidad.ts`, `contratos/aaa.md`), se manda tal cual; si no (registros viejos), `subida/bajada` como antes.

Reuso en modo `simple` (`contratos/velocidad.md`): con `plan.reuso > 1` y `control_velocidad = simple`, activo y limitado reciben `Mikrotik-Group = plan-<plan.id>`: el perfil PPP que el dispatcher de RouterOS (`apps/api/app/network/routeros/velocidad_router.ts`) mantiene en el router con `parent-queue = argosisp-plan-<id>` (la cola padre del plan) y los pools, DNS e IPv6 del perfil `default`. Tiene prioridad sobre `profile_ppp`. El suspendido conserva `Mikrotik-Group = suspendido`.

En `arbol_pcq` (`control_velocidad` del registro) el activo y el limitado no reciben `Mikrotik-Rate-Limit` ni el grupo del plan: no hay cola simple por sesión; el PCQ y el árbol del plan limitan las direcciones de la sesión, que el dispatcher de RouterOS pone en `argosisp-plan-<id>[-limitado]`. El suspendido conserva su perfil completo.

El suspendido conserva su IPv4 y sus prefijos (A5 lo identifica por IP en la página de corte). El perfil sale de lo verificado en RouterOS 7.24.5 (`infra/mikrotik/README.md`): `Mikrotik-Group` aplica el perfil de corte completo al conectar (address-list e interface-list IPv4/IPv6); `Mikrotik-Address-List` y `Filter-Id` son los mismos atributos que `coa` usa para suspender una sesión viva, así el router queda igual en ambos caminos. Se configuran con `AAA_SUSPENDIDO_*`.

## `/aaa/accounting`

1. Normaliza el paquete (`src/accounting.ts`): `Acct-Status-Type` (`Start`, `Interim-Update`, `Stop`, `Accounting-On`, `Accounting-Off`), NAS, sesión, usuario, `Framed-IP-Address`, `Framed-IPv6-Prefix`, `Delegated-IPv6-Prefix` si viene, octetos con gigawords, duración, causa y el instante (`Event-Timestamp` o recepción − `Acct-Delay-Time`).
2. Lo encola en BullMQ (`aaa-accounting`, prefijo `COLAS_PREFIJO`). Contrato del job: `.claude/integration/contratos/accounting.md`. Lo consume `node ace sesiones:worker` (`apps/api/app/network/sesiones`), que escribe `network.sesiones` y emite los eventos.

| Caso                                                    | HTTP | FreeRADIUS                                       |
| ------------------------------------------------------- | ---- | ------------------------------------------------ |
| encolado                                                | 204  | ok → Accounting-Response                         |
| paquete inservible (tipo desconocido, sin NAS o sesión) | 204  | ok → Accounting-Response (se descarta con aviso) |
| Redis no acepta el job en 1,5 s                         | 503  | fail → sin respuesta: el NAS reintenta           |

`aaa` no escribe en Postgres ni decide nada sobre la sesión. RouterOS 7.24.5 no manda `Delegated-IPv6-Prefix` en accounting (lo comprobó el PM): el worker lo toma de la asignación vigente en modo `radius_servicio` (ver `apps/api/app/network/sesiones/README.md`).

## Observabilidad (semana 2, tarea 5)

`GET /metrics` (texto Prometheus 0.0.4; con `METRICS_TOKEN` exige `Authorization: Bearer <token>`, vacío = abierto en la red interna):

| Métrica                                       | Tipo                    | Etiquetas                                                                               |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `argosisp_aaa_autorizaciones_total`           | counter                 | `resultado` = `accept` (200), `reject` (401, retirado), `notfound` (404), `error` (5xx) |
| `argosisp_aaa_autorizacion_duracion_segundos` | histogram (0,005 a 1 s) | `resultado`                                                                             |
| `argosisp_aaa_accounting_total`               | counter                 | `tipo`, `resultado` = `encolado`, `descartado`, `error`                                 |
| `argosisp_aaa_redis_arriba`                   | gauge                   | —                                                                                       |

Autorizaciones por segundo: `rate(argosisp_aaa_autorizaciones_total[1m])`; p95: `histogram_quantile(0.95, sum by (le) (rate(argosisp_aaa_autorizacion_duracion_segundos_bucket[5m])))`. Cada línea de log lleva `request_id` (`src/request_id.ts`, semana 3):

- FreeRADIUS manda `X-Request-Id` en authorize, post-auth y accounting (`control:REST-HTTP-Header` en `sites-enabled/default`): `rad-` + md5(`<NAS-IP>|<Acct-Session-Id>`), o md5(`<NAS-IP>|u:<User-Name>`) si el paquete no trae sesión.
- Si no llega (otra config, pruebas), `aaa` calcula el mismo valor del cuerpo. Es estable, no al azar: el authorize y todo el accounting de una sesión PPPoE comparten id, y un reintento del NAS también.
- Se propaga a la consulta de respaldo (`X-Request-Id` en `GET /internal/aaa/servicio`, que la API usa en su log de acceso) y al job de accounting (`request_id`), que el worker usa en `audit.*` y en `sesion.iniciada` / `sesion.terminada`.
- `/health` y `/metrics`: UUID nuevo. Se devuelve siempre en la respuesta.

## Comandos

```
pnpm --filter @argosisp/aaa dev        # node --watch con type stripping (Node >= 22.18)
pnpm --filter @argosisp/aaa test       # node --test; usa Redis local (base 2, prefijo propio)
pnpm --filter @argosisp/aaa build      # tsc → dist/
docker build -f services/aaa/Dockerfile .   # contexto = raíz del repo
```

Variables en `.env.example`. Las pruebas leen `REDIS_HOST`/`REDIS_PORT` (por defecto `127.0.0.1:6379`) y escriben solo en la base 2 con un prefijo aleatorio que borran al terminar.

## FreeRADIUS (`freeradius/`)

Se monta sobre la imagen oficial `freeradius/freeradius-server:3.2.10` (ver `infra/docker-compose.yml`):

| Archivo del repo                                                     | Destino en el contenedor                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `freeradius/mods-enabled/` (`rest`, `pap`, `chap`, `always`, `expr`) | `/etc/freeradius/mods-enabled/` (reemplaza el de la imagen: sin EAP, LDAP, etc.) |
| `freeradius/sites-enabled/default`                                   | `/etc/freeradius/sites-enabled/` (sin `inner-tunnel`)                            |
| `freeradius/clients.conf` + `freeradius/clients.d/`                  | `/etc/freeradius/clients.conf` y `clients.d/`                                    |

- El diccionario MikroTik (`Mikrotik-Rate-Limit`, `Mikrotik-Group`, `Mikrotik-Address-List`, `Mikrotik-Delegated-IPv6-Pool`, vendor 14988) viene incluido en la imagen (`/usr/share/freeradius/dictionary.mikrotik`); no se reemplaza. `Filter-Id` y `Framed-Pool` son de RFC 2865/2869; `Framed-IPv6-Prefix`, `Framed-IPv6-Pool` y `Delegated-IPv6-Prefix` de RFC 3162/4818.
- El cuerpo que recibe `/aaa/authorize` incluye `User-Password` en claro (PAP): nunca se registra (Fastify no registra cuerpos y el logger lo redacta).
- Secrets por entorno: `RADIUS_LOCAL_SECRET` (cliente `localhost`, healthcheck y `radtest`), `RADIUS_LAB_NAS_IP` y `RADIUS_LAB_SECRET` (cliente fijo `mikrotik-lab`).

### Clientes desde `network.routers` (`pnpm aaa:clients`)

```
DB_HOST=127.0.0.1 DB_USER=argosisp DB_PASSWORD=... DB_DATABASE=argosisp \
AAA_PPP_KEY=... RADIUS_LAB_NAS_IP=10.255.255.2 pnpm aaa:clients
docker compose -f infra/docker-compose.yml restart freeradius   # FreeRADIUS lee los clientes al arrancar
```

- Lee `network.routers` con `activo` y `modo_seguridad = 'radius'`, descifra `radius_secret` (formato `v1`, `AAA_PPP_KEY`) y escribe `freeradius/clients.d/router-<id>.conf` (`ipaddr = nas_ip`, `require_message_authenticator = yes`, permisos 0640). `AAA_CLIENTS_DIR` cambia el directorio.
- Borra los `router-*.conf` de routers que ya no aplican (inactivos, en modo `api`, sin secret). Si un router tiene IP o secret inválidos, conserva su archivo anterior, lo informa y sale con 1.
- Omite el router cuya `nas_ip` es `RADIUS_LAB_NAS_IP`: ya tiene el cliente fijo `mikrotik-lab` en `clients.conf` y FreeRADIUS no arranca con dos clientes en la misma IP.
- Los `.conf` generados llevan el secret en claro: están en `services/aaa/.gitignore`.

## Prueba con `radtest` contra FreeRADIUS en Docker (tarea 3)

El MikroTik físico no estuvo disponible para A2; se probó con FreeRADIUS 3.2.10 real (config de este repo) → `rlm_rest` → `aaa` con fixtures, y `radtest` PAP y CHAP desde dentro del contenedor. Automatizado en `test/freeradius.test.ts` (corre con `pnpm --filter @argosisp/aaa test` si hay Docker; `AAA_PRUEBAS_DOCKER=0` la omite). El contenedor alcanza a `aaa` por `host.docker.internal` (host-gateway), sin `--network host` ni puertos 1812/1813 publicados.

A mano, con el compose (`COMPOSE_PROFILES=lab`, `AAA_RESPALDO=fixtures` en el servicio `aaa`):

```
docker compose -f infra/docker-compose.yml exec freeradius \
  radtest -t chap prueba-suspendido clave-suspendido 127.0.0.1 0 "$RADIUS_LOCAL_SECRET"
```

`test/freeradius.test.ts` también manda accounting con `radclient` (Start, Interim-Update, Stop) por el puerto 1813 y comprueba el Accounting-Response y el job; sin cola disponible no hay respuesta.

Resultado (2026-10-20, idéntico en PAP y CHAP; todas las respuestas traen `Message-Authenticator`):

| Usuario              | Respuesta     | Atributos                                                                                                                                                                                                                |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prueba-activo`      | Access-Accept | `Mikrotik-Rate-Limit = "5120k/20480k"`, `Framed-IP-Address = 10.10.1.10`, `Framed-IPv6-Prefix = 2001:db8:101:1::/64`, `Delegated-IPv6-Prefix = 2001:db8:300:100::/56`, `Acct-Interim-Interval = 300`                     |
| `prueba-limitado`    | Access-Accept | `Mikrotik-Rate-Limit = "1024k/2048k"`, `Framed-Pool = "argos-v4-pppoe"`, `Framed-IPv6-Pool = "argos-v6-enlace"`, `Mikrotik-Delegated-IPv6-Pool = "argos-v6-pd"`, `Acct-Interim-Interval = 300`                           |
| `prueba-suspendido`  | Access-Accept | `Mikrotik-Rate-Limit = "256k/256k"`, `Mikrotik-Group = "suspendido"`, `Mikrotik-Address-List = "suspendidos"`, `Filter-Id = "argos-corte.in"`, `Framed-IP-Address = 10.10.1.11`, /64, /56, `Acct-Interim-Interval = 300` |
| `prueba-burst`       | Access-Accept | `Mikrotik-Rate-Limit = "5M/20M 10M/40M 4M/16M 16/16 8 1M/4M"`, `Mikrotik-Group = "plan-20m"`, `Framed-Pool = "argos-v4-pppoe"`, `Acct-Interim-Interval = 300`                                                            |
| `prueba-retirado`    | Access-Reject | —                                                                                                                                                                                                                        |
| `prueba-inexistente` | Access-Reject | —                                                                                                                                                                                                                        |
| clave errónea        | Access-Reject | —                                                                                                                                                                                                                        |

También se verificó: tras el primer login la clave queda en Redis sin TTL, y un cambio escrito por A1 en Redis (activo → suspendido) se aplica en el siguiente login sin reiniciar nada. Latencia de `aaa` por autorización: 1 a 2 ms (log `ms`).

Pendiente con el MikroTik del laboratorio (A6/PM): PPPoE real con estos atributos (el PM ya verificó en RouterOS 7.24.5 los mismos atributos con un `aaa` simulado, ver `infra/mikrotik/README.md`).

## Pruebas de punta a punta con FreeRADIUS en Docker (tarea 10)

`apps/api/tests/network/freeradius.spec.ts` monta todo el camino con procesos reales y Postgres real:

```
radtest / radclient (en el contenedor, como el MikroTik) → FreeRADIUS 3.2 (config de este repo)
  → rlm_rest → services/aaa (proceso, Redis vacío) → GET /api/v1/internal/aaa/servicio (Postgres)
  → accounting → BullMQ → worker de sesiones → network.sesiones + sesion.iniciada / sesion.terminada
CambiarEstadoServicio / DesconectarSesion → audit.outbox → stream → services/coa (proceso)
  → el mismo FreeRADIUS como NAS (listen type=coa, 3799) → CoA-ACK / CoA-NAK / Disconnect-ACK → audit.red
```

| Prueba     | Qué comprueba                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| authorize  | PAP y CHAP: activo (plan, IPv4, /64, /56), limitado (velocidad reducida), suspendido (perfil de corte + IPs), retirado, inexistente y clave errónea → Reject; caché sin TTL |
| accounting | Start, Interim-Update (gigawords) y Stop → fila abierta, contadores, cierre con causa, /56 de la asignación, eventos; el Interim de contadores no se audita                 |
| CoA ACK    | suspender → CoA-ACK en < 5 s; el NAS devuelve en `Reply-Message` los atributos que decodificó (`256k/256k`, `suspendidos`, `argos-corte.in`); reactivar → Disconnect-ACK    |
| CoA NAK    | limitar un `User-Name` `nak-*` → CoA-NAK con `Error-Cause = Session-Context-Not-Found`, sin reintento, `coa.fallido`                                                        |
| Disconnect | `DesconectarSesion` → Disconnect-ACK con `razon = manual: …`; el Stop del NAS cierra la sesión                                                                              |

Cómo correrla (Docker, Postgres y Redis locales; imagen `freeradius/freeradius-server` de `infra/docker-compose.yml`, se descarga si falta):

```
cd apps/api
DB_DATABASE=argosisp_test_a2 PORT=3422 node ace test --files tests/network/freeradius.spec.ts
```

- Usa un prefijo de Redis propio (`a2fr-<aleatorio>`: claves de `aaa`, cola BullMQ y stream) y lo borra al terminar; el contenedor se llama igual y se elimina.
- Publica el 3799 del contenedor en `127.0.0.6:<puerto libre>` (el `nas_ip` del router de la prueba); FreeRADIUS llega a `aaa` por `host.docker.internal`.
- Sin Docker se omite (`AAA_PRUEBAS_DOCKER=0` también la omite). Tarda unos 15 s.
- Las de `services/aaa` (`pnpm --filter @argosisp/aaa test`, `test/freeradius.test.ts`) y `services/coa` (`test/nas.test.ts`, firma contra `radclient`) siguen cubriendo cada servicio por separado.

## Prueba de carga (semana 2): `pnpm aaa:carga`

Criterio del plan: 200 reconexiones PPPoE simultáneas dual-stack, **cero rechazos por timeout y p95 de autorización < 100 ms**.

```
NODE_ENV=test DB_DATABASE=argosisp_test_a2 PORT=3422 pnpm aaa:carga
# opcionales: AAA_CARGA_CLIENTES=200  AAA_CARGA_REPETICIONES=3  AAA_CARGA_SALIDA=res.json  AAA_CARGA_LOG=aaa.log
```

Es `apps/api/tests/network/carga_radius.spec.ts` (se omite sin `AAA_CARGA=1` o sin Docker). Monta el camino real, cada pieza en su proceso como en el compose:

```
generador (carga/cli.ts, proceso propio) ──UDP──▶ FreeRADIUS 3.2.10 (Docker, config del repo, cliente mikrotik-lab)
  → rlm_rest → aaa (proceso, valores por defecto de producción) → Redis | GET /internal/aaa/servicio (API, Postgres)
  → accounting → BullMQ → sesiones:worker (proceso) → network.sesiones
```

- **Generador** (`carga/generador.ts`, sin dependencias): por cliente, Accounting **Stop** de la sesión anterior (Lost-Carrier) → **Access-Request CHAP** con `Message-Authenticator` (como RouterOS 7.15+) → Accounting **Start** con `Framed-IP-Address` y `Framed-IPv6-Prefix`. Mide la latencia Access-Request → Accept en el cliente (FreeRADIUS + aaa + Redis o API) y cuenta como timeout lo que tarda más de 1 s (`/radius timeout` del laboratorio). Comprueba que cada Accept trae `/64` y `/56`. `node services/aaa/carga/cli.ts <opciones.json>` sirve también contra un FreeRADIUS de laboratorio.
- **Rondas:** arranque (procesos recién iniciados, Redis vacío) y tres pares de reconexión con Redis vaciado (todas las autorizaciones por la API) y con caché caliente.
- **Comprueba:** 200 Accept por ronda, cero timeouts, cero rechazos, accounting sin pérdidas, `network.sesiones` con 200 sesiones abiertas (IPv4, /64 y /56) y las anteriores cerradas; p95 (mediana de las repeticiones) < 100 ms con caché caliente y < 400 ms con Redis vacío.

### Resultados (2026-10-16, contenedor de 4 vCPU compartido con otros agentes, loadavg 7)

| Ronda (200 clientes)                  | Timeouts | p50 ms | p95 ms  | p99 ms  | máx ms  |
| ------------------------------------- | -------- | ------ | ------- | ------- | ------- |
| Arranque, Redis vacío                 | 0        | 225    | 363     | 373     | 375     |
| Reconexión, Redis vacío (3 rondas)    | 0        | 86–131 | 189–242 | 200–282 | 205–301 |
| Reconexión, caché caliente (3 rondas) | 0        | 58–64  | 82–166  | 88–175  | 91–179  |
| Otra corrida, caché caliente          | 0        | 41–77  | 60–106  | 62–111  | 65–126  |

Cero rechazos y cero timeouts en todas las rondas desde los arreglos. Dentro de `aaa`, una autorización con caché caliente tarda p50 5–12 ms y p95 20–37 ms bajo la ráfaga; el resto del p95 del cliente es la cola en FreeRADIUS y Docker con la máquina saturada por otros procesos (el p95 con caché caliente varía de 55 a 166 ms entre corridas idénticas). **El criterio de < 100 ms con caché caliente se cumple en la mediana solo cuando la máquina no está saturada**; hay que repetir la prueba en el hardware del laboratorio (pedido a A6 en `.claude/integration/a2.md`). Con Redis vacío el p95 queda en ~200 ms: lo limita la API (una consulta HTTP por usuario, ~3 ms cada una en serie); el arreglo es del lado de A1 (consulta por lotes y repoblado de Redis, pedidos en `a2.md`).

### Cuellos de botella encontrados y arreglados (antes → después, misma máquina)

| Hallazgo                                                                                                                                                                            | Arreglo                                                                                                       | Efecto                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AAA_API_TIMEOUT_MS=300`: con Redis vacío y 200 consultas a la vez la API pasaba de 300 ms → 503 → Reject (FreeRADIUS lo demora 1 s con `reject_delay` → el NAS lo ve como timeout) | Timeout 600 ms (Redis 150 + API 600 < 800 ms de rlm_rest)                                                     | De 2–166 timeouts a 0 en la ronda de arranque                                  |
| `fetch` abría un socket por consulta a la API: 200 handshakes simultáneos                                                                                                           | Agente keep-alive con 16 conexiones (`AAA_API_CONEXIONES`) y calentamiento al arrancar (`FuenteApi.calentar`) | Arranque p95 925 → 363 ms                                                      |
| `post-auth` llamaba a `aaa` en cada Accept solo para un log de nivel debug: dos HTTP por autorización                                                                               | `post-auth` solo en `Post-Auth-Type REJECT` (registra el rechazo con su causa)                                | La mitad de peticiones HTTP en FreeRADIUS por login                            |
| Cada paquete de accounting era un `Queue.add` (script Lua + escritura) y cada GET su propia escritura; en esta máquina cada syscall cuesta ~50 µs                                   | `addBulk` por tick en `ColaAccountingBullmq` y `enableAutoPipelining` en el Redis de autorización             | Caché caliente (sin API) p95 60–130 → 25–80 ms con fixtures, sin API ni worker |
| El generador en el proceso de la prueba compartía bucle con la API y el worker                                                                                                      | Generador y `sesiones:worker` en procesos propios                                                             | Mide lo que vería el NAS                                                       |

Probado y descartado: subir el pool de hilos de FreeRADIUS (`start_servers` 16–32, `max_servers` 64) no mejoró de forma medible en esta máquina; queda la variable `AAA_CARGA_RADIUSD` para montar otro `radiusd.conf` y repetir la comparación en el laboratorio.

## Dependencias

| Paquete          | Motivo                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fastify` 5.12.5 | El brief pide Fastify o Hono. Fastify: logger pino incluido (JSON), `inject` para pruebas sin puerto, buen rendimiento para el p95 < 100 ms de la semana 2 |
| `ioredis` 5.11.1 | Cliente Redis; misma versión que ya usa BullMQ en el workspace                                                                                             |
| `pg` 8.23.1      | `pnpm aaa:clients` lee `network.routers`; misma versión que ya usa Lucid en `apps/api`                                                                     |
| `bullmq` 6.3.15  | Tarea 4: `/aaa/accounting` encola en la cola que consume `sesiones:worker` (el brief pide BullMQ); misma versión que `apps/api`                            |
