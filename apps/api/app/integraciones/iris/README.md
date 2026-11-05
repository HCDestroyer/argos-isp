# integraciones/iris · Conector con Iris (A1)

Iris (operación de campo: tickets, órdenes, agenda y comercial) lee y escribe en Argos con el token
del usuario técnico «Iris», y Argos abre sus tickets, órdenes y prospectos con autologin. Contrato
espejo: `.claude/integration/contratos/iris.md` (§1; pedidos A2 y A8). Mismo patrón que el conector
Horus (`app/integraciones/horus`, contrato `horus.md` §1), con sus propias tablas.

## Reglas

- **Argos funciona completo sin Iris.** El conector viene **apagado**; nada de AAA, facturación,
  corte ni portal llama a este módulo.
- **Secretos** (`iris_pat_`, secreto del receptor de Iris, secreto del receptor de Argos) cifrados
  con `app/shared/cifrado.ts`; salen como `***` en la API y en la auditoría.
- **Sin caché**: la configuración se lee de la base en cada uso (`configIris`), así no hay nada que
  invalidar (regla 5).
- `IRIS_PERMITIR_HTTP=true` (laboratorio) permite `http://`; en producción solo `https://`.

## Piezas

| Archivo                                                            | Qué hace                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuracion.ts`                                                 | Fila única `integraciones.iris_conector`, vista del panel, escritura con diff y `destinoWebhooksIris()` para A6                                            |
| `actions/configurar_iris.ts`                                       | `iris.configurar`: URL, token y receptor a mano (alternativa al enlace)                                                                                    |
| `actions/generar_enlace_iris.ts`, `actions/canjear_enlace_iris.ts` | Enlace de conexión: Argos genera, Iris canjea (15 min, un uso, un enlace nuevo anula los anteriores, la misma petición repetida recibe la misma respuesta). Desde el contrato 0.3.1 el canje informa `alcance_global` y `empresas[]` (`id`, `nombre` comercial, `nit` o null) del alcance del usuario técnico Iris |
| `actions/autorizar_iris.ts`, `autorizacion.ts`                     | «Conectar con un botón» (contrato 0.4.0 §1.4): origen de Iris, PKCE S256, `crearCodigoIris` (el mismo código del enlace, compartido con `generar_enlace_iris.ts`) y la vista previa de la pantalla. Ver abajo |
| `actions/informar_contrato_iris.ts`                                | `PUT /integraciones/iris/contrato` (contrato 0.5.0): Iris informa la versión del contrato que habla; ver «Versión y compatibilidad» |
| `actions/abrir_en_iris.ts`                                         | «Ver en Iris»: el servidor pide el ticket a `POST <iris>/api/v1/integraciones/argosisp/sso/tickets` con el `iris_pat_`; `usuario.correo_verificado` siempre `false` (0.3.1)                                  |
| `#core/integraciones_iris.ts`, `#core/usuario_tecnico.ts`          | Usuario técnico «Iris» (rol `integracion_iris`, `PERMISOS_IRIS` = §1.1 que existen en `permisos.ts`); el helper es el mismo que usa Horus                  |
| `#core/actions/emitir_ticket_sso.ts`                               | Autologin con Argos de destino, compartido con Horus (`conector: 'iris'`)                                                                                  |

Reutiliza de Horus, sin cambiarlo: `hashCodigo` y la vigencia del enlace, `generarSecretoWebhook`,
`EnlaceVencido`, `urlPublicaApi` y la acción `ResolverIps` del núcleo. El canje tiene su propio
validador (`canjearEnlaceIrisValidator`: el de Horus más `code_verifier`); el canje de Horus no cambia
(ni `code_verifier` ni `panel_url`).

## Rutas y permisos

