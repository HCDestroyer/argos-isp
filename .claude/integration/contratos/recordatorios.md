# Contrato: plantillas de recordatorio

Lote L0 del plan v3 (`plan-servicios-suscripciones-recordatorios.md`, §1.5, §2.6, §2.7 y §3.6). Decisión del PM (26 nov 2026, P-N9 y P-N12): plantillas con nombre como las de facturación, asignadas por servicio o suscripción, con una por defecto en cada empresa y excepción personalizada por servicio; **no van por zona ni son push**; **con Iris conectado, Iris entrega por los canales que declara para la empresa** (ajuste de Iris: hoy solo WhatsApp; Telegram sigue en Argos, decisión del líder); Argos usa sus canales propios para los que Iris no declara y todos si Iris no está conectado. Argos decide qué y cuándo. Dueño: A6 (`notify`), con A3 para `fechaCortePrevista`. Lotes R1 a R5. Contrato con Iris: `iris.md` 0.15.0 bloque C (propuesta aceptada por Iris con ajustes, pendiente de la PR espejo; la versión vigente sigue en 0.14.3).

## 1. Estado actual (lo que se reemplaza)

- `notify.recordatorios`: tres filas globales fijas (`orden` 1 a 3), con `dias` respecto a `vence_en` (−60 a 60), `hora` y `activo`; sin `empresa_id`, sin nombre y sin asignación. Cron cada minuto en `notify-cron`, concurrencia 1, todo lo pendiente hasta ahora, lotes de 200, ventana de 7 días. Toma el recordatorio activo más reciente cuyo momento ya pasó (no manda tres atrasados). Idempotencia: origen `recordatorio:<orden>:factura:<id>`, único con `(origen, cliente_id, canal)` en `notify.envios`.
- Textos en `notify.plantillas` (globales, `UNIQUE (evento, canal)`, eventos `recordatorio.1` a `recordatorio.3`).
- No recuerda facturas `por_certificar`, sustituidas ni de un servicio `pendiente_instalacion`. No hay «corte próximo» ni «promesa por vencer».

## 2. Modelo (R1; schema `notify`)

- `notify.plantillas_recordatorio`: `empresa_id NOT NULL`, `nombre`, `descripcion`; `por_defecto boolean` (índice único parcial: una por empresa); `servicio_id bigint NULL` (con valor es la plantilla **personalizada** de ese servicio: única por servicio, no aparece en la lista general ni se asigna a otros); `retirada_en`, `retirada_por`, `motivo_retiro`, `version`. `UNIQUE (empresa_id, nombre)` entre las que no son personalizadas.
- `notify.plantillas_recordatorio_pasos` (hasta **8** por plantilla): `plantilla_id`, `orden` (`UNIQUE (plantilla_id, orden)`); `disparador`: `vencimiento` (días antes o después de `vence_en`), `corte_proximo` (días antes del corte previsto), `promesa_por_vencer` (días antes de que venza la promesa); `dias integer` (negativo antes, positivo después; −60 a 60); `hora time` (hora de Guatemala); `aviso`: código que se pide a Iris (`factura_por_vencer`, `factura_vencida`, `corte_proximo`, `promesa_por_vencer`); `evento_plantilla`: texto local de respaldo en `notify.plantillas` (`recordatorio.1` a `.3` y los nuevos `recordatorio.corte_proximo`, `recordatorio.promesa_por_vencer`); `canales text[]` (`whatsapp`, `correo`, `telegram`; vacío = los que Iris declare para la empresa, más los propios de Argos para el resto); `activo`, `version`.
- `notify.recordatorios_asignaciones`: `empresa_id`, `plantilla_id`, `servicio_id NULL`, `suscripcion_id NULL`, `asignada_por`, `version`. CHECK: exactamente uno de los dos; único por servicio y único por suscripción. Vive en `notify`: no agrega columnas a `core.servicios` ni a `billing.suscripciones`.
- Un servicio solo recibe plantillas de su empresa (trigger). Las plantillas de facturación son globales; las de recordatorio **sí** llevan `empresa_id`.

## 3. Qué plantilla aplica

Función única `plantillaRecordatorioEfectiva` (`apps/api/app/notify/plantillas_recordatorio.ts`):

1. La personalizada del servicio de la factura, si existe.
2. La asignada a ese servicio o a esa suscripción.
3. La por defecto de la empresa de la factura.

Una factura sin servicio ni suscripción (cargo único suelto) usa la por defecto de su empresa. No hay nivel de zona ni nivel global.

## 4. Reglas

