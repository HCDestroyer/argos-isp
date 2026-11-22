# integraciones/equipos · equipos del cliente (A6)

Contrato Iris 0.9.0 §12 (bloque E): aprovisionar (A32), estado del equipo (A33) y cambio de Wi-Fi
(A35). Decisión del PM (21 nov 2026): **SmartOLT** para la fibra (ONU/ONT) y **GenieACS** (TR-069,
servidor propio) para configurar routers, CPE y Wi-Fi. Iris nunca ve credenciales de ninguno.

## Configuración por empresa

| Ruta                                 | Permiso              | Qué hace                                                                                                                                                           |
| ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /integraciones/equipos`         | `equipos.ver`        | Configuración de la empresa activa; token y clave como `***`                                                                                                       |
| `PUT /integraciones/equipos`         | `equipos.configurar` | URL y token de SmartOLT; URL, usuario y clave de GenieACS; `pppoe_por_acs`; `perfiles[]` (OLT de SmartOLT + plan → `authorization_preset_id`). Con `version` (409) |
| `POST /integraciones/equipos/probar` | `equipos.probar`     | Prueba los dos con lo guardado y guarda el resultado (devuelve las OLT)                                                                                            |

- Tabla `integraciones.equipos_config` (una fila por empresa). Secretos cifrados con `#shared/cifrado`
  (`AAA_PPP_KEY`); nunca salen en respuestas, auditoría (`***`), `audit.red` ni logs.
- **Capacidad = encendida + probada.** `capacidades.aprovisionamiento` (§4.3, canje y
  `GET /integraciones/iris/estado`): `ftth` con SmartOLT probado, `tr069` con GenieACS probado,
  `wireless` con cualquiera de los dos. Cambiar URL o secreto borra la prueba.
- Solo `https://`; `http://` con `EQUIPOS_PERMITIR_HTTP=true` (laboratorio).
- **GenieACS va en otro servidor** (decisión del PM): su NBI detrás de un proxy con HTTPS, autenticación
  básica y lista de IP (`infra/genieacs/`). Argos manda `Authorization: Basic` con el usuario y la clave
  de la empresa y, si el certificado del proxy es de una autoridad propia, confía en el certificado raíz
  guardado en `genieacs_ca` (PEM, solo para ese ACS). Errores claros en «Probar conexión»: clave mala
  (401), IP no permitida (403) y certificado inválido (autofirmado, vencido, de otro nombre; no se
  reintenta ni se mandan credenciales).
- **Un ACS y un SmartOLT por empresa**, nada global: cada servicio usa los de su empresa y el equipo
  gestionado guardado solo vale para la empresa con la que se registró (si el servicio cambia de
  empresa, se vuelve a descubrir).

## Rutas del contrato

