---
orden: 5
pantallas:
    - /configuracion/aviso-cobro
---

# Plantillas de documentos

Aquí editas cómo se ve el PDF del **aviso de cobro** (que pasa a llamarse **factura** cuando está certificada en FEL) y el de la **nota de crédito**. Es el PDF que el cliente descarga en su portal y el que se ve desde el panel. La plantilla es HTML con variables que Argos llena con los datos de cada documento.

Hay una sola plantilla de cada tipo para toda la instalación. Si trabajas con varias empresas, cada PDF sale con los datos y el logo de la empresa del documento.

## Quién la usa

- **Ver:** permiso `documentos.ver` (roles `admin` y `lectura`).
- **Editar, vista previa y guardar:** permiso `documentos.editar` (solo `admin`). Sin él, el editor está en solo lectura y la pantalla lo dice.

Está en **Configuración → Plantillas de documentos**.

## Qué ves

- Dos pestañas: «Aviso de cobro y factura» y «Nota de crédito».
- Una etiqueta con la versión: «Plantilla de fábrica» si nunca se guardó, o «Versión N».
- El editor «HTML de la plantilla», con el contador de caracteres (máximo 100,000).
- **Variables**, agrupadas en Empresa, Cliente, Servicio, Factura (o Nota de crédito) y Otras, con un buscador. Al tocar una, se inserta donde está el cursor. Pasa el puntero sobre una variable para ver qué significa.
- **Vista previa (datos de ejemplo)** a la derecha: el PDF generado con datos ficticios.

### Cómo se escriben las variables

- `{{cliente.nombre}}` pone el dato.
- `{{#factura.tiene_pagos}}…{{/factura.tiene_pagos}}` es una **sección**: lo que va dentro solo aparece si el dato existe o es verdadero (por ejemplo, la línea de abonos solo si hay abonos).
- `{{#lineas}}…{{/lineas}}` repite lo de dentro por cada línea del documento (`concepto`, `cantidad`, `precio_unitario`, `iva`, `total`). `{{factura.lineas}}` inserta la tabla ya armada.
- El logo de la empresa va dentro de `{{#empresa.logo}}…{{/empresa.logo}}` con `<img src="empresa:logo" height="48">`. No se pueden usar imágenes de internet.
- No se permite `{{{ }}}` ni `{{& }}`.

Variables principales del aviso de cobro:

| Grupo    | Variables                                                                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empresa  | `empresa.nombre`, `empresa.razon_social`, `empresa.nit`, `empresa.direccion`, `empresa.logo`, `empresa.telefono`, `empresa.telefono_alterno`, `empresa.whatsapp`, `empresa.correo`, `empresa.horario`, `empresa.instrucciones_pago`                                                                       |
| Cliente  | `cliente.nombre`, `cliente.nit` («CF» si no tiene), `cliente.direccion`, `cliente.email`                                                                                                                                                                                                                  |
| Servicio | `servicio.plan`, `servicio.direccion`                                                                                                                                                                                                                                                                     |
| Factura  | `factura.documento` («Aviso de cobro», o «Factura» / «Nota de débito» con FEL), `factura.numero`, `factura.periodo`, `factura.emitida`, `factura.vence`, `factura.estado`, `factura.subtotal`, `factura.iva`, `factura.total`, `factura.pagado`, `factura.saldo`, `factura.lineas`, `factura.tiene_pagos` |
| FEL      | `factura.fel` (sección), `factura.fel_uuid`, `factura.fel_serie`, `factura.fel_numero`, `factura.fel_fecha`, `factura.fel_tipo`, `factura.fel_anulado` (sección)                                                                                                                                          |
| Otras    | `lineas`, `generado` (fecha y hora de generación)                                                                                                                                                                                                                                                         |

Los montos ya salen en quetzales (`Q 175.00`) y las fechas en hora de Guatemala. La lista completa, con su descripción, está siempre en la pantalla. La nota de crédito tiene sus propias variables (`nota.numero`, `nota.fecha`, `nota.motivo`, `nota.monto`… y los datos del documento acreditado).

## Acciones

### Vista previa

- **Permiso:** `documentos.editar`
- **Dónde:** botón «Vista previa».
- **Qué pasa:** genera el PDF con datos de ejemplo, **sin guardar**. «Abrir PDF» lo abre en otra pestaña. Si sigues editando, aparece «Cambiaste la plantilla después de esta vista previa» con «Actualizar».

### Guardar

- **Permiso:** `documentos.editar`
- **Dónde:** botón «Guardar».
- **Qué pasa:** antes de guardar, Argos prueba que la plantilla genere un PDF con los datos de ejemplo; si no, muestra el error y no guarda. Al guardar ves «Plantilla guardada · Versión N. Los próximos PDF ya la usan». Queda en la bitácora con el antes y el después.
- **Deshacer:** no hay historial para volver a una versión: copia el HTML antes de cambios grandes. Siempre puedes volver a la plantilla de fábrica (abajo).

### Descartar cambios

«Descartar cambios» vuelve el editor a lo guardado.

### Comparar o restaurar la de fábrica

- **Dónde:** botón «Comparar con la de fábrica» (solo si ya guardaste una versión propia).
- **Qué pasa:** muestra las líneas que solo están en la de fábrica y las que solo están en la tuya. «Restaurar la de fábrica en el editor» la pone en el editor; para que quede, toca «Guardar».

### Insertar el bloque FEL

Una plantilla que guardaste antes no recibe sola las variables nuevas de FEL. Si falta alguna, ves el aviso «Tu plantilla guardada no tiene el bloque FEL nuevo». «Insertar bloque FEL» pone el bloque de la plantilla de fábrica donde está el cursor (quita el anterior si lo tenías) y luego guardas.

## Preguntas frecuentes y errores

- **«La plantilla no puede quedar vacía»**, **«Máximo 100 000 caracteres»**, **«No se permite {{{ }}} ni {{& }}: usa {{variable}}»:** corrige el HTML.
- **«Alguien más guardó la plantilla»:** otra persona guardó mientras editabas. Copia tus cambios si quieres conservarlos y toca «Recargar»: se reemplazan por la versión actual.
- **El PDF del cliente no muestra los datos de FEL:** inserta el bloque FEL (arriba).
- **Los datos de la empresa salen vacíos:** se llenan desde **Configuración → Contacto y pagos** y los datos de la empresa.

## Relacionado

- [Portal del cliente](./portal-del-cliente.md#mi-cuenta)
