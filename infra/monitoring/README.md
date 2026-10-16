# Monitoreo

| Pieza                                                       | Dónde                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Métricas de la API (`GET /metrics`, Bearer `METRICS_TOKEN`) | `apps/api/app/monitoreo/README.md`                                                                                                |
| Prometheus                                                  | servicio `prometheus` del compose, perfil `monitoreo`; configuración en `prometheus.yml`                                          |
| Métricas de aaa y coa (A2, `GET /metrics`, mismo Bearer)   | jobs `aaa` (`aaa:3100`) y `coa` (`coa:3200`) de `prometheus.yml`; detalle abajo, "aaa y coa"                                       |
| Reglas de alerta                                            | `reglas.yml` (API, aaa o coa sin métricas, aaa sin Redis o con p95 > 100 ms, coa sin consumir, colas atascadas o con fallos, grupos de eventos atrasados, outbox sin publicar, crons sin correr, routers con más de ~1000 colas simples); pruebas en `reglas.test.yml` (CI) |
| Alertas de negocio al equipo por Telegram                   | `apps/api/app/notify` (aaa caído y recuperado, CoA fallido, RouterOS fallido, caja con diferencia, crons de billing atrasados)    |
| Health checks                                               | `healthcheck` de cada servicio en `infra/docker-compose.yml`                                                                      |
| Logs                                                        | JSON a stdout en api (pino), aaa (pino de Fastify) y coa (`docker compose logs -f <servicio>`)                                    |

```sh
# infra/.env: METRICS_TOKEN=$(openssl rand -hex 24)
COMPOSE_PROFILES=monitoreo docker compose -f infra/docker-compose.yml up -d
# http://127.0.0.1:9090  (PROMETHEUS_PORT_HOST), retención PROMETHEUS_RETENCION (30d)
```

Prometheus no expande variables en su configuración: el `entrypoint` del servicio escribe `METRICS_TOKEN` en `/tmp/metrics_token`, que `prometheus.yml` lee con `credentials_file`. Las reglas no tienen Alertmanager todavía: se ven en `/alerts` de Prometheus. Las alertas que el equipo debe recibir en el teléfono ya salen por Telegram desde notify.

## RouterOS y colas (semana 2)

- **`routeros.fallido`** (`contratos/routeros.md`, lo emite el dispatcher de A2 tras 3 reintentos) → alerta por Telegram al equipo: incidente `routeros:<router_id>`, una alerta por router y los fallos siguientes de ese router en 30 min se suman en silencio (quedan en `audit.red`). Plantilla `alerta.routeros.fallido` con el nombre y host del router, la operación, el servicio y el error.
- **Colas simples por router** (`contratos/velocidad.md`: más de ~1000 es alerta). Métricas que expone A2 en la sección `routeros` de `/metrics` con `registrarSeccionMetricas` (`apps/api/app/monitoreo/metricas.ts`):

| Métrica | Etiquetas | Qué es |
| --- | --- | --- |
| `argosisp_routeros_colas_simples` | `router_id`, `router` | colas simples del router en la última lectura (todas, también las dinámicas de PPPoE) |
| `argosisp_routeros_colas_leidas_timestamp_seconds` | `router_id`, `router` | cuándo se contaron (epoch) |

  El conteo lo hace el reconciliador (u otro job con lock) y lo guarda; `/metrics` solo lo lee (no llama al router en cada scrape). Reglas: `RouterDemasiadasColasSimples` (`> 1000` durante 15 min) y `RouterColasSinLeer` (lectura de más de 1 h). Probarlas:

```sh
docker run --rm -v "$PWD/infra/monitoring:/m:ro" --entrypoint promtool prom/prometheus:v3.5.0 test rules /m/reglas.test.yml
```

## Health checks del compose

| Servicio                                                  | Check                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| postgres, redis, mailpit                                  | `pg_isready`, `redis-cli ping`, `mailpit readyz`            |
| api, web, portal, aaa, coa                                | `GET /health` (o `/`) por HTTP dentro del contenedor        |
| relay, billing-worker, sesiones-worker, worker, aaa-vigia | el PID 1 sigue siendo su comando de ace (no tienen HTTP)    |
| freeradius                                                | `Status-Server` al 1812                                     |
| backup                                                    | el último intento de respaldo no falló (`/backups/.estado`) |
| prometheus                                                | `GET /-/ready`                                              |

## Logs y `request_id`

- **api**: JSON (pino) en producción. `request_id_middleware` pone `requestId` en el logger de cada petición y lo devuelve en `X-Request-Id`; las acciones lo guardan en `audit.acciones.request_id` y en `audit.outbox`, y los consumidores de eventos lo reciben (`request_id` del stream). Hoy no hay una línea de log por petición (pedido a A1 en `.claude/integration/a6.md`).
- **aaa** (A2): JSON de Fastify con `reqId` propio por petición; pedido a A2 que lo tome del `Acct-Session-Id`/`X-Request-Id` y lo registre como `request_id`.
- **coa** (A2): JSON propio; las líneas de CoA llevan `evento_id`, no el `request_id` del evento (pedido a A2).

## Verificado (día 4)

Compose con la imagen actual de la API: `/metrics` con el usuario de la aplicación (`argosisp_api`) devuelve colas (`billing-cron`, `notify-cron` con sus schedulers), grupos `notify` y `aaa-cache` con lag 0, outbox 0, la última corrida de cada cron e incidentes abiertos; Prometheus tiene el target `api` en `up 1` y carga las 8 reglas (`promtool check rules` y `check config` en verde).

## aaa y coa

Prometheus raspa `aaa:3100/metrics` y `coa:3200/metrics` con el mismo `METRICS_TOKEN` que la API (el compose se lo pasa a los tres). Con el token vacío aaa y coa responden sin autenticación; la API responde 404. Ambos son del perfil `lab`: sin él, sus targets quedan en `down` y salta `ServicioSinMetricas`.

| Métrica | Servicio | Uso |
| --- | --- | --- |
| `argosisp_aaa_autorizaciones_total{resultado}` | aaa | autorizaciones por segundo: `sum(rate(argosisp_aaa_autorizaciones_total[1m]))` |
| `argosisp_aaa_autorizacion_duracion_segundos{resultado}` | aaa | latencia (histograma): `histogram_quantile(0.95, sum by (le) (rate(argosisp_aaa_autorizacion_duracion_segundos_bucket[5m])))` |
| `argosisp_aaa_accounting_total{tipo,resultado}`, `argosisp_aaa_redis_arriba` | aaa | accounting encolado y Redis |
| `argosisp_coa_envios_total{tipo,resultado}`, `argosisp_coa_rtt_segundos{tipo}` | coa | CoA/Disconnect por resultado (ack, nak, timeout, error, sin_secret) y RTT del NAS |
| `argosisp_coa_eventos_pendientes`, `argosisp_coa_consumidor_activo` | coa | grupo `coa` de `argos:eventos` |

Reglas: `ServicioSinMetricas` (2 min), `AaaSinRedis` (1 min), `AaaLatenciaAlta` (p95 > 100 ms durante 10 min) y `CoaConsumidorInactivo` (2 min), con pruebas en `reglas.test.yml`. Las colas `routeros-cron` y `routeros-prefijos` del `routeros-worker` aparecen en `argosisp_cola_trabajos` de la API.
