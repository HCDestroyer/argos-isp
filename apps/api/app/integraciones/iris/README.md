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
| `GET /integraciones/iris`                                          | `iris.ver`                                             | vista (secretos `***`)                                 |
| `GET /integraciones/iris/estado`                                   | `iris.abrir`                                           | `{ activo }` para el botón «Ver en Iris»               |
| `PUT /integraciones/iris`                                          | `iris.configurar`                                      | `iris.configurar` (con `version`)                      |
| `POST /integraciones/iris/enlace`                                  | `iris.configurar`                                      | `iris.generar_enlace`                                  |
| `GET /integraciones/iris/autorizar/vista-previa?iris=`             | `iris.configurar`                                      | lectura (sin auditoría): origen, `origen_conocido`, empresas |
| `POST /integraciones/iris/autorizar`                               | `iris.configurar`                                      | `iris.autorizar`                                       |
| `POST /integraciones/iris/conexion/canjear`                        | público (código del enlace)                            | `iris.canjear_enlace`                                  |
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
| `envios.ts` | Eventos `cliente.actualizado`, `servicio.creado`, `servicio.config_cambiada`, `asignacion.cambiada`, `servicio.estado_cambiado`, `inventario.equipo_por_recuperar`, `servicio.caidas_repetidas`, `servicio.eliminado` y `router.eliminado` → tabla `integraciones.iris_envios`. Payload con lista cerrada de campos y `empresa_id` (nunca `user_ppp`, contraseñas ni secretos); `id = argos-evt-<outbox>` estable; reintentos 1 min, 5 min, 30 min, 2 h, 12 h y luego `fallido` |
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
- **Eventos atrasados:** un `servicio.*` o `asignacion.cambiada` que llega después del
  `servicio.eliminado` sale igual con el `empresa_id` de su payload (sin la fila, `cliente_id`
  queda null si el evento no lo trae); Iris lo trata como «no existe».
