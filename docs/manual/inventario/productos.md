---
orden: 2
pantallas:
    - /inventario/productos
    - /inventario/productos-lote#alta-de-productos-por-lote
    - /inventario/tipos-producto#tipos-de-producto
---

# Productos y tipos de producto

El catálogo de lo que el ISP compra, guarda, presta o vende: cable, conectores, routers, ONU, antenas. Cada producto dice cómo se lleva (por cantidad o por serie) y qué pasa cuando se usa con un servicio (se presta, se gasta o se cobra).

Menú: **Inventario → Catálogos y kardex → Productos** y **Inventario → Catálogos y kardex → Tipos de producto**.

## Quién la usa

- Ver productos y tipos: `inventario.ver` (todos los roles base).
- Crear, editar y desactivar productos: `productos.crear`, `productos.editar`, `productos.desactivar` (`admin` y `contabilidad`).
- Alta por lote: `productos.crear_lote` (`admin` y `contabilidad`).
- Tipos de producto: `tipos_producto.crear`, `tipos_producto.editar`, `tipos_producto.desactivar` (`admin` y `contabilidad`).

## Qué ves

Una fila por producto con su nombre, SKU y tipo, su **seguimiento**, su **modalidad**, la existencia sumada de todas las bodegas (con el mínimo si tiene) y su valor. Un clic en la existencia te lleva a las [existencias](./existencias.md) de ese producto.

Filtros: búsqueda por SKU o nombre, seguimiento («Por cantidad» o «Por serie») y estado («Activos», «Desactivados» o «Todos»).

### Seguimiento

| Seguimiento  | Para qué                                      | Ejemplo                    |
| ------------ | --------------------------------------------- | -------------------------- |
| Por cantidad | Se lleva cuánto hay.                          | Cable, conectores, grapas. |
| Por serie    | Cada equipo es una unidad con su serie o MAC. | Router, ONU, antena.       |

El seguimiento ya no se puede cambiar cuando el producto tiene existencias.

### Modalidad

Dice qué pasa cuando el producto se usa con un servicio:

| Modalidad | Etiqueta   | Qué pasa                                                                                                              | Con qué seguimiento      |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Comodato  | «Comodato» | Se presta al cliente y vuelve al retirar el servicio. Mientras está prestado es un activo fijo del ISP y se deprecia. | Solo por serie           |
| Gasto     | «Gasto»    | Se consume en la instalación y lo absorbe el ISP.                                                                     | Solo por cantidad        |
| Cobro     | «Cobro»    | Se consume y se cobra al cliente con un cargo único (precio con IVA). Por serie es la venta del equipo.               | Por cantidad o por serie |

Cambiar la modalidad afecta solo lo que se registre después.

## Acciones

### Nuevo producto y editar

- **Permiso:** `productos.crear` para «Nuevo producto»; `productos.editar` para el lápiz de una fila.
- **Campos:**
    - **SKU** (único en la empresa) y **Nombre**.
    - **Tipo:** al elegirlo, un producto nuevo toma el seguimiento y la modalidad del tipo; luego los puedes cambiar.
    - **Unidad de medida:** unidad, metro, caja…
    - **Seguimiento** y **Modalidad**, como se explicó arriba.
    - **Clase de activo al prestarlo:** solo en productos por serie en comodato. Es la clase de activo fijo con que se deprecia mientras está prestado («Equipo de red» por defecto).
    - **Precio de venta:** con IVA. Es el precio que propone el cargo único. En un producto con modalidad «Cobro» es el precio que se cobra al consumirlo; si lo dejas vacío, quien registre el consumo tendrá que escribirlo.
    - **Existencia mínima:** vacía es sin mínimo. Por debajo de ese número, el producto aparece en el filtro «Bajo mínimo» de las existencias.
    - **Cuenta de costo** y **Cuenta de consumo:** solo si contabilidad quiere otra cuenta que la normal (vacías usan 5.6.01 y 5.2.07).
