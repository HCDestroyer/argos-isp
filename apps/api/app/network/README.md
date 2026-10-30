# network (A1)

Routers, IPAM IPv4 e IPv6, planes y su implementación por router.

## Routers

- `api_password` y `radius_secret` se guardan cifrados con el formato `v1` (`app/shared/cifrado.ts`, AES-256-GCM, clave `AAA_PPP_KEY`), el mismo que descifran `services/aaa` y `services/coa`. Nunca salen por la API: la respuesta trae `tiene_api_password` / `tiene_radius_secret`. En `audit.cambios` aparecen como `***`.
- Alcance del ACL por router: listas filtradas y 403 en recursos de otro router.
- Conexión de la API REST de RouterOS (`api_url`, `api_tls_verificar`, `api_ca`, `dhcp_servidor`, `interfaz_clientes`): columnas y precedencias en `.claude/integration/contratos/routeros.md`, "Conexión del router". La CA nunca sale por la API (fila 57 de `a4.md`): la vista solo trae `tiene_api_ca`; el dispatcher la lee de su propia consulta. En `audit.cambios` va como `***`, también cuando se reemplaza por otra.
- En línea y último contacto (`contacto_router.ts`, pedido de A4): `Router.ultimo_contacto` = lo más reciente entre `network.routers_contacto` (fuentes periódicas: accounting del NAS y sondeo de RouterOS, escritas con `registrarContactoRouter(trx, { routerId } | { nasIp }, fuente, en?)` dentro de la acción que las recibe; nunca retrocede y reescribe a lo sumo cada 30 s; sin auditoría, es telemetría) y la última respuesta buena del router en `audit.red` (CoA/Disconnect con ACK, comando de RouterOS con `ok`). `Router.en_linea`: null si ninguna fuente periódica lo mide (sin fila: no se sabe); si no, `ultimo_contacto` dentro de `SESIONES_COLGADAS_INTERVALOS` × `AAA_INTERIM_SEGUNDOS` (15 min). Quién escribe las fuentes periódicas (A2): `.claude/integration/a1.md`.
- **Eliminar sin historial** (`contratos/eliminar.md`): `EliminarRouter` (`routers.eliminar`, solo admin; `DELETE /routers/:id?version=`) borra un router sin servicios (ni retirados), sesiones, historial, asignaciones en sus redes, comandos de escritura en `audit.red`, bodegas ni alcances; se lleva sus redes IPv4, bloques y pools IPv6, `planes_routers`, contacto, migración AAA y conexión. Si no, 422 `router_con_historial`. `GET /routers/:id/eliminable` (`eliminacion.ts`). Emite `router.eliminado`. Los desactivados: `GET /routers?activo=false`.

- Edición desde el panel (`PUT /routers/:id`, pedido del PM 28 oct): nombre, `host`, `api_url` (`https://host:puerto`; null = `https://<host>`), `api_usuario`, `api_password`, `radius_secret`, `zona_id` (opcional; 422 en `zona_id` si no existe; no cambia el alcance del ACL), `empresa_sugerida_id` y capacidad. En la edición una credencial vacía o null **no cambia** (el bodyparser convierte `""` en null); se borra con `quitar_api_password` / `quitar_radius_secret` (422 si llega también el valor).
- Ubicación (contrato Iris 0.3.1, factibilidad desde el catálogo de `GET /routers`): `coordenadas` opcional en el alta y la edición, `"lat,lng"` en grados decimales como en clientes y servicios (latitud −90…90, longitud −180…180; 422 en `coordenadas` fuera de rango o mal formada; null la quita). Se guarda en `network.routers.coordenadas` (`text` con el mismo CHECK de formato que clientes y servicios; el rango lo valida VineJS), sin espacios, y sale igual en `Router.coordenadas`. No es `numeric`: en el modelo, `numeric` es dinero. El diff queda en `audit.cambios` (`coordenadas`); no emite evento (Iris lee el catálogo).

## Conexión por WireGuard (`conexion/`, `contratos/conexion-routers.md`)

