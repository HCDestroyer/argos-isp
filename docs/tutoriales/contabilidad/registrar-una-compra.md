---
orden: 2
---

# Registrar una compra con su factura

Al terminar, la factura del proveedor queda registrada como compra, con su IVA como crédito fiscal, su asiento y, si trae equipos o materiales, su entrada al inventario.

## Antes de empezar

- Permisos: `compras.cargar_borrador`, `compras.editar_borrador`, `compras.confirmar_borrador` y `compras.registrar` (rol **contabilidad**). Para elegir productos y bodegas, `inventario.ver`.
- Ten el XML FEL de la factura (lo mejor), o su PDF o una foto.
- El mes del documento debe estar abierto.

## Pasos

1. Abre **Compras → Compras** y pulsa «Cargar factura».
2. En **Factura**, elige o arrastra el archivo y pulsa «Cargar». Se abre el borrador.
3. Revisa **Datos de la factura**: NIT y nombre del emisor, tipo, serie, número, fecha, autorización y las líneas.
    - Si la leyó la IA, corrige los campos en ámbar o rojo.
    - Abajo debe decir que las líneas suman el total de la factura.
    - Si cambiaste algo, pulsa «Guardar cambios».
4. En **Confirmar la compra**, elige el proveedor (o «Crear el proveedor» con su NIT y nombre).
5. Elige la **Condición**:
    - **Al crédito**, con su fecha de vencimiento (vacía: los días de crédito del proveedor).
    - **Al contado**, con la caja, el banco o la cuenta con que se pagó.
6. En cada línea elige qué hacer: **Producto existente** (revisa el que propone), **Producto nuevo** o **Gasto**. Para productos, elige la bodega en **Entra a** y, si van por serie, escribe una serie o MAC por unidad.
7. Pulsa «Confirmar compra».

::: tip Sin archivo
Si no tienes el archivo, usa «Registrar compra» en **Compras → Compras** y llena el formulario a mano: proveedor, documento, líneas, retenciones y pago. Ver [Compras](../../manual/compras-y-activos/compras.md#registrar-una-compra).
:::

## Qué pasa después

- La compra aparece en **Compras** con su saldo (si fue al crédito) y entra al libro de compras del mes de su IVA.
- Si fue al contado, se crea el egreso que la pagó.
- Las líneas con producto entran a la bodega elegida.
- Si al proveedor se le retiene, registra la constancia desde la ficha de la compra cuando la emitas.
- Para pagar una compra al crédito: ficha del proveedor → «Registrar pago». Ver [Proveedores y pagos](../../manual/compras-y-activos/proveedores.md#registrar-un-pago-a-un-proveedor).

## Si algo sale mal

| Mensaje                                               | Causa                                      | Qué hacer                                                                 |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Esta factura ya está registrada                       | El mismo emisor, serie y número ya existen | Búscala en **Compras**                                                    |
| Este archivo ya se cargó                              | Hay un borrador con ese archivo            | Ábrelo desde «Por revisar»                                                |
| No hay IA configurada para leer PDF o imágenes        | Falta configurar la IA                     | Captura a mano o pide que la configuren en **Configuración → Inventario** |
| «Guarda los cambios de la factura antes de confirmar» | Hay cambios sin guardar                    | Pulsa «Guardar cambios»                                                   |
| El NIT del receptor no es el de la empresa            | La factura salió a otro NIT                | Pide al proveedor que la corrija; confirma solo si estás seguro           |
| El crédito fiscal está fuera de plazo                 | El mes del IVA ya pasó su ventana          | Regístrala sin crédito fiscal                                             |
