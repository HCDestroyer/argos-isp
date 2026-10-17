# integraciones/horus · Conector con Horus Flow (A6)

Argos lee de Horus consumo, salud y seguridad de sus servicios, le avisa por webhooks firmados
los cambios de identidad (IPs, sesiones, estado) y recibe sus hallazgos y alertas. Contrato
compartido: `.claude/integration/contratos/horus.md` (1.2.0-propuesta, ADR-0030). Runbook:
`docs/runbooks/conectar-horus.md`.

## Reglas

- **Argos funciona completo sin Horus.** El conector viene **apagado**; sin él no hay llamadas, no
  se registran webhooks y el receptor responde 503. Nada de AAA, facturación, corte ni portal
  llama a este módulo.
- **Horus no decide cortes.** Ningún evento de Horus cambia el estado de un servicio: solo produce
  eventos `horus.*` (avisos y línea de tiempo).
- **Degradación.** Si Horus no responde se muestra el último dato conocido (`integraciones.horus_datos`,
  una tabla, no una caché con TTL) con `stale: true`, `actualizado_en` y `error`. Cada fallo
  transitorio pausa las llamadas `15 s × 2^(n−1)`, máx. 15 min (`integraciones.horus_salud`).
- **Secretos** (`hf_pat_`, secreto del receptor de Horus, secreto del receptor de Argos) cifrados
  con `app/shared/cifrado.ts`; salen como `***` en la API y en la auditoría.
- **Configuración desde el panel.** Solo `HORUS_PERMITIR_HTTP` (laboratorio: permite `http://`) y
  `API_PUBLIC_URL` (URL pública de la API) son de entorno.
- **Recarga sin TTL.** Cada proceso guarda la configuración en memoria; `horus.config_cambiada`
  (grupo `horus`) y Pub/Sub `<COLAS_PREFIJO>:horus:config` la invalidan.

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `configuracion.ts` | Fila única del conector, caché por proceso e invalidación |
| `cliente.ts` | HTTP a Horus: Bearer `hf_pat_`, timeout 4 s, espera exponencial compartida |
| `consultas.ts` | Consulta 360 (§3.1, por `external_service_id` y si no por la IP actual), consumo (§3.2), seguridad por lotes (§3.5 o alternativa) |
| `envios.ts`, `consumidor.ts` | Webhooks Argos → Horus: grupo `horus`, tabla `horus_envios`, reintentos 1 min, 5 min, 30 min, 2 h, 12 h |
| `receptor.ts`, `actions/recibir_webhook_horus.ts` | Webhooks Horus → Argos: firma, desfase ±5 min, dedupe por `id`, eventos `horus.*` |
| `actions/generar_enlace_horus.ts`, `actions/canjear_enlace_horus.ts`, `actions/conectar_con_enlace_horus.ts` | Enlace de conexión (§1.4) en los dos sentidos |
| `actions/abrir_en_horus.ts` | "Ver en Horus" (§1.5, lado emisor): ticket pedido por el servidor |
| `token_argos.ts` | Token `atk_` del canje: `GenerarTokenHorus` y `RevocarTokenHorus` de A1, anidadas (cada canje revoca el anterior) |
| `firma.ts` | HMAC-SHA256 `v1=` de `timestamp + "." + cuerpo` |

## Acciones y permisos

| Acción | Permiso de la ruta | Ruta |
| --- | --- | --- |
| `horus.configurar` | `horus.configurar` | `PUT /integraciones/horus` |
| `horus.probar` | `horus.probar` | `POST /integraciones/horus/probar` |
| `horus.generar_enlace` | `horus.configurar` | `POST /integraciones/horus/enlace` |
| `horus.conectar_enlace` | `horus.configurar` | `POST /integraciones/horus/conexion/conectar` |
| `horus.canjear_enlace` | público (código del enlace) | `POST /integraciones/horus/conexion/canjear` |
| `horus.abrir` | `horus.abrir` | `POST /integraciones/horus/abrir` |
| `horus.recibir_webhook` | público (firma HMAC) | `POST /integraciones/horus/webhook` |

Lecturas (`horus.ver`): `GET /integraciones/horus`, `GET /integraciones/horus/envios`,
`GET /integraciones/horus/recibidos`, `GET /servicios/:id/horus`, `GET /servicios/:id/horus/consumo`,
`POST /integraciones/horus/consumo`, `POST /integraciones/horus/seguridad`. Revisan el acceso al
servicio (alcance y empresa).

`GET /integraciones/horus/estado` (`horus.abrir`, sin `horus.ver`): `{ activo, reintentar_en }`
para deshabilitar "Ver en Horus"; sin URL, ids ni secretos. El conector es uno por instalación,
así que es igual para toda empresa. No llama a Horus.

### Enlace de conexión y página del panel

El enlace `<API_PUBLIC_URL>/conectar#<código>` queda en el host de la API porque Horus canjea en
`<host del enlace>/api/v1/integraciones/horus/conexion/canjear` (§1.4). Quien lo abre en el
navegador recibe `GET /conectar` → 302 a `<PANEL_URL_PUBLICA>/conectar` (el fragmento no llega al
servidor y el navegador lo conserva), la página del panel que explica que se pega en Horus.

### Espera exponencial en los errores

Con Horus en pausa, `detail` (502 de `abrir`) y `error` (lecturas) dicen la hora en
`America/Guatemala` ("se reintenta después de las 17/10/2026 14:33 (hora de Guatemala)") y el
instante va aparte en `reintentar_en` (ISO UTC): extensión del problem+json de `horus_error` (declarada en el schema común `Problem`) y
campo de `Horus360Servicio`, `ConsumoHorus` y `SeguridadHorus` (null sin pausa).

### `Horus360Servicio.datos`

La respuesta de §3.1 tal cual. El esquema declara `security` (`state`, `open_findings`,
`findings[]` con `id`, `kind`, `severity`, `opened_at`, `summary`) y `meta` (`at`, `omitted`), todo
opcional y abierto a campos nuevos; el resto (`customer`, `external`, `consumption`, `health`)
llega sin tipar. `meta.omitted` es siempre una lista `[{ block, reason }]` (vacía si no se omitió
nada; `block`: `consumption`, `health` o `security`), como fija el contrato.

## Eventos

- **Emite:** `horus.config_cambiada` (`activo`, `campos[]`), `horus.hallazgo_abierto`,
  `horus.hallazgo_resuelto`, `horus.estado_seguridad_cambiado`, `horus.router_estado_cambiado`,
  `horus.servicio_infra_cambiado` (payloads en `app/shared/eventos.ts` y `contratos/eventos.md`).
- **Consume (grupo `horus`):** `asignacion.cambiada`, `sesion.iniciada`, `sesion.terminada`,
  `cliente.actualizado` (A1), `servicio.estado_cambiado` → webhooks a Horus; `horus.config_cambiada`.
- **notify** (grupo `notify`, `ConsumidorAlertas`): alerta al chat del equipo por hallazgos `high`
  o `critical` (con la configuración de la empresa del servicio), routers y servicios de
  infraestructura caídos, y su recuperación.

## Procesos

`node ace horus:worker` (servicio `horus-worker` del compose): grupo `horus` y entrega de los
webhooks pendientes cada 5 s. La API solo escucha las invalidaciones.