Script `.rsc` que conecta un MikroTik a Argos: túnel WireGuard, usuario `argosisp-api` (grupo `read,write,api,rest-api`), cliente RADIUS y puertos de gestión cerrados. Las plantillas y `variables.json` son de A6 (`infra/mikrotik`); la API las rellena.

- `network.routers_conexion`: una fila por router con `ip_tunel` (/32 de `ARGOSISP_WG_RED`, única y estable: `ipam_tunel.ts`, salta la `.1` del servidor y las `nas_ip` de otros routers), `public_key`, `estado`, `ultimo_handshake`, `routeros_version`, token de registro (hash sha256, 24 h, un uso) y `api_password_pendiente` (cifrada). `network.wireguard_servidor`: la clave pública que publicó el agente.
- **Generar** (`GET /routers/:id/script-conexion?admin=&incluir=servicio`, `routers.generar_script`): rota el token y crea una clave aleatoria de 32 caracteres para la API, pendiente hasta que el router se registra con ese script. El secreto RADIUS es el `radius_secret` del router (el de FreeRADIUS); sin él o fuera del patrón (16 a 128), 422 `radius_secret_requerido`. Con `incluir=servicio`, los datos de `servicio.ts` (422 `servicio_incompleto` si faltan). 503 `wireguard_no_configurado` sin `ARGOSISP_WIREGUARD=1`, sin `ARGOSISP_WG_ENDPOINT`, sin clave publicada o sin `API_PUBLIC_URL` https; 503 `plantillas_no_disponibles` si faltan los archivos.
- **Registrar** (`POST /routers/conexion/registrar`, público): `{ token, public_key, routeros_version, api_ca }` → `{ router_id, ip_tunel, servidor: { public_key, endpoint, puerto, ip } }`; 410 `token_invalido`; 409 `clave_en_uso`; límite por IP (`ROUTERS_REGISTRO_LIMITE`, `ROUTERS_REGISTRO_VENTANA_S`). Al registrarse: `host` y `nas_ip` = IP del túnel (dirección del NAS en FreeRADIUS y destino del CoA), `api_url = https://<ip_tunel>`, `api_usuario = argosisp-api`, `api_tls_verificar = true`, `api_ca` la del router y la clave pendiente pasa a `api_password`.
- **Pegar la clave** (`POST /routers/:id/conexion/clave`, `routers.conexion_clave`): igual que el registro, para un router sin internet. 422 `script_no_generado`.
- **Rotar** (`POST /routers/:id/conexion/rotar`, `routers.rotar_conexion`): borra la clave registrada y responde un script nuevo. La IP no cambia.
- **Estado** (`GET /routers/:id/conexion`, `routers.ver`): `sin_configurar`, `pendiente` o `conectado` (handshake de menos de 3 min), IP del túnel, clave pública, último handshake, `routeros_version` y vencimiento del token.
- **Desactivar** un router con túnel (`PUT /routers/:id { activo: false }`) lo saca de los peers y emite `router.conexion_eliminada`; reactivarlo emite `router.conexion_registrada`.
- **wireguard-agente (A6)**: `GET /internal/wireguard/peers` → `{ data: [{ router_id, public_key, ip_tunel }] }` (routers activos con clave) y `POST /internal/wireguard/estado` → 204 (`routers.registrar_estado_wireguard`: guarda la clave del servidor y el handshake, que solo avanza; el cambio `pendiente` ↔ `conectado` va a `audit.cambios` y la acción solo deja fila en `audit.acciones` si cambió algún estado o la clave).
- Render (`render.ts`): port de `infra/mikrotik/render.mjs` (espejo de su prueba en `tests/network/conexion_render.spec.ts`): todas las variables deben venir y cumplir su patrón, se escapan `\ " $ ?` y un carácter de control es error. Archivos en `ROUTERS_MIKROTIK_DIR` o `infra/mikrotik`.
- Ni la auditoría ni los eventos llevan el token, la clave de la API ni el secreto RADIUS; el script no se guarda.

