---
orden: 7
pantallas:
    - /inventario/kardex
    - /inventario/valorizado#inventario-valorizado
---

# Kardex e inventario valorizado

El kardex es la historia de cada producto: cada entrada y cada salida con su costo y el saldo que fue quedando. El inventario valorizado dice cuánto había y cuánto valía a una fecha.

Menú: **Inventario → Kardex** y **Inventario → Inventario valorizado**. Permiso `inventario.ver` (todos los roles base).

## Kardex

### Qué ves

Una fila por movimiento:

| Columna         | Qué dice                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fecha           | La fecha del movimiento.                                                                                                                                           |
| Movimiento      | El tipo, con una flecha verde si entra o roja si sale; el producto y la bodega; la causa y el motivo si los tiene; y el enlace al servicio si fue para un cliente. |
| Cantidad        | Con signo: + entra, − sale.                                                                                                                                        |
| Costo           | El costo total y el unitario.                                                                                                                                      |
| Saldo           | La existencia que quedó en esa bodega.                                                                                                                             |
| Valor del saldo | Lo que valía esa existencia.                                                                                                                                       |

El saldo de cada fila es **el de su bodega**. Si eliges un producto, arriba ves su existencia y su valor en todas las bodegas juntas.

Tipos de movimiento: Compra, Compra anulada, Devolución al proveedor, Venta, Venta anulada, Consumo, Traslado, Comodato asignado, Comodato devuelto, Ajuste por conteo, Ajuste, Baja, Saldo inicial, Premio entregado y Entrega de premio anulada.

### Filtros

Producto, bodega, rango de fechas («Desde» y «Hasta») y tipo de movimiento. Desde [Existencias](./existencias.md), «Ver kardex» abre esta pantalla ya filtrada.

::: tip El kardex no se edita
Ningún movimiento se borra ni se cambia. Una corrección es otro movimiento (un ajuste, una anulación) y queda a la vista con su motivo.
:::

## Inventario valorizado

Muestra la cantidad, el costo promedio y el valor de cada producto en cada bodega **a la fecha que elijas**, reconstruidos del kardex.

- **Fecha:** por defecto, hoy.
- **Bodega:** todas o una.
- **Con existencia 0:** muestra también los productos que estaban en cero.

Arriba hay dos tarjetas:

- **Valor al …**: el total de la fecha elegida.
- **Cuadre con 1.1.14 Inventarios**: compara el kardex completo con la cuenta de inventarios del libro a esa misma fecha. Debe decir «El kardex cuadra con el libro». Si alguna empresa no cuadra, verás la empresa, el valor del kardex, el del libro y la diferencia.

::: warning Si no cuadra
Una diferencia entre el kardex y el libro no debería pasar. Avísale a contabilidad o al administrador del sistema con la fecha y la diferencia que ves.
:::

El reporte se ve en pantalla; por ahora no tiene botón para exportarlo.

## Relacionado

- [Existencias](./existencias.md)
- [Conteos físicos](./conteos.md)
- [Contabilidad](../contabilidad/index.md)