| Ruta                                                               | Permiso                                                | Acción                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| `GET /integraciones/iris`                                          | `iris.ver`                                             | vista (secretos `***`, `requiere_reconectar`, 0.6.2)   |
| `GET /integraciones/iris/estado`                                   | `iris.abrir` o el `atk_` de Iris                       | `{ activo, version_argos, contrato }` (botón «Ver en Iris»; Iris lee las versiones) |
| `PUT /integraciones/iris/contrato`                                 | `sso.emitir` (solo el `atk_` de Iris)                  | `iris.informar_contrato`                               |
| `PUT /integraciones/iris`                                          | `iris.configurar`                                      | `iris.configurar` (con `version`)                      |
| `POST /integraciones/iris/enlace`                                  | `iris.configurar`                                      | `iris.generar_enlace`                                  |
| `GET /integraciones/iris/autorizar/vista-previa?iris=`             | `iris.configurar`                                      | lectura (sin auditoría): origen, `origen_conocido`, empresas |
| `POST /integraciones/iris/autorizar`                               | `iris.configurar`                                      | `iris.autorizar`                                       |
| `POST /integraciones/iris/conexion/canjear`                        | público (código del enlace)                            | `iris.canjear_enlace`                                  |
| `POST /integraciones/iris/conexion/revocar`                        | `sso.emitir` (solo el `atk_` de Iris, que se revoca)   | `iris.revocar_conexion` (204; repetido → 401, 0.6.3)   |
| `POST /integraciones/iris/abrir`                                   | `iris.abrir`                                           | `iris.abrir` (destinos `ticket`, `orden`, `prospecto`) |
| `POST /integraciones/iris/sso/tickets`                             | `sso.emitir` (solo el `atk_` de Iris)                  | `sso.emitir` (destinos `cliente`, `servicio`)          |
| `POST /integraciones/iris/resolver`                                | `ip.resolver`                                          | `ip.resolver` (pedido A8, igual que Horus)             |
| `GET/POST /integraciones/iris/tokens`, `POST …/tokens/:id/revocar` | `iris.ver`, `iris.generar_token`, `iris.revocar_token` | tokens del usuario técnico                             |

Los permisos `iris.*` son solo del `admin`.

## Conectar con un botón (contrato 0.4.0 §1.4)

Alternativa al enlace de §1.3 (que sigue igual): el admin pulsa «Conectar con Argos» en Iris, Iris
abre `<panel>/integraciones/iris/autorizar?iris=&state=&code_challenge=&code_challenge_method=S256`
y el admin aprueba en Argos.

- **Origen.** `iris` se normaliza a `https://host[:puerto]` (`normalizarOrigenIris`; `http://` solo
  con `IRIS_PERMITIR_HTTP`; sin usuario, ruta, consulta ni fragmento → 422 `iris_origen_invalido`).
  Es **conocido** si coincide con el origen de la URL del conector Iris o con `ARGOSISP_IRIS_ORIGENES`
  (lista separada por espacios). Si no, `confirmar_origen` debe ser su host (con puerto si lo lleva,
  sin distinguir mayúsculas): si falta o no coincide, 422 `iris_origen_no_confirmado`.
- **PKCE.** `code_challenge` base64url de 43 caracteres (422 `code_challenge_invalido`);
  `code_challenge_method` solo `S256`. `state`: 16 a 256 caracteres `A-Z a-z 0-9 . _ ~ -` (422 de
  validación).
- **Código.** `crearCodigoIris`: el mismo de §1.3 (15 min, un uso, anula los anteriores sin usar de
  los dos tipos, solo su SHA-256), con `code_challenge` y `origen_iris` en `integraciones.iris_enlaces`.
- **Respuesta.** `{ redirigir_a: <iris>/administracion/integraciones/argos/vuelta#codigo=…&api=<API_PUBLIC_URL>&state=… }`,
  valores codificados para URL y todo en el fragmento. La auditoría (`iris.autorizar`) guarda
  `codigo: ***`, el origen y si era conocido; no emite evento (como el enlace).
- **Canje.** Un código con `code_challenge` exige `code_verifier` (43 a 128 caracteres) y compara
  `base64url(SHA-256(verifier))` en tiempo constante. Si falta o no coincide: 401 `codigo_invalido`,
  el error queda auditado y el código queda gastado (`rechazado_en`; después, 410). El enlace de §1.3
  no lo pide. `code_verifier` se audita como `***`.
- **`panel_url`.** El canje responde además `panel_url` (`PANEL_URL_PUBLICA`, la misma variable del
  autologin; en `docker-compose.produccion.yml` es `https://${DOMINIO_PANEL}`). Una respuesta guardada
  antes de 0.4.0 se completa con el valor actual al repetirse.
