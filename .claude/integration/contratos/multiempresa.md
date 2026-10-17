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
