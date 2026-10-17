# Módulo `portal` (A5)

Endpoints públicos y del cliente para `apps/portal`. Rutas en `start/routes/portal.ts`.

## Qué hace

| Endpoint | Acción | Qué devuelve |
| --- | --- | --- |
| `GET /api/v1/portal/quien-soy` (público) | `actions/identificar_por_ip.ts` (`portal.quien_soy`) | `QuienSoy`: identificado, ip, nombre parcial ("Juan P."), estado, promesa activa, monto adeudado y facturas vencidas (cantidad y total) |
| `GET /api/v1/portal/estado` (público) | `actions/consultar_estado_por_ip.ts` (`portal.estado`) | `EstadoPortal`: identificado, estado y monto adeudado. Sin nombre ni IP: la página de corte lo consulta cada 5 s tras un pago o una promesa |

### Acceso por código y portal autenticado (tarea 7)

| Endpoint | Acción / lectura | Qué hace |
| --- | --- | --- |
| `POST /api/v1/portal/codigo` (público, límite por IP) | `actions/solicitar_codigo.ts` (`portal.solicitar_codigo`) | Código de 6 dígitos al correo o Telegram **registrado** del cliente, identificado por NIT/CUI, usuario PPPoE o (`por_ip: true`) la IP de origen. 202 `PortalSolicitudCodigo` |
| `POST /api/v1/portal/verificar` (público, límite por IP) | `actions/verificar_codigo.ts` (`portal.verificar_codigo`) | Verifica y pone la cookie httpOnly `argos_portal`. 200 `PortalSesion`; 422 `codigo_invalido` |
| `POST /api/v1/portal/salir` | `actions/cerrar_sesion.ts` (`portal.cerrar_sesion`) | Revoca la sesión y borra la cookie |
| `GET /api/v1/portal/cuenta` | `cuenta.ts` | Contacto, servicios con estado y saldo |
| `GET /api/v1/portal/facturas`, `/facturas/:id` | `cuenta.ts` | Facturas del cliente (`PortalFactura`, sin datos internos); una ajena responde 404 |
| `GET /api/v1/portal/pagos`, `/promesas` | `cuenta.ts` | Pagos (con depósitos en verificación) y promesas, solo lectura |
| `PUT /api/v1/portal/contacto` | `actions/editar_contacto.ts` (`portal.editar_contacto` → `clientes.editar` de A1) | Correo, teléfono, móvil y canal preferido; diff en `audit.cambios`, 409 por `version` |

Reglas:

- **Destino.** El código va solo a `core.clientes.email` o `telegram_chat_id` (Telegram si es el canal
  preferido y está vinculado, si no correo). La petición no puede elegir destino.
- **Sin enumeración.** Por identificador la respuesta es idéntica exista o no el cliente (la solicitud
  falsa nunca verifica). Un NIT compartido por varios clientes o `CF` no identifica a nadie. Por IP sí
  se informa el destino enmascarado (`m***a@e***.com`) o 422 `no_identificado`/`sin_destino`, porque
  `/corte` ya identifica al cliente por la IP.
- **Código.** `core.portal_codigos`: solo `HMAC-SHA256(APP_KEY, solicitud:código)`, vigencia
  `PORTAL_CODIGO_VIGENCIA_S` (600), `PORTAL_CODIGO_INTENTOS` (5) por código, `PORTAL_CODIGO_MAX_HORA` (5)
  por cliente (por IP responde 429 con `Retry-After`; por identificador, silencio). Uno nuevo reemplaza
  a los anteriores. El intento se cuenta con un `UPDATE` atómico antes de comparar y fuera de la
  transacción de la acción, así un intento fallido queda contado aunque la acción se revierta. En la
  auditoría el código viaja como `secreto` (`***`).
- **Envío.** Puerto `acceso/envio_codigo.ts` (`EnviadorCodigo`); por defecto usa la interfaz `Canal`
  de notify (`SMTP_*`, `TELEGRAM_BOT_TOKEN`). No usa `ProgramarNotificacion` porque guardaría el texto
  con el código en `notify.envios`. Si el canal falla: 503 `envio_codigo_fallido` y el código no queda.