## Probar conexión, reconciliar y sincronizar (pedidos del PM, 28 y 29 oct)

- `api_ca` (alta, edición y registro por el túnel) debe ser el certificado de una CA (`basicConstraints CA:TRUE`, `exigirCaValida`): pegar el del servicio da 422 en `api_ca` con lo que hay que revisar.
- `POST /servicios/:id/sincronizar-router` (`servicios.sincronizar_router`: admin, técnico, soporte; `actions/sincronizar_router_servicio.ts`): corre `routeros.aplicar_servicio` en el acto (anidada) y responde `{ servicio_id, router_id, cambios[] (router_id, ruta, comment, accion), ya_estaba_bien, avisos[], error }`. Candado por servicio, idempotente, cada comando en `audit.red`. 422 `servicio_pendiente_instalacion` y `router_sin_api` (inactivo o sin usuario/clave de la API). Router caído: 200 con `error { motivo, detalle }`.


- `POST /routers/:id/probar-conexion` (`routers.probar_conexion`: admin, técnico, soporte): chequeos `{ clave, ok, detalle, ms, motivo?, datos? }` en este orden: `tunel` (solo con conexión WireGuard), `api` (`GET /rest/system/resource`; si falla, `motivo` y `detalle` en lenguaje simple con los comandos de RouterOS, de `diagnostico_routeros.ts`: `sin_certificado` (alerta TLS 40: www-ssl sin certificado → crear la CA `argos-ca`, firmar con `ca=argos-ca` y asignarlo), `certificado_no_confiable` (autofirmado o emisor desconocido → desactivar la verificación o pegar la CA), `certificado_proposito` (`unsuitable certificate purpose`: la `api_ca` no es la CA o el certificado de www-ssl no tiene `tls-server`), `puerto_cerrado` (ECONNREFUSED o timeout), `protocolo` (wrong version number: HTTPS a un puerto HTTP), `credenciales` (401), `politicas` («not allowed»: faltan `api`/`rest-api`), `no_responde`, `respuesta` o `sin_credenciales`; el texto de OpenSSL solo en `datos.error_tecnico`. El sondeo guarda el mismo `motivo` y `detalle` en `audit.red`), `equipo` (`datos`: `version`, `modelo`, `uptime`, `cpu_pct`; exige RouterOS 7) y `radius` (modo radius: un `/radius` con servicio `ppp` hacia la IP del servidor en el túnel o `ROUTERS_RADIUS_DIRECCIONES`; el secreto se compara solo si el router lo devuelve y nunca sale). Reutiliza `sondearRouter` (`routeros/actions/sondear_routers.ts`): cada GET va a `audit.red` y una respuesta buena actualiza `en_linea`/`ultimo_contacto` (fuente `sondeo`). `ok: null` = no se pudo comprobar.
- `POST /routers/:id/reconciliar` (`routers.reconciliar`: admin, técnico): 202 `{ router_id, job_id, encolado }`. Job `reconciliar_router` en la cola `routeros-cron` (worker de concurrencia 1, lock por router de la acción); `jobId = reconciliar-<id>`: mientras uno espera, otro pedido devuelve `encolado: false`.

| Acción | Permiso | Eventos |
| --- | --- | --- |
| `GenerarScript` | `routers.generar_script` | `router.conexion_generada` |
| `RegistrarConexion` | público con token | `router.conexion_registrada` |
| `ConexionClave` | `routers.conexion_clave` | `router.conexion_registrada` |
| `RotarConexion` | `routers.rotar_conexion` | `router.conexion_rotada`, `router.conexion_generada` |
| `RegistrarEstadoWireguard` | interno | — |
| `EditarRouter` (activo) | `routers.editar` | `router.conexion_eliminada` / `router.conexion_registrada` |
| `CrearRouter`, `EditarRouter`, registro por el túnel (`nas_ip` o `radius_secret`) | `routers.crear`, `routers.editar` | `router.radius_cambiado { router_id, empresa_id, campos[] }` (nunca el secreto; A2 regenera el cliente de FreeRADIUS) |
| `ProbarConexion` | `routers.probar_conexion` | — (`audit.red`) |
| `ReconciliarAhora` | `routers.reconciliar` | — (encola `routeros.reconciliar`) |

