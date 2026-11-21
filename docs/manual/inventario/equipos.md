---
orden: 4
pantallas:
    - /inventario/unidades
    - /inventario/por-recuperar#equipos-por-recuperar
---

# Equipos por serie y comodato

Cada router, ONU o antena que se lleva por serie es un equipo con su serie o MAC. Aquí lo buscas, ves dónde está y su historia, y sigues los que hay que recuperar de servicios retirados.

Menú: **Inventario → Movimientos → Equipos por serie** y **Inventario → Movimientos → Por recuperar**.

## Quién la usa

- Ver: `inventario.ver` (todos los roles base).
- Marcar un equipo como reparado: `inventario.marcar_reparada` (`admin`, `tecnico` y `contabilidad`).
- Prestar en comodato: `inventario.asignar_comodato`; recibirlo de vuelta: `inventario.devolver_comodato` (`admin` y `tecnico`).
- Declarar perdido un equipo prestado: `inventario.declarar_perdida_comodato` (solo `admin`).

## Qué ves

En **Equipos por serie**, una fila por equipo con su serie y MAC, el producto, si es nuevo o usado, su estado, dónde está (una bodega o un servicio) y su costo.

- **Buscar:** escribe parte de la serie, o la MAC con o sin separadores (`AA:BB:CC:DD:EE:FF`, `AA-BB-…` o `AABBCC…`).
- **Estado:** filtra por cualquiera de estos:

| Estado                | Qué significa                                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| Disponible            | En una bodega, listo para prestar, trasladar o vender.                         |
| En comodato           | Prestado a un servicio, en casa del cliente.                                   |
| Por recuperar         | Sigue en casa del cliente, pero el servicio se retiró.                         |
| En reparación         | Volvió dañado: cuenta en la bodega, pero no se presta hasta marcarlo reparado. |
| Vendida               | Se vendió con un cargo único.                                                  |
| Dada de baja          | Salió por daño, robo, pérdida o faltante de un conteo.                         |
| Anulada               | Su compra se anuló.                                                            |
| Devuelta al proveedor | Salió con una nota de crédito del proveedor.                                   |
| Entregada (premio)    | Se entregó como premio de un sorteo.                                           |

Un clic en la serie abre el **historial** del equipo: estado, condición, costo, dónde está y cada movimiento con su fecha, bodega, costo, servicio y motivo.

### Marcar reparada

En el historial de un equipo «En reparación» aparece «Marcar reparada». Pide un motivo (por ejemplo, «se cambió el adaptador de corriente»). El equipo vuelve a «Disponible» en la misma bodega y se puede prestar otra vez. No mueve costos.

## Equipos en comodato

Los equipos se prestan y se reciben desde la sección **Equipos en comodato** de la ficha del servicio, no desde el inventario.

- **Asignar equipo** (`inventario.asignar_comodato`): busca un equipo disponible por serie o MAC y elige la fecha (vacía es hoy). El equipo sale de su bodega y pasa a ser un activo fijo del ISP que se deprecia desde el mes siguiente. Un servicio retirado no recibe equipos; uno pendiente de instalación sí.
- **Devolver** (`inventario.devolver_comodato`): elige la bodega que lo recibe, si vuelve «Nuevo» o «Usado», la fecha y una nota. Activa «Entra a reparación» si viene dañado. El equipo vuelve a la bodega a su valor en libros (lo que costó menos lo depreciado) y sin pérdida ni ganancia.
- **Declarar pérdida** (`inventario.declarar_perdida_comodato`): pide un motivo. El equipo se da de baja como pérdida del ISP.

::: danger La pérdida no se deshace y no cobra al cliente
Declarar la pérdida no le cobra nada al cliente. Si quieres cobrarle el equipo no devuelto, emite aparte un cargo único.
:::

Un equipo en comodato no se puede vender, trasladar ni dar de baja: primero se devuelve o se declara perdido.

## Equipos por recuperar

Cuando un servicio se **retira**, cada equipo en comodato de ese servicio pasa solo a «Por recuperar». Si el servicio vuelve a otro estado, sus equipos vuelven a «En comodato».

Esta pantalla lista esos equipos con su serie o MAC, el producto, el servicio y el cliente (con enlace), la fecha en que se prestaron y su valor en libros.

Para cerrarlos:

1. Abre el servicio con su enlace (te lleva directo a la sección de equipos).
2. Si recuperaste el equipo, usa «Devolver».
3. Si el cliente no lo entrega, usa «Declarar pérdida» y, si corresponde, cobra con un cargo único.

::: tip Iris
Si tu empresa tiene Iris conectado, Argos también le avisa de cada equipo por recuperar.
:::

## Preguntas frecuentes y errores

- **«Unidad en comodato».** Ese equipo está prestado a un servicio: devuélvelo o declara la pérdida antes de moverlo.
- **«Servicio retirado».** Un servicio retirado no recibe equipos en comodato.
- **No encuentro un equipo para asignar.** Solo aparecen los «Disponible» de la empresa del servicio. Uno en reparación hay que marcarlo reparado antes.
- **No veo «Declarar pérdida».** Es solo del rol `admin`.

## Relacionado

- [Existencias](./existencias.md)
- [Conteos físicos](./conteos.md)
- [Clientes y servicios](../clientes-y-servicios/index.md)
