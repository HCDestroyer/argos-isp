---
orden: 1
pantallas:
    - /inventario
---

# Existencias

Aquí ves qué hay en cada bodega, cuánto vale y qué está por debajo del mínimo. Desde esta pantalla también registras el saldo inicial, los consumos, los traslados inmediatos, los ajustes y las bajas.

Menú: **Inventario → Existencias**.

## Quién la usa

- Para verla necesitas el permiso `inventario.ver`. Lo traen todos los roles base: `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad` y `lectura`.
- Cada operación pide además su propio permiso (abajo). Si no lo tienes, la opción no aparece en el menú «Registrar».

## Qué ves

Una fila por producto y bodega:

| Columna    | Qué dice                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Producto   | Nombre, SKU y su modalidad (Comodato, Gasto o Cobro). Si está por debajo del mínimo lleva la marca amarilla «Bajo mínimo».                      |
| Bodega     | Nombre de la bodega, con el icono de bodega o de técnico.                                                                                       |
| Existencia | Cuánto hay, en la unidad del producto. Si el producto tiene mínimo, debajo verás «mín. … · total …» (el total es la suma de todas las bodegas). |
| Promedio   | Costo promedio por unidad en esa bodega.                                                                                                        |
| Valor      | Lo que vale esa existencia.                                                                                                                     |