- **Migración.** Por cada empresa se crea «Estándar», por defecto, con los tres recordatorios actuales como pasos de `vencimiento` (mismos `dias`, `hora` y `activo`). `notify.recordatorios` queda de solo lectura hasta retirarla en un lote posterior. Con la plantilla «Estándar» el cron produce **exactamente los mismos envíos que antes** (prueba de regresión obligatoria). Una empresa nueva recibe su «Estándar» por consumidor.
- **Personalizados por servicio:** un conjunto propio de pasos que sustituye completo al de la plantilla para ese servicio. Lo crea soporte desde la ficha (P-N15, abierta; recomendado: admin y soporte, con auditoría), con diff en la auditoría; `quitar` devuelve al servicio a su plantilla asignada o a la por defecto. Las suscripciones **no** tienen personalizados en esta ronda.
- **Cambios de plantilla:** editar los pasos no reenvía lo ya enviado. Retirar una plantilla no la quita de quien la tiene; solo impide asignarla (asignar una retirada: 409). La por defecto no se puede retirar sin fijar otra (409); fijar otra por defecto desplaza a la anterior en la misma transacción.
- **Edición** con `version` vieja: 409. Más de 8 pasos u `orden` repetido: 422. Servicio eliminado: limpia su asignación.
- **Idempotencia:** el origen depende del paso y del documento, no de la plantilla (cambiar de plantilla a mitad de mes no reenvía el paso que ya salió): `recordatorio:<orden>:factura:<id>` (`vencimiento`, el de hoy), `recordatorio:corte:<orden>:factura:<id>` y `recordatorio:promesa:<orden>:promesa:<id>`.

## 5. Disparadores y programación (R2)

- El cron `notify-cron` sigue siendo el único que programa: todo lo pendiente hasta ahora, con lock, en lotes. Por cada factura cobrable resuelve la plantilla efectiva y toma, de sus pasos activos, el más reciente cuyo momento ya pasó y que no se haya enviado.
- Siguen fuera las facturas `por_certificar`, sustituidas, pagadas y las de un servicio `pendiente_instalacion`.
- `vencimiento`: `vence_en + dias` a la `hora` del paso, en hora de Guatemala.
- `corte_proximo`: `dias` antes de la fecha en que `evaluarEstadoServicio` cortaría (o `suscripciones.evaluar_estado` suspendería) si nada cambia. notify **no** calcula esa fecha: A3 expone `fechaCortePrevista`, función de solo lectura con las mismas reglas de plantilla y excepciones (debe coincidir con la fecha en que `ejecutar_corte` corta). Sin fecha prevista, o con promesa activa o factura pagada, el paso no sale.
- `promesa_por_vencer`: `dias` antes del `vence` de una promesa activa del servicio; una vez por promesa.

## 6. Entrega (R3)

Con la decisión del PM del 26 nov y los ajustes de Iris (`iris.md` §13.3, C1 a C14):

| Situación | Qué hace Argos |
| --- | --- |
| Iris con contrato ≥ 0.15.0 y `capacidades.mensajeria[].entrega_auto` para la empresa, y los canales del paso tienen intersección con `canales[].canal` | **Un solo envío**, canal `iris`, con `canal_preferido: "auto"` y `canales_permitidos` = esa intersección. Iris usa **un solo canal por aviso**, en el orden de la empresa, y pasa al siguiente solo antes del primer envío y por causas del canal; aplica permiso, límite diario y silencio. Argos **no** manda ese aviso por su correo ni Telegram. El estado final y el canal real llegan en un único `aviso.entregado` o `aviso.fallido` |
| La intersección queda vacía | No se usa `auto`: Argos envía por sus propios canales |
| Los canales del paso que Iris no declara | Los sigue enviando Argos, con el texto de `evento_plantilla` |
| Iris entre 0.6.0 y 0.14.x | Como hoy: WhatsApp por Iris con `canal_preferido: "whatsapp"` (solo los códigos que ese Iris conoce) y correo y Telegram desde Argos |
| Sin Iris | Correo y Telegram desde Argos con el texto de `evento_plantilla`. Un paso sin canal posible queda `omitido` con su motivo; nada se inventa |