- **Vista previa** (`vistaPreviaAutorizacionIris`): `{ origen_normalizado, origen_conocido,
  alcance_global, empresas[] }` con las mismas empresas que el canje (`empresasDelAlcance` del usuario
  Iris; si aún no existe, nacerá global: todas las activas).
- Rechazar no llama a la API: el panel navega a `<iris>/…/vuelta#error=rechazado&state=…`.

## Versión y compatibilidad (contrato 0.5.0, §3.3)

- **`version_argos` y `contrato`.** El canje (las dos variantes, §1.3 y §1.4) y
  `GET /integraciones/iris/estado` responden `version_argos` (la versión instalada,
  `ARGOSISP_VERSION` de la imagen vía `versionInstalada()` de `#monitoreo/version`, la misma de
  `GET /version`; `desarrollo` fuera de una imagen publicada) y `contrato` (`CONTRATO_IRIS`, hoy
  `"0.6.4"`: la versión del contrato que habla este Argos). Una repetición del canje sale con los
  valores actuales.
- **Contrato del conector.** El canje acepta `contrato` opcional (semver, `FORMATO_SEMVER`; 422 si no
  lo es) y lo guarda en `integraciones.iris_conector.contrato` (diff en `audit.cambios`). Sin él queda
  null: un Iris anterior a 0.5.0. Reconectar sin `contrato` lo vuelve a null. Entra en el hash de
  idempotencia del canje solo si viene (el de una petición sin él no cambia).
- **`PUT /integraciones/iris/contrato { contrato }`** (`iris.informar_contrato`): lo actualiza, p. ej.
  cuando Iris se actualiza sin reconectar. Solo el `atk_` del usuario técnico Iris (403 a cualquier
  otra credencial, aunque sea admin; con conector preparado por enlace, solo el `atk_` de ese canje,
  como el autologin); funciona con el conector apagado. Permiso de la ruta: **`sso.emitir`**, el mínimo
  que el token de Iris ya tiene (§1.1): un permiso nuevo no llegaría a los tokens ya emitidos (el
  token recorta a `PERMISOS_IRIS` al crearse) y obligaría a reconectar cada Iris. Responde
  `{ contrato_iris, version_argos, contrato }`.
- **`GET /integraciones/iris/estado`** acepta `iris.abrir` (panel) o el `atk_` de Iris (que no tiene
  `iris.abrir`); la ruta es `permiso: null` y lo comprueba `exigirEstadoIris`. Cualquier otro: 403.
- **`conectorAdmite(version)`** (`configuracion.ts`, para A6): true si el contrato guardado es ≥
  `version` (semver con prerelease: `0.5.0-rc.1 < 0.5.0`); sin conector, sin contrato o con uno que
  no es semver, false. Los webhooks nuevos de 0.5.0 (`servicio.datos_cambiados`,
  `catalogo.cambiado`, `inventario.traslado_*`) solo deben salir con `conectorAdmite('0.5.0')`.
  `compararSemver` y `contratoAdmite` son las funciones puras.

## Receptor de Argos y «hay que volver a conectar» (contrato 0.6.2)

- **`receptor_argos`** (boolean, opcional) en el cuerpo del canje (§1.3 y §1.4) y de
  `PUT /integraciones/iris/contrato`: si Iris tiene guardados la `url` y el `secreto` del receptor
  de Argos que entrega el canje. Se guarda en `integraciones.iris_conector.receptor_argos`
  (migración `1793889354405_alter_iris_conector_receptor_argos_table`, diff en `audit.cambios`).
  - Canje: con B1, Iris siempre manda `true`. Sin el campo (un Iris anterior) queda **null**; un
    canje nuevo siempre reemplaza el valor anterior. Entra en el hash de idempotencia solo si viene.
  - `PUT`: Iris manda `false` en los conectores canjeados antes de B1. Sin el campo se **conserva**
    el último informado (un Iris que solo informa su contrato no lo borra).
  - Otro tipo (`"si"`, `1`): 422 en `receptor_argos`.
