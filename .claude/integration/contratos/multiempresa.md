# Contrato: multiempresa (varios NIT en una instalación)

Decisión del PM, 17 de octubre. Un ISP puede ser un conglomerado que, por orden contable, opera con varios NIT (empresas), cada una con su logo, dirección fiscal y contabilidad. Una sola instalación de ArgosIsp las atiende a todas.

Este contrato manda sobre lo que choque con él en `modelo-datos.md` y en los otros contratos. Cada agente lo cumple en sus carpetas, y los cambios a este contrato van en la misma PR que el código que los cumple.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Contabilidad | **Separada por NIT.** Cada empresa tiene su libro, sus cajas, bancos, periodos y cierres, y su IVA. Los reportes pueden consolidar el grupo. |
| Pertenencia | **Por servicio.** Cada servicio pertenece a una empresa y sus facturas salen con ese NIT. Un cliente puede tener servicios de varias empresas. |
| Acceso | **Por empresa.** Cada usuario tiene la lista de empresas que puede operar y elige la *empresa activa* con un selector. Un usuario con alcance global (el admin) ve todas y los consolidados. |
| Marca | **La de la empresa del servicio.** El portal, los avisos y los documentos muestran el logo, el nombre, los datos de pago y el contacto de la empresa que factura. ArgosIsp aparece solo en el pie. |

## Modelo (A1 es dueño de `core`)

- **`core.empresas`** reemplaza a la tabla `core.empresa` de una sola fila. La fila existente se migra como empresa 1, la principal.
  - Datos: `id`, `nit`, `razon_social`, `nombre_comercial`, `direccion_fiscal`, `municipio`, `departamento`, `telefono`, `correo`, `sitio_web`, `logo` (archivo; referencia en el almacenamiento de archivos, no base64 en la base), `color_marca` (opcional, solo para el PDF y el correo; la interfaz usa el teal de la identidad), `regimen_isr` (frases FEL), `codigo_establecimiento`, `activa`, `version`, `creado_en` y `actualizado_en`.
  - `nit` es único entre las empresas activas.
  - Se crea, edita y desactiva con acciones auditadas (`empresas.crear`, `empresas.editar`, `empresas.desactivar`). Una empresa con documentos no se borra.
- **`empresa_id`, `NOT NULL`, con FK a `core.empresas`**, en:
  - `core.servicios`: inmutable una vez facturado. Se cambia solo con la acción explícita `servicios.cambiar_empresa`, que exige que el servicio no tenga saldo pendiente.
  - `core.zonas` y `network.routers`: empresa **sugerida** para los servicios nuevos (`empresa_sugerida_id`, nulable). La regla es servicio > zona > router > la empresa activa de quien crea el servicio.
  - Todo lo financiero (A3): facturas, notas de crédito, pagos, comprobantes, cobros de la pasarela, promesas (se toma del servicio), cajas, cuentas bancarias, egresos, asientos, periodos y cierres, series y numeración.
- **El cliente no tiene empresa.** Sus servicios sí. En pantalla y en el portal, el cliente se ve agrupado por empresa.
- **`core.usuarios_empresas`** (`usuario_id`, `empresa_id`) define el alcance del usuario. Un usuario con `alcance_global = true` ve todas las empresas. El rol sigue siendo uno solo; la empresa acota *dónde* aplica.

## Contexto y API

- **Empresa activa.** Cada petición del panel puede mandar la cabecera `X-Empresa-Id`.
  - El middleware valida que el usuario tenga acceso a esa empresa. Si no lo tiene, responde 403 `empresa_no_permitida`.
  - La empresa queda en `ctx.empresaId`, y `DomainAction` la guarda en la auditoría (`audit.acciones.empresa_id`).
  - Si no viene la cabecera, se usa la única empresa del usuario. Si tiene varias y la acción la necesita, responde 422 `empresa_requerida`.
