# Contrato · Equipos: SmartOLT multi-instancia y ACS por separado

Dueño: **A6** (`apps/api/app/integraciones/equipos/`). Lo consumen **A4** (panel: Configuración › Integraciones), **A1** (red de acceso: `network.olts`) e Iris por el contrato de siempre (`contratos/iris.md` §4.3 y §12, que **no cambia**).

Estado: **versión 1 (25 nov 2026): análisis y plan. Nada de esto está implementado todavía.** La rama `agente/a6-olt-acs` solo trae este documento. Quien lo ejecute cambia el estado de cada lote aquí mismo, en la PR del lote.

Pedido del PM: «SmartOLT y ACS pueden estar separados, ya que ahora depende uno del otro; además SmartOLT, al ser el sistema multi agente, puede tener varias instancias/subdominios de SmartOLT y a su vez tener en cada uno varias OLTs».

---

## 1. Diagnóstico: qué está acoplado hoy

Código leído en `origin/main` 3d5d1221.

| # | Dónde | Acoplamiento | Efecto |
| --- | --- | --- | --- |
| D1 | `integraciones.equipos_config` (migración `1795283605195`) | Una fila por empresa con las columnas de SmartOLT y de GenieACS juntas, **un solo `activo`** y **una sola `version`** | No se puede apagar uno sin el otro. Guardar el ACS da 409 a quien edita SmartOLT al mismo tiempo |
| D2 | `actions/configurar_equipos.ts` (`equipos.configurar`) | Una acción y un `PUT /integraciones/equipos` para los dos. «Encender exige SmartOLT (URL y token) **o** GenieACS (URL)» | Se enciende «la integración» con uno solo completo; el otro queda encendido a medias |
| D3 | `actions/probar_equipos.ts` (`equipos.probar`) | Una acción prueba los dos y guarda los dos resultados | Probar el ACS gasta una llamada a `get_olts` de SmartOLT, que su documentación pide no usar como latido |
| D4 | `configuracion.ts` `gestionDe()` | `if (!config.activo) → todo false`; `wireless = ftth \|\| tr069` | Una empresa con solo SmartOLT probado informa `wireless: true`, que no tiene relación con SmartOLT. Una empresa sin ninguno informa `wireless: false` aunque un CPE sin TR-069 solo necesita IP y activación |
| D5 | `capacidades.ts` `marcasDeEmpresa()` | `estado_equipo = ftth \|\| tr069`, `wifi = tr069`, las dos detrás del `activo` compartido | Correcto como regla, pero depende de D1 y D4 |
| D6 | `actions/aprovisionar_servicio.ts` | `disponible` por tipo sale de `gestionDe`; `usaAcs = router_tr069 \|\| wifi \|\| (pppoePorAcs && tr069)` | `cpe_wireless` exige «cualquiera de los dos» (D4). `pppoe_por_acs` vive en la fila compartida |
| D7 | `actions/preparar_aprovisionamiento.ts` | `autorizarOnt()` usa `config.smartolt` (el único de la empresa) y `perfilesDeEmpresa(empresa_id)`; el perfil se busca por `onu.olt_id` | Con dos subdominios, el `olt_id` «1» existe en los dos: el perfil es ambiguo. No hay forma de elegir instancia |
| D8 | `equipos.ts` `descubrirEquipo()` y `estadoEquipo()` | Un SmartOLT y un ACS por empresa; `integraciones.equipos_servicio` guarda `smartolt_external_id` sin decir de qué instancia | Con varias instancias no se sabe a cuál preguntar por `argos<servicio_id>` |
| D9 | `integraciones.equipos_perfiles` | Clave `(empresa_id, smartolt_olt_id, plan_id)` | Mismo problema que D7 |
| D10 | Permisos `equipos.ver`, `equipos.configurar`, `equipos.probar` (`core/permisos.ts`) | Un permiso para los dos sistemas | No se puede dar el ACS a soporte sin dar el token de SmartOLT |
| D11 | Panel `ConfiguracionEquipos.vue`, `utils/equiposIntegracion.ts`, `useIntegracionesConfiguracion.ts` | Dos tarjetas (`?ver=smartolt`, `?ver=genieacs`) sobre el mismo recurso y la misma `version`; el interruptor dice «SmartOLT y GenieACS se encienden juntos» | Lo mismo que D1 a la vista del usuario |
| D12 | Red de acceso (`contratos/red-acceso.md`) | `network.olts` son «datos para ordenar y filtrar; Argos nunca habla con la OLT». No hay relación entre una OLT de Argos y una de SmartOLT | No se puede saber a qué instancia va un servicio |
| D13 | Cron `equipos.pendientes` (`monitoreo/crons/catalogo.ts`) | Un cron reintenta aprovisionamientos y cambios de Wi-Fi | Solo es de la cola: **no hay acoplamiento**. Cambia el texto y nada más |
| D14 | Manual (`docs/manual/integraciones/integraciones.md`), bitácora (`apps/web/app/utils/bitacora.ts`) | Textos «SmartOLT y GenieACS» juntos | Se reescriben |

No existe hoy un evento `equipos.config_cambiada`: `equipos.configurar` no emite nada (falta frente a la regla 3; ver §6).

Lo que **ya está bien** y se conserva: secretos cifrados con `#shared/cifrado` que nunca salen; cada llamada en `audit.red`; «capacidad = encendido + probado»; cambiar URL o secreto borra la prueba; `http://` solo con `EQUIPOS_PERMITIR_HTTP`; worker con varias copias y lock por pedido.