- **Sesión.** `core.portal_sesiones`: token `pcs_…` (solo su SHA-256) en la cookie `argos_portal`
  (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/portal`, `Secure` con HTTPS o `PORTAL_COOKIE_SEGURA=siempre`). Inactividad
  `PORTAL_SESION_INACTIVIDAD_S` (1800), máximo `PORTAL_SESION_MAX_S` (14400). Alcance: un cliente;
  todas las lecturas filtran por el `clienteId` de la sesión (`acceso/sesion.ts`).
- **Actor.** Canal `portal` siempre. Con la sesión, actor `cliente` (`ctx.contextoCliente`, id de
  `core.clientes`): `portal.cerrar_sesion`, `portal.editar_contacto`, `portal.desvincular_telegram`,
  `notificaciones.telegram_codigo` y `promesas.crear` con `servicio_id`; `portal.verificar_codigo`
  se audita como `cliente` al acertar (`t.identificarActor`, como `auth.login`). Por IP (sin sesión)
  y al pedir el código, actor `sistema`: la IP no autentica a nadie. `comprobantes.registrar` y
  `pasarela.crear_cobro` siguen como `sistema` aun con la sesión porque A3 guarda `actor.id` en
  `registrado_por` / `creado_por` (`core.usuarios`); pasan a `cliente` cuando usen `usuarioDelActor`.

### PDF del aviso de cobro y plantillas de documentos (tarea 8)

| Endpoint | Permiso | Qué hace |
| --- | --- | --- |
| `GET /api/v1/portal/facturas/:id/pdf` | sesión del portal | PDF de una factura del cliente (ajena: 404) |
| `GET /api/v1/documentos/aviso-cobro/:facturaId` | `facturas.ver` (con alcance) | El mismo PDF desde el panel |
| `GET /api/v1/documentos/plantillas/aviso_cobro` | `documentos.ver` | HTML vigente, `version` (0 = de fábrica) y la lista de variables |
| `PUT /api/v1/documentos/plantillas/aviso_cobro` | `documentos.editar` | Acción `documentos.editar` (`actions/editar_plantilla_documento.ts`): valida, guarda con `version` (409) y diff en `audit.cambios` |
| `POST /api/v1/documentos/plantillas/aviso_cobro/vista-previa` | `documentos.editar` | PDF con datos de ejemplo, sin guardar |

El PDF responde `Content-Type: application/pdf` y `Content-Disposition: inline; filename="aviso-cobro-<número>.pdf"`
(`factura-<serie>-<número>.pdf` cuando la factura tiene `fel_uuid`: el documento pasa a llamarse
"Factura" y muestra serie, número y autorización FEL).

**Generación** (`documentos/`): Mustache (`render.ts`, ya era dependencia) sobre la plantilla de
`core.plantillas_documentos` o la de fábrica (`plantilla_base.ts`), y el HTML resultante a PDF con
`html_a_pdf.ts` (**pdfkit** + **htmlparser2**, dependencias nuevas). Motivo: la imagen de la API es
`node:22-alpine`; Chromium suma unos 300 MB y un proceso por PDF, y un aviso de cobro es texto, tablas y
líneas. pdfkit es JavaScript puro y usa las fuentes estándar del PDF (Helvetica, WinAnsi: tildes, ñ, ¿¡).

**Variables** (para el editor de A4; también las devuelve `GET /documentos/plantillas/aviso_cobro`).
Montos ya formateados en quetzales con `decimal.js`; fechas en `America/Guatemala`.

| Variable | Ejemplo |
| --- | --- |
| `{{empresa.nombre}}`, `{{empresa.nit}}`, `{{empresa.direccion}}`, `{{empresa.telefono}}`, `{{empresa.whatsapp}}`, `{{empresa.correo}}`, `{{empresa.horario}}`, `{{empresa.instrucciones_pago}}` | Configuración de empresa (tarea 9) |
| `{{cliente.nombre}}` | Nombre fiscal o, si no hay, el nombre |
| `{{cliente.nit}}` | NIT/CUI o `CF` |
| `{{cliente.direccion}}`, `{{cliente.email}}` | Dirección fiscal (o la del cliente), correo |
| `{{servicio.plan}}`, `{{servicio.direccion}}` | Plan y dirección de instalación |
| `{{factura.documento}}` | `Aviso de cobro` o `Factura` (con FEL) |
| `{{factura.numero}}` | `1203`, o `ABCD1234-1449658872` con FEL |
| `{{factura.periodo}}` | `octubre 2026` (`Recargo por mora` en una mora) |
| `{{factura.emitida}}`, `{{factura.vence}}` | `01/10/2026`, `10/10/2026` |
| `{{factura.estado}}` | `Pendiente`, `Abono parcial`, `Vencida`, `Pagada`, `Anulada` |
| `{{factura.subtotal}}`, `{{factura.iva}}`, `{{factura.total}}`, `{{factura.pagado}}`, `{{factura.saldo}}` | `Q 1,234.50` |
| `{{factura.lineas}}` | Tabla de líneas ya armada (concepto, cantidad, precio, total) |
| `{{#lineas}}…{{/lineas}}` | Para una tabla propia: `concepto`, `cantidad`, `precio_unitario`, `iva`, `total` |
| `{{#factura.tiene_pagos}}…{{/factura.tiene_pagos}}` | Sección si hay abonos |
| `{{#factura.fel}}…{{/factura.fel}}`, `{{factura.fel_uuid}}`, `{{factura.fel_serie}}`, `{{factura.fel_numero}}` | Datos FEL (semana 5) |
| `{{generado}}` | Fecha y hora de generación |

Una variable vacía se oculta con su sección: `{{#empresa.nit}}NIT {{empresa.nit}}{{/empresa.nit}}`.
Mustache escapa el HTML de cada dato; `{{{ }}}` y `{{& }}` se rechazan (422) para que un dato del
cliente nunca agregue marcas.

**HTML que entiende el generador:** `h1`–`h3`, `p`, `div`, `section`, `header`, `footer`, `ul`/`ol`/`li`,
`hr`, `br`, `table` (`thead`, `tbody`, `tfoot`, `tr`, `th`, `td` con `width="40%"` y `colspan`), `strong`/`b`,
`em`/`i`, `small`, `span`. Clases: `derecha`, `centro`, `tenue`, `grande`, `negrita`; en tablas `caja` (con
bordes) y `sin-borde`. `style` admite `text-align`, `font-weight`, `font-style`, `font-size` y `color`
(`#rgb`). Imágenes, CSS externo y scripts se ignoran. Página carta con márgenes de 48 pt; las tablas
largas siguen en otra página.

### Configuración de empresa (tarea 9)

| Endpoint | Permiso | Qué hace |
| --- | --- | --- |
| `GET /api/v1/portal/empresa` | público (límite por IP) | `EmpresaPublica`: contacto, horario, instrucciones de pago y `cuentas_deposito` |
| `GET /api/v1/empresa` | `empresa.ver` | `Empresa` con `version` (0 = nunca se guardó) |
| `PUT /api/v1/empresa` | `empresa.editar` (admin) | Acción `empresa.editar` (`actions/editar_empresa.ts`): nombre, NIT, dirección, teléfono y teléfono alterno, WhatsApp, correo, horario, instrucciones de pago. 409 por `version`, diff por campo en `audit.cambios` (entidad `empresa`, id 1) |

- `core.empresa` es una sola fila (`id = 1`). Sin fila: `nombre` de `NOTIFY_EMPRESA_NOMBRE`, `telefono` de
  `NOTIFY_EMPRESA_TELEFONO`, lo demás vacío. Un campo `null` o vacío se borra (salvo `nombre`).
- La usan `/corte`, `/contacto`, el encabezado del portal, el mensaje del código de acceso y `{{empresa.*}}`
  de los documentos (`empresa.ts`).
- **Cuentas para depósito**: no se guardan aquí. Su fuente única es `billing.cuentas_bancarias` (A3);
  el portal las lee por el puerto `cuentas_deposito.ts` con `listarCuentasDeposito()` de A3 (solo
  lectura; salen id, banco, alias, número y moneda, nada del libro; el `id` es el `cuenta_bancaria_id`
  del comprobante). Sin cuentas activas, `[]` y
  `/corte` no muestra la sección (nunca inventadas).
- **Las cuentas en USD no se muestran** (decisión de la tarea 9): los avisos y los pagos son en
  quetzales y un depósito a una cuenta en dólares lo convierte el banco a su tipo de cambio, así que lo
  acreditado no cuadra con la deuda. Ocultarlas es más claro en el teléfono que marcarlas.

### Promesa de pago desde el portal (tarea 4)

| Endpoint | Identifica | Qué hace |
| --- | --- | --- |
| `GET /api/v1/portal/promesas/condiciones` | IP o sesión (`?servicio_id=`) | `PortalCondicionesPromesa`: si se puede pedir ahora (y por qué no), fecha mínima y máxima, plazo máximo del canal portal, monto máximo (deuda) y sugerido (vencido), abono inicial (porcentaje, requerido, abonado, faltante), deuda máxima (máximo, vencida, faltante), `pago_previo` (lo que debe pagar antes de prometer) y si requiere aprobación. Cupo del periodo agotado: no disponible |
| `POST /api/v1/portal/promesas` | IP o sesión (`servicio_id` en el cuerpo) | `vence_el` (YYYY-MM-DD de Guatemala, vence a las 23:59:59) y `monto`. Llama `CrearPromesaPago` de A3 (`promesas.crear`) con canal `portal` (actor `cliente` con la sesión, `sistema` por IP). Responde `PortalPromesaSolicitada`: `resultado` (`aprobada`, `rechazada`, `pendiente_aprobacion`), `motivo` en palabras del cliente y `servicio_estado` |

- **Sin lógica de promesas en el portal.** La decisión, la auditoría (`promesas.crear`, canal `portal`), el
  evento `promesa.creada` y la reactivación son de `CrearPromesaPago`. `promesas.ts` solo identifica el
  servicio, traduce el resultado y lee los límites para mostrarlos antes de enviar con
  `limitesPromesa(servicio, 'portal')` de A3 (la misma evaluación que crear; solo el porcentaje del
  abono sale de `configuracionDeServicio`). Las reglas de historial (cumplimiento, bloqueo tras
  incumplida, antigüedad) no se adelantan: las dice el resultado.
- Identificación: sin `servicio_id`, la IP de origen (422 `no_identificado` si no es de ningún servicio);
  con `servicio_id`, la sesión del portal (401 sin ella) y el servicio debe ser del cliente (404).
- `motivo` sale de `resultado_evaluacion.regla` y su límite (`motivoParaCliente`): "La fecha de pago debe
  estar dentro de los próximos 3 días.", nunca `plazo_max_dias`. Una regla nueva cae en el `motivo` de A3.
- La respuesta no lleva `cliente_id`, reglas, historial ni deuda detallada. El 409 `promesa_abierta` de A3
  (que nombra ids) se reescribe como "Ya tienes una promesa de pago en curso."
- `Idempotency-Key` (middleware común) y límite por IP propio (`promesas`, `promesas-condiciones`).

### Comprobante de depósito desde el portal (tarea 5)

| Endpoint | Identifica | Qué hace |
| --- | --- | --- |
| `GET /api/v1/portal/bancos` | público (límite por IP) | `PortalBanco[]`: bancos de origen activos (`listarBancos()` de A3), solo id y nombre |
| `POST /api/v1/portal/comprobantes` | IP o sesión (`servicio_id` en el cuerpo) | **multipart**: `metodo` (`deposito`, `transferencia`, `ach`, `remesa`), `cuenta_bancaria_id` (de `cuentas_deposito`), `banco_origen_id` (solo transferencia y ACH), `referencia`, `monto`, `fecha_deposito` (YYYY-MM-DD, no futura), `nota?` y el archivo `archivo` (JPG, PNG, WebP o PDF, 5 MB). Llama `RegistrarComprobante` de A3 (`comprobantes.registrar`) con canal `portal` y actor sistema. 201 `PortalComprobante` (`estado: pendiente`) |
| `GET /api/v1/portal/comprobantes` | sesión | Comprobantes del cliente de la sesión (`listarComprobantes({ cliente_id })` de A3), con estado y `motivo_rechazo` |

- **Sin lógica de comprobantes en el portal.** Validación del archivo por contenido, unicidad de la
  referencia, auditoría (el archivo solo con nombre y tamaño), evento `comprobante.recibido` y el
  guardado en `COMPROBANTES_DIR` son de A3. No reactiva nada: eso pasa cuando el panel lo aprueba, y
  `/corte` lo ve con el estado en vivo.
- `comprobantes.ts` identifica al titular (como la promesa), lee el archivo del multipart (sin archivo
  pasa contenido vacío y A3 responde 422 `archivo` `required` junto con los demás campos) y traduce los
  errores: cada 422 por campo lleva el texto para el cliente (`mensajeCampo`), y el 409
  `referencia_duplicada` de A3, que nombra el pago o comprobante que ya la tiene (quizá de otro
  cliente), se reescribe sin ids.
- La respuesta no lleva `cliente_id`, nombre, ruta del archivo ni quién lo revisó.
- `Idempotency-Key` (la huella son los campos, no el archivo) y límite por IP propio (`comprobantes`,
  `bancos`).
- El OpenAPI declara el cuerpo como JSON con los campos (el generador aún no conoce multipart; pedido
  en `.claude/integration/a5.md`); la descripción del endpoint dice que es `multipart/form-data`.

Las de IP son lecturas puras (`consultas.ts`: resolución de la IP, saldo y nombre parcial): no cambian
estado ni emiten eventos. Se auditan en `audit.acciones` (canal `portal`, entidad `servicio`, entrada
`{ ip }`) porque son públicas y revelan información de un cliente.

### Vincular Telegram desde el portal (semana 2)

Contrato de A6 en `.claude/integration/contratos/telegram.md`: el código, su tabla
(`notify.telegram_codigos`), el webhook y el canje son de A6; el portal solo pide el código y muestra el estado.

| Ruta | Acción | Qué hace |
| --- | --- | --- |
| `GET /api/v1/portal/telegram` (sesión) | `acceso/telegram.ts` (`estadoTelegram`, lectura) | `PortalTelegram`: vinculado, bot disponible (`TELEGRAM_BOT_TOKEN` y `TELEGRAM_BOT_NOMBRE`) y su usuario |
| `POST /api/v1/portal/telegram/vincular` (sesión, límite por IP) | `GenerarCodigoTelegram` de A6 (`notificaciones.telegram_codigo`, canal portal) | 201 `{ codigo, enlace, bot, vence_en }` con `enlace = https://t.me/<bot>?start=<código>`; 503 `telegram_no_configurado` |
| `POST /api/v1/portal/telegram/desvincular` (sesión) | `actions/desvincular_telegram.ts` (`portal.desvincular_telegram`) | `clientes.desvincular_telegram` de A1; si el canal preferido era Telegram pasa a correo (`clientes.editar`). Idempotente |

### Pago en línea desde el portal (semana 2)

Contrato en `.claude/integration/contratos/pago-en-linea.md`. El cobro, el webhook firmado, el pago y la
reactivación son de A3; el portal solo identifica al pagador, elige las facturas y lee el estado.

| Ruta | Acción | Qué hace |
| --- | --- | --- |
| `POST /api/v1/portal/pagos/iniciar` (IP o sesión, límite por IP, `Idempotency-Key`) | `CrearCobroPasarela` de A3 (`pasarela.crear_cobro`, canal portal, actor sistema) | Sin `facturas`: las vencidas con saldo del servicio (o todo lo pendiente del servicio). Con `facturas` (sesión): deben ser del cliente (404). 201 `PortalPagoEnLinea` con `url_pago`; 422 `sin_deuda` / `no_identificado` / `facturas.<i>`; 503 `pasarela_no_configurada` en palabras del cliente |
| `GET /api/v1/portal/pagos/en-linea/:id` (límite por IP) | `pagos_en_linea.ts` (`cobroDeLaPeticion`, lectura con `verCobroPasarela` de A3) | Estado del cobro para la página de retorno `/corte?pago=<id>`; solo si es del cliente de la sesión o del servicio de la IP (si no, 404). `url_pago` solo mientras está pendiente |

`GET /portal/empresa` agrega `pago_en_linea` (hay pasarela configurada, `proveedorConfigurado()` de A3).

**Retorno.** El cobro lleva `url_retorno = <PORTAL_URL_PUBLICA>/corte?pago={cobro_id}` (`urlRetornoPortal`;
vacía = `NOTIFY_PORTAL_URL`, sin ninguna no se manda). El proveedor devuelve al cliente con `&estado=pagado`
o `&estado=fallido`; `/corte` lo muestra mientras el cobro siga `pendiente` y luego manda la API. El
origen debe estar en `PASARELA_RETORNO_ORIGENES` (A3); si no, 503 `pasarela_no_configurada` y error en el log.

### Auditoría una vez por ventana

Cada visita a `/corte` y cada consulta del estado en vivo (cada 5 s) escribían una fila y llenaban la
línea de tiempo del cliente. `ConsultaPortalAuditada` (`actions/consulta_auditada.ts`) responde
siempre, pero audita solo la primera consulta de cada IP + servicio + acción dentro de
`PORTAL_AUDITORIA_VENTANA_S` (600 s; `0` audita todas). La fila la escribe `RegistrarConsultaPortal`
(un `DomainAction`), así que actor, canal y request id son los de siempre.

- La marca vive en Redis (`auditoria_unica.ts`, `SET NX PX`):
  `<prefijo>:portal:auditado:<accion>:<ip>:<servicio|ninguno>`. Es una ventana, no una caché de
  datos: la identificación se calcula siempre contra Postgres.
- Una IP que cambia de servicio se audita en el acto (cambia la clave). Una IP sin servicio también
  se audita una vez por ventana.
- Si Redis no responde, se audita. Si la auditoría falla, se libera la marca y la consulta falla.
- Si la lectura falla, el error se audita (sin ventana) y se relanza.

### Resolución de la IP

`resolverIp` de A1 (`#network/consultas/ip`, la misma regla que `GET /ip/{ip}`): sesiones activas y
asignaciones vigentes, gana el prefijo más largo y, a igual longitud, la sesión activa.

### Montos

`monto_adeudado` = suma de `total - pagado` de las facturas del servicio en `emitida`, `parcial` o
`vencida` (con `decimal.js`, sin `number`). Vencidas: estado `vencida` o `vence_en` anterior a hoy en
`America/Guatemala`. Nunca se devuelven nombre completo, contacto, NIT, dirección ni usuario PPPoE.

### IP de origen y proxies

`ip_origen.ts` toma la IP del socket. Solo si la conexión viene de un proxy listado en
`PORTAL_PROXIES_CONFIABLES` usa la cabecera `PORTAL_CABECERA_IP` y la recorre desde la derecha
saltando proxies confiables. El portal (Nitro) agrega la IP de su socket al final de `X-Forwarded-For`.

| Variable | Ejemplo | Qué es |
| --- | --- | --- |
| `PORTAL_PROXIES_CONFIABLES` | `172.16.0.0/12,fd00::/8` | IPs/CIDR del contenedor del portal y de cualquier proxy inverso delante. Vacía = la cabecera se ignora |
| `PORTAL_CABECERA_IP` | `x-forwarded-for` (defecto) | Cabecera con la IP del cliente |

Se leen de `process.env` en cada petición; declaradas en `start/env.ts` y `.env.example`.

### Límite de peticiones

`limite_peticiones.ts`, aplicado en la ruta después de resolver la IP y antes de la acción.
Ventana fija en Redis (`INCR` + `PEXPIRE` atómicos en un script Lua) por endpoint e IP: la IPv4 tal
cual y la IPv6 por su /64 (un cliente puede rotar direcciones dentro del prefijo). La expiración es la
del contador de la ventana, no una caché de datos, así que no choca con la regla 5.

- Respuestas con `RateLimit-Limit` y `RateLimit-Remaining`.
- Al pasarse: 429 `application/problem+json` (`urn:argosisp:problema:demasiadas_peticiones`) con
  `Retry-After` en segundos. La acción no corre (no identifica ni audita).
- Si Redis no responde (500 ms), la petición pasa y se registra un aviso: la página de corte no se cae
  por el limitador.

| Variable | Defecto | Qué es |
| --- | --- | --- |
| `PORTAL_LIMITE_PETICIONES` | `30` | Peticiones por ventana y por IP; `0` lo apaga |
| `PORTAL_LIMITE_VENTANA_S` | `60` | Largo de la ventana en segundos |
| `PORTAL_REDIS_PREFIJO` | `COLAS_PREFIJO` o `argosisp` | Prefijo de las claves del portal en Redis (`redis_portal.ts`): `<prefijo>:portal:limite:<endpoint>:<ip>` y `<prefijo>:portal:auditado:…` |
| `PORTAL_AUDITORIA_VENTANA_S` | `600` | Ventana de auditoría de las consultas públicas; `0` audita todas |

## Eventos

No emite ni consume eventos propios. Las acciones de A3 que llama emiten los suyos
(`promesa.creada`, `comprobante.recibido`; el webhook de la pasarela emite `pago.registrado` y
`servicio.estado_cambiado`).

## Pruebas

`tests/portal/acceso.spec.ts` (Postgres y Redis reales, enviador falso): código al correo registrado por
NIT y por usuario PPPoE, sin enumeración, destino que no sale de la petición, Telegram preferido, por IP
con destino enmascarado y 422, intentos agotados, vencido/usado/reemplazado, límite por cliente, canal
caído (503 sin código guardado), 401 sin sesión, datos solo del cliente de la sesión (factura ajena 404),
salir y sesión vencida, extensión hasta el máximo, edición de contacto con auditoría, 409 y 422.

`tests/portal/documentos.spec.ts`: HTML a PDF (tildes, tablas, listas, salto de página), escape de
datos, PDF del portal con datos, montos y fechas de Guatemala, factura ajena 404 y sin sesión 401, FEL,
PDF del panel con y sin `facturas.ver`, plantilla editable (versión 0, diff, 409, el PDF usa la nueva),
Mustache inválido y triple bigote (422), vista previa y 403 sin `documentos.editar`. Con
`PDF_SALIDA=/ruta` deja los PDF para revisarlos.

`tests/portal/comprobantes.spec.ts`: por IP con archivo válido (pendiente, sin datos internos,
auditoría con canal portal y el archivo solo con nombre y tamaño), archivo de otro tipo, de más de 5 MB
o ausente (422 en `archivo` con texto claro), fecha futura, transferencia sin banco y con el catálogo
público, referencia duplicada (409 sin ids) e idempotencia, IP sin servicio (422), servicio de otro
cliente con sesión (404) y sin sesión (401), lista de la sesión con el motivo del rechazo y el `id` de
las cuentas públicas.

`tests/portal/telegram.spec.ts` (con `CanjearCodigoTelegram` de A6 como lo llama el bot): código y
enlace al bot, solo el hash guardado y sin código en la auditoría, "vinculado" y canal preferido
Telegram, uso único (otro chat 422, reintento del mismo chat), vencido, reemplazado al pedir otro,
código de otro cliente (vincula a su dueño) y sesión ajena que no lo toca, 401 sin sesión, desvincular
con canal a correo e idempotente, 503 sin bot y límite por IP.

`tests/portal/empresa.spec.ts`: valores por defecto con versión 0 y sin cuentas, guardado con auditoría
y diff, lectura pública con las cuentas de la fuente (falsa), documentos con `{{empresa.*}}`, borrar
campos, 409, 422 y 403.

`tests/portal/auditoria_unica.spec.ts`: misma IP y servicio auditan una vez (quien-soy y estado por
separado), otra IP u otro servicio se auditan, IP sin servicio, fin de la ventana, ventana `0`, Redis
caído audita, auditoría fallida libera la marca.

`tests/portal/estado.spec.ts`: solo estado y monto (sin datos personales ni IP), IPv6 delegada, IP
desconocida, refleja la reactivación (`CambiarEstadoServicio`), auditoría y contador de límite propio.
Datos de prueba compartidos en `tests/portal/ayudas_portal.ts`.

`tests/portal/limite_peticiones.spec.ts` (Redis real): 429 con `Retry-After` y sin auditoría, contadores
por IPv4 y por /64, fin de la ventana, `0` lo apaga, Redis caído deja pasar, configuración y claves.

`tests/portal/quien_soy.spec.ts`: IPv4, IPv6 en /56 delegado y /64 de enlace, asignaciones sin sesión,
sesión cerrada, X-Forwarded-For falso, sin proxies confiables, cabecera configurable, auditoría y que
no se filtren datos personales.

`tests/portal/promesas.spec.ts`: condiciones por IP sin datos personales (plazo del canal portal, deuda),
abono inicial, aprobación y fecha máxima antes de la siguiente factura; aprobada por IP reactiva y
`/portal/estado` la ve, auditada como sistema/portal con `promesa.creada`; rechazada con motivo legible;
pendiente de aprobación, condiciones no disponibles y 409 legible; IP desconocida 422; monto mayor que la
deuda y fecha pasada 422; `Idempotency-Key`; 429; por sesión (401 sin cookie, 404 servicio ajeno).
