---
orden: 5
pantallas:
    - /configuracion/aviso-cobro
    - /configuracion/plantillas-documentos/nueva
    - /configuracion/plantillas-documentos/[id]
---

# Plantillas de documentos

Aquí decides cómo se ven los PDF del **aviso de cobro** (que pasa a llamarse **factura** cuando está certificada en FEL), del **recibo de cobro** de la caja y de la **nota de crédito**. Cada plantilla es HTML con variables que Argos llena con los datos de cada documento.

Cada documento puede tener **varias plantillas**, cada una con su nombre y su formato:

- **Carta:** hoja carta, para impresora normal o para enviar.
- **POS 80 mm:** rollo de impresora térmica de 80 mm. El PDF sale de 80 mm de ancho, todo en negro, y del largo justo del contenido.

Una de cada documento es la **predeterminada**: la que usan el portal del cliente, el correo y los procesos automáticos. Al imprimir desde el panel (factura, caja, nota de crédito) puedes elegir otra con **Imprimir con…**.

Al actualizar, la plantilla que ya tenías queda como predeterminada con el nombre «Carta», y aparecen listas la «POS 80 mm» del aviso de cobro y la del recibo de cobro. Si trabajas con varias empresas, cada PDF sale con los datos y el logo de la empresa del documento.

## Quién la usa

- **Ver la lista y elegir con cuál imprimir:** permiso `documentos.ver` (`admin`, `cajero`, `soporte`, `contabilidad` y `lectura`).
- **Crear:** `documentos.crear`. **Editar, vista previa y guardar:** `documentos.editar`. **Elegir la predeterminada:** `documentos.predeterminar`. **Desactivar / activar:** `documentos.desactivar` / `documentos.activar`. Todos, solo `admin`. Sin ellos la pantalla queda en solo lectura.

Está en **Ajustes → Facturación y cobro → Plantillas de documentos**.

## Qué ves

- Tres pestañas: «Aviso de cobro y factura», «Recibo de cobro» y «Nota de crédito».
- La lista de plantillas del documento: nombre, formato, «De fábrica» o «Versión N», cuándo se actualizó, y las etiquetas **Predeterminada** y **Desactivada**. La predeterminada va primero.
- El botón **Nueva plantilla** y, en cada fila, el menú **⋮** con Editar, Duplicar, Usar como predeterminada, Desactivar o Activar.

Al abrir una plantilla ves su editor:

- **Nombre** (así aparece al elegir con qué imprimir) y **Formato** (carta o POS 80 mm).
- El editor «HTML de la plantilla», con el contador de caracteres (máximo 100,000). El tamaño de la hoja lo da el formato, no el HTML.
- **Variables**, agrupadas en Empresa, Cliente, Servicio, Factura, Cobro (o Nota de crédito) y Otras, con un buscador. Al tocar una, se inserta donde está el cursor. Pasa el puntero sobre una variable para ver qué significa.
- **Vista previa (datos de ejemplo)** a la derecha: el PDF generado con datos ficticios en el formato elegido.

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

Los montos ya salen en quetzales (`Q 175.00`) y las fechas en hora de Guatemala. La lista completa, con su descripción, está siempre en la pantalla. El **recibo de cobro** usa `cobro.numero`, `cobro.fecha`, `cobro.metodo`, `cobro.total`, `cobro.cajero`, `cliente.nombre`, `cliente.nit` y, por cada empresa del cobro, la lista `{{#secciones}}…{{/secciones}}` con `empresa.nombre`, `pago.numero`, `pago.monto` y sus `{{#aplicaciones}}` (`documento`, `numero`, `periodo`, `monto`). La nota de crédito tiene sus propias variables (`nota.numero`, `nota.fecha`, `nota.motivo`, `nota.monto`… y los datos del documento acreditado).

## Acciones

### Nueva plantilla

- **Permiso:** `documentos.crear`
- **Dónde:** botón «Nueva plantilla», o «Duplicar» en el menú de una plantilla.
- **Qué pasa:** abre su propia pantalla. Eliges el documento, el nombre, el formato y desde dónde empieza: **la plantilla de fábrica** de ese formato o **una copia** de otra plantilla del mismo documento. Al crearla se abre su editor. Nace activa y no predeterminada. El nombre no se puede repetir en el mismo documento («Ya hay una plantilla de este documento con ese nombre»).