## 2. Qué dice la API de SmartOLT

Fuentes, leídas el 25 nov 2026:

- Especificación oficial OpenAPI 3.0.3 «SmartOLT API 1.0»: <https://www.smartolt.com/openapi.json>
- Documentación para personas: <https://api.smartolt.com/>

| Tema | Lo que dice la especificación |
| --- | --- |
| Un subdominio por cuenta | `servers: https://{subdomain}.smartolt.com` («Your SmartOLT subdomain»). «Send each request to `https://<your-subdomain>.smartolt.com/api/...`» |
| Credencial | Cabecera `X-Token` (`securitySchemes.ApiKeyAuth`). La clave se administra en **General > API key** de esa cuenta. Hay claves **restringidas** por zona: lo que queda fuera responde `403 forbidden` |
| Varias OLT por cuenta | `GET /api/system/get_olts` → `response[]: { id, name, olt_hardware_version, ip, telnet_port, snmp_port }`. «Do NOT use this endpoint as a heartbeat» |
| Puertos PON de una OLT | `GET /api/system/get_olt_pon_ports_details/{olt_id}` → `board`, `pon_port`, `pon_type`, estado, `onus_count`, `description` |
| Identidad de una ONU | `unique_external_id` (alfanumérico, **único en la cuenta**: «the ONU external ID is already existing») y `sn`. Argos usa `argos<servicio_id>` |
| Dónde está una ONU | `GET /api/onu/get_onu_details/{onu_external_id}` → `olt_id`, `olt_name`, `board`, `port`, `onu`, `sn`, `onu_type_name`, `tr069`, `wifi_ports[]`. Por serie: `GET /api/onu/get_onus_details_by_sn/{sn}` |
| ONU sin autorizar | `GET /api/onu/unconfigured_onus?sn=` («on all OLTs», búsqueda «contains») → `olt_id`, `pon_type`, `board`, `port`, `sn`, `onu_type_name`. Por OLT: `…/unconfigured_onus_for_olt/{olt_id}` |
| Perfiles de autorización | Son **de una OLT**: `GET /api/onu/get_authorization_presets?olt_id=` → `authorization_presets[]: { id, name, olt_id, is_default, criteria, applies }`. Solo se crean en la web de SmartOLT |
| Autorizar | `POST /api/onu/authorize_onu` con `olt_id`, `pon_type`, `sn`, `authorization_preset_id`, `board`, `port`, `onu_external_id` |
| Límites | **Por cuenta**: 1,000 llamadas por hora y 15 por segundo (429 con `Retry-After`) |
| Lo que SmartOLT hace sin ACS | `POST /api/onu/set_onu_wan_mode_pppoe/{id}` (usuario y clave PPPoE por OMCI o TR-069) y `POST /api/onu/set_wifi_port_lan/{id}` (`ssid`, `password`). Un perfil puede traer `sets_wan`, `sets_wifi`, `sets_tr069` |
| Eventos | Webhook o SSE por cuenta (`onu.status_changed`, `onu.unconfigured_detected`, `olt.outage_started`…), configurado en la clave de API |

Consecuencias para el diseño:

1. **La instancia es la unidad de configuración**: subdominio + token + su propio presupuesto de llamadas.
2. **El `olt_id` solo vale dentro de su instancia.** Toda referencia a una OLT de SmartOLT lleva la instancia.
3. **El id externo es único por cuenta, no entre cuentas.** `argos<servicio_id>` puede existir en dos instancias; hay que guardar en cuál.
4. **Los perfiles son por OLT**, así que cuelgan de la OLT de SmartOLT, no de la empresa.
5. `get_olts` sirve a la vez de prueba y de sincronización: una sola llamada, solo a pedido.

## 3. Modelo nuevo

```
core.empresas ─┬─ integraciones.acs_config            (0..1 por empresa: GenieACS)
               └─ integraciones.smartolt_instancias   (0..n por empresa; empresa_id null = compartida)
                        └─ integraciones.smartolt_olts        (las OLT que devuelve get_olts)
                                 ├─ olt_id → network.olts     (la OLT de la red de acceso de Argos, 0..1)
                                 └─ integraciones.equipos_perfiles (OLT + plan → preset)

core.servicios ── servidor_pppoe ── vlan ── puerto PON ── network.olts ── smartolt_olts ── instancia
```

### 3.1 `integraciones.smartolt_instancias`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | bigint identity PK | |
| `empresa_id` | bigint NULL → `core.empresas` | dueña; **null = compartida** entre las empresas de la instalación (igual que `network.olts`). Ver §3.6 |
| `nombre` | text NOT NULL | etiqueta en Argos («Zona norte»); único por empresa sin distinguir mayúsculas (409 `instancia_duplicada`) |
| `url` | text NOT NULL | `https://<subdominio>.smartolt.com` (`normalizarUrl(…, 'smartolt')`); **única en toda la instalación** (409 `subdominio_duplicado`): una cuenta, un token, un presupuesto de llamadas |
| `token_cifrado` | text NOT NULL | `cifrar()`; nunca sale (`***`) |
| `activo` | boolean NOT NULL DEFAULT false | |
| `probado_en`, `prueba_ok`, `prueba_error` | timestamptz, boolean, text NULL | cambiar `url` o token los borra |
| `olts_sincronizadas_en` | timestamptz NULL | |
| `version` | integer NOT NULL DEFAULT 1 | 409 `conflicto_version` |
| `created_at`, `updated_at` | timestamptz | |

**Operativa** = `activo` y `prueba_ok = true`.

