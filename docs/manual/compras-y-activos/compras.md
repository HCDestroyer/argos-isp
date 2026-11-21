---
orden: 1
pantallas:
    - /compras
    - /compras/nueva#registrar-una-compra
    - /compras/[id]#ficha-de-la-compra
---

# Compras

Las facturas de tus proveedores: con su IVA como crédito fiscal (o al costo), sus retenciones, si se pagaron al contado o quedan al crédito, y su saldo. Cada compra deja su asiento y entra al libro de compras del mes de su IVA.

Está en **Finanzas → Compras → Compras**.

## Quién la usa

- Ver: `compras.ver` (**admin**, **contabilidad** y **lectura**).
- Registrar y registrar constancias: `compras.registrar` (**contabilidad** y **admin**).
- Anular: `compras.anular` (**contabilidad** y **admin**).
- Cargar una factura para leerla: `compras.cargar_borrador` (ver [Cargar una factura de compra](./cargar-factura.md)).
- Diferir una línea: `libro.registrar_asiento` (**contabilidad** y **admin**).

## Qué ves

Filtros: **Mes del IVA**, **Documento** (FACT, FCAM, FPEQ, FCAP, NCRE, NDEB, FESP, DUA, RECIBO), **Condición** (al contado o al crédito), **Estado** (vigentes o anuladas) y el interruptor **Solo con saldo por pagar**.

Cada fila muestra la fecha del documento, el número de compra con el documento (por ejemplo `FACT A-1234`), el proveedor y la condición, el mes del IVA (con «sin crédito» si no se tomó), el total, el saldo y el estado: **Vigente** (verde) o **Anulada** (gris). Las compras al crédito vencidas dicen «Vencida hace N días».

Arriba están los botones «Cargar factura» y «Registrar compra».

## Registrar una compra

- **Permiso:** `compras.registrar`
- **Dónde:** botón «Registrar compra», o «Registrar compra» en la ficha de un proveedor, o «Registrar su compra» en un egreso.

### Datos del documento

- **Proveedor** (búscalo por nombre).
- **Documento**: el tipo, por ejemplo FACT, FPEQ o NCRE.
- **Fecha del documento** (no futura), **Serie** y **Número**.
- **Autorización del DTE**: el UUID de la factura electrónica del proveedor (opcional).
- **Mes del IVA**: vacío toma el del documento. Se puede mover hasta la ventana del crédito fiscal.
- **Compra que corrige**: solo en NCRE y NDEB; en NCRE es obligatoria.
- **Tomar el crédito fiscal del IVA**: sin marcar, el IVA va al costo.
- **Descripción**.

### Líneas

Pulsa «Agregar línea» por cada concepto. Cada línea lleva **Descripción**, **Tipo** (servicio, bien, activo fijo, combustible o importación), **Total con IVA** y:

- **Cuenta**: vacía usa la del tipo de línea.
- Si es **activo fijo**: **Clase del activo** y **Tasa anual** (vacía: el máximo legal de la clase). Se da de alta el activo con la compra.
- Si es **bien** y hay inventario: **Producto del inventario** (opcional; con producto entra a la bodega), la **Bodega que recibe**, la **Cantidad** o, si el producto va por serie, las **Series o MAC** (una por línea). En una NCRE eliges la bodega de la que sale y los equipos que se devuelven.
- **Exenta de IVA**.
- **Gasto anticipado: diferir** con el número de meses (2 a 120): el gasto se amortiza cada mes.

Abajo ves la base, el IVA (12 %) y el total como referencia.

### Retenciones

No aplica a las NCRE. Elige:

- **Sugeridas**: las que tocan según el proveedor. Por ejemplo, al régimen opcional simplificado se le retiene ISR (5 % de la base).
- **Ninguna**.
- **Elegir**: las que indiques (ISR del régimen opcional, IVA de factura especial, IVA a pequeño contribuyente) con su monto, o vacío para calcularlo con la tasa.

### Pago

No aparece si la compra viene de un egreso.