- **`GET /integraciones/iris`** responde `requiere_reconectar` (boolean) y `motivo_reconectar`
  (string o null, `MOTIVO_RECONECTAR_RECEPTOR`). `true` **solo** cuando el último `receptor_argos`
  es `false`; null (nunca informado), `true` o sin conector → `false` y `null`. No se infiere nada del
  contrato ni de la fecha del canje (`reconexionIris(fila)` en `configuracion.ts`). Se quita al volver a
  conectar con B1 (el canje deja `true`) o con un `PUT { receptor_argos: true }`.
- **Host del receptor.** El canje arma `webhook.url` como `<base>/api/v1/integraciones/iris/webhook`
  con la **misma** `base` guardada en el enlace al generarlo (`baseArgos`: `API_PUBLIC_URL`, si no
  `NOTIFY_API_URL`, si no protocolo + host de la petición). Esa base es la que Iris recibe: el enlace
  de §1.3 es `<base>/conectar#…` y en §1.4 va como `api=<base>` en el fragmento. Por eso el host
  coincide siempre con la base de Argos que conoce Iris; **no** coincide con `panel_url` (en
  producción el panel y la API tienen dominios distintos). Prueba: `tests/core/iris_receptor_062.spec.ts`.

## Token huérfano de un canje y reconexión (contrato 0.6.3)

Si Iris rechaza la respuesta de un canje (por ejemplo `422 webhook_invalido`), el `atk_` y el
conector ya existían en Argos. Y al reconectar, Iris sigue usando su conector anterior hasta activar
el nuevo. Reglas:

- **Confirmación = primera llamada autenticada** del `atk_` de un canje (cualquiera). La hace el guard
  de tokens (`token_api_guard.ts` → `esCanjeIrisPorConfirmar` → `actions/confirmar_canje_iris.ts`,
  `iris.confirmar_canje`) **antes** de atender esa llamada, así la llamada ya ve el conector nuevo.
  Excepción: la primera llamada a `POST /integraciones/iris/conexion/revocar` no confirma. Si el guard
  falla, el cron la confirma después (ve `core.tokens_api.ultimo_uso`).
- **Canje directo** (no hay conector en uso: sin fila, desconectado, sin `iris_pat_`, o con un canje
  que nadie confirmó): reemplaza el conector al momento, como antes: apagado, `atk_` anterior
  revocado, canje pendiente de confirmar (`canje_confirmado_en = null`).
- **Reconexión** (`conectorIrisEnUso`: conector con `iris_pat_`, no desconectado y, si vino de un
  enlace, ya confirmado; también uno configurado a mano): el canje **no toca** el conector. Guarda el
  juego nuevo en `pendiente_token_argos_id`, `pendiente_canjeado_en` y `pendiente_secreto_cifrado`
  (`JuegoPendienteIris` cifrado entero: `url_base`, `iris_pat_`, receptor de Iris y su secreto,
  secreto del receptor de Argos, `contrato`, `receptor_argos`; en `audit.cambios` sale `***`).
  - Hasta confirmar, el conector sigue con su `atk_`, URL, `iris_pat_`, secretos, `contrato`,
    `receptor_argos` y `activo`.
  - Al confirmar (primera llamada del `atk_` nuevo) se aplica todo el juego, `token_argos_id` pasa al
    nuevo, `conectado_por_enlace_en` = hora del canje nuevo, `canje_confirmado_en` = ahora, y se
    **revoca el `atk_` anterior**. `activo` no cambia: la integración no se corta.
  - Si el `atk_` nuevo se revoca (endpoint) o vence sin uso (24 h), el juego se descarta y el
    conector anterior queda vivo y sin cambios.
  - Un canje nuevo con una reconexión pendiente la reemplaza (revoca su `atk_`).
  - `GET /integraciones/iris`: `reconexion_pendiente_desde` y `reconexion_vence_en` (opcionales).
- **`POST /integraciones/iris/conexion/revocar`** (`actions/revocar_conexion_iris.ts`,
  `iris.revocar_conexion`): con el mismo `atk_`, sin cuerpo, 204. Revoca ese token. Si es el de una
  reconexión pendiente, la descarta (conector sin cambios). Si es el del conector, lo desconecta
  (`desconexion.ts`): apagado, sin el `iris_pat_` ni los dos secretos de webhooks, `desconectado_en` y
  `motivo_desconexion = revocado_por_iris`; conserva URL, receptor, `conector_id`, `token_argos_id` y
  contrato. Repetido → 401 (ya no autentica). Otra credencial → 403. Sin evento: nadie consume el
  estado del conector por evento y los envíos lo leen de la base. Repetir el canje cuyo token ya se
  revocó → 410.