### 3.2 `integraciones.smartolt_olts`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | bigint identity PK | |
| `instancia_id` | bigint NOT NULL → instancias, ON DELETE CASCADE | |
| `smartolt_olt_id` | text NOT NULL | el `id` de `get_olts`; UNIQUE `(instancia_id, smartolt_olt_id)` |
| `nombre`, `hardware`, `ip` | text NULL | de `get_olts` (`name`, `olt_hardware_version`, `ip`) |
| `olt_id` | bigint NULL → `network.olts`, ON DELETE SET NULL | la OLT de Argos. UNIQUE parcial `WHERE olt_id IS NOT NULL`: una OLT de Argos está en una sola OLT de SmartOLT |
| `presente` | boolean NOT NULL DEFAULT true | false si ya no vino en la última sincronización (no se borra: puede tener perfiles) |
| `origen` | text NOT NULL | `sincronizada` o `manual` (migrada de un perfil antes de la primera sincronización) |
| `sincronizada_en` | timestamptz NULL | |

### 3.3 `integraciones.equipos_perfiles` (cambia)

Hoy `(empresa_id, smartolt_olt_id text, plan_id, authorization_preset_id, pon_type)`. Queda `(smartolt_olt_ref_id bigint NOT NULL → smartolt_olts ON DELETE CASCADE, plan_id, authorization_preset_id, pon_type)` con UNIQUE `(smartolt_olt_ref_id, coalesce(plan_id, 0))`. Se quitan `empresa_id` y `smartolt_olt_id`.

### 3.4 `integraciones.acs_config`

Una fila por empresa (`empresa_id` PK): `activo`, `url`, `usuario`, `clave_cifrada`, `ca`, `probado_en`, `prueba_ok`, `prueba_error`, `pppoe_por_acs`, `version`, `created_at`, `updated_at`. Las mismas reglas de hoy para GenieACS.

**Recomendación: un ACS por empresa, sin instancias.** Razones: (1) un CPE tiene una sola URL de ACS de fábrica o por DHCP opción 43, así que la empresa reparte una; (2) GenieACS crece hacia los lados por dentro (varios `genieacs-cwmp` tras un balanceador y un solo NBI), que es lo que pide la regla 14; (3) el dispositivo se busca por serie o MAC en todo el ACS, sin necesidad de elegir. Dos empresas que usan el mismo servidor registran la misma URL cada una (no hay unicidad de URL en el ACS). Si algún día hay un ACS por región, se repite el patrón de §3.1.

### 3.5 Columnas nuevas en tablas existentes

- `integraciones.equipos_servicio.smartolt_instancia_id` bigint NULL → instancias, ON DELETE SET NULL.
- `integraciones.aprovisionamientos.smartolt_instancia_id`, igual.
- `equipoGestionado()` deja de exigir la misma `empresa_id` para la parte de SmartOLT cuando la instancia es compartida; para el ACS se conserva la regla de hoy (el `acs_device_id` solo vale en el ACS de la empresa con la que se guardó).

### 3.6 ¿Una instancia compartida entre empresas?

Propuesta: **sí, con `empresa_id` null, y solo quien tiene alcance global la crea o edita.** Justificación con la regla 13:

- La regla 13 exige `empresa_id` en «todo lo de un servicio y todo lo financiero». La instancia no es de un servicio ni mueve dinero: es infraestructura, como `network.olts`, `network.vlans` y los routers, que ya admiten `empresa_id` null = compartido (`contratos/red-acceso.md` §1).
- Una OLT física compartida (`network.olts.empresa_id` null) vive en una sola cuenta de SmartOLT. Si la instancia fuera de una sola empresa, los servicios de la otra en esa misma OLT no tendrían a quién pedir la autorización, o habría que guardar el mismo token dos veces y repartir entre dos filas el mismo presupuesto de 1,000 llamadas por hora.
- No hay choque de identificadores: `argos<servicio_id>` es único en la instalación.
- Lo de cada servicio sigue con su empresa: `equipos_servicio`, `aprovisionamientos`, `wifi_solicitudes` y `audit.red` llevan `empresa_id`.
- Riesgo: el token de una instancia compartida ve las ONU de todas las empresas de esa cuenta. Por eso solo se administra con alcance global y la lista de OLT que ve un usuario de una empresa se limita a las vinculadas a OLT de su empresa o compartidas.

Es decisión de negocio: **pregunta P1 para el PM** (§9). Si responde que no, se quita el null (CHECK `empresa_id IS NOT NULL`) y no cambia nada más.

### 3.7 Migración de datos (una migración, `node ace make:migration separar_smartolt_acs`)

En una sola transacción, idempotente, con `this.defer` para los datos:

1. Crea `smartolt_instancias`, `smartolt_olts`, `acs_config` y las dos columnas de §3.5.
2. Por cada fila de `equipos_config`:
   - **ACS**: si `genieacs_url` no es null o `pppoe_por_acs` es true → fila en `acs_config` con `activo = equipos_config.activo AND genieacs_url IS NOT NULL`, `url`, `usuario`, `clave_cifrada` (**el mismo texto cifrado, sin descifrar**), `ca`, la prueba completa (`probado_en`, `prueba_ok`, `prueba_error`), `pppoe_por_acs` y `version`.
   - **SmartOLT**: si `smartolt_url` y `smartolt_token_cifrado` no son null → una instancia con `empresa_id` de la fila, `nombre = 'SmartOLT'`, `url`, `token_cifrado` (mismo texto cifrado), `activo = equipos_config.activo`, la prueba completa y `version = 1`. Si dos empresas tenían la misma URL, la segunda **no** crea instancia: la primera pasa a `empresa_id = null` (compartida) y se deja una fila en `audit.acciones` (actor `sistema`, `request_id = 'migracion:<nombre>'`) que lo dice. Con P1 = no, en su lugar la migración falla con un mensaje claro.
   - Una fila con `smartolt_url` pero sin token (a medio configurar) no se puede migrar a `token_cifrado NOT NULL`: se anota en `audit.acciones` y se descarta la URL.