- **Listas.** Se filtran por la empresa activa. `?empresas=todas` solo funciona con alcance global o con acceso a todas: es el modo consolidado de reportes y del dashboard.
- **Creación.** Lo nuevo toma la empresa del servicio cuando existe uno, por ejemplo facturas, pagos y promesas. Lo que no depende de un servicio toma la empresa activa: cajas, egresos, cuentas bancarias y asientos manuales.
- **Eventos.** Los eventos financieros y de servicio agregan `empresa_id` al payload, de forma aditiva. Hay que actualizar `contratos/eventos.md`.
- **`GET /me`.** Devuelve `empresas[]` (`id`, `nombre_comercial`, `nit`, `logo_url`) y `alcance_global`.
- **Logo.** `GET /empresas/:id/logo` lo sirve con caché e ETag. Se sube como multipart, solo PNG o SVG saneado, de hasta 512 KB. El SVG se sanea sin scripts ni referencias externas.

## Contabilidad (A3 es dueño de `billing` y `ledger`)

- **Plan de cuentas.** El catálogo de códigos es común y los saldos van por empresa. Cada asiento lleva `empresa_id`, y la restricción de Debe = Haber se cumple por asiento.
- **Asientos de una sola empresa.** Un asiento nunca mezcla empresas. No hay operaciones entre empresas en la fase 1.
- **Auxiliar del cliente por empresa.** El saldo de un cliente es por empresa. El estado de cuenta muestra una sección por cada empresa y el total solo como información.
- **Pagos.**
  - **Un pago pertenece a una sola empresa**, y sus facturas deben ser de esa empresa.
  - **Cobro en caja que cubre facturas de varias empresas:** la acción de cobro lo divide en un pago por empresa dentro de la misma transacción.
    - Los pagos quedan agrupados por un `cobro_id` y se emite un recibo con una sección por empresa.
    - Cada pago va a la caja abierta del cajero en esa empresa.
    - Si el cajero no tiene caja abierta en alguna de esas empresas, responde 422 `caja_no_abierta` con la empresa.
  - **Transferencia, depósito, ACH y remesa:** la cuenta bancaria de destino es de una empresa. Si las facturas elegidas son de otra, responde 422 `cuenta_de_otra_empresa`. No se cruzan dineros entre NIT.
  - **Anticipo y saldo a favor:** son por empresa.
- **Caja.** Pertenece a una empresa. Un cajero que cobra para varias empresas abre una caja en cada una; el panel lo hace transparente. El cierre de caja es por empresa.
- **Periodos y cierre mensual:** por empresa.
- **Reportes:** se filtran por empresa activa. Con alcance global hay consolidado, con una columna o sección por empresa y el total del grupo. El IVA se calcula por NIT.
- **Numeración y series:** por empresa. FEL (semana 5) tiene emisor y credenciales por empresa.

## Interfaces

- **Panel (A4).**
  - Selector de empresa en la barra superior, con el logo y el nombre comercial.
  - El cambio de empresa recarga los datos sin perder la sesión.
  - "Todas las empresas" solo aparece con alcance global.
  - CRUD de empresas con logo.
  - El cliente se muestra agrupado por empresa.
  - El cobro rápido divide por empresa y lo muestra.
- **Portal (A5).**
  - La marca del portal es la de la empresa del servicio identificado.
  - Con sesión y servicios de varias empresas, `/cuenta` agrupa por empresa y cada sección lleva su marca, sus cuentas bancarias y su pago en línea.
  - El pago en línea no mezcla empresas.
- **Notificaciones (A6).**
  - `{{empresa.*}}` sale de la empresa del servicio o de la factura del evento.
  - El remitente es único en la fase 1 y lleva el nombre comercial de la empresa en el nombre visible.
  - Telegram también es único: el mensaje lleva el nombre de la empresa.
- **Importación (A6).** `--empresa=<id|nit>` asigna la empresa a todo lo importado, o se asigna por zona o router con un mapa en el archivo de origen.
- **PDF del aviso de cobro (A5).** Lleva el logo, la razón social, el NIT y la dirección fiscal de la empresa de la factura.

## Configuración de canales de notificación (decisión del PM, 17 oct)

Correo (SMTP) y Telegram se configuran **desde el panel**, no con variables de entorno. Las variables quedan solo como valor inicial de laboratorio y desarrollo y se pueden borrar.

- **Global y por empresa.** Hay una configuración **global** y cada empresa puede **heredarla** (el valor por defecto) o tener **la suya**.
  - Correo: servidor, puerto, TLS, usuario, contraseña, remitente y nombre visible.
  - Telegram: token del bot, nombre del bot y chat del equipo.
