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
| `actions/generar_enlace_iris.ts`, `actions/canjear_enlace_iris.ts` | Enlace de conexión: Argos genera, Iris canjea (15 min, un uso, un enlace nuevo anula los anteriores, la misma petición repetida recibe la misma respuesta) |
| `actions/abrir_en_iris.ts`                                         | «Ver en Iris»: el servidor pide el ticket a `POST <iris>/api/v1/integraciones/argosisp/sso/tickets` con el `iris_pat_`                                     |
| `#core/integraciones_iris.ts`, `#core/usuario_tecnico.ts`          | Usuario técnico «Iris» (rol `integracion_iris`, `PERMISOS_IRIS` = §1.1 que existen en `permisos.ts`); el helper es el mismo que usa Horus                  |
| `#core/actions/emitir_ticket_sso.ts`                               | Autologin con Argos de destino, compartido con Horus (`conector: 'iris'`)                                                                                  |

Reutiliza de Horus, sin cambiarlo: `hashCodigo` y la vigencia del enlace, `generarSecretoWebhook`,
`EnlaceVencido`, `canjearEnlaceValidator`, `urlPublicaApi` y la acción `ResolverIps` del núcleo.

## Rutas y permisos

| Ruta                                                               | Permiso                                                | Acción                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| `GET /integraciones/iris`                                          | `iris.ver`                                             | vista (secretos `***`)                                 |
| `GET /integraciones/iris/estado`                                   | `iris.abrir`                                           | `{ activo }` para el botón «Ver en Iris»               |
| `PUT /integraciones/iris`                                          | `iris.configurar`                                      | `iris.configurar` (con `version`)                      |
| `POST /integraciones/iris/enlace`                                  | `iris.configurar`                                      | `iris.generar_enlace`                                  |
| `POST /integraciones/iris/conexion/canjear`                        | público (código del enlace)                            | `iris.canjear_enlace`                                  |
| `POST /integraciones/iris/abrir`                                   | `iris.abrir`                                           | `iris.abrir` (destinos `ticket`, `orden`, `prospecto`) |
| `POST /integraciones/iris/sso/tickets`                             | `sso.emitir` (solo el `atk_` de Iris)                  | `sso.emitir` (destinos `cliente`, `servicio`)          |
| `POST /integraciones/iris/resolver`                                | `ip.resolver`                                          | `ip.resolver` (pedido A8, igual que Horus)             |
| `GET/POST /integraciones/iris/tokens`, `POST …/tokens/:id/revocar` | `iris.ver`, `iris.generar_token`, `iris.revocar_token` | tokens del usuario técnico                             |

Los permisos `iris.*` son solo del `admin`.

## Eventos

No emite ni consume eventos propios. Los webhooks salientes Argos → Iris (§2.3: `cliente.actualizado`,
`servicio.*`, `asignacion.cambiada`, `inventario.equipo_por_recuperar`) los envía A6 desde `notify`
con `destinoWebhooksIris()` (`{ url, secreto, conector_id }` o null si está apagado o sin receptor),
firmados con `cabecerasFirmadas` de `#integraciones/horus/firma`. El receptor Iris → Argos
(`/api/v1/integraciones/iris/webhook`) está reservado: el canje entrega su URL y secreto, pero el
contrato aún no define eventos de Iris hacia Argos.