3. Por cada `smartolt_olt_id` distinto de `equipos_perfiles` de la empresa: fila en `smartolt_olts` (`origen = 'manual'`, `nombre = null`, `presente = true`) de su instancia; el perfil pasa a `smartolt_olt_ref_id`. Perfiles de una empresa sin instancia (no debería haber) se borran dejando su resumen en `audit.cambios`.
4. `equipos_servicio.smartolt_instancia_id` y `aprovisionamientos.smartolt_instancia_id` = la instancia de su `empresa_id` donde `smartolt_external_id IS NOT NULL`.
5. Permisos (§5): crea los nuevos, los da a cada rol que tenía el viejo equivalente, ajusta `alcances.permisos` de los tokens vigentes y borra `equipos.*`. Cada cambio con su diff en `audit.cambios`, como en `1795279364216_create_permisos_iris_090_s_table.ts`.
6. Borra `equipos_config` y las columnas viejas de `equipos_perfiles`. `GRANT` a `argosisp_app` como en la migración original.
7. `down()`: recrea `equipos_config` y vuelve a juntar (una instancia por empresa: la de id menor). Documentar que con más de una instancia el reverso pierde las demás.

La auditoría anterior (`entidad = configuracion_equipos`) no se toca: `audit.*` es inmutable.

## 4. Reglas explícitas de cada flujo

### 4.1 Capacidades (lo que ve Iris; el contrato no cambia de forma)

| Marca | Regla nueva |
| --- | --- |
| `aprovisionamiento.ftth` | la empresa tiene al menos una instancia de SmartOLT **operativa** (suya o compartida) |
| `aprovisionamiento.tr069` | el ACS de la empresa está encendido y probado |
| `aprovisionamiento.wireless` | **P2 para el PM.** Mientras no responda: se conserva el valor de hoy (`ftth \|\| tr069`) para no cambiar lo que Iris ofrece. Propuesta: `true` siempre que el conector de Iris admita 0.9.0, porque un CPE sin TR-069 solo recibe IP y activación y no usa ninguno de los dos |
| `equipos.estado_equipo` | `ftth \|\| tr069` (cualquiera de los dos da estado) |
| `equipos.wifi` | `tr069` (el Wi-Fi solo se cambia por el ACS; P3) |

`gestionDe()` deja de recibir un `activo` común: cada marca mira solo su sistema.

### 4.2 Elegir la instancia de SmartOLT para un servicio

Función única `instanciaParaServicio(servicio, planta, cliente)` en `integraciones/equipos/smartolt_instancias.ts`, usada al aceptar, al preparar, al descubrir y al leer el estado:

1. **Ya se sabe**: `equipos_servicio.smartolt_instancia_id` o `aprovisionamientos.smartolt_instancia_id` → esa.
2. **Por la OLT del servicio en Argos**: `core.servicios.servidor_pppoe_id → network.servidores_pppoe.vlan_id → network.vlans.puerto_pon_id → network.olt_puertos_pon.olt_id`; si no hay, `planta.olt` del pedido cuando coincide (sin distinguir mayúsculas) con el `nombre` de una `network.olts` visible para la empresa. Si esa OLT tiene fila en `smartolt_olts` → su instancia y su `smartolt_olt_id` esperado.
3. **Sin OLT conocida**: candidatas = instancias operativas visibles para la empresa. Una → esa. Varias → se busca la serie en cada una (`get_onus_details_by_sn` y `unconfigured_onus?sn=`, como hoy, una vez por instancia); la que la tenga gana. En dos a la vez → `FalloPaso('equipo', 'otro', 'La ONT aparece en más de una instancia de SmartOLT', false)`.
4. Instancia elegida pero no operativa → al aceptar `422 aprovisionamiento_no_disponible`; en el worker `FalloPaso('equipo', 'olt_sin_respuesta', 'La instancia «<nombre>» de SmartOLT está apagada o sin probar', false, true)`.

La autorización usa siempre el `olt_id`, `board` y `port` **que devuelve SmartOLT** para esa ONU (la planta física manda). Si no coincide con la OLT esperada del paso 2, no falla: se anota `olt_distinta: { esperada, real }` con `t.anotarAuditoria`. El perfil se busca en `equipos_perfiles` de la fila `smartolt_olts` (instancia + `olt_id` real); sin fila o sin perfil → `perfil_sin_mapear`, como hoy.

### 4.3 Flujos que usan los dos sistemas