- **Encender y apagar.** Cada canal se habilita o deshabilita por separado: correo, Telegram a clientes y Telegram de alertas al equipo. Cada tipo de aviso (recordatorio, corte, pago, comprobante…) también, a nivel global y por empresa.
  - Un canal apagado no envía nada y lo registra.
  - El cliente sigue eligiendo su canal preferido.
- **Seguridad.**
  - Las credenciales (contraseña SMTP, token del bot) se guardan **cifradas** en la base, con la misma clave de cifrado de la instalación que `AAA_PPP_KEY` o una propia de notify.
  - Nunca vuelven a la interfaz ni a la auditoría: se muestran como `***` y solo se pueden reemplazar.
  - Cambiar la configuración es una acción con permiso (`notificaciones.configurar`) y queda auditada.
- **Probar desde el panel.** Botón "Enviar prueba" en correo y Telegram, que muestra el error real del servidor si falla.
- **Efecto inmediato.** El worker de notify relee la configuración por evento (`notificaciones.config_cambiada`), sin reiniciar. Sigue la regla 5: invalidación por evento, nunca TTL.
- **Responsables.**
  - A6: modelo, cifrado, resolución global/empresa, worker y pruebas de envío.
  - A4: pantallas en Configuración → Notificaciones, global y por empresa.
  - El webhook de Telegram se registra con la URL pública configurada.

## Migración

Los datos existentes pasan a la empresa 1. Ninguna prueba ni pantalla existente debe cambiar de comportamiento con una sola empresa. Con una sola empresa, el selector no aparece.

## Implementación del núcleo (A1, 17 de octubre)

Lo que A1 ya cumple y cómo usarlo desde los otros módulos. Las desviaciones del texto de arriba están al final, con su motivo.

### Contexto de la petición

- Middleware `empresa` (`apps/api/app/middleware/empresa_middleware.ts`) en **toda ruta con sesión**, después de `auth` y antes de `autorizar`:
  - `X-Empresa-Id: <id>` → debe ser una empresa activa del alcance del usuario; si no, 403 `empresa_no_permitida`. Un valor que no es un id, 400.
  - Sin cabecera → la única empresa del usuario; con varias, ninguna.
  - Deja `ctx.empresa: EmpresaPeticion` = `{ activa, empresas, permitidas, alcanceGlobal, accesoTotal }` (`permitidas: null` = alcance global).
- `ctx.contextoAccion()` lleva `empresaId` (la activa o null) y `empresasPermitidas` (null = todas). Fuera de HTTP (crons, workers, consola) no vienen: sin restricción y sin empresa activa.
- `DomainAction` escribe `audit.acciones.empresa_id`: la que la acción fije con `t.fijarEmpresa(id)` (la del servicio, la de la factura…) o, si no, la activa del contexto.

### Helpers

| Helper | Dónde | Para qué |
| --- | --- | --- |
| `empresasDeLaLista(ctx.empresa, query.empresas)` | `#shared/empresa_activa` | Empresas por las que filtrar una lista: `[activa]`; sin activa, las del alcance (`null` con global); `empresas=todas` → `null` (consolidado) o 403 si no tiene acceso a todas |
| `filtrarPorEmpresa(q, empresas, (q, ids) => q.whereIn('x.empresa_id', ids))` | `#shared/empresa_activa` | Aplica lo anterior (con `null` no filtra) |
| `empresasConsulta()` | `#shared/validadores` | Campo `empresas` (`todas`) del validador de query, para el OpenAPI |
| `exigirAccesoEmpresa(ctx, id)` / `tieneAccesoEmpresa` | `#shared/empresa_activa` | 403 `empresa_no_permitida` si el actor no tiene esa empresa |
| `exigirEmpresaActivaDelContexto(ctx)` | `#shared/empresa_activa` | La activa o 422 `empresa_requerida` |
| `resolverEmpresaActiva(ctx, trx)` | `#core/empresas` | Para lo que no depende de un servicio (cajas, egresos, cuentas, asientos manuales): la activa o, sin ella (crons, pruebas), la única empresa activa; 422/403 |
| `empresaDeServicio(servicioId, trx)` | `#core/empresas` | La empresa de un servicio (facturas, pagos, promesas) |
| `exigirServicio(ctx, id)` / `exigirCliente(ctx, id)` | `#core/acceso_empresa` | Alcance (router/zona) y empresa de un recurso concreto en una ruta |
| `leerEmpresa(trx, empresaId)` / `verEmpresa` | `#portal/empresa` | Datos de marca con los nombres de siempre (`nombre`, `direccion`…); la 1 por defecto |
| `variablesEmpresa(trx, empresaId?)` | `#notify/variables` | `{{empresa.*}}`; `construirVariables` ya toma `empresa_id` del payload o la del servicio |

