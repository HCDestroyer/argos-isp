---
orden: 7
---

# Integraciones con Iris y Horus

ArgosIsp forma parte de la familia Horus junto con **Iris** (tickets, órdenes de trabajo, agenda, ventas y mensajería) y **Horus Flow** (tráfico y seguridad de la red). Cada integración es un contrato escrito que vive con el mismo texto en los dos repositorios; esta página resume qué intercambian. El detalle, con cada cuerpo y cada error, está en los contratos:

- [`contratos/iris.md`](../../.claude/integration/contratos/iris.md): versión **0.7.0** (borrador).
- [`contratos/horus.md`](../../.claude/integration/contratos/horus.md): versión **1.7.0-propuesta**.

## Principios comunes

- **Cada sistema es dueño de sus datos.** Argos es la fuente de verdad de clientes, servicios, planes, routers, zonas, facturación e inventario. Iris y Horus guardan solo una copia de lectura y la refrescan con los webhooks.
- **Independencia.** Argos nunca depende de Iris ni de Horus para RADIUS, facturación ni corte. Horus no decide cortes: ningún evento de Horus cambia el estado de un servicio.
- **Mínimo privilegio.** Cada sistema entra al otro con un token de un usuario técnico que solo tiene los permisos del contrato. En Argos es un token `atk_` que pasa por el mismo [ACL](./permisos.md).
- **Webhooks firmados** en los dos sentidos, con reintentos e id estable para deduplicar ([Webhooks](./webhooks.md)).
- **Idempotencia.** Las escrituras de otro sistema en Argos llevan `Idempotency-Key`; Iris usa `iris:<operacion>:<id>`.
- **Versionado semver.** Los campos nuevos son aditivos y los receptores ignoran lo que no conocen. Cambiar un contrato requiere dos PRs enlazadas, una por repositorio.

## Conectar

Las dos integraciones se conectan igual, sin copiar tokens a mano:

1. En un sistema, un administrador genera un **enlace de conexión** `https://<sistema>/conectar#<codigo>`: 15 minutos, un solo uso; el código va en el fragmento de la URL para que no quede en registros.
2. En el otro sistema, un administrador lo pega. Ese servidor lo canjea servidor a servidor (`POST /api/v1/integraciones/horus/conexion/canjear` o `…/iris/conexion/canjear` en Argos) y cada lado recibe el token del otro y la URL y el secreto del receptor de webhooks.
3. El conector queda **apagado** hasta que un administrador lo active.

Con Iris existe además «Conectar con un botón» (contrato Iris 0.4.0): una autorización desde el panel de Argos con `state` y PKCE S256, al estilo OAuth. También se pueden generar los tokens a mano: `POST /integraciones/horus/tokens` y `POST /integraciones/iris/tokens`.

Lo que se recibe en el canje se guarda cifrado y no se vuelve a mostrar. Solo se acepta `https`, salvo con `HORUS_PERMITIR_HTTP` o `IRIS_PERMITIR_HTTP` en laboratorio.

## Iris

| Sentido                                | Qué                                                                                                                                                                                                 | Cómo                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Iris → Argos (lectura)                 | Buscar clientes y ver su ficha, servicios, estado de cuenta resumido, planes para cotizar, routers y zonas para factibilidad, equipos en comodato, bodega del técnico                               | API de Argos con el `atk_` del usuario técnico «Iris»                                                                     |
| Iris → Argos (escritura)               | Crear cliente y servicio al ganar una venta (servicio en `pendiente_instalacion`), activar la instalación, retirar, consumos y comodatos de inventario, cargos únicos                               | Misma API, siempre con `Idempotency-Key`                                                                                  |
| Iris → Argos (atención, 0.6.0 y 0.7.0) | Registrar comprobantes de pago, reconexión temporal, promesas de pago, verificar identidad sin ver el documento, buscar cliente por teléfono, aprobar y rechazar comprobantes desde la conversación | Cabeceras `X-Iris-Actor` (`asistente_ia` o `usuario:<id>`) y `X-Iris-Conversacion`; el canal de auditoría es `ia` o `api` |
| Argos → Iris                           | Webhooks de clientes, servicios, catálogos, inventario, comprobantes y promesas                                                                                                                     | `POST <iris>/api/v1/integraciones/argosisp/webhook/{conector_id}`                                                         |
| Argos → Iris (lectura)                 | Tickets y órdenes del cliente en su ficha, abrir tickets desde el portal, enviar avisos por la mensajería de Iris                                                                                   | Token `iris_pat_…` de Iris                                                                                                |
| Iris → Argos (webhooks)                | Resultado de los avisos (`aviso.entregado`, `aviso.fallido`) y bajas de contacto (`contacto.baja`)                                                                                                  | `POST /api/v1/integraciones/iris/webhook`                                                                                 |
| Autologin                              | «Abrir en Argos» desde Iris y «Ver en Iris» desde Argos                                                                                                                                             | Ticket de 60 s y un uso ([Autenticación](./autenticacion.md#autologin-con-iris-y-horus-sso))                              |

El usuario técnico Iris solo tiene alcance por empresas (o global), nunca por router ni zona. Con aprobar y rechazar comprobantes (§7.7), el token solo abre la ruta: la acción corre y se audita como el usuario de Argos vinculado al operador de `X-Iris-Actor`, con sus permisos; con `asistente_ia` nunca vale.

## Horus

| Sentido                  | Qué                                                                                                                               | Cómo                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horus → Argos            | Resolver IP a servicio y cliente, por lotes                                                                                       | `POST /api/v1/integraciones/horus/resolver` (o `GET /api/v1/ip/{ip}`) con el `atk_` del usuario técnico «Horus» (`ip.resolver`, `clientes.ver`, `servicios.ver`, `sso.emitir`) |
| Argos → Horus (webhooks) | Cambios de IP y de sesión, de cliente, de estado del servicio y de plan o empresa                                                 | `POST <horus>/api/v1/integrations/argosisp/webhook/{connector_id}`                                                                                                             |
| Argos → Horus (lectura)  | Consulta 360 por IP o por servicio (consumo, salud, seguridad), consumo por lotes, salud de la red, estado de seguridad por lotes | Token `hf_pat_…` de Horus                                                                                                                                                      |
| Horus → Argos (webhooks) | Hallazgos de seguridad, cambio de estado de seguridad, estado de routers y servicios de infraestructura                           | `POST /api/v1/integraciones/horus/webhook`                                                                                                                                     |
| Autologin                | «Ver en Horus» / «Ver en ArgosISP»                                                                                                | Ticket de 60 s y un uso                                                                                                                                                        |

## Relacionado

- [Autenticación](./autenticacion.md), [Webhooks](./webhooks.md), [Eventos](./eventos.md)
- Rutas en la referencia: [Integraciones](./referencia/integraciones.md)