| Flujo | Regla |
| --- | --- |
| ONT con `wifi` inicial | SmartOLT autoriza (paso `equipo`); el ACS pone el Wi-Fi (paso `wifi`). Sin ACS operativo: `422 wifi_no_disponible` (o `capacidad_no_disponible` con 0.14.3) al aceptar, como hoy. La ONT sin `wifi` se aprovisiona solo con SmartOLT |
| ONT con `pppoe_por_acs` | El ajuste es **del ACS** (`acs_config.pppoe_por_acs`). Solo aplica si el ACS está operativo al aceptar; si no, se ignora y la ONT se autoriza sola. Se decide al aceptar (queda en `pasos`); si el ACS deja de estar operativo antes de que corra el worker: `acs_sin_respuesta`, reintentable |
| `router_tr069` | Solo ACS. No mira SmartOLT |
| `cpe_wireless` | Ninguno, salvo `wifi` o `pppoe_por_acs`, que piden el ACS. Disponibilidad según P2 |
| Estado del equipo (A33) | Cada sistema aporta lo suyo si el equipo tiene su id y el sistema está operativo: SmartOLT estado y señal, ACS firmware, SSID y último contacto. Uno caído no tumba al otro; `503` solo si no respondió ninguno de los que aplicaban |
| Descubrir un equipo viejo | SmartOLT (todas las instancias candidatas, §4.2 paso 3) y ACS por separado; guarda lo que encuentre y la instancia |
| Cambio de Wi-Fi (A35) | Solo ACS |
| Cron `equipos.pendientes` | Sin cambios de lógica; texto: «Reintenta los aprovisionamientos (SmartOLT y ACS) y los cambios de Wi-Fi (ACS) en proceso» |
| Apagar o borrar una instancia con pedidos `en_proceso` | Apagar: permitido, los pedidos fallan reintentables (§4.2 paso 4). Borrar: `409 instancia_en_uso` si hay `equipos_servicio` o pedidos `en_proceso` que la usan |

## 5. API, permisos y eventos

### 5.1 Rutas (`start/routes/equipos_iris.ts`; todas en `packages/contracts`)

Se **quitan** `GET`/`PUT /integraciones/equipos` y `POST /integraciones/equipos/probar` (solo las usa el panel).

| Método y ruta | Permiso = acción | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| `GET /integraciones/smartolt/instancias` | `smartolt.ver` | `?cursor&limit` | `{ data: InstanciaSmartOlt[], nextCursor }` (de la empresa activa y compartidas) |
| `GET /integraciones/smartolt/instancias/:id` | `smartolt.ver` | | `InstanciaSmartOlt` |
| `POST /integraciones/smartolt/instancias` | `smartolt.crear_instancia` | `nombre, url, token, compartida?, activo?` | 201 `InstanciaSmartOlt` |
| `PUT /integraciones/smartolt/instancias/:id` | `smartolt.editar_instancia` | `version, nombre?, url?, token? (omitido = se conserva), activo?, perfiles?[]` | `InstanciaSmartOlt` |
| `DELETE /integraciones/smartolt/instancias/:id` | `smartolt.eliminar_instancia` | | 204; `409 instancia_en_uso` |
| `POST /integraciones/smartolt/instancias/:id/probar` | `smartolt.probar_instancia` | | `{ ok, latencia_ms, error, instancia: InstanciaSmartOlt }`. Guarda la prueba y **sincroniza las OLT** con la misma llamada |
| `POST /integraciones/smartolt/olts/:id/vincular` | `smartolt.vincular_olt` | `olt_id: number \| null` | `OltSmartOlt`; `409 olt_ya_vinculada`; `422 olt_de_otra_empresa` |
| `GET /integraciones/acs` | `acs.ver` | | `ConfigAcs` (`version` 0 = nunca guardada) |
| `PUT /integraciones/acs` | `acs.configurar` | `version, activo?, url?, usuario?, clave?, ca?, pppoe_por_acs?` | `ConfigAcs` |
| `POST /integraciones/acs/probar` | `acs.probar` | | `{ ok, latencia_ms, error, config: ConfigAcs }` |

`InstanciaSmartOlt`: `id, empresa_id (o null), compartida, nombre, url, token ('***'), activo, operativa, probado_en, prueba_ok, prueba_error, olts_sincronizadas_en, version, olts[]`.
`OltSmartOlt`: `id, smartolt_olt_id, nombre, hardware, ip, presente, origen, olt (null o { id, nombre }), perfiles[]: { plan_id, authorization_preset_id, pon_type }`.
`ConfigAcs`: `empresa_id, activo, operativo, url, usuario, clave ('***' o null), ca (boolean), probado_en, prueba_ok, prueba_error, pppoe_por_acs, version`.

Reglas: `activo: true` exige URL y token (SmartOLT) o URL (ACS), 422 en `activo`. `compartida: true` y editar una compartida exigen alcance global (403 `empresa_no_permitida`). `perfiles[].smartolt_olt_id` debe ser una OLT de esa instancia (se crea `origen: manual` si aún no se sincronizó). Al sincronizar, una OLT nueva cuyo `name` coincide exactamente (sin mayúsculas) con una sola `network.olts` visible y sin vínculo se vincula sola y la respuesta lo dice en `vinculadas_por_nombre[]`.

### 5.2 Permisos (`core/permisos.ts` y migración §3.7 paso 5)

| Nuevo | Quién lo hereda en la migración | Roles base |
| --- | --- | --- |
| `smartolt.ver` | quien tenía `equipos.ver` | `admin`, `tecnico`, `soporte`, `lectura` (los que hoy tengan `equipos.ver`) |
| `smartolt.crear_instancia`, `smartolt.editar_instancia`, `smartolt.eliminar_instancia`, `smartolt.vincular_olt` | quien tenía `equipos.configurar` | `admin` |
| `smartolt.probar_instancia` | quien tenía `equipos.probar` | `admin` |
| `acs.ver` | `equipos.ver` | igual que `smartolt.ver` |
| `acs.configurar` | `equipos.configurar` | `admin` |
| `acs.probar` | `equipos.probar` | `admin` |