## IPAM IPv4 (`ipam_v4.ts`)

- `asignarIpv4(trx, { servicioId, routerId, ip?, redId? })`: la IP pedida (debe estar en una red del router, no ser red/broadcast/gateway y estar libre: 422/409) o la primera libre, prefiriendo redes `estatico` sobre `pool`. Con `redId`, solo de esa red: 422 en `red_ipv4_id` si no es del router o está llena (`rule: llena`), y 422 en `ipv4` si la IP pedida no es de esa red. Advisory lock por router.
- `liberarIpv4(trx, servicioId)`: cierra la asignación vigente (`fin = now()`); el historial queda en `network.ipv4_asignaciones`.
- Redes: no se traslapan (409 `red_traslapada`), el CIDR debe venir normalizado y el gateway dentro de la red.

## IPAM IPv6 (`ipam_v6.ts`, `ipv6.ts`)

- Bloques por router (`/routers/:id/ipv6-bloques`) y pools dentro del bloque (`/ipv6-bloques/:id/pools`): `enlace` entrega /64, `delegacion` /56 o /48. Prefijos normalizados y sin traslapes.
- `reservarPrefijo(trx, { servicioId, routerId, tipo, tamano })`: conserva el vigente si sigue en un pool válido del router; si no, recupera el anterior del servicio en ese pool si está libre; si no, el primer subprefijo libre (saltando cualquier vigente que se traslape). Advisory lock por pool.
- `asignarPrefijoEstatico` (modo `estatico`) y `liberarPrefijos` (retiro, cambio de modo). Historial en `network.ipv6_asignaciones`.

## Pools editables, ocupación y migración (`contratos/pools.md`)

- Redes IPv4 con `nombre`, `rango_inicio`/`rango_fin` (solo se entregan IPs del rango, también a mano; fuera quedan reservadas) y DNS. Bloques IPv6 con `nombre` y `proveedor`; un router admite varios bloques y pools de cada tipo.
- Editar (`PUT /redes-ipv4/:id`, `/ipv6-bloques/:id`, `/ipv6-pools/:id`, con `version`): achicar dejando direcciones asignadas fuera responde 422 con la lista (`reglas_pools.ts`).
- Ocupación (`ocupacion.ts`) en SQL: `total`, `asignadas`, `libres`, `reservadas`, `porcentaje` en cada red y pool; `GET /routers/:id/direccionamiento` lo resume con lo que recibe cada plan (`consultas/direccionamiento.ts`).
- Migrar (`migrar_pools.ts`): 422 `pool_con_servicios` si hay servicios y no se pidió `mover_servicios`; con él, `EditarServicio` anidada por servicio (conserva las direcciones de lo que se muda); `simular` revierte todo (`simularEnTransaccion`).
- Vistas previas IPv6: `POST /ipv6-pools/vista-previa`, `POST /ipv6-bloques/vista-previa`.
- Mensajes de los campos obligatorios con su motivo (`conMensajes` de `#shared/mensajes_validacion`).

## Historial de asignaciones (`historial.ts`, tarea 12)

- `network.asignaciones_historial`: tramos `inicio`/`fin` de (router, plan, IPv4, `/64` de enlace en `prefijo_enlace_v6`, delegado en `prefijo_v6`). Un solo tramo abierto por servicio (`fin IS NULL`, índice único).
- `registrarTramo(trx, servicioId, motivo)`: si la foto vigente cambió, cierra el tramo abierto y abre otro; un retirado solo cierra. Lo llaman `CrearServicio` (`alta`), `EditarServicio` (`edicion: plan, router, ips, prefijo_v6`) y `RetirarServicio` (`retiro: <motivo>`). Usa `now()` de la transacción: el `fin` de un tramo es el `inicio` del siguiente.
- La migración `1792132594124_network_asignaciones_historial_v6` siembra un tramo `inicial` para los servicios no retirados.
- `GET /servicios/:id/asignaciones` (`listarTramos`): del más reciente al más viejo, con `router_nombre` y `plan_nombre`, cursor por `id`.
- `ipv4_asignaciones` e `ipv6_asignaciones` siguen siendo la fuente del IPAM y de `GET /ip/{ip}`; esta tabla es la vista por servicio para la ficha.