- **Qué pasa:** el producto queda listo para compras, saldos iniciales y movimientos. Si otra persona lo editó mientras tanto, verás un conflicto: recarga y vuelve a guardar.

### Desactivar un producto

- **Permiso:** `productos.desactivar`.
- **Dónde:** el botón de pausa de la fila.
- **Qué pasa:** pide un motivo. El producto deja de ofrecerse en compras, ventas y movimientos; su kardex se conserva.
- **Límite:** solo con existencia 0 en todas las bodegas. Si queda algo, el sistema responde «Producto con existencias» y te dice en qué bodega.

## Alta de productos por lote

Menú: botón «Alta por lote» en **Productos**. Permiso `productos.crear_lote`.

Sirve para cargar muchos productos de una vez, hasta 500 filas, por ejemplo al empezar a usar el sistema.

1. Llena la tabla fila por fila (SKU, nombre, tipo, modalidad, unidad, precio de venta) o usa «Pegar desde Excel o CSV». Las columnas que se pegan van en este orden: SKU, nombre, tipo, unidad, modalidad, precio, cantidad, costo, series. La primera fila puede ser el encabezado. También puedes elegir un archivo CSV.
2. En la columna «Modalidad», «La del tipo» toma la del tipo de producto.
3. Si además quieres cargar lo que ya tienes en bodega, elige arriba la **Entrada a una bodega (opcional)**. Entonces cada fila pide la cantidad y el costo unitario o, si el producto es por serie, sus series o MAC separadas por coma. Esta opción solo aparece si tienes también el permiso `inventario.cargar_saldo_inicial`, y entra como saldo inicial.
4. Pulsa «Crear productos».

::: warning Todo o nada
Si una sola fila tiene un error, no se crea ninguna. Las filas con problema se marcan en rojo y cada celda dice qué corregir. Corrige y vuelve a pulsar «Crear productos».
:::

Errores frecuentes: SKU repetido en el lote o ya existente en la empresa, tipo inexistente, modalidad que no va con el seguimiento, serie o MAC que ya existe. Si contabilidad ya cerró los saldos de apertura, la entrada a bodega no se acepta: crea los productos sin entrada y registra lo comprado con una compra.

## Tipos de producto

Menú: **Inventario → Catálogos y kardex → Tipos de producto**.

Un tipo agrupa productos y define el seguimiento y la modalidad que toma un producto nuevo. Vienen tres de fábrica: «Equipo» (por serie, comodato), «Material» y «Otro» (por cantidad, gasto).

- Los tipos marcados «Global» sirven para todas las empresas de la instalación. Solo los edita o desactiva un usuario con alcance global.
- **Nuevo tipo** (`tipos_producto.crear`): nombre, código (minúsculas, dígitos y _; no cambia después), seguimiento por defecto y modalidad por defecto. Quien tiene alcance global puede marcarlo «Tipo global».
- **Editar** (`tipos_producto.editar`): cambia el nombre, el seguimiento y la modalidad por defecto. Solo afecta a los productos nuevos.
- **Desactivar** (`tipos_producto.desactivar`): pide motivo. Los productos que ya lo usan siguen igual; los nuevos ya no pueden elegirlo.

::: danger Un tipo desactivado no se reactiva desde el panel
No hay botón para volver a activarlo. Si lo necesitas otra vez, crea un tipo nuevo con otro código.
:::

## Preguntas frecuentes y errores

- **No puedo cambiar el seguimiento.** El producto ya tiene existencias.
- **«El comodato es solo para productos por serie» / «El gasto es solo para productos por cantidad».** Cambia la modalidad o el seguimiento para que vayan juntos.
- **No veo «Nuevo producto» ni «Alta por lote».** Te falta el permiso correspondiente.

## Relacionado

- [Existencias](./existencias.md)
- [Equipos por serie y comodato](./equipos.md)
- [Ajustes del inventario](./configuracion.md)