Se eliminan `equipos.ver`, `equipos.configurar`, `equipos.probar`. `pnpm verificar:permisos` debe pasar (el menú de Integraciones pide `['horus.ver', 'iris.ver', 'smartolt.ver', 'acs.ver']`).

### 5.3 Evento nuevo `equipos.config_cambiada` (por outbox, regla 3)

| Evento | Emite | Payload |
| --- | --- | --- |
| `equipos.config_cambiada` | A6 (`smartolt.*_instancia`, `smartolt.probar_instancia` solo si cambió `operativa` o la lista de OLT, `smartolt.vincular_olt`, `acs.configurar`, `acs.probar` solo si cambió `operativo`) | `sistema` (`smartolt` \| `acs`), `empresa_id` (null = instancia compartida), `instancia_id` (null en `acs`), `accion` (`creada`, `editada`, `eliminada`, `probada`, `olts_sincronizadas`, `olt_vinculada`), `campos[]` (solo nombres; nunca valores ni secretos), `operativa` (después del cambio) |

Consumidores hoy: ninguno obligatorio (las capacidades se calculan en cada lectura, regla 5). Se agrega a `#shared/eventos`, a `contratos/eventos.md` y se pide al líder la fila del catálogo de `CLAUDE.md` (A6 no lo edita). **No** va a Iris: su contrato no lo conoce (P5).

## 6. Plan de trabajo por lotes

Cada lote es una PR con CI en verde. Comando de pruebas de la API (un archivo por corrida):
`DB_DATABASE=argosisp_test_a6olt PORT=3416 COLAS_PREFIJO=a6olt AAA_REDIS_PREFIJO=a6olt:aaa:user: NODE_ENV=test node ace test --files=<archivo>`. Al final de cada lote: `pnpm lint`, `pnpm typecheck`, `pnpm verificar:permisos` y `NODE_ENV=development pnpm contracts:build`.

### Lote 1 · Modelo y migración (API, sin cambio de comportamiento visible)

Archivos:
- `apps/api/database/migrations/<marca>_separar_smartolt_acs.ts` (nueva, con `node ace make:migration`): §3.7 completo.
- `apps/api/app/integraciones/equipos/configuracion.ts`: se parte en `acs.ts` (`TABLA_ACS`, `leerFilaAcs`, `acsDeEmpresa`, `vistaAcs`), `smartolt_instancias.ts` (`leerInstancia`, `instanciasDeEmpresa(empresaId)` = propias + compartidas, `vistaInstancia`, `perfilPara(oltRefId, planId)`, `instanciaParaServicio` de §4.2) y `configuracion.ts` queda con `normalizarUrl`, `permiteHttp` y `gestionDe(empresaId)` según §4.1.
- `apps/api/app/core/permisos.ts`: §5.2.
- `apps/api/tests/integraciones/equipos_simulado.ts`: `configurarEquipos()` de las pruebas pasa a crear instancia y ACS por separado; el SmartOLT simulado acepta varias copias (una por puerto) con OLT distintas.

Pruebas (`tests/integraciones/equipos_migracion.spec.ts`, nueva; corre el `up` de la migración sobre filas viejas insertadas a mano tras un `down`):
1. Empresa con SmartOLT y ACS probados y `activo = true` → una instancia operativa y un ACS operativo; `descifrar(token_cifrado)` y `descifrar(clave_cifrada)` devuelven los secretos originales; `probado_en` idéntico.
2. Empresa con solo ACS → `acs_config` y ninguna instancia.
3. Empresa con `activo = false` y los dos probados → los dos `activo = false`, pruebas conservadas.
4. Dos perfiles (`olt 1`/plan A → 31, `olt 1`/cualquier plan → 32) → una fila `smartolt_olts` `manual` y dos perfiles con `smartolt_olt_ref_id`.
5. `equipos_servicio` con `smartolt_external_id = 'argos7'` → `smartolt_instancia_id` de su empresa.
6. Rol con `equipos.configurar` → queda con los cuatro `smartolt.*` de escritura y `acs.configurar`; `equipos.*` ya no existe en `core.permisos`.
7. Dos empresas con la misma URL de SmartOLT → una instancia con `empresa_id` null.

### Lote 2 · ACS independiente (API)

Archivos:
- `actions/configurar_acs.ts` (`acs.configurar`) y `actions/probar_acs.ts` (`acs.probar`): lo de GenieACS de `configurar_equipos.ts` y `probar_equipos.ts`, entidad de auditoría `configuracion_acs`, emite §5.3.
- Se borran `actions/configurar_equipos.ts` y `actions/probar_equipos.ts` al terminar el lote 3.
- `validators.ts`: `configurarAcsValidator`. `start/routes/equipos_iris.ts`: rutas de ACS de §5.1.
- `capacidades.ts`, `equipos.ts`, `actions/aprovisionar_servicio.ts`, `actions/preparar_aprovisionamiento.ts`, `actions/aplicar_wifi.ts`, `actions/cambiar_wifi_servicio.ts`: leen el ACS con `acsDeEmpresa()`; `pppoe_por_acs` sale del ACS.

