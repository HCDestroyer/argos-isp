# Monitoreo

| Pieza                                                       | Dónde                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Métricas de la API (`GET /metrics`, Bearer `METRICS_TOKEN`) | `apps/api/app/monitoreo/README.md`                                                                                                |
| Prometheus                                                  | servicio `prometheus` del compose, perfil `monitoreo`; configuración en `prometheus.yml`                                          |
| Reglas de alerta                                            | `reglas.yml` (API sin métricas, colas atascadas o con fallos, grupos de eventos atrasados, outbox sin publicar, crons sin correr) |
| Alertas de negocio al equipo por Telegram                   | `apps/api/app/notify` (aaa caído y recuperado, CoA fallido, caja con diferencia, crons de billing atrasados)                      |
| Health checks                                               | `healthcheck` de cada servicio en `infra/docker-compose.yml`                                                                      |
| Logs                                                        | JSON a stdout en api (pino), aaa (pino de Fastify) y coa (`docker compose logs -f <servicio>`)                                    |

```sh
# infra/.env: METRICS_TOKEN=$(openssl rand -hex 24)
COMPOSE_PROFILES=monitoreo docker compose -f infra/docker-compose.yml up -d
# http://127.0.0.1:9090  (PROMETHEUS_PORT_HOST), retención PROMETHEUS_RETENCION (30d)
```

Prometheus no expande variables en su configuración: el `entrypoint` del servicio escribe `METRICS_TOKEN` en `/tmp/metrics_token`, que `prometheus.yml` lee con `credentials_file`. Las reglas no tienen Alertmanager todavía: se ven en `/alerts` de Prometheus. Las alertas que el equipo debe recibir en el teléfono ya salen por Telegram desde notify.

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
