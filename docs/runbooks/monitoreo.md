---
orden: 6
---

# Runbook · Monitoreo y alertas

Para el operador y el equipo de turno. Qué avisa ArgosIsp solo, por dónde llega cada aviso y qué métricas puedes leer desde tu propio monitoreo.

Hay dos capas:

| Capa                                                       | Qué vigila                                                                                                                                          | Por dónde avisa              | En un servidor instalado                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Alertas del sistema** (las da la propia API)             | RADIUS caído, cambios de velocidad o cortes que el router no aceptó, routers que no responden, cajas con diferencia, procesos automáticos atrasados | Telegram, al chat del equipo | Sí, solo hay que configurar el bot                                                                   |
| **Alertas de infraestructura** (Prometheus y Alertmanager) | La API sin responder, colas atascadas, eventos sin publicar, latencia de RADIUS                                                                     | Telegram, por Alertmanager   | No vienen instaladas: se usan con el compose de desarrollo y laboratorio, o con tu propio Prometheus |

## 1. Alertas del sistema por Telegram

Se configuran en el panel, **Configuración → Notificaciones** ([guía](../manual/notificaciones/configuracion.md)), en la configuración **global**: token del bot, «Chat del equipo» (el bot tiene que ser miembro del grupo) y el interruptor «Alertas al equipo». Usa «Enviar prueba» de Telegram con el destino vacío: va al chat del equipo.

Cada problema es un **incidente**: llega **una** alerta al abrirse, y mientras sigue abierto las repeticiones solo se cuentan. Algunos avisan también cuando se resuelven («RESUELTO»).

| Alerta                      | Cuándo llega                                                                                                                                                                           | Se cierra                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| RADIUS (`aaa`) caído        | El vigía no recibe respuesta de salud de un nodo `aaa` durante 60 s                                                                                                                    | Cuando el nodo responde otra vez, con «RESUELTO» y la duración |
| CoA fallido                 | El router no aceptó o no respondió un cambio de velocidad, corte o desconexión                                                                                                         | Solo, tras 30 min sin fallos de ese router                     |
| RouterOS fallido            | Un comando al router por su API falló tras 3 reintentos (nombre y host del router, operación, servicio y error)                                                                        | Solo, tras 30 min sin fallos de ese router                     |
| Validación de velocidad     | ArgosIsp rechazó una configuración de velocidad inválida para un router                                                                                                                | Solo, tras 30 min                                              |
| Caja con diferencia         | Se cerró un turno de caja con faltante o sobrante                                                                                                                                      | Es puntual                                                     |
| Proceso automático atrasado | La generación o el vencimiento de facturas no corrió en más de 60 min (más la tolerancia), la hora de corte de hoy pasó sin procesarse, o los procesos diarios de lealtad no corrieron | Cuando vuelve a correr, con «RESUELTO»                         |
| Horus                       | Hallazgos de seguridad, routers e infraestructura que informa Horus (si está conectado)                                                                                                | Según Horus                                                    |

La vigilancia de procesos atrasados corre cada 5 minutos en el proceso de notificaciones (`worker`); la tolerancia es `NOTIFY_CRON_TOLERANCIA_MIN` (30 min por defecto).

Cada alerta queda en **Configuración → Plantillas de avisos → Envíos** con cliente «Equipo». Si el chat o el token faltan, la alerta queda «Fallido» con el motivo; con el interruptor apagado, «Omitido». El texto de cada alerta es una plantilla «Alerta al equipo · …» que puedes editar o apagar ([Plantillas de avisos](../manual/notificaciones/plantillas-y-envios.md)); apagada, el incidente se registra igual pero no avisa.

::: warning
Estas alertas las manda el propio proceso de notificaciones. Si el `worker` o Redis están caídos, no salen. Para vigilar eso hace falta la capa de infraestructura (abajo) o, como mínimo, revisar `sudo argosisp estado`.
:::

## 2. Estado de los servicios

```sh
sudo argosisp estado         # cada servicio: sano o no, más avisos
sudo argosisp logs <servicio>
```

Cada servicio tiene su chequeo de salud:

| Servicio                                                                                                                               | Chequeo                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `postgres`, `redis`                                                                                                                    | `pg_isready`, `redis-cli ping`                              |
| `api`, `api-portal`, `web`, `portal`, `aaa`, `coa`                                                                                     | Responden su página de salud por HTTP dentro del contenedor |
| `relay`, `billing-worker`, `fiscal-worker`, `sesiones-worker`, `routeros-worker`, `worker`, `aaa-vigia`, `horus-worker`, `iris-worker` | El proceso sigue vivo (no tienen HTTP)                      |
| `freeradius`                                                                                                                           | Responde `Status-Server` en el 1812                         |
| `backup`                                                                                                                               | El último intento de respaldo no falló                      |

Los registros de `api`, `aaa` y `coa` son JSON de una línea. Cada petición a la API lleva un `request_id` (cabecera `X-Request-Id` de la respuesta), el mismo que queda en la bitácora de la acción: con él se encuentra todo lo que hizo esa petición.

## 3. Métricas para tu Prometheus

La API publica métricas en formato Prometheus en `GET /metrics`, con `Authorization: Bearer <METRICS_TOKEN>`. El instalador genera `METRICS_TOKEN` en `/opt/argosisp/.env`; vacío, `/metrics` responde 404 (apagado); con otro token, 401.

En un servidor instalado se llega por el dominio de la API:

```sh
TOKEN=$(sudo grep ^METRICS_TOKEN= /opt/argosisp/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $TOKEN" https://api.<tu-dominio>/metrics | head
```