Abajo de la tabla está el «Valor de esta página»: es la suma de las filas que tienes a la vista, no de todo el inventario. Para el valor total a una fecha usa el [inventario valorizado](./kardex-y-valorizado.md#inventario-valorizado).

### Filtros

- **Bodega** y **Producto**: limitan la tabla.
- **Bajo mínimo**: solo los productos que quedaron por debajo de su existencia mínima. El mínimo se define en cada [producto](./productos.md).
- **En tránsito**: agrega lo que va viajando en una [orden de traslado](./traslados.md). Esas filas no tienen menú: su botón con el camión te lleva a las órdenes en tránsito.

::: tip El sistema no manda un aviso cuando algo baja del mínimo
Por ahora nadie recibe una notificación. Revisa el filtro «Bajo mínimo» con frecuencia, por ejemplo antes de hacer pedidos.
:::

### Cómo se calcula el costo

- Lo que se lleva **por cantidad** (cable, conectores, grapas) usa un **costo promedio por bodega**. Cada compra a otro precio cambia el promedio de la bodega que la recibe. Cada salida sale a ese promedio.
- Lo que se lleva **por serie** (router, ONU, antena) tiene el **costo de cada equipo**.
- Cuando una bodega se queda sin existencia de un producto, su valor también queda en Q 0.00.

## Acciones

Hay dos formas de empezar una operación:

- El botón «Registrar» de arriba, que abre la operación en blanco.
- El menú «⋮» de una fila, que la abre con el producto y la bodega ya elegidos. Ese menú trae también «Ver kardex».

Antes de confirmar, el formulario te muestra cuánto hay en la bodega, su valor y su promedio. Si la operación falla, no se registra nada.

### Saldo inicial

- **Permiso:** `inventario.cargar_saldo_inicial` (`admin` y `contabilidad`).
- **Dónde:** «Registrar» → «Saldo inicial». No aparece en el menú de las filas.
- **Para qué:** cargar lo que ya tenías en bodega el día que empezaste a usar el inventario.
- **Qué pides:** producto, bodega, cantidad y costo unitario. Para un equipo por serie, su serie o MAC y su costo (un equipo por vez). Puedes poner una fecha pasada; vacía es hoy.
- **Qué pasa:** entra al kardex y al libro contra la cuenta de saldos de apertura.
- **Límites:** una sola vez por producto y bodega, y antes de cualquier otro movimiento ahí. Si ya hay movimientos, corrige con un ajuste. Si contabilidad ya cerró los saldos de apertura de la empresa, tampoco se puede: lo nuevo entra por una compra.

### Consumo

- **Permiso:** `inventario.consumir` (`admin` y `tecnico`).
- **Para qué:** materiales que se usaron en una instalación o reparación.
- **Qué pides:** producto, bodega, cantidad y, si quieres, el número del servicio donde se usó. Puedes poner una fecha pasada (vacía es hoy).
- **Qué pasa según la modalidad del producto:**
    - **Gasto:** sale del inventario y se registra como gasto de materiales del ISP.
    - **Cobro:** el número de servicio es obligatorio. Al registrarlo se emite **un cargo único al cliente** de ese servicio con la fecha de hoy, al precio de venta del producto (o al que escribas). Un aviso te dice cuánto se cobró y te deja abrir la factura.
    - **Comodato:** no se consume. El equipo se presta desde la ficha del servicio (ver [equipos en comodato](./equipos.md)).
- **Productos por serie:** no se consumen desde aquí. Se prestan en comodato o se dan de baja.

::: warning El cargo se emite al instante
Un consumo de un producto con modalidad «Cobro» factura al cliente en ese momento. Si te equivocaste, el cargo se corrige desde facturación (anulación o nota de crédito), no desde el inventario.
:::

### Traslado inmediato

- **Permiso:** `inventario.trasladar` (`admin` y `tecnico`).
- **Para qué:** mover existencias de una bodega a otra (o a la de un técnico) **en el acto**, sin que nadie firme.
- **Qué pides:** producto, bodega de origen («Desde»), destino («Hacia») y la cantidad o los equipos.
- **Qué pasa:** sale del origen y entra al destino al mismo costo. No toca la contabilidad.
- Si necesitas que quien recibe lo confirme y firme, usa una [orden de traslado](./traslados.md).

### Ajuste

- **Permiso:** `inventario.ajustar` (`admin` y `contabilidad`).
- **Para qué:** corregir la existencia a mano. Cantidad con signo: positiva entra (sobrante), negativa sale (faltante). Para un equipo por serie eliges «Entra un equipo (sobrante)» y escribes su serie o MAC, o «Sale un equipo (faltante)» y eliges cuál.
- **Motivo:** obligatorio.
- **Costo:** solo hace falta si entra algo en una bodega que no tenía existencia; si no, va al promedio.
- **Qué pasa:** un faltante se registra como merma; un sobrante, como ingreso por sobrantes.
- **Fecha pasada:** se permite dentro de un mes abierto, siempre que después de esa fecha no haya otro movimiento que haya cambiado el costo de ese producto en esa bodega. Si lo hay, regístralo con la fecha de hoy.

### Baja

- **Permiso:** `inventario.dar_de_baja` (`admin` y `contabilidad`).
- **Para qué:** sacar lo dañado, robado u obsoleto.
- **Qué pides:** producto, bodega, cantidad (o el equipo), la causa («Dañado», «Robado», «Obsoleto» u «Otro») y el motivo, que es obligatorio.
- **Qué pasa:** sale del inventario como merma, con la fecha de hoy.

::: danger No se deshace
Un ajuste o una baja no se borran. Si te equivocaste, registra el movimiento contrario (por ejemplo, un ajuste positivo) con su motivo.
:::

## Preguntas frecuentes y errores

- **«Existencia insuficiente».** Pediste sacar más de lo que hay en esa bodega. Revisa la cantidad o la bodega elegida.
- **«Unidad en comodato».** El equipo está prestado a un servicio. Primero hay que devolverlo o declararlo perdido.
- **«Saldo inicial registrado».** Ese producto ya tiene su saldo inicial en esa bodega. Corrige con un ajuste.
- **«Apertura cerrada».** Contabilidad ya cerró los saldos de apertura. Registra la mercadería con una compra (o un ajuste si salió en un conteo).
- **«Movimientos posteriores a la fecha».** Hay un movimiento después de la fecha que pusiste que cambió el costo. Regístralo con la fecha de hoy.
- **El cargo de un consumo pide precio.** El producto no tiene precio de venta. Escríbelo en el formulario o agrégalo al [producto](./productos.md).
- **El mes está cerrado.** Si el movimiento cae en un periodo cerrado o bloqueado en el libro, no se registra. Usa una fecha dentro de un mes abierto o habla con contabilidad.

## Relacionado

- [Productos y tipos de producto](./productos.md)
- [Bodegas y Mi bodega](./bodegas.md)
- [Órdenes de traslado](./traslados.md)
- [Kardex e inventario valorizado](./kardex-y-valorizado.md)
