# @argosisp/coa

coa-dispatcher. Lee el bus de eventos y, cuando cambia el estado o la configuración de un servicio, manda CoA-Request o Disconnect-Request (RFC 5176) a cada sesión abierta del servicio, a la `nas_ip` **actual** del router de la sesión (`network.sesiones.router_id`; UDP 3799, `/radius incoming` del MikroTik) y con su secret; solo una sesión sin router va a su propia `nas_ip`. Así, una sesión abierta antes de que el router se registrara por el túnel WireGuard recibe el CoA por la IP del túnel (`contratos/conexion-routers.md` §6.4). Registra cada envío y su respuesta en `audit.red`. Dueño: A2 (`.claude/agents/a2-radius.md`).

## Eventos

| Consume (grupo `coa` sobre `argos:eventos`) | Emite (por `audit.outbox`)                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `servicio.estado_cambiado`                  | `coa.fallido` `{servicio_id, nas_ip, tipo: coa\|disconnect, error}` cuando una sesión no recibe ACK |
| `servicio.config_cambiada`                  |                                                                                                     |
| `sesion.desconexion_solicitada`             | (mismo `coa.fallido`; `servicio_id` null si la sesión no tiene servicio)                            |

Consumo según `.claude/integration/contratos/eventos.md`: `XREADGROUP` + `XACK`; si el proceso cae relee sus pendientes al arrancar; lo que lleva 60 s sin confirmar se reclama con `XAUTOCLAIM`. Un evento que falla por Postgres no se confirma y se reintenta; los siguientes del mismo servicio esperan detrás de él. Un payload ilegible o fuera del catálogo se confirma y se descarta.

## Qué manda en cada caso

Decisión del PM, probada en RouterOS 7.24.5 (`infra/mikrotik/README.md`). Código en `src/decision.ts`.

| Cambio                                                     | Paquete    | Atributos además de `User-Name` y `Acct-Session-Id` de la sesión                                                                                   |
| ---------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activo` o `limitado` → `suspendido`                       | CoA        | `Mikrotik-Rate-Limit = 256k/256k`, `Mikrotik-Address-List = suspendidos`, `Filter-Id = argos-corte.in`                                             |
| `activo` → `limitado`                                      | CoA        | `Mikrotik-Rate-Limit` = velocidad limitada del plan                                                                                                |
| `limitado` → `activo`                                      | CoA        | `Mikrotik-Rate-Limit` del plan (o `rate_limit_override` del router)                                                                                |
| `suspendido` → `activo` o `limitado` (reactivar)           | Disconnect | — (un CoA deja el IPv6 cortado; al reconectar `aaa` entrega el perfil normal)                                                                      |
| → `retirado`                                               | Disconnect | — (al reconectar `aaa` lo rechaza)                                                                                                                 |
| `pendiente_instalacion` → `activo` (`motivo: instalacion`) | Disconnect | — (`aaa` rechazaba al pendiente: normalmente no hay sesión y no se envía nada; si quedó una del RADIUS anterior, reconecta con el perfil del plan) |
| config con `ips`, `prefijo_v6` o `router`                  | Disconnect | — (al reconectar trae la IP, el prefijo o el NAS nuevos)                                                                                           |
| config solo con `plan`                                     | CoA        | `Mikrotik-Rate-Limit` del estado actual; nada si está suspendido (se aplica al reactivar)                                                          |
| config con `plan`, reuso > 1 en `simple`                   | Disconnect | — (el perfil `plan-<id>` con la cola padre solo se asigna al conectar)                                                                             |
| velocidad o plan con el router en `arbol_pcq`              | —          | nada: sin cola por sesión, el dispatcher de RouterOS mueve sus direcciones entre las listas del plan                                               |
| `sesion.desconexion_solicitada` (panel o API)              | Disconnect | — a esa sesión, solo si sigue abierta (`network.sesiones.fin IS NULL`); `razon` = `manual: <motivo>`                                               |

- Suspender una sesión con IPv6 depende de `COA_SUSPENDER_CON_IPV6`: `coa` (por defecto) manda el CoA de la tabla; `disconnect` manda Disconnect-Request a las sesiones con /64 o /56 para que reconecten con el perfil `suspendido` (address-list IPv6 y redirect a `/corte`, ver `infra/mikrotik/README.md`, "Corte IPv6 hacia `/corte`"). Las sesiones solo IPv4 van siempre por CoA.
- `coa` no decide estados: un `servicio.estado_cambiado` cuyo `a` ya no es el estado actual del servicio se ignora (llegó tarde; otro evento describe el estado vigente).
- Sin sesión abierta en `network.sesiones` no manda nada (el próximo login ya sale de `aaa` con el perfil correcto).
- Velocidades: la cadena completa de `Mikrotik-Rate-Limit` que calcula A1 con `apps/api/app/network/velocidad.ts` (`plan.rate_limit` en activo, `plan.rate_limit_limitado` en limitado), la misma que entrega `aaa`. Sale de Redis `aaa:user:<user_ppp>` y, si falta, no es de este servicio o no trae las cadenas, de `GET ${API_INTERNAL_URL}internal/aaa/servicio?user_ppp=` con `AAA_INTERNAL_TOKEN` (`src/registro.ts`; reintentos `COA_API_REINTENTOS` ante red, timeout o 5xx). `coa` nunca arma `subida/bajada` por su cuenta: si ninguna fuente responde, no envía nada, deja `resultado = sin_rate_limit` en `audit.red` y emite `coa.fallido`.

## Envío, reintentos y auditoría

- Todo paquete lleva `Message-Authenticator`. Las firmas (Request Authenticator y Message-Authenticator) se calculan en `src/firma.ts` como FreeRADIUS: el paquete `radius` 1.1.4 codifica los atributos pero firma mal las peticiones con Message-Authenticator (ni él mismo las acepta). `test/nas.test.ts` valida `firma.ts` contra `radclient` de FreeRADIUS 3.2 en Docker.
- Respuesta verificada con el secret (Response Authenticator y Message-Authenticator); las que no cuadran se ignoran.
- Timeout por envío `COA_TIMEOUT_MS` (2 s). Ante timeout o error de red, hasta `COA_REINTENTOS` (3) reintentos con backoff 0,5 s · 1 s · 2 s. Un NAK es respuesta definitiva y no se reintenta.
- `audit.red`: una fila por intento. `comando` = `{evento_id, evento, razon, sesion_id, nas_ip, puerto, atributos, intento}`; `respuesta` = `{resultado: ack|nak|timeout|error|sin_secret, codigo, atributos (p. ej. Error-Cause), error, rtt_ms, final}`; `ok` = ACK.
- Sin ACK al final (NAK, reintentos agotados, router sin secret) → `coa.fallido` en `audit.outbox` en la misma transacción que la última fila de `audit.red`.
- Idempotente por `id` del evento: si una sesión ya tiene una fila final para ese evento no se vuelve a enviar (un evento duplicado no desconecta dos veces).

## RouterOS (servicios sin PPPoE)

El cliente REST de RouterOS 7 y el dispatcher de servicios WISP (`ip_estatica`, `dhcp_fija`) viven en `apps/api/app/network/routeros` (semana 2): necesitan la función de velocidad compartida (`#network/velocidad`), las acciones de dominio y el outbox (`routeros.fallido`), que están en la API. `coa` sigue siendo solo RADIUS (CoA/Disconnect). Ver `apps/api/app/network/routeros/README.md`.