- **Cron `iris_canjes_sin_uso`** (`app/core/jobs.ts`, cada 5 min, con lock) →
  `actions/vencer_canje_iris.ts` (`iris.vencer_canje`): confirma lo que el guard no alcanzó, descarta
  la reconexión sin uso a las 24 h (`PLAZO_CONFIRMAR_CANJE_IRIS_MS`) y desconecta el canje directo
  sin uso a las 24 h (`motivo_desconexion = canje_sin_uso`). Solo llama a la acción (y solo audita)
  si hay algo que hacer. No es un TTL de caché (regla 5): es el vencimiento auditado de una
  credencial que nadie aceptó.
- Migraciones `1793893516316_alter_iris_conector_canje_063_table` (las filas existentes quedan
  confirmadas) y `1793894670907_alter_iris_conector_reconexion_table` (columnas `pendiente_*`).
- **Compatibilidad.** Un Iris anterior nunca llama a revocar y usa el `atk_` al activar su conector
  (PUT del contrato y primera carga de catálogos), antes de que venza su propio `iris_pat_` (15 min).
- `GET /integraciones/iris` responde `estado_canje` (`pendiente` | `confirmado` | `desconectado` |
  null sin enlace), `canje_vence_en`, `desconectado_en` y `motivo_desconexion` (opcionales en el
  OpenAPI). Encender a mano un conector desconectado (`PUT /integraciones/iris` con `activo: true` y
  un `iris_pat_` nuevo) lo deja **configurado a mano**: sin `conectado_por_enlace_en`, `token_argos_id`
  ni `canje_confirmado_en` (`estado_canje: null`, `canje_vence_en: null`) y sin reconexión pendiente;
  el barrido no lo vuelve a tomar. Iris usa entonces un `atk_` creado en el panel.
- Prueba: `tests/core/iris_revocar_063.spec.ts`.

## Pagos y atención (contrato 0.6.0, §1.1, §7.1, §7.5, §7.6; parte de A1)

- **Permisos del usuario técnico** (§1.1 con los nombres de §9.1): `PERMISOS_IRIS_CONTRATO` suma
  `cuentas_bancarias.ver`, `comprobantes.registrar`, `comprobantes.ver`,
  `comprobantes.reconexion_temporal`, `promesas.ver`, `promesas.crear` y
  `clientes.verificar_identidad` (`PERMISOS_IRIS_060`). `pagos.reportar`,
  `servicios.reconexion_temporal` y `clientes.buscar_por_telefono` no existen en Argos. La migración
  `1793862211681_alter_permisos_iris_060` los suma al rol `integracion_iris` y a los tokens vigentes
  que recortan permisos (idempotente, con diff en `audit.cambios`), como la de 0.5.0.
- **Webhooks de 0.6.0** (`comprobante.aprobado` / `.rechazado`, `promesa.creada` / `.cumplida` /
  `.incumplida` / `.cancelada`): `EVENTOS_IRIS_DESDE_060` y `CONTRATO_EVENTOS_060` en
  `configuracion.ts`; solo a conectores con `conectorAdmite('0.6.0')` (lo aplica A6 en `envios.ts`;
  `contratoMinimoEventoIris(evento)` dice la versión mínima).
- **Cabeceras de atención** (`atencion.ts`): con el `atk_` de Iris, las rutas que declaran
  `cabecerasIris` en `definirRuta` exigen `X-Iris-Actor` (`asistente_ia` | `usuario:<id>`, id de hasta
  64 `A-Z a-z 0-9 _ -`) y `X-Iris-Conversacion` (hasta 128 `A-Z a-z 0-9 . _ : -`); si faltan o están mal
  formadas, `400 cabecera_iris_requerida`. Quedan en `ctx.iris` → `ContextoAccion.iris` y en
  `audit.acciones.iris_actor` / `iris_conversacion` (buscables con
  `GET /bitacora/acciones?iris_conversacion=`). Canal: `ia` con `asistente_ia`, `api` con
  `usuario:<id>` (no existe un canal `integracion`). Otros actores no las necesitan y se ignoran.