Pruebas (`tests/integraciones/equipos_acs_independiente.spec.ts`, nueva; se actualizan `equipos_acs_aparte.spec.ts`, `iris_equipos_090.spec.ts`, `iris_equipos_0143.spec.ts`):
1. Empresa **solo con ACS** probado: `capacidades.aprovisionamiento` = `{ ftth: false, tr069: true }`; `equipos` = `{ estado_equipo: true, wifi: true }`.
2. Solo ACS: aprovisionar `router_tr069` con `wifi` termina `listo`; `audit.red` no tiene ninguna fila `smartolt`.
3. Solo ACS: aprovisionar `ont` → `422 aprovisionamiento_no_disponible`.
4. `PUT /integraciones/acs` con `activo: true` sin URL → 422 en `activo`; cambiar la clave borra la prueba; la respuesta y `audit.cambios` traen `***`.
5. `POST /integraciones/acs/probar` no llama a SmartOLT (el simulado cuenta 0 peticiones).
6. Versión vieja → 409; el ACS de la empresa A no se ve con `X-Empresa-Id` de B.
7. Emite `equipos.config_cambiada` con `sistema: 'acs'` y sin valores.

### Lote 3 · SmartOLT multi-instancia (API)

Archivos:
- `actions/crear_instancia_smartolt.ts`, `editar_instancia_smartolt.ts`, `eliminar_instancia_smartolt.ts`, `probar_instancia_smartolt.ts`, `vincular_olt_smartolt.ts` (nombres de acción de §5.1).
- `smartolt.ts`: `listarOlts` devuelve también `hardware` e `ip`; nada más cambia (ya recibe `ConfigSmartOlt` por parámetro).
- `actions/preparar_aprovisionamiento.ts` `autorizarOnt()`: §4.2; guarda `smartolt_instancia_id`. `actions/activar_aprovisionamiento.ts`: lo pasa a `guardarEquipoGestionado`.
- `equipos.ts` `descubrirEquipo()` y `estadoEquipo()`: instancia del equipo (§4.2, §4.3).
- `actions/aprovisionar_servicio.ts`: `ftth` y §4.2 paso 4 al aceptar.
- `validators.ts`, `start/routes/equipos_iris.ts`: rutas de SmartOLT; se quitan las de `/integraciones/equipos`.
- `monitoreo/crons/catalogo.ts`: texto de `equipos.pendientes` (y `tests/monitoreo/crons_catalogo.spec.ts` si compara el texto).
- `#shared/eventos`, `contratos/eventos.md`: §5.3. `README.md` del módulo reescrito. `contratos/red-acceso.md`: la frase «SmartOLT queda para después» pasa a remitir a este contrato (pedirlo a A1 en `a6.md` si no se puede tocar).

Pruebas (`tests/integraciones/equipos_smartolt_instancias.spec.ts`, nueva; se actualiza `equipos_smartolt_genieacs.spec.ts`):
1. Empresa **solo con SmartOLT**: `{ ftth: true, tr069: false }`, `wifi: false`; aprovisionar `ont` sin `wifi` termina `listo` sin filas `genieacs` en `audit.red`; con `wifi` → `422 wifi_no_disponible`.
2. Dos instancias (A con OLT `1` «Norte», B con OLT `1` «Sur») y dos simulados: `probar` de cada una guarda sus OLT; las dos tienen `smartolt_olt_id = '1'` sin chocar.
3. Probar la instancia A no llama al simulado de B; la prueba fallida de B (token malo, 403) no cambia `operativa` de A.
4. Servicio cuya OLT de Argos está vinculada a la OLT de B: la ONT se autoriza en B (el simulado de A recibe 0 peticiones) con el perfil de B; `equipos_servicio.smartolt_instancia_id = B`.
5. Servicio sin OLT en Argos y la serie solo en A: se autoriza en A. Serie en las dos → `fallido`, causa `otro`.
6. Mismo `olt_id` y plan con presets distintos en A (31) y en B (77): cada servicio recibe el suyo.
7. OLT vinculada a una instancia apagada → `422 aprovisionamiento_no_disponible` al aceptar.
8. `GET /servicios/:id/equipo` lee el estado en la instancia guardada, no en la otra.
9. `vincular`: una OLT de Argos ya vinculada → 409; OLT de otra empresa → 422; `olt_id: null` desvincula. Sincronizar vincula sola la del mismo nombre.
10. Borrar una instancia con un equipo gestionado → `409 instancia_en_uso`; sin uso → 204 y sus OLT y perfiles se van.
11. Instancia compartida: la crea solo un usuario con alcance global (403 al de una empresa); la ven las dos empresas; `ftth: true` en las dos.
12. Mismo subdominio dos veces → `409 subdominio_duplicado`. El token nunca aparece en respuestas, `audit.acciones`, `audit.cambios` ni `audit.red`.
13. Con una sola instancia y un ACS, todo `equipos_smartolt_genieacs.spec.ts` sigue pasando (regla 13: con un solo elemento nada cambia).

### Lote 4 · Panel (apps/web)

No hay tablero para estas pantallas: `OperConfigIntegraciones.dc.html` muestra SmartOLT como «Próximamente». Regla 10: se sigue la distribución de ese tablero (lista a la izquierda, detalle a la derecha) y **se avisa al líder para sumar el tablero** (P6).