| Ruta                               | Permiso                  | Qué hace                                                                                                                                                         |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /servicios/:id/aprovisionar` | `servicios.aprovisionar` | Valida y acepta (`202 { aprovisionamiento_id, estado: en_proceso }`); repetir la clave ya terminada da `200` con el estado final (`releerRepeticion` de la ruta) |
| `GET /aprovisionamientos/:id`      | `servicios.aprovisionar` | Estado, `pasos[]` (`ip`, `equipo`, `wifi`, `activacion`), `causa`, `reintentable`, `detalle`, `equipo`, `senal`                                                  |
| `GET /servicios/:id/equipo`        | `servicios.ver_equipo`   | Estado en vivo (SmartOLT + GenieACS), lectura de menos de 60 s guardada; asistente: solo lo que permite §12.3                                                    |
| `POST /servicios/:id/wifi`         | `servicios.cambiar_wifi` | Valida, verifica al titular, tope 3 por día, acepta (`202 { solicitud_id }`)                                                                                     |

Errores: `409 servicio_no_pendiente`, `409 aprovisionamiento_en_curso` (`extensions.aprovisionamiento_id` e
`iniciado_por`), `422 capacidad_no_disponible` (0.14.3),
`409 unidad_en_otra_bodega` (simulando el comodato), `422 equipo_invalido`, `422 wifi_invalido`,
`422 wifi_no_disponible`, `422 aprovisionamiento_no_disponible`, `422 plan_no_permitido`,
`409 equipo_sin_gestion` (con `extensions.equipos[]` del inventario en A33, salvo al asistente),
`503 equipo_sin_respuesta`, `422 verificacion_requerida`, `429 demasiados_cambios_wifi` (`Retry-After`
hasta la medianoche de Guatemala).

## Contrato Iris 0.14.3 (`capacidades.ts`)

Solo con el token de Iris y un conector con contrato ≥ 0.14.3 (con uno anterior, todo como en la 0.14.2):

- **`capacidades.equipos[]`** en el canje y en `GET /integraciones/iris/estado`: una fila por empresa del
  token `{ empresa_id, estado_equipo, wifi, bienvenida, cobro_equipo }` (con Iris < 0.9.0, todas en false).
  `estado_equipo` = SmartOLT o GenieACS probados; `wifi` = GenieACS probado; `bienvenida` = aviso de
  bienvenida encendido y un canal con plantilla activa y configurado (también decide si notify pide
  `bienvenida_servicio` con `origen` o `bienvenida`); `cobro_equipo` = el concepto con
  `codigo_sistema = 'instalacion'` activo (columna de A3).
- **Orden**: alcance (`exigirServicioIris`: servicio de otra empresa = el 404 de uno que no existe),
  capacidad (`422 capacidad_no_disponible`, sin `extensions` ni datos de SmartOLT o del ACS) y después
  los errores de la ruta. Antes de todo eso corre el middleware de idempotencia: una clave guardada con
  la misma huella devuelve su `2xx` original aunque la marca ya esté en false, y una en curso
  `409 idempotencia_en_curso`; un `4xx` (también el `422`) no guarda la clave. Lo aplican `GET …/equipo`, `POST …/wifi`, el `wifi` de `aprovisionar`,
  `…/bienvenida/reenviar` y, en `cargo-unico`, solo las líneas del concepto de instalación.
- **Unidad del aprovisionamiento** (§12.2): se busca por `unidad_id`, `serie` o `mac` en todo el
  inventario. Con `tecnico`, vínculo I1 en la empresa (`403 actor_desconocido`) y la unidad en su bodega
  personal o de cuadrilla (se guarda en `bodega_id` y el comodato sale de ahí al activar, sin volver a
  mirar el actor: con la orden cerrada lo pide un agente) o ya asignada al servicio; sin `tecnico`, ya
  asignada. Otro lugar, también otra empresa: `409 unidad_en_otra_bodega` sin decir dónde.
- **Ajeno**: lo que pide el panel de Argos queda con `origen_tipo: argos_panel` y `origen_id: null`; el
  `409 aprovisionamiento_en_curso` lleva `iniciado_por` (`argos` | `iris`); `GET /aprovisionamientos/:id`
  suma `iniciado_por` y al token de Iris le recorta uno que no inició Iris; nunca `instalacion.*` a Iris
  de un `argos_panel`. Un comodato de Iris de una unidad ya en comodato en ese servicio responde como
  hecho (`inventario.asignar_comodato`), sin movimiento.

## Flujo asíncrono (`node ace equipos:worker`, cola BullMQ `equipos`)

```
servicios.aprovisionar ──▶ integraciones.aprovisionamientos (en_proceso, Wi-Fi cifrado)
        │ job aprovisionar (lock por id)       │ cron `pendientes` cada 30 s (reintentos, Redis perdido)
        ▼
equipos.preparar_aprovisionamiento: ONT en SmartOLT (por serie, perfil de su OLT y plan) y
        PPPoE / Wi-Fi por GenieACS (TR-098 o TR-181)        ── transitorio → reintenta 30 s, 1, 2, 4 min
        ▼
equipos.activar_aprovisionamiento: comodato + servicios.activar_instalacion (IP, activo, cobro)
        │ listo → instalacion.aprovisionada          error de negocio → equipos.fallar_aprovisionamiento
        ▼                                                          → instalacion.fallida
servicios.cambiar_wifi ──▶ integraciones.wifi_solicitudes ──▶ equipos.aplicar_wifi ──▶ equipo.wifi_resuelto
```

- Cada llamada a SmartOLT o GenieACS queda en `audit.red` (tipo `smartolt` o `genieacs`) con la
  respuesta del equipo, sin secretos (`limpiarSecretos` en `http.ts`).
- Timeouts y reintentos acotados (`http.ts`): lecturas con 2 reintentos (0,5 s, 1 s); autorizar una ONT
  y las tareas TR-069 sin reintento automático (el siguiente intento del pedido primero revisa si ya
  quedó hecho: ONU ya autorizada con `argos<servicio_id>`).
- Una tarea TR-069 que el equipo no ejecutó en la sesión se **borra** del ACS (`DELETE /tasks/:id`):
  nunca se aplica sola después de que Argos dijo «fallido».
- El SSID y la clave del Wi-Fi viven cifrados en la fila solo mientras está `en_proceso`.
- **Varias instancias de `equipos-worker`** (crecimiento horizontal): BullMQ reparte los jobs y el advisory
  lock de Postgres por pedido (`LOCK_EQUIPOS`/`LOCK_WIFI` + id) hace que solo una trabaje cada pedido;
  la otra lo omite. Además cada acción bloquea la fila del pedido (`FOR UPDATE`) y no hace nada si ya
  no está `en_proceso`.

## Eventos

**Emite** (por outbox): `instalacion.aprovisionada`, `instalacion.fallida`, `equipo.wifi_resuelto`
(payloads en `contratos/eventos.md`; a Iris con contrato ≥ 0.9.0, salvo los de `origen_tipo: argos_panel`). La activación emite además los de
siempre (`servicio.estado_cambiado`, `asignacion.cambiada`, `inventario.comodato_asignado`…).
**Consume**: nada. notify consume `equipo.wifi_resuelto` (`aplicado` → aviso al titular
`equipo.wifi_cambiado`).

## De dónde sale cada llamada (sin inventar endpoints)

**SmartOLT** — especificación oficial `https://www.smartolt.com/openapi.json` (OpenAPI 3.0.3 «SmartOLT
API 1.0», enlazada desde `https://api.smartolt.com`). Base `https://<subdominio>.smartolt.com`,
cabecera `X-Token`, cuerpos `application/x-www-form-urlencoded`, respuesta `{ status, response | error,
error_code }`.