- `entrega_auto` es `true` solo si la empresa tiene al menos un canal declarado. Argos lee las marcas solo de `GET …/capacidades` y las relee al activar la integración, en la revisión periódica de versión y ante un `422 canal_no_permitido` o un `bloqueado` con `canal_no_disponible`.
- Un aviso `bloqueado` por Iris queda `omitido` con el motivo, sin reintento ni respaldo. **Excepción:** un `auto` `bloqueado` con `canal_no_disponible`: Argos relee `capacidades` y reenvía por sus propios canales con otro `envio_id`.
- **Un `envio_id` nunca se reenvía con otro `canal_preferido`:** si cambia el canal, el `envio_id` es nuevo (la `Idempotency-Key` es `argos:aviso:<plantilla>:<envio_id>`).
- `422 canal_no_permitido`: `canales_permitidos` sin `auto`, vacío o con valores repetidos; Argos nunca manda la lista vacía (omite el campo solo si quiere «todos los declarados»).
- Código nuevo pedido a un Iris que no lo declara en `capacidades.mensajeria[].canales[].codigos` del canal: ese paso cae al texto local, sin 422.
- **Vencimiento dentro del silencio (Iris, C9):** `corte_proximo` vence en `fecha_corte`; `promesa_por_vencer`, en `vence_en`; `debito_fallido`, en `reintenta_el` o a las 72 h si no viene; `factura_por_vencer`, en `vence_en`; `factura_vencida` y los demás, a las 72 h. Lo descarta Iris con `aviso.fallido` y `motivo = vencido`. El silencio y el tope diario aplican a todos los canales.
- **Bajas:** los avisos de cobro por correo y Telegram son transaccionales (sin alta). Argos respeta la baja que Iris informe con `contacto.baja` para `correo` y `telegram`, también cuando envía él.
- Reintento tras timeout: mismos bytes y misma `Idempotency-Key`. El número y el correo del cliente nunca van en el cuerpo.
- `notify.envios.canal` admite `iris`. `aviso.entregado` con `canal: correo` deja el envío `enviado` con ese canal; en correo, `entregado_en` es la aceptación del SMTP de destino, `leido_en` es siempre null y el fallo por un correo inválido llega con `motivo: destino_invalido`.
- Contactos: con `auto`, el correo va solo al titular. Los contactos con `permisos.avisos` del servicio reciben solo por WhatsApp, con el permiso de cada número que resuelve Iris (`iris.md` §6.4); los avisos por los canales propios de Argos siguen copiándose como hoy.
- A52: Argos lee `GET <iris>/api/v1/integraciones/argosisp/plantillas-whatsapp?empresa_id=` (no implementado hoy en Argos). Si la lectura falla, el panel muestra el error con «Reintentar», nunca una lista vacía ni «aprobada» por defecto.

## 7. Avisos de suscripciones y débito (R5)

Facturas con `suscripcion_id` usan la plantilla asignada a la suscripción o la por defecto, y llevan la variable opcional `concepto` (nombre del producto del catálogo, nunca texto libre; máximo 60 caracteres, sin saltos de línea ni URL, o `422 variable_invalida`; nunca datos de tarjeta ni del débito). En `debito_fallido`, la variable `reintenta_el` se omite cuando no hay reintento, nunca se manda vacía. Se agregan los textos `debito.fallido`, `debito.desactivado` y `suscripcion.estado_cambiada`. `debito.fallido` avisa una vez por intento; `debito.desactivado` una vez.

## 8. Eventos, permisos y endpoints

- Eventos: `recordatorios.plantilla_cambiada` y `recordatorios.asignacion_cambiada` (payloads en `eventos.md`).
- Permisos: `recordatorios.ver`, `.crear`, `.editar`, `.retirar`, `.asignar`, `.personalizar`. Admin, todos; soporte: ver, asignar, personalizar; lectura: ver. `notificaciones.editar` sigue cubriendo los textos de `notify.plantillas`.
- Endpoints: `GET/POST /plantillas-recordatorio`, `GET/PUT /plantillas-recordatorio/:id` (con pasos y `version`); `POST /plantillas-recordatorio/:id/retirar | fijar-por-defecto`; `GET /plantillas-recordatorio/:id/vista-previa?factura_id=` (qué saldría y cuándo, sin enviar); `POST /servicios/:id/recordatorios/asignar` y `POST /suscripciones/:id/recordatorios/asignar` (`plantilla_id` o null vuelve a la por defecto); `PUT /servicios/:id/recordatorios/personalizados`; `POST /servicios/:id/recordatorios/quitar-personalizados`; `GET /servicios/:id/recordatorios` y `GET /suscripciones/:id/recordatorios` (plantilla efectiva, de dónde sale y próximos envíos); `POST /plantillas-recordatorio/:id/asignar-masivo` (por una acción que registra cada fila, regla 9).

## 9. Lotes y orden

R1 (modelo, A6) → R2 (cron y disparadores, A6 + A3) y R3 (entrega por Iris, A6; necesita el bloque C acordado) → R4 (panel, A4) → R5 (suscripciones y débito, A6; depende de R2, I2, D2). En serie: `programar_recordatorios.ts` R2 → R5; `notify/whatsapp.ts` (`VARIABLES_IRIS`) R3 → R5.

## 10. Preguntas abiertas

P-N15: quién crea recordatorios personalizados (recomendado: admin y soporte).