- **Documento oculto**: `despachar` (`#shared/rutas`) pasa toda respuesta JSON del `atk_` de Iris por
  `ocultarDocumentoIris`: `nit_cui` sale `"***"` (null sigue null). `GET /clientes?q=` con ese token no
  compara contra el documento. Los webhooks a Iris no llevan valores de documento (solo el nombre
  `nit_cui` en `campos[]` de `cliente.actualizado`).
- **`POST /integraciones/iris/verificar-identidad`** (`clientes.verificar_identidad`, acción
  `#core/actions/verificar_identidad_cliente`): `{ cliente_id, metodo, valor }` → `{ coincide }`.
  Ver `app/core/README.md`.
- **`GET /clientes?telefono=`** (A20): filtro exacto con `coincide_en[]`; con el `atk_` de Iris exige
  las cabeceras. Ver `app/core/README.md`.

## Eventos

No emite ni consume eventos propios. Los webhooks salientes Argos → Iris (§2.3: `cliente.actualizado`,
`servicio.*`, `asignacion.cambiada`, `inventario.equipo_por_recuperar`) los envía A6 desde `notify`
con `destinoWebhooksIris()` (`{ url, secreto, conector_id }` o null si está apagado o sin receptor),
firmados con `cabecerasFirmadas` de `#integraciones/horus/firma`. El receptor Iris → Argos
(`/api/v1/integraciones/iris/webhook`) está reservado: el canje entrega su URL y secreto, pero el
contrato aún no define eventos de Iris hacia Argos.

## Webhooks Argos → Iris (A6)

Contrato §1.3 y §2.3. `node ace iris:worker` (servicio `iris-worker` del compose) consume el grupo
`iris` del bus y entrega cada 5 s, con el motor común con Horus (`../webhooks_salientes.ts`).

| Archivo | Qué hace |
| --- | --- |
| `envios.ts` | Eventos `cliente.actualizado`, `servicio.creado`, `servicio.config_cambiada`, `asignacion.cambiada`, `servicio.estado_cambiado`, `inventario.equipo_por_recuperar`, `servicio.caidas_repetidas`, `servicio.eliminado`, `router.eliminado`, `servicio.datos_cambiados`, `catalogo.cambiado` e `inventario.traslado_enviado` / `_recibido` / `_cancelado` → tabla `integraciones.iris_envios`. Payload con lista cerrada de campos y `empresa_id` (nunca `user_ppp`, contraseñas ni secretos); `id = argos-evt-<outbox>` estable; reintentos 1 min, 5 min, 30 min, 2 h, 12 h y luego `fallido` |
| `consumidor.ts` | `ConsumidorIris` (grupo `iris`) |
| `envios_panel.ts` | `GET /integraciones/iris/envios` y `GET /integraciones/iris/envios/resumen` (`iris.ver`): estado, pendientes, fallidos, último error, destino y alcance |

- Solo con `destinoWebhooksIris()` (conector activo con receptor). Un pendiente que encuentra el
  conector apagado queda `descartado`.
- **Alcance:** solo eventos de las empresas del usuario técnico «Iris» (`core.usuarios_empresas` o
  alcance global); sin usuario técnico activo no se envía nada. `cliente.actualizado` no trae
  empresa: se usan las de los servicios no retirados del cliente (`empresas[]`, y `empresa_id` = la
  primera), recortadas al alcance. Un cambio de empresa (`campos: ['empresa']`) sale si la nueva o
  la anterior está en el alcance.
- **Eliminados** (`contratos/eliminar.md` §A6, espejo `iris.md` 0.3.1): `servicio.eliminado`
  (`servicio_id`, `empresa_id`, `cliente_id`, `router_id`) y `router.eliminado` (`router_id`,
  `empresa_id` o null) se arman solo con el payload del evento: la fila ya no existe y no se busca.
  Iris quita su instantánea. Un `router.eliminado` sin empresa (router compartido) llega a
  cualquier conector, como `GET /routers` muestra esos routers a cualquier alcance; con empresa,
  solo si está en el alcance.