| Uso                  | Ruta                                                                                                                                                                 | Verificado                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Probar               | `GET /api/system/get_olts`                                                                                                                                           | en la especificación (la doc pide no usarla como latido: solo a pedido) |
| Buscar ONU por serie | `GET /api/onu/unconfigured_onus?sn=`                                                                                                                                 | especificación                                                          |
| ¿Ya autorizada?      | `GET /api/onu/get_onus_details_by_sn/{sn}`                                                                                                                           | especificación                                                          |
| Autorizar            | `POST /api/onu/authorize_onu` (`olt_id`, `pon_type`, `sn`, `board`, `port`, `authorization_preset_id`, `onu_external_id`; `onu_type` si responde `specify_onu_type`) | especificación                                                          |
| Estado               | `GET /api/onu/get_onu_status/{onu_external_id}`                                                                                                                      | especificación                                                          |
| Señal                | `GET /api/onu/get_onu_signal/{onu_external_id}` (`onu_signal_1490` → `rx_dbm`, `onu_signal_1310` → `tx_dbm`)                                                         | especificación; el mapeo de `tx_dbm` está por confirmar                 |

**GenieACS** — `https://docs.genieacs.com/en/latest/api-reference.html` (NBI, puerto 7557),
`environment-variables.html` y `virtual-parameters.html`, más el código del NBI
(`lib/nbi.ts`, `lib/db/synth.ts`, `lib/cwmp/db.ts` de `genieacs/genieacs`).

| Uso             | Ruta o parámetro                                                                                                                       | Verificado                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Probar / buscar | `GET /devices/?query=<JSON>&projection=&limit=`                                                                                        | referencia del API; `limit` en `lib/nbi.ts`                                                                             |
| Por serie       | `query {"_deviceId._SerialNumber": …}`                                                                                                 | `DeviceID.SerialNumber` ↔ `_deviceId._SerialNumber` en `lib/db/synth.ts`                                                |
| Por MAC         | `…WANIPConnection.1.MACAddress` (ejemplo de la referencia), `…WANPPPConnection.1.MACAddress`, `Device.Ethernet.Interface.1.MACAddress` | solo la primera está en la doc                                                                                          |
| Tarea           | `POST /devices/<id>/tasks?connection_request&timeout=<ms>` con `setParameterValues`                                                    | referencia; `200` aplicada, `202` «Task queued but not processed» o «Task faulted» en `lib/nbi.ts`                      |
| Limpiar         | `DELETE /tasks/<id>`, `DELETE /faults/<device>:task_<id>`                                                                              | referencia y `lib/nbi.ts`                                                                                               |
| Wi-Fi TR-098    | `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID` y `.KeyPassphrase`                                                        | referencia y `virtual-parameters.html`                                                                                  |
| Wi-Fi TR-181    | `Device.WiFi.SSID.1.SSID` y `Device.WiFi.AccessPoint.1.Security.KeyPassphrase`                                                         | la clave en `virtual-parameters.html`; el SSID es del modelo TR-181 (Broadband Forum), **pendiente** con equipos reales |
| PPPoE           | `…WANPPPConnection.1.Username/Password` (TR-098), `Device.PPP.Interface.1.Username/Password` (TR-181)                                  | modelo de datos BBF, **pendiente** con equipos reales                                                                   |
| Autenticación   | El NBI **no tiene**; Argos manda `Authorization: Basic` si la empresa guarda usuario y clave (proxy delante)                           | `environment-variables.html` (`NBI_INTERFACE`)                                                                          |

**Pendientes:** solo la primera red Wi-Fi (índice 1; una segunda banda de 5 GHz no se toca);
confirmar con equipos reales el formato de la serie de la ONT en el ACS (puede diferir del SN de
SmartOLT); la tecnología del servicio no se compara con `equipo.tipo` (Argos no la guarda); un equipo
viejo que no pasó por A32 se descubre por la serie o MAC de su comodato, sin pantalla para vincularlo
a mano.

Pruebas: `tests/integraciones/equipos_acs_aparte.spec.ts` (NBI por HTTPS con autenticación básica y
certificados generados con `openssl`, un ACS por empresa, dos workers sobre la misma cola),
`tests/integraciones/equipos_smartolt_genieacs.spec.ts` (SmartOLT y GenieACS simulados con
servidores HTTP locales, `equipos_simulado.ts`) y `tests/integraciones/iris_equipos_090.spec.ts`
(empresa sin integraciones).
