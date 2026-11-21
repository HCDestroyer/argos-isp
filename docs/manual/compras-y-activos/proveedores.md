---
orden: 3
pantallas:
    - /proveedores
    - /proveedores/[id]#ficha-del-proveedor
    - /pagos-proveedores#pagos-a-proveedores
---

# Proveedores y pagos

Los proveedores de la empresa con lo que se les debe, sus compras y los pagos que se les hicieron.

Están en **Finanzas → Compras → Proveedores** y **Finanzas → Compras → Pagos a proveedores**.

## Quién la usa

- Ver proveedores: `proveedores.ver` (**admin**, **contabilidad** y **lectura**).
- Crear y editar: `proveedores.editar` (**contabilidad** y **admin**).
- Ver pagos a proveedores: `compras.ver`.
- Registrar y anular pagos: `compras.pagar` (**contabilidad** y **admin**).

## Qué ves

Busca por **Nombre o NIT** y filtra por **Tipo** (general, pequeño contribuyente, no residente, sin documento) y por **Activos**, **Inactivos** o ambos.

Cada fila muestra el proveedor con su documento, el tipo, los días de **Crédito** y **Le debemos** (su saldo).

## Acciones

### Crear o editar un proveedor

- **Permiso:** `proveedores.editar`
- **Dónde:** botón «Nuevo proveedor» en la lista, o «Editar» en la ficha.
- **Campos:**
    - **Documento**: NIT, CUI o identificación extranjera, y su **Número** (con o sin guion: `1234567-8`). Al editar, el documento no cambia.
    - **Nombre o razón social** y **Tipo**.
    - **Régimen del ISR**: sin indicar, sobre utilidades, opcional simplificado (se le retiene ISR) o pequeño contribuyente.
    - **Días de crédito**: el plazo por defecto de sus compras al crédito.
    - **Es agente de retención de IVA**: si lo es, no se le retiene IVA.
    - **Teléfono**, **Correo** y **Dirección**.
- **Qué pasa:** el proveedor queda disponible para compras. Cada cambio queda en la bitácora con el cambio de cada campo. Si otra persona lo cambió mientras editabas, verás «Alguien más cambió el proveedor»: recarga la ficha y repite el cambio.

## Ficha del proveedor

Arriba ves el nombre, su tipo, «Inactivo» si lo está y «Se le retiene ISR (régimen opcional)» si aplica, con su documento, lo que le debemos, el crédito, si es agente de retención de IVA y sus datos de contacto. Los botones «Registrar compra» y «Registrar pago» llevan a cada acción.

Tiene tres pestañas:

- **Estado de cuenta**: la lista **Por pagar** (cada compra con saldo, con «Vence el …» o «Vencida hace N días» en rojo) y los movimientos al crédito con debe, haber y saldo (compra, nota de crédito, pago, anulación, ajuste).
- **Compras**: sus compras con fecha, documento, condición, estado, total y saldo.
- **Pagos**: sus pagos con fecha, monto y estado.

### Registrar un pago a un proveedor

- **Permiso:** `compras.pagar`
- **Dónde:** botón «Registrar pago» en la ficha (aparece si hay compras por pagar).
- **Campos:** las compras a pagar (marca las que quieras), **Monto**, con qué se pagó (caja, banco o cuenta bancaria propia), **Fecha** (vacía: hoy), **Referencia** (cheque, transferencia…) y **Descripción**.
- **Qué pasa:** el pago se aplica primero a las compras marcadas y luego a la más antigua por vencimiento. Se registra su asiento y baja el saldo de esas compras.

## Pagos a proveedores

La pantalla **Pagos a proveedores** lista todos los pagos. Filtra por estado: todos, registrados o anulados. Cada fila muestra la fecha, el número de pago y el proveedor (enlace a sus pagos), el método y la referencia, las compras a las que se aplicó con su monto, y el monto (tachado si se anuló, con el motivo).

Un pago se registra desde la ficha del proveedor, con lo que se le debe a la vista.

### Anular un pago

- **Permiso:** `compras.pagar`
- **Dónde:** botón de anular en la fila del pago (en esta pantalla o en la pestaña **Pagos** de la ficha). Pide motivo (por ejemplo, «el cheque fue rechazado»).
- **Qué pasa:** se registra el reverso con fecha de hoy y las compras a las que se aplicó vuelven a quedar con saldo.

## Preguntas frecuentes y errores

| Mensaje                           | Qué hacer                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| Ese proveedor ya existe           | Ya hay un proveedor con ese documento: búscalo en la lista |
| El pago pasa de lo que se le debe | Baja el monto al saldo pendiente                           |
| El pago es anterior a la compra   | Usa una fecha igual o posterior a la de la compra          |
| La cuenta es de otra empresa      | Elige una caja o cuenta de la misma empresa que la compra  |
| No aparece «Registrar pago»       | El proveedor no tiene compras por pagar                    |

## Relacionado

- [Compras](./compras.md)
- [Reportes: cuentas por pagar](../reportes/catalogo.md#cuentas-por-pagar)