## Planes

- `global = true`: disponible en todos los routers; si no, solo donde tenga fila en `planes_routers`. Inactivos no se ofrecen.
- `obtenerImplementacionPlan(plan_id, router_id)` (`actions/obtener_implementacion_plan.ts`, interfaz pública, solo lectura): plantilla del plan + excepciones del router (`profile_ppp`, pools, `local_address`, `rate_limit_override`). `rate_limit` y `rate_limit_limitado` = `Mikrotik-Rate-Limit` completo de `rateLimitServicio` (ver "Velocidad"). Los campos de velocidad del resultado ya traen las excepciones del router aplicadas. 422 `plan_no_disponible` si el plan no aplica al router.
- Velocidades limitadas obligatorias y > 0 (las usa `aaa` al limitar).

| Acción                                            | Permiso                           | Eventos         |
| ------------------------------------------------- | --------------------------------- | --------------- |
| `CrearRouter`, `EditarRouter`                     | `routers.crear`, `routers.editar` | ver "Velocidad" |
| `CrearRedIpv4`                                    | `redes.crear`                     | —               |
| `CrearPlan`, `EditarPlan`                         | `planes.crear`, `planes.editar`   | ver "Velocidad" |
| `ImplementarPlan` (crea o edita `planes_routers`) | `planes.editar`                   | —               |
| `CrearBloqueIpv6`, `CrearPoolIpv6`                | `ipv6.crear`                      | —               |
| `EditarRedIpv4`                                   | `redes.editar`                    | —               |
| `EditarBloqueIpv6`, `EditarPoolIpv6`              | `ipv6.editar`                     | —               |
| `MigrarRedIpv4`                                   | `redes.migrar`                    | los de `EditarServicio` por cada servicio movido |
| `MigrarBloqueIpv6`                                | `ipv6.migrar`                     | los de `EditarServicio` por cada servicio movido |

Lecturas en `consultas/routers.ts` y `consultas/planes.ts`.

Eventos: salvo los de velocidad (sección "Velocidad"), los cambios de asignación de un servicio salen de las acciones de `core` (`servicio.config_cambiada`, `asignacion.cambiada`). `EditarPlan` e `ImplementarPlan` reescriben `aaa:user:*` de los servicios afectados. No consume eventos.

### Tipo de plan (`tipos_plan.ts`, decisión del PM 19 oct)

- `network.planes.tipo` ∈ `residencial` (por defecto; los planes que ya existían quedaron así), `empresarial`, `dedicado`. Se crea y edita con el plan (`version`, diff en `audit.cambios`). No cambia la velocidad: no emite `plan.velocidad_cambiada` ni otro evento.
- Visible en `Plan.tipo`, `PlanEfectivo.tipo` y, de solo lectura, en `Servicio.plan_tipo`. Filtro `?tipo=` en `GET /planes` y `GET /servicios` (tipo del plan del servicio).
- **Reglas, solo advertencias** (`warnings[]` = `{ codigo, mensaje }` en las respuestas de crear y editar; nunca 422):
    - `plan_dedicado_asimetrico`: plan `dedicado` con `bajada_kbps` ≠ `subida_kbps`.
    - `plan_dedicado_compartido`: plan `dedicado` con `reuso` (compartición 1:N) ≠ 1.
    - `servicio_cliente_cf`: servicio (`POST /servicios`, `PUT /servicios/:id`) de un plan `empresarial` o `dedicado` cuyo cliente factura como CF (`tipo_documento_fiscal = 'cf'`).

### Adicionales incluidos en el plan