### Usar como predeterminada

- **Permiso:** `documentos.predeterminar`
- **Dónde:** menú **⋮** de una plantilla activa → «Usar como predeterminada», y confirmas.
- **Qué pasa:** desde ese momento el portal, el correo y los procesos automáticos usan esa plantilla. La anterior sigue disponible para imprimir. Queda en la bitácora.

### Desactivar o activar

- **Permiso:** `documentos.desactivar` / `documentos.activar`
- **Dónde:** menú **⋮** → «Desactivar» o «Activar», y confirmas.
- **Qué pasa:** una plantilla desactivada ya no se ofrece al imprimir. No se borra. La **predeterminada no se puede desactivar**: primero elige otra como predeterminada.

### Vista previa

- **Permiso:** `documentos.editar`
- **Dónde:** botón «Vista previa».
- **Qué pasa:** genera el PDF con datos de ejemplo, **sin guardar**. «Abrir PDF» lo abre en otra pestaña. Si sigues editando, aparece «Cambiaste la plantilla después de esta vista previa» con «Actualizar».

### Guardar

- **Permiso:** `documentos.editar`
- **Dónde:** botón «Guardar».
- **Qué pasa:** guarda el nombre, el formato y el HTML. Antes de guardar, Argos prueba que la plantilla genere un PDF con los datos de ejemplo en su formato; si no, muestra el error y no guarda. Al guardar ves «Plantilla guardada · … versión N. Los próximos PDF ya la usan». Queda en la bitácora con el antes y el después. Si dejas el HTML igual al de fábrica, la plantilla queda «De fábrica» y recibe sola las mejoras de las próximas versiones.
- **Deshacer:** no hay historial para volver a una versión: copia el HTML antes de cambios grandes. Siempre puedes volver a la plantilla de fábrica (abajo).

### Descartar cambios

«Descartar cambios» vuelve el editor a lo guardado.

### Comparar o restaurar la de fábrica

- **Dónde:** botón «Comparar con la de fábrica» (solo si el HTML es distinto al de fábrica de su formato).
- **Qué pasa:** muestra las líneas que solo están en la de fábrica y las que solo están en la tuya. «Restaurar la de fábrica en el editor» la pone en el editor; para que quede, toca «Guardar».

### Insertar el bloque FEL

Una plantilla que editaste no recibe sola las variables nuevas de FEL. Si falta alguna, ves el aviso «Tu plantilla guardada no tiene el bloque FEL nuevo». «Insertar bloque FEL» pone el bloque de la plantilla de fábrica donde está el cursor (quita el anterior si lo tenías) y luego guardas.

## Preguntas frecuentes y errores

- **«La plantilla no puede quedar vacía»**, **«Máximo 100 000 caracteres»**, **«No se permite {{{ }}} ni {{& }}: usa {{variable}}»:** corrige el HTML.
- **Quiero imprimir en la impresora térmica:** en la factura, la caja o la nota de crédito toca la flecha junto al botón del PDF (**Imprimir con…**) y elige «POS 80 mm». Si no aparece, revisa que esa plantilla esté activa.
- **«La plantilla está desactivada»** o **«La plantilla es de otro documento»** al imprimir: alguien la desactivó mientras tenías la pantalla abierta; recarga y elige otra.
- **«Alguien más guardó la plantilla»:** otra persona guardó mientras editabas. Copia tus cambios si quieres conservarlos y toca «Recargar»: se reemplazan por la versión actual.
- **El PDF del cliente no muestra los datos de FEL:** inserta el bloque FEL (arriba).
- **Los datos de la empresa salen vacíos:** se llenan desde **Ajustes → Empresa y fiscal → Contacto y pagos** y los datos de la empresa.

## Relacionado

- [Portal del cliente](./portal-del-cliente.md#mi-cuenta)
- [Cobrar en caja](../cobros/cobrar.md)