Archivos:
- `app/composables/useSmartOlt.ts` y `app/composables/useAcs.ts` (un recurso por composable); se borra `useEquiposIntegracion.ts`.
- `app/utils/smartOlt.ts` y `app/utils/acs.ts` (esquemas `zod` espejo y `estado…()` con icono, texto y color); se borra `utils/equiposIntegracion.ts`.
- `app/components/ConfiguracionSmartOlt.vue`: lista de instancias (nombre, subdominio, estado, «N OLT», marca «Compartida») con buscador si hay más de 6; cada una se abre para ver sus OLT (nombre, hardware, IP, OLT de Argos vinculada con `USelectMenu`, perfiles por plan) y los botones «Probar y sincronizar», «Apagar» o «Encender» y «Eliminar» (ventana de confirmación).
- `app/pages/configuracion/integraciones/smartolt/nueva.vue` y `…/smartolt/[id].vue`: alta y edición en página propia (formulario largo, no modal), `CampoSecreto` para el token.
- `app/components/ConfiguracionAcs.vue`: la mitad GenieACS de `ConfiguracionEquipos.vue`, con su propio interruptor y su propia prueba. Se borra `ConfiguracionEquipos.vue`.
- `app/pages/configuracion/integraciones/index.vue`, `useIntegracionesConfiguracion.ts`: dos filas independientes; SmartOLT dice «2 de 3 conectadas» o el estado de la única.
- `app/utils/navegacion.ts`, `app/utils/configuracionSecciones.ts`: permisos nuevos. `app/utils/bitacora.ts`: textos de las nueve acciones nuevas; quitar los dos viejos.
- `app/pages/red/acceso.vue`: la nota «Argos no se conecta a ellas (SmartOLT llegará después)» cambia a mostrar, por OLT, la instancia vinculada (solo lectura, enlace a Integraciones).
- `fixtures/operacionPm/equipos.ts`: fixtures `Schema<'InstanciaSmartOlt'>` y `Schema<'ConfigAcs'>` con los valores por defecto de la API.
- `docs/manual/integraciones/integraciones.md` y `pnpm --filter @argosisp/web ayuda:indice`.

Pruebas:
- Vitest (`tests/nuxt/equiposA6.test.ts` reescrita, `pendientesConfig.test.ts`, `aclPantallas.test.ts`): dos instancias con estados distintos; sin `smartolt.editar_instancia` no hay «Guardar» ni «Eliminar»; con solo `acs.ver` no aparece la fila SmartOLT; el token y la clave nunca están en el DOM; un 500 de la lista muestra el error con «Reintentar» y ningún conteo; «Todas las empresas» pide elegir una.
- Playwright (`tests/e2e/pendientes-config.spec.ts` y `tests/e2e/integraciones-smartolt.spec.ts` nueva, `--trace off`), en 1280 px y 390 px, claro y oscuro: alta de una instancia, probar, ver sus OLT, vincular una a una OLT de Argos, apagar; guardar el ACS sin tocar SmartOLT.
- `pnpm demo:datos` carga una instancia y un ACS por la API para revisar contra el backend real.

### Lote 5 · Cierre

`.claude/integration/a6.md` (pedidos a A1 y A4 y a quién toca `CLAUDE.md`), `infra/genieacs/README.md` si nombra la configuración conjunta, `CHANGELOG.md` por el flujo de versiones del líder, y `scripts/integrar.sh agente/a6-olt-acs` contra `main`.

## 7. Fuera de alcance (anotado para después)

- Webhook o SSE de SmartOLT por instancia (estado de ONU y cortes de PON sin sondeo).
- PPPoE y Wi-Fi por SmartOLT (OMCI) para empresas sin ACS (P3).
- Sincronizar los puertos PON de SmartOLT con `network.olt_puertos_pon`.
- Traer los perfiles de autorización con `get_authorization_presets?olt_id=` para elegirlos por nombre en vez de escribir el número (pequeño y útil: candidato a ir dentro del lote 3 si el PM lo quiere, P4).

## 8. Riesgos

- **Migración con secretos**: se copia el texto cifrado tal cual; si `AAA_PPP_KEY` cambió antes, el secreto ya era ilegible y lo sigue siendo (se ve como «Sin probar»).
- **Presupuesto de SmartOLT**: descubrir por serie en N instancias cuesta 2 llamadas por instancia, una sola vez por equipo. Aceptable hasta decenas de instancias.
- **Permisos renombrados**: tokens de API con `equipos.*` en `alcances.permisos` se ajustan en la migración; un token creado entre el despliegue de la migración y el del código no existe (la migración corre antes del arranque).

## 9. Preguntas para el PM

- **P1 · Instancia compartida.** ¿Una cuenta de SmartOLT puede servir a varias empresas de la instalación (propuesta: sí, la administra solo quien ve todas las empresas), o cada empresa registra siempre la suya?
- **P2 · Wireless sin integraciones.** Hoy Iris solo ofrece «Activar servicio» para un CPE inalámbrico si la empresa tiene SmartOLT o ACS probado, aunque ese CPE no use ninguno. ¿Se ofrece siempre, o solo con ACS?
- **P3 · Wi-Fi y PPPoE sin ACS.** SmartOLT puede poner el Wi-Fi y el PPPoE de una ONT por sí solo. ¿Lo quieres para empresas que solo tienen SmartOLT, o el Wi-Fi sigue siendo solo por ACS?
- **P4 · Perfiles por nombre.** ¿Traemos los perfiles de autorización desde SmartOLT para elegirlos de una lista en vez de escribir su número?
- **P5 · Aviso a Iris.** Cuando se apaga una instancia o el ACS, Iris se entera la próxima vez que consulta el estado. ¿Hace falta avisarle en el momento (cambio de contrato con Iris)?
- **P6 · Tablero.** No hay diseño aprobado para SmartOLT con varias instancias ni para ACS aparte. ¿Lo dibujamos antes del lote 4, o se construye siguiendo el tablero de Integraciones y se revisa después?
- **P7 · Un ACS por empresa.** Recomendación: uno por empresa (§3.4). ¿De acuerdo, o hay alguna empresa con más de un ACS?
