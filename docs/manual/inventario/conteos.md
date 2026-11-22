---
orden: 6
pantallas:
    - /inventario/conteos
    - /inventario/conteos/[id]#captura-y-cierre
---

# Conteos físicos

Un conteo compara lo que hay de verdad en una bodega con lo que dice el sistema. Al cerrarlo, los faltantes y sobrantes se ajustan solos, con su costo y su registro contable.

Menú: **Inventario → Movimientos → Conteos físicos**.

## Quién la usa

| Acción              | Permiso                      | Roles base                         |
| ------------------- | ---------------------------- | ---------------------------------- |
| Ver conteos         | `inventario.ver`             | Todos                              |
| Abrir un conteo     | `inventario.abrir_conteo`    | `admin`, `contabilidad`            |
| Capturar lo contado | `inventario.contar`          | `admin`, `contabilidad`, `tecnico` |
| Cerrar              | `inventario.cerrar_conteo`   | `admin`, `contabilidad`            |
| Cancelar            | `inventario.cancelar_conteo` | `admin`, `contabilidad`            |

## Qué ves

Una fila por conteo con su número, la bodega, la fecha de corte, el motivo y su estado: «Abierto», «Cerrado» o «Cancelado». En los cerrados se ve el faltante y el sobrante en quetzales.

## Acciones

### Abrir un conteo

Botón «Abrir conteo». Elige la bodega y, si quieres, un motivo («Conteo de fin de mes»). Te lleva a la captura.

Solo puede haber un conteo abierto por bodega. **La bodega sigue trabajando mientras cuentas**: se puede vender, consumir y trasladar.

## Captura y cierre

### Capturar una línea

En la sección «Capturar»:

1. Elige el producto.
2. Si es por cantidad, escribe lo **Contado** (0 si no hay). Si es por serie, pega o escanea las **Series o MAC encontradas**, una por línea.
3. Solo si sobra algo de un producto que no tenía existencia, escribe el **Costo del sobrante**.
4. Pulsa «Capturar línea».

Lo esperado se toma **en el momento de capturar** la línea. Lo que se mueva después (una venta, un consumo) no cuenta como faltante ni sobrante; la tabla lo avisa con «… movimientos después de capturar (no cuentan como diferencia)». Capturar otra vez el mismo producto reemplaza la línea y vuelve a tomar lo esperado.

La tabla muestra por producto lo esperado, lo contado y la diferencia en cantidad y en quetzales: en rojo lo que falta, en verde lo que sobra. Arriba ves el «Faltante si se cierra» y el «Sobrante si se cierra».

En productos por serie:

- Falta cada equipo que estaba en la bodega al capturar, no se contó y sigue ahí.
- Sobra una serie contada que no era de la bodega. Entra como equipo usado. Si esa serie es de un equipo que está en otra bodega o prestado, no se acepta: trasládalo antes.

### Cerrar conteo

Botón «Cerrar conteo» (necesita al menos una línea). La confirmación muestra el faltante (a mermas) y el sobrante (a ingresos por sobrantes). Pulsa «Cerrar y ajustar».

**Qué pasa:** solo se ajustan los productos contados; lo que no capturaste no cambia. Los faltantes salen al costo promedio (o al costo de cada equipo, que queda dado de baja); los sobrantes entran al promedio o, sin existencia, al costo que escribiste o al último costo conocido.

::: danger No se reabre
Un conteo cerrado no se vuelve a cerrar ni se reabre. Si algo quedó mal, corrige con un [ajuste](./existencias.md#ajuste) o abre otro conteo.
:::

### Cancelar conteo

Botón «Cancelar conteo». Pide motivo. El conteo queda cancelado sin ningún ajuste y la bodega puede abrir otro.

## Preguntas frecuentes y errores

- **«Conteo abierto».** Esa bodega ya tiene un conteo abierto. Ciérralo o cancélalo.
- **Pide el costo del sobrante.** Sobró algo sin existencia y el producto nunca tuvo costo. Escribe el costo unitario.
- **«Serie o MAC inválida o repetida».** La serie contada pertenece a un equipo que está en otra parte. Trasládalo primero.
- **El periodo está cerrado.** Los ajustes llevan la fecha del cierre; si ese mes está bloqueado en el libro, habla con contabilidad.

## Relacionado

- [Existencias](./existencias.md)
- [Kardex e inventario valorizado](./kardex-y-valorizado.md)