- **Datos del servicio y catálogos** (contrato 0.5.0, pedidos A10 a A15):
  `servicio.datos_cambiados` (`servicio_id`, `empresa_id`, `empresas[]` = `[empresa_id]`,
  `cliente_id`, `campos[]` ⊂ `direccion`, `coordenadas`, `referencia`, `contacto_nombre`,
  `contacto_telefono`; solo nombres) sigue el alcance de la empresa del servicio.
  `catalogo.cambiado` (`catalogo`: `zona`·`plan`·`router`, `id`, `empresa_id`, `campos[]`:
  `nombre`, `activo` y, en routers, `coordenadas`; se reenvían todos los que traiga) no trae
  servicio: con `empresa_id` null (zona o router compartido; los planes siempre) llega a cualquier
  conector, como `router.eliminado`; con empresa, solo si está en el alcance. Un `catalogo`
  desconocido no se envía. `cliente.actualizado` reenvía todos sus `campos[]` (también `email` y
  `referencia` desde 0.5.0); nunca valores.
- **Traslados** (contrato 0.5.0, §2.3 y §3.3; los emite A3): `inventario.traslado_enviado`
  (`traslado_id`, `empresa_id`, `bodega_destino_id`, `tecnico` `{ id_externo, correo }` o null,
  `estado`, `lineas[]` `{ producto_id, cantidad, series[] }`, `enviado_en`), `_recibido` (más
  `recibido_en`, `recibido_por`, `metodo_recepcion`, `origen` `iris`·`panel`) y `_cancelado` (más
  `cancelado_en`, `motivo`). Lista cerrada de §2.3 con los valores tal cual los emite A3: no salen
  `numero`, `registrado_por` ni `faltantes` (Iris lee la orden con `GET /inventario/traslados/:id`),
  y nunca la firma. Siguen el alcance de la empresa de la orden.
- **Filtro por contrato** (0.5.0): `servicio.datos_cambiados`, `catalogo.cambiado` y los tres de
  traslado (`EVENTOS_DESDE_050`) solo se registran si `conectorAdmite('0.5.0')` (contrato informado
  por Iris ≥ 0.5.0); con un conector sin contrato (Iris anterior) o con uno menor no salen, como un
  evento fuera de alcance. Los demás eventos no cambian. Un envío ya registrado sale aunque el
  contrato cambie después (el contrato solo sube).
- **Pagos y atención** (contrato 0.6.0, §7.2 y §7.4; `EVENTOS_DESDE_060`, solo con
  `conectorAdmite('0.6.0')`): `comprobante.aprobado` / `.rechazado` (`comprobante_id`, `empresa_id`,
  `cliente_id`, `servicio_id`, `canal`, `monto`, `pago_id`, `motivo`, `causa`, `servicio_estado`) y
  `promesa.creada` / `.cumplida` / `.incumplida` / `.cancelada` (`promesa_id`, `empresa_id`,
  `cliente_id`, `servicio_id`, `tipo`, `canal`, `comprobante_id`, `vence`, `monto`; `motivo` solo en
  `cancelada`), de cualquier canal dentro del alcance. Lo que el evento no trae se completa con
  `billing.comprobantes` / `billing.promesas`; sin `causa` el rechazo sale `otro`, sin `tipo` es
  `promesa`. Nunca la imagen ni la referencia bancaria.
- **Receptor Iris → Argos** (contrato 0.6.0 §6.6, A6): `POST /integraciones/iris/webhook` (ya no
  reservado; `receptor.ts`, `actions/recibir_webhook_iris.ts`, tabla `integraciones.iris_recibidos`).
  Misma firma `v1=` que Horus con el secreto de entrada del canje, ±5 min, 503 `iris_apagado` con el
  conector apagado, deduplicado por `X-Webhook-Id`. `aviso.entregado` / `aviso.fallido` cierran el
  envío de notify por `idempotency_key`; `contacto.baja` deja de pedir WhatsApp a ese cliente
  (`app/notify/README.md`, «WhatsApp por la mensajería de Iris»).
- **Eventos atrasados:** un `servicio.*` o `asignacion.cambiada` que llega después del
  `servicio.eliminado` sale igual con el `empresa_id` de su payload (sin la fila, `cliente_id`
  queda null si el evento no lo trae); Iris lo trata como «no existe».