- **Al crédito**: **Vence** (vacío: los días de crédito del proveedor). Queda con saldo por pagar.
- **Al contado**: eliges con qué se pagó (caja, banco o cuenta bancaria propia). Se crea el egreso que la paga junto con el asiento de la compra.

Pulsa «Registrar compra».

::: tip Compra desde un egreso
El asiento del egreso no cambia: la compra agrega la reclasificación del IVA como crédito fiscal. El total menos las retenciones debe ser igual al monto del egreso; si no cuadra, la pantalla lo avisa.
:::

## Ficha de la compra

Al abrir una compra ves:

- El documento, su estado, la condición y la etiqueta «Sin crédito fiscal» si aplica.
- Proveedor (enlace a su ficha), tipo, fecha del documento, mes del IVA, fecha contable, vencimiento, autorización, la compra que corrige y el egreso con que se pagó o del que salió.
- **Base**, **IVA** (crédito fiscal o al costo), **Total**, **Retenido**, **Neto al proveedor** y **Saldo por pagar**.
- Las **Líneas** con su cuenta, base e IVA; las que entraron al inventario enlazan al kardex del producto.
- Las **Retenciones emitidas**, cada una con «Constancia …» o «Sin constancia».
- Los **Activos y diferidos de esta compra**, con enlace a cada uno.

### Anular la compra

- **Permiso:** `compras.anular`
- **Dónde:** botón «Anular». Pide motivo (por ejemplo, «factura con el NIT equivocado»).
- **Qué pasa:** se registra el reverso con fecha de hoy; el libro de compras la resta en este mes. Si fue al contado, también se anula su egreso. Sus activos sin cuotas quedan dados de baja y sus diferidos, cancelados.

| Error                                         | Qué hacer                                               |
| --------------------------------------------- | ------------------------------------------------------- |
| La compra tiene notas de crédito              | Anula primero las NCRE del proveedor que la corrigen    |
| La compra tiene pagos                         | Anula primero los pagos aplicados (Pagos a proveedores) |
| La compra ya tiene su constancia de retención | Ya no se anula: corrígela con una NCRE del proveedor    |
| Su activo ya se deprecia                      | Da de baja el activo en vez de anular la compra         |

### Registrar la constancia de retención

- **Permiso:** `compras.registrar`
- **Dónde:** botón «Registrar constancia» en las retenciones emitidas sin constancia.
- **Campos:** **Retención**, **Número de la constancia** y **Fecha** (vacía: hoy).
- **Qué pasa:** queda la constancia ligada a la retención. No mueve el libro: la retención ya estaba registrada. La ves también en [Constancias de retención](../fiscal/constancias.md).

### Diferir una línea

- **Permiso:** `libro.registrar_asiento`
- **Dónde:** botón «Diferir línea» (solo en compras vigentes con líneas que se pueden diferir).
- **Campos:** **Línea**, **Meses**, **Primera cuota** (vacío: el mes de la compra) y **Descripción**.
- **Qué pasa:** el gasto pagado por anticipado pasa a gastos anticipados y se amortiza cada mes.

## Preguntas frecuentes y errores

| Mensaje                               | Qué significa / qué hacer                                             |
| ------------------------------------- | --------------------------------------------------------------------- |
| Esa compra ya está registrada         | Ya hay una compra del mismo proveedor con esa serie y número          |
| El crédito fiscal está fuera de plazo | Registra la compra sin crédito fiscal (el IVA va al costo)            |
| La compra no cuadra con el egreso     | El total menos las retenciones debe ser el monto del egreso           |
| El egreso ya tiene su compra          | Ese egreso ya se registró como compra                                 |
| La nota de crédito pasa del saldo     | Una NCRE no puede ser mayor que lo que queda de la compra que corrige |

## Relacionado

- [Cargar una factura de compra](./cargar-factura.md)
- [Proveedores y pagos](./proveedores.md)
- [Activos fijos](./activos.md)
- [Tutorial: registrar una compra con su factura](../../tutoriales/contabilidad/registrar-una-compra.md)
