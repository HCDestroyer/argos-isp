# monitoreo · métricas, salud, registro y almacenamiento (A6)

`GET /metrics` en formato de texto de Prometheus (0.0.4). Fuera de `/api/v1` y del OpenAPI, como `/health`. No es una acción de dominio: solo lee, no audita ni emite eventos.

- **Acceso.** `Authorization: Bearer <METRICS_TOKEN>`. Sin `METRICS_TOKEN` responde 404 (apagado); con otro token, 401.
- **Sin estado en memoria.** Todo se lee en el scrape (Redis y Postgres), así varias réplicas de la API dicen lo mismo y no hay contadores que se pierdan al reiniciar. Sin dependencias nuevas (el formato lo arma `prometheus.ts`).
- **Una sección que falla no tumba las demás**: queda `argosisp_metricas_error{seccion}` en 1.
- **Secciones de otros módulos**: `registrarSeccionMetricas(nombre, leer)` (A2 registra `routeros` desde `start/routes/network.ts`). En pruebas, quien reemplace una sección real la guarda con `seccionMetricas(nombre)` y la devuelve al terminar (`tests/monitoreo/metricas.spec.ts` lo hace en cada prueba y en el teardown del grupo); `quitarSeccionMetricas` la borra para el resto de la corrida.

| Métrica                                                                                   | Etiquetas        | Fuente                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argosisp_cola_trabajos`                                                                  | `cola`, `estado` | `getJobCounts` de `notify-envios`, `notify-cron`, `billing-cron`, `aaa-accounting`, `routeros-cron`, `routeros-prefijos` (prefijo `COLAS_PREFIJO`)                                                                                                                                            |
| `argosisp_eventos_stream_longitud`, `argosisp_eventos_lag`, `argosisp_eventos_pendientes` | `grupo`          | `XLEN` y `XINFO GROUPS` de `argos:eventos`: lag = entradas que el grupo aún no leyó; pendientes = entregadas sin `XACK`                                                                                                                                                                       |
| `argosisp_outbox_sin_publicar`                                                            |                  | `audit.outbox` con `publicado_en` nulo (relay detenido)                                                                                                                                                                                                                                       |
| `argosisp_cron_ultima_ejecucion_timestamp_seconds`                                        | `cron`           | última fila `ok` con canal `cron` en `audit.acciones` de `facturas.generar`, `facturas.vencer_pendientes`, `servicios.corte`, `lealtad.otorgar_antiguedad`, `lealtad.vencer`, `notificaciones.recordatorios`, `notificaciones.vigilar_crons`, `auditoria.crear_particiones` (últimos 40 días) |
| `argosisp_incidentes_abiertos`                                                            | `tipo`           | `notify.incidentes` abiertos (alertas internas)                                                                                                                                                                                                                                               |
| `argosisp_metricas_error`                                                                 | `seccion`        | 1 si la sección falló en este scrape                                                                                                                                                                                                                                                          |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_start_time_seconds`   |                  | proceso de la API                                                                                                                                                                                                                                                                             |

Prometheus, reglas de alerta y el servicio del compose: `infra/monitoring/README.md`. Pruebas: `tests/monitoreo/metricas.spec.ts`.

## Versión instalada · `GET /api/v1/version` (distribución)

`version.ts` + `esquemas.ts`, ruta en `start/routes/monitoreo.ts`. Cualquier usuario con sesión (sin permiso del ACL, como `/me`); no audita ni emite eventos.

- `version`, `commit`, `compilada`: `ARGOSISP_VERSION`, `ARGOSISP_COMMIT` y `ARGOSISP_COMPILADA` que pone la imagen (`ARG` de los Dockerfiles, `.github/workflows/imagenes.yml`). Fuera de una imagen publicada, `desarrollo` y null.
- `notas_url`: `https://github.com/HCDestroyer/argos-isp/releases/tag/v<versión>` (`ARGOSISP_REPO_URL` cambia el repositorio); null en desarrollo.
- `cambios`: la sección de la versión en el `CHANGELOG.md` que la imagen trae en `/app/CHANGELOG.md` (en desarrollo, el de la raíz del monorepo; `ARGOSISP_CHANGELOG` cambia la ruta), en Markdown. Se lee una vez por proceso.