`GET/PUT /planes/:id/adicionales` (`DefinirAdicionalesPlan`, permiso `planes.editar`): lista de adicionales con su cantidad; el PUT reemplaza la lista y sube la `version` del plan. Reglas en `.claude/integration/contratos/adicionales.md` y `app/core/README.md`.

## Velocidad (`velocidad.ts`, semana 2)

Contrato: `.claude/integration/contratos/velocidad.md`. Única fuente del rate-limit para PPPoE y WISP.

- Plan: `reuso` (1..64), `garantizado_pct` (null = `100 / reuso`), `rafaga_bajada_kbps` / `rafaga_subida_kbps` (null = sin ráfaga), `rafaga_umbral_pct` (75), `rafaga_segundos` (16), `prioridad` (8). `planes_routers` los puede sobrescribir (null hereda).
- Router: `control_velocidad` (`simple` | `arbol_pcq`, reemplaza `modo_velocidad`, que sigue en la vista derivado y obsoleto), `capacidad_bajada_kbps`, `capacidad_subida_kbps`.
- `rateLimitServicio(planEfectivo, estado)` → `rx/tx ráfaga umbral tiempo prioridad limit-at`; `limitesPadrePlan(plan, activos)` → `max_limit` y `limit_at` del padre; `validarVelocidad` → 422 por campo (CIR ≤ MIR / reuso, umbral < MIR < ráfaga, rangos).
- Cambio de comportamiento: un plan sin campos nuevos conserva su velocidad, pero `rate_limit` pasa de `5000k/20000k` a la cadena completa `5M/20M 0/0 0/0 0/0 8 5M/20M` (el `limit-at` sale del reuso; con reuso 1 es el MIR).

| Acción                                                                           | Permiso                                          | Eventos                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `EditarPlan` (campos de velocidad)                                               | `planes.editar`                                  | `plan.velocidad_cambiada` (`router_id: null`)       |
| `ImplementarPlan` (excepción de velocidad, `rate_limit_override`, `profile_ppp`) | `planes.editar`                                  | `plan.velocidad_cambiada` (`router_id`)             |
| `CambiarControlVelocidad` (`POST /routers/:id/cambiar-control-velocidad`)        | `routers.cambiar_control_velocidad` (solo admin) | `router.control_cambiado`                           |
| `EditarRouter` (capacidad)                                                       | `routers.editar`                                 | `router.control_cambiado` (`campos: ['capacidad']`) |

## Resolver una IP (`consultas/ip.ts`, tarea 13)

- `GET /ip/{ip}` (permiso `ip.resolver`) y `resolverIp(ip, cliente?)` para uso interno: busca en `network.sesiones` activas (IPv4 igual, IPv6 dentro de `prefijo_enlace_v6`/`prefijo_delegado_v6`) y en asignaciones vigentes (`ipv4_asignaciones`, `ipv6_asignaciones`). Gana el prefijo más largo (una IPv4 cuenta como /32); a igual longitud, la sesión activa y luego la más reciente. Responde `{ servicio_id, cliente_id, prefijo }`, 404 si nadie la tiene, 422 si no es IP.
- Índices GiST parciales sobre los prefijos IPv6 de sesiones activas (`1761100000001_network_indices_ip`).

## Vista previa del rate-limit (semana 3)

- `POST /api/v1/planes/vista-previa` (`planes.ver`): recibe los campos de velocidad del formulario de planes (`bajada_kbps`, `subida_kbps`, `*_limitada_kbps`, `reuso`, `garantizado_pct`, `rafaga_*`, `prioridad`, opcionales `rate_limit_override` y `activos`, por defecto 1) y devuelve `vistaPreviaVelocidad` de `velocidad.ts`: `rate_limit`, `rate_limit_limitado`, `garantizado_pct_efectivo`, `limit_at_servicio_kbps` y `padre` (`limitesPadrePlan` con `activos`). 422 por campo con `validarVelocidad`, igual que crear el plan. No guarda ni audita (es una lectura).