### Reglas que implementa

- **Servicio nuevo**: `empresa_id` explícito > `empresa_sugerida_id` de la zona del cliente > la del router > la empresa activa (o la única activa) > 422 `empresa_requerida`. El actor necesita acceso a la elegida (403). Un `INSERT` directo sin `empresa_id` toma la única empresa activa (trigger `core.servicios_empresa_por_defecto`); con varias, falla.
- **`servicios.cambiar_empresa`** (`POST /servicios/:id/cambiar-empresa`, con `version`): solo sin saldo pendiente (422 `servicio_con_saldo`); acceso a las dos empresas. Emite `servicio.config_cambiada` con `campos: ['empresa']` y `empresa_anterior_id`.
- **Listas del núcleo**: servicios por `empresa_id`; clientes con algún servicio en la empresa **o sin servicios** (un cliente recién creado lo ven todas); routers sin empresa sugerida, sugeridos para la empresa o con servicios de ella.
- **Un recurso concreto** se abre si es de cualquier empresa del alcance del usuario, no solo de la activa (los enlaces directos funcionan); si no, 403.
- **Usuarios**: los existentes y los que crea alguien con alcance global quedan con alcance global; los que crea alguien acotado quedan en su empresa activa (o en las suyas). `PUT /usuarios/:id/empresas` (`usuarios.asignar_empresas`): sin global, al menos una empresa activa; nadie reparte lo que no tiene.
- **Desactivar una empresa**: nunca la 1; no con servicios sin retirar (422 `empresa_con_servicios`). Su NIT queda libre.

### Desviaciones de este contrato y motivo

- `created_at` y `updated_at` en lugar de `creado_en` y `actualizado_en`: es la convención de todas las tablas, y `actualizarConVersion` y el diff de auditoría dependen de esos nombres.
- El logo son tres columnas: `logo` (ruta en el almacenamiento, nunca sale en la API), `logo_tipo` y `logo_etag` (sha256). La API expone `logo_url` (`/api/v1/empresas/:id/logo?v=…`, pública). El archivo vive en el almacenamiento de los comprobantes (`COMPROBANTES_DIR/logos/empresas/<id>/…`), así usa el mismo volumen respaldado.
- `core.empresas` conserva `telefono_alterno`, `whatsapp`, `horario` e `instrucciones_pago` de la antigua `core.empresa` (los usan el portal y los avisos).
- La empresa 1 puede quedar con `version = 0` y sin NIT si nunca se guardó: así `GET /empresa` y los textos siguen devolviendo los valores por defecto del entorno, como antes. Las empresas nuevas exigen NIT válido, razón social y nombre comercial.
- `regimen_isr` es un enumerado: `sujeto_pagos_trimestrales`, `retencion_definitiva` o `pequeno_contribuyente` (para elegir las frases de FEL). `codigo_establecimiento` es entero.
- Esquemas OpenAPI `EmpresaGrupo` (la empresa completa) y `EmpresaResumen` (la de `GET /me`): el nombre `Empresa` ya era del portal (A5). En `Me`, `alcance_global`, `empresas` y `empresa_activa_id` son opcionales en el OpenAPI para no romper fixtures, pero `GET /me` siempre los envía.
- Permisos extra: `empresas.ver` y `empresas.cambiar_logo` (subir el logo es una acción propia, con su auditoría).
- Una lista sin empresa activa (usuario con varias empresas y sin `X-Empresa-Id`) no responde 422: muestra la unión de las empresas del usuario (todas con alcance global). El 422 `empresa_requerida` queda para las altas que la necesitan.