Pruebas: `tests/monitoreo/version.spec.ts`. Distribución completa: `infra/produccion/README.md`.

## Salud del sistema · `GET /api/v1/sistema/salud` (`salud.ts`)

Permiso `sistema.ver_salud` (admin). Contrato `.claude/integration/contratos/salud.md` §2. Solo lee: no audita ni emite eventos; se calcula al pedirla (sin caché). Cada chequeo corre en paralelo con 1 s de límite (`conTimeout`); uno que falla o no contesta sale `caido` o `desconocido`, nunca 500. Componentes: API, PostgreSQL (latencia, conexiones), Redis (`PING`), cada cola BullMQ (fallidos de la última hora), outbox (pendientes y antigüedad), RADIUS (último `aaa.caido`/`aaa.recuperado` por nodo), CoA (`coa.fallido` recientes), routers (`network.routers_contacto`), crons de facturación, vencimiento y corte (`ultimaCorrida` de `metricas.ts`), respaldos (`BACKUP_DIR`), CPU, memoria y disco (≥ 80 % usado degradado, ≥ 95 % caído). Las pruebas simulan Redis caído y el disco lleno con `fijarFuentesSalud` y `fijarEspacioVolumen`.

## Registro del sistema · `GET /api/v1/sistema/registro` (`registro.ts`)

Permiso `sistema.ver_registro` (admin). Contrato §3. Paginación por cursor (`{ data, nextCursor }`) sobre la unión de: errores de `audit.acciones`, `audit.red` con `ok = false`, eventos `coa.fallido`, `routeros.fallido`, `aaa.caido`, `aaa.recuperado`, `libro.integridad_rota` y `libro.proceso_bloqueado` del outbox, mediciones de almacenamiento con el disco en aviso y jobs fallidos de BullMQ (hasta 200 por cola; sin Redis, la página sale sin ellos). Orden por (microsegundos, id) con cursor estable. El texto libre pasa por `enmascararTexto` (pares `clave=valor` sensibles y tokens `atk_`/`oat_`/`argn_`/Bearer como `***`); nunca se devuelve la entrada ni el comando completos.

## Almacenamiento · `GET /api/v1/sistema/almacenamiento` (`almacenamiento.ts`)

Permisos `sistema.ver_almacenamiento` y `sistema.recalcular_almacenamiento` (admin). Contrato §6. El GET devuelve los volúmenes leídos en el momento y la última medición de `core.almacenamiento_mediciones`. La acción `RecalcularAlmacenamiento` (`POST /sistema/almacenamiento/recalcular` y cron diario `almacenamiento` en la cola `notify-cron` de `notify:worker`, `cron_almacenamiento.ts`) recorre las carpetas de `COMPROBANTES_DIR` (comprobantes, logos, anuncios, inventario, libros, sorteos) y `BACKUP_DIR` con presupuesto de tiempo (15 s el botón, 5 min el cron; lo que no alcance queda `parcial`), mide la base (`pg_database_size`, por schema y las 10 tablas mayores con `pg_total_relation_size`, particiones sumadas a su raíz) y Redis (`INFO memory`), toma un advisory lock (409 `calculo_en_curso`) y guarda una fila. **Nunca borra nada.** Una medición con el disco en aviso aparece en el registro del sistema.

| Acción                     | Permiso                             | Eventos |
| -------------------------- | ----------------------------------- | ------- |
| `RecalcularAlmacenamiento` | `sistema.recalcular_almacenamiento` | —       |

Pruebas: `tests/monitoreo/salud.spec.ts`, `registro.spec.ts`, `almacenamiento.spec.ts`.