## Observabilidad (semana 2, tarea 5)

`GET /metrics` (texto Prometheus 0.0.4; `METRICS_TOKEN` igual que `aaa`):

| Métrica                           | Tipo                   | Etiquetas                                                                                                   |
| --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `argosisp_coa_envios_total`       | counter                | `tipo` (`coa`, `disconnect`), `resultado` (`ack`, `nak`, `timeout`, `error`, `sin_secret`); uno por intento |
| `argosisp_coa_rtt_segundos`       | histogram (0,01 a 2 s) | `tipo` (envíos con respuesta)                                                                               |
| `argosisp_coa_eventos_pendientes` | gauge                  | eventos del grupo `coa` entregados y sin confirmar (`XPENDING`)                                             |
| `argosisp_coa_consumidor_activo`  | gauge                  | —                                                                                                           |

Las líneas de log del dispatcher llevan `evento_id` y `request_id` (el de la acción que emitió el evento). Las métricas del dispatcher WISP (RouterOS) están en `/metrics` de la API (`apps/api/app/network/routeros/metricas.ts`).

## Comandos

```
pnpm --filter @argosisp/coa dev
pnpm --filter @argosisp/coa test     # Redis local (base 2, stream propio); Docker opcional para radclient
docker build -f services/coa/Dockerfile .   # contexto = raíz del repo
```

Variables en `.env.example`. La prueba de punta a punta (`CambiarEstadoServicio` → evento → CoA/Disconnect contra un NAS simulado, con Postgres real) está en `apps/api/tests/network/coa.spec.ts`.

## Dependencias

| Paquete          | Motivo                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| `radius` 1.1.4   | Codificar y decodificar paquetes RADIUS (lo pide el stack de `CLAUDE.md`)              |
| `ioredis` 5.11.1 | Consumidor de Redis Streams; misma versión que `services/aaa`                          |
| `pg` 8.23.1      | Lee sesiones, servicio y router; escribe `audit.red` y `audit.outbox`. Igual que `aaa` |