| Métrica                                                                                                  | Qué dice                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `argosisp_cola_trabajos{cola,estado}`                                                                    | Trabajos de cada cola (envíos de notificaciones, crons de facturación y notificaciones, accounting de RADIUS, RouterOS) por estado  |
| `argosisp_eventos_lag{grupo}`, `argosisp_eventos_pendientes{grupo}`, `argosisp_eventos_stream_longitud`  | Eventos que cada consumidor todavía no leyó o no confirmó                                                                           |
| `argosisp_outbox_sin_publicar`                                                                           | Eventos guardados que el `relay` aún no publicó (si crece, el `relay` está detenido)                                                |
| `argosisp_cron_ultima_ejecucion_timestamp_seconds{cron}`                                                 | Última corrida correcta de cada proceso automático (facturas, vencimientos, corte, lealtad, recordatorios, vigilancia, particiones) |
| `argosisp_incidentes_abiertos{tipo}`                                                                     | Alertas del sistema abiertas ahora                                                                                                  |
| `argosisp_routeros_colas_simples{router_id,router}` y `argosisp_routeros_colas_leidas_timestamp_seconds` | Colas simples de cada router y cuándo se contaron                                                                                   |
| `argosisp_metricas_error{seccion}`                                                                       | 1 si una parte de las métricas no se pudo leer (Postgres o Redis)                                                                   |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_start_time_seconds`                  | Memoria y arranque del proceso de la API                                                                                            |

`aaa` y `coa` también publican `/metrics` (autorizaciones por segundo y latencia de RADIUS, envíos de CoA, consumidor activo), pero en un servidor instalado no salen a internet: solo se leen desde la red interna de Docker.

### Reglas de alerta de referencia

El repositorio trae la configuración que se usa en desarrollo y laboratorio: [`infra/monitoring/prometheus.yml`](../../infra/monitoring/prometheus.yml), las reglas [`infra/monitoring/reglas.yml`](../../infra/monitoring/reglas.yml) (con pruebas en `reglas.test.yml`) y Alertmanager con Telegram en [`infra/monitoring/alertmanager/`](../../infra/monitoring/alertmanager/). Puedes usarlas en tu Prometheus:

| Alerta                                                                                                                                 | Condición                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ApiSinMetricas`                                                                                                                       | La API no responde `/metrics` durante 2 min                                  |
| `SeccionDeMetricasFallando`                                                                                                            | Una sección de métricas falla 5 min                                          |
| `ColaAtascada`                                                                                                                         | Más de 500 trabajos esperando en una cola durante 10 min                     |
| `TrabajosFallidos`                                                                                                                     | Más de 20 trabajos fallidos en 30 min                                        |
| `GrupoDeEventosAtrasado`                                                                                                               | Un consumidor con más de 1000 eventos sin leer o 100 sin confirmar, 5 min    |
| `OutboxSinPublicar`                                                                                                                    | Más de 100 eventos sin publicar, 5 min                                       |
| `CronDeFacturacionAtrasado`                                                                                                            | Facturas o vencimientos sin correr en más de 2 h                             |
| `CronDeLealtadAtrasado`                                                                                                                | Procesos diarios de lealtad sin correr en más de 25 h                        |
| `CronDeNotifyAtrasado`                                                                                                                 | Recordatorios o vigilancia sin correr en más de 15 min (¿`worker` detenido?) |
| `RouterDemasiadasColasSimples`                                                                                                         | Un router con más de 1000 colas simples durante 15 min: pasarlo a árbol PCQ  |
| `RouterColasSinLeer`                                                                                                                   | Más de 1 h sin contar las colas de un router                                 |
| `ServicioSinMetricas`, `AaaSinRedis`, `AaaDegradado`, `AaaEspejoViejo`, `AaaLatenciaAlta`, `CoaConsumidorInactivo`, `NasSinAccounting` | RADIUS y CoA: [RADIUS caído](./aaa-caido.md) dice qué hacer con cada una     |

Alertmanager manda estas alertas directo a Telegram (mismo bot y chat del equipo), sin pasar por la API: así avisa aunque la API o Redis estén caídos. Agrupa por alerta, repite cada 4 h y avisa cuando se resuelve.

## 4. Con el compose de desarrollo o laboratorio

```sh
# infra/.env: METRICS_TOKEN, TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_EQUIPO
COMPOSE_PROFILES=monitoreo docker compose -f infra/docker-compose.yml up -d prometheus alertmanager
# Prometheus: http://127.0.0.1:9090 · Alertmanager: http://127.0.0.1:9093

# Alerta de prueba (llega al chat en unos 10 s)
docker compose -f infra/docker-compose.yml exec alertmanager amtool alert add AlertaDePrueba \
    severity=prueba --annotation=summary='Prueba del equipo' --alertmanager.url=http://127.0.0.1:9093

# Silenciar una alerta durante un mantenimiento (2 h)
docker compose -f infra/docker-compose.yml exec alertmanager amtool silence add alertname=ApiSinMetricas \
    --duration=2h --comment='mantenimiento' --alertmanager.url=http://127.0.0.1:9093
```

Detalle técnico: [`infra/monitoring/README.md`](../../infra/monitoring/README.md) y [`apps/api/app/monitoreo/README.md`](../../apps/api/app/monitoreo/README.md).

## Versión instalada

`GET /api/v1/version` (con sesión iniciada) devuelve la versión, el commit, la fecha de compilación y qué cambió en esa versión. `sudo argosisp estado` muestra lo mismo y la última publicada.
