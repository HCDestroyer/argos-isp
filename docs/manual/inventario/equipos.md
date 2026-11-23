---
orden: 4
pantallas:
    - /inventario/unidades
    - /inventario/por-recuperar#equipos-por-recuperar
    - /inventario/revision#revision-y-garantia
---

# Equipos por serie y comodato

Cada router, ONU o antena que se lleva por serie es un equipo con su serie o MAC. Aquí lo buscas, ves dónde está y su historia, y sigues los que hay que recuperar de servicios retirados.

Menú: **Inventario → Movimientos → Equipos por serie**, **Por recuperar** y **Revisión y garantía**. Las tres son pestañas de la misma tarjeta de Inventario, junto a Existencias y Kardex.

## Quién la usa

- Ver: `inventario.ver` (todos los roles base).
- Marcar un equipo como reparado: `inventario.marcar_reparada` (`admin`, `tecnico` y `contabilidad`).
- Prestar en comodato: `inventario.asignar_comodato`; recibirlo de vuelta: `inventario.devolver_comodato` (`admin` y `tecnico`).
- Declarar perdido un equipo prestado: `inventario.declarar_perdida_comodato` (solo `admin`).
- Cambiar el equipo de un servicio: `servicios.cambiar_equipo`.
- Enviar a garantía y resolverla: `inventario.enviar_garantia` e `inventario.resolver_garantia`.
- Registrar un contacto con el cliente para recuperar un equipo: `inventario.registrar_contacto_recuperacion`.
- Declarar un equipo no recuperado y decidir los cobros de equipo: `inventario.cobrar_equipo`. El técnico nunca decide pérdidas ni cobros: solo registra sus intentos desde Iris.

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

Cada estado se ve con su ícono, texto y color: **En comodato** verde, **En bodega** índigo, **Por recuperar** y **En revisión** ámbar, **En garantía** índigo y **Con técnico** gris (un equipo disponible en la bodega de un técnico o de una cuadrilla).

Un clic en la fila abre la **ficha** del equipo: estado y dónde o con quién está, costo y condición, y el historial completo (cambios de estado, movimientos del kardex, garantías, intentos de recuperación y contactos con el cliente). Abajo aparecen las acciones que permite su estado: «Cambiar equipo», «Recibido», «Registrar contacto» o «No recuperado».

### Cambiar equipo

«Cambiar equipo» hace en un solo paso lo que antes eran dos (devolver y asignar):

1. Elige **por qué se cambia**: dañado, actualización, garantía u otro.
2. Escanea o busca el **equipo que entra** (solo los disponibles).
3. Elige **qué pasa con el que sale**: funciona (vuelve a bodega como usado), a revisión, a garantía o dañado (queda en revisión para darlo de baja). Un equipo dañado o en garantía nunca vuelve como «funciona».
4. Si fue por mal uso, activa **«Cobrar al cliente»**: el cobro solo se **propone** y espera en «Cobros de equipo por decidir».

Queda en el historial de los dos equipos y en la bitácora del servicio.

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

### No recuperados y cobros de equipo

Debajo de la lista hay dos apartados:

- **Cobros de equipo por decidir:** los cobros que propuso un cambio de equipo. Con `inventario.cobrar_equipo` eliges «Cobrar» (con el monto, que queda como cargo único al cliente) o «Sin cobro» (con el motivo).
- **No recuperados (este año):** los equipos que se declararon no recuperados, con lo que se decidió: cobrado al cliente o sin cobro.

Para **declarar un equipo no recuperado** hacen falta intentos de 2 técnicos distintos que cuenten o un contacto con el cliente registrado. Se da de baja como pérdida y, si lo eliges, se cobra al cliente el cargo «Equipo no devuelto». No se deshace. Toca el equipo (o «Intentos y declaración» en su menú «⋯») para abrir [Declarar no recuperado](./declarar-no-recuperado.md), con cada intento y su verificación con Iris.

«Crear orden de retiro (Iris)» aparece deshabilitado: Argos crea esa orden solo al retirar el servicio; crearla a mano todavía no está disponible.

## Revisión y garantía

Tres columnas:

- **En revisión:** equipos que volvieron de un cambio o de un retiro y se prueban en bodega. «Funciona: a bodega» lo deja disponible como usado; «Enviar a garantía» pide el proveedor, el RMA y el vencimiento; «Dar de baja» lo saca como gasto (5.6.02).
- **En garantía:** los que tiene el proveedor. «Volvió reparada» lo deja disponible; «Cambiada por otra» toma la serie o MAC del equipo nuevo al mismo costo; «Rechazada» lo regresa a revisión.
- **Dados de baja:** los del mes, con su causa y su costo.

Un equipo en revisión o en garantía sigue contando en su bodega y no se presta.

## Preguntas frecuentes y errores

- **«Unidad en comodato».** Ese equipo está prestado a un servicio: devuélvelo o declara la pérdida antes de moverlo.
- **«Servicio retirado».** Un servicio retirado no recibe equipos en comodato.
- **No encuentro un equipo para asignar.** Solo aparecen los «Disponible» de la empresa del servicio. Uno en reparación hay que marcarlo reparado antes.
- **No veo «Declarar pérdida».** Es solo del rol `admin`.
- **«Faltan intentos» al declarar no recuperado.** Faltan intentos de técnicos distintos; registra un contacto con el cliente o espera otro intento desde Iris.
- **«Cobro ya decidido».** Otra persona ya aprobó o rechazó ese cobro; recarga la lista.

## Relacionado

- [Existencias](./existencias.md)
- [Conteos físicos](./conteos.md)
- [Clientes y servicios](../clientes-y-servicios/index.md)
