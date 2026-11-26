---
orden: 5
pantallas:
    - /inventario/traslados
    - /inventario/traslados/nueva#nueva-orden-de-traslado
    - /inventario/traslados/[id]#detalle-de-una-orden
---

# Órdenes de traslado

Una orden de traslado envía productos y equipos de una bodega a otra, o al vehículo de un técnico. Lo enviado queda **en tránsito** hasta que quien recibe lo confirma, con firma digital, con firma en papel o, si la empresa lo permite, con una aceptación simple. Lo que no llega vuelve a la bodega que lo envió.

Menú: **Inventario → Movimientos → Traslados**.

## Quién la usa

| Acción                    | Permiso                                  | Roles base                         |
| ------------------------- | ---------------------------------------- | ---------------------------------- |
| Ver órdenes               | `inventario.ver`                         | Todos                              |
| Enviar una orden          | `inventario.crear_traslado`              | `admin`, `contabilidad`, `tecnico` |
| Recibir                   | `inventario.recibir_traslado`            | `admin`, `contabilidad`, `tecnico` |
| Cancelar                  | `inventario.cancelar_traslado`           | `admin`, `contabilidad`, `tecnico` |
| Adjuntar el papel firmado | `inventario.adjuntar_documento_traslado` | `admin`, `contabilidad`            |

La bodega de un técnico solo la opera ese técnico o quien tenga alcance global: un técnico no envía desde la bodega de otro ni recibe lo que va a la bodega de otro.

::: tip ¿Orden de traslado o traslado inmediato?
El traslado inmediato de [Existencias](./existencias.md#traslado-inmediato) mueve en el acto, sin que nadie firme. La orden de traslado deja constancia de quién envió, quién recibió y qué faltó.
:::

## Qué ves

Una fila por orden con su número, la ruta (origen → destino, con el técnico), el estado, la fecha de envío, las líneas y el valor enviado.

| Estado                   | Qué significa                                         |
| ------------------------ | ----------------------------------------------------- |
| En tránsito              | Enviada; el destino todavía no la recibe.             |
| Recibida                 | Llegó todo.                                           |
| Recibida con diferencias | Faltó algo; lo faltante volvió a la bodega de origen. |
| Cancelada                | Se canceló antes de recibirla; todo volvió al origen. |

Filtros: estado, bodega, técnico y número de orden. El filtro «Recibida con diferencias» es tu lista de faltantes por investigar.

## Nueva orden de traslado

Botón «Nueva orden». Permiso `inventario.crear_traslado`.

1. Elige **Desde** (bodega o técnico que envía) y **Hacia** (quien recibe).
2. Escribe un **Motivo** si quieres; sale en el PDF y en el kardex.
3. Agrega las líneas:
    - «Agregar producto» muestra lo que hay en el origen. Un producto va una sola vez.
    - En un producto por cantidad, escribe la cantidad.
    - En un producto por serie, elige los equipos o usa «Escanear serie o MAC»: escanea (un lector de código de barras funciona como teclado) o escribe y pulsa Enter. Si el equipo no está en esa línea, se agrega solo.
4. Pulsa «Enviar orden».

**Qué pasa:** todo sale del origen al mismo costo y queda en tránsito. El origen ya no lo cuenta y el destino todavía no. Al terminar verás «Orden N.º … enviada». No mueve la contabilidad.

**Todo o nada:** si una línea no alcanza («Existencia insuficiente») o un equipo no está disponible, no sale nada. Corrige esa línea y vuelve a enviar.

## Detalle de una orden

Muestra el estado, quién la envió y cuándo, la ruta, el motivo, el valor enviado y cada línea con lo enviado, lo recibido y el faltante. En los equipos por serie, cada uno lleva un camión (en tránsito), un cheque (llegó) o una equis (faltó).

Ya recibida, la sección **Recepción** dice el método, quién recibió, quién lo registró, la fecha, las observaciones y la firma digital con su huella (SHA-256), o el papel firmado.

### Imprimir

«Imprimir» abre el PDF de la orden: empresa, número, fecha, origen y destino, una fila por producto con su casilla, y los espacios «Entrega» y «Recibe». **No muestra costos**, porque lo firma el técnico. Si ya se firmó en pantalla, la firma sale en el espacio «Recibe»; si no, salen en blanco para firmar a mano.

### Recibir una orden

Botón «Recibir» en el detalle, o «Recibir y firmar» en [Mi bodega](./bodegas.md#mi-bodega). Solo en órdenes en tránsito.

1. **¿Qué llegó?** Todo viene marcado como recibido. Corrige solo lo que faltó: baja la cantidad recibida o desmarca los equipos que no llegaron.
2. **¿Cómo se recibe?**
    - «Firma digital»: quien recibe firma en la pantalla con el dedo, un lápiz o el ratón. «Borrar firma» la limpia.
    - «Firma en papel»: solo para usuarios con alcance global (un encargado). Imprime la orden, que la firme quien recibe y luego adjunta la foto o el escaneo.
    - «Aceptación simple»: sin firma. Solo aparece si en [Ajustes → Red y equipos → Inventario](./configuracion.md) la firma no es obligatoria.
3. Agrega **Observaciones** si hace falta («una caja llegó golpeada»).
4. Pulsa «Recibir y firmar» (o «Recibir»).

**Qué pasa:** lo recibido entra al destino al mismo costo. Lo faltante vuelve a la bodega de origen, sin gasto, y la orden queda «Recibida con diferencias». Si el faltante no aparece, contabilidad lo da de baja después o lo saca un [conteo](./conteos.md).

::: danger Una recepción no se repite
Recibida la orden, no se puede volver a recibir ni cambiar lo registrado. Una diferencia posterior se corrige con un ajuste o con otra orden.
:::

### Adjuntar papel firmado

Aparece cuando la orden se recibió con «Firma en papel» y todavía no tiene su documento. Permiso `inventario.adjuntar_documento_traslado`. Sube la foto o el escaneo (JPG, PNG, WebP o PDF de hasta 5 MB) y una nota opcional. Se adjunta una sola vez; después verás «Ver papel firmado».

### Cancelar

Botón «Cancelar», solo en órdenes en tránsito. Pide un motivo. Todo lo enviado vuelve al origen al mismo costo.

## Preguntas frecuentes y errores

- **«La orden ya se recibió».** La recepción guardada no cambia. Corrige con un ajuste.
- **«La orden está cancelada».** Lo enviado ya volvió al origen.
- **«Quien recibe no es el técnico de la bodega destino».** Solo el técnico de esa bodega, o un encargado con alcance global en su nombre, puede recibir.
- **«La firma no es válida».** Borra y vuelve a firmar.
- **«Falta la firma de quien recibe».** Con firma digital, la firma es obligatoria.
- **No me aparece «Aceptación simple».** La empresa exige firma.
- **No me aparece «Firma en papel».** Solo la usa quien tiene alcance global.
- **«La orden ya tiene su documento firmado».** El papel ya se adjuntó; no se reemplaza.

## Relacionado

- [Bodegas y Mi bodega](./bodegas.md)
- [Ajustes del inventario](./configuracion.md)
- [Kardex](./kardex-y-valorizado.md)
