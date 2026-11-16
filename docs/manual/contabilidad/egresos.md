---
orden: 4
pantallas:
    - /egresos
---

# Egresos

Los gastos de la empresa pagados con efectivo de caja, desde el banco o desde una cuenta bancaria propia: energía, tránsito de internet, nómina, vehículos, alquileres y otros. Cada egreso deja su asiento en el libro.

Está en **Contabilidad → Egresos**.

## Quién la usa

- Ver la lista: `egresos.ver` (**admin**, **contabilidad** y **lectura**).
- Registrar: `egresos.registrar` (**cajero**, **contabilidad** y **admin**). El cajero no tiene `egresos.ver`, así que no entra a esta pantalla.
- Registrar sin límite: `egresos.registrar_sin_limite` (**contabilidad** y **admin**).
- Anular: `egresos.anular` (**contabilidad** y **admin**).

## Qué ves

Filtros: **Desde** y **Hasta** (fecha contable, día de Guatemala), **Categoría**, **Pagado con** (efectivo de caja, banco o cuenta bancaria propia) y **Estado**. «Limpiar filtros» los quita.

Cada fila muestra:

- Fecha, número de egreso y categoría.
- Proveedor, documento y descripción.
- De dónde salió el dinero (por ejemplo, «Efectivo de caja · Caja principal»).
- El monto (tachado si está anulado) y el estado: **Registrado** (verde) o **Anulado** (gris), con el motivo de anulación.

Arriba de la tabla ves el total de los egresos vigentes de la página. El enlace «libro diario» abre el libro filtrado por egresos.

## Acciones

### Registrar un egreso

- **Permiso:** `egresos.registrar`
- **Dónde:** botón «Registrar egreso».
- **Campos:**
    - **Categoría** (con la cuenta contable de cada una).
    - **Monto** en quetzales, por ejemplo `150.00`.
    - **Pagado con**: efectivo de caja, banco o cuenta bancaria propia.
    - **Fecha contable**: vacía es hoy. No puede ser futura ni de un mes cerrado.
    - **Caja** (si es efectivo). Si la caja tiene turno abierto, el egreso sale de ese turno y baja el esperado del cierre.
    - **Cuenta bancaria** (si es cuenta propia) o **Banco** (si es banco; sin elegir, el banco principal).
    - **Proveedor**, **Documento del proveedor** (serie y número de su factura) y **Descripción**, opcionales.
- **Qué pasa:** se registra el egreso con su asiento (gasto contra caja o banco).

::: warning Sin `egresos.registrar_sin_limite`
Quien no tiene ese permiso (como el cajero) solo registra egresos en efectivo de su caja abierta, con motivo obligatorio en la descripción, con fecha no anterior al turno, sin pasar del efectivo del turno y hasta el máximo por egreso que tenga la empresa. Un egreso mayor lo registra contabilidad.
:::

### Registrar la compra de un egreso

- **Permiso:** `compras.registrar`
- **Dónde:** botón «Registrar su compra» en la fila de un egreso registrado.
- **Qué pasa:** abre el formulario de compra ligado a ese egreso para tomar el IVA como crédito fiscal. Ver [Compras](../compras-y-activos/compras.md#registrar-una-compra).

### Anular un egreso

- **Permiso:** `egresos.anular`
- **Dónde:** botón «Anular» en la fila. Pide motivo (por ejemplo, «se registró dos veces»).
- **Qué pasa:** se registra un asiento de reverso con la fecha de hoy. El egreso queda en la lista como anulado; no se borra.
- **Cuándo no se puede:** un premio de sorteo se anula desde el sorteo («Anular entrega»); un egreso que ya tiene su compra se anula con la compra (la fila lo indica).

## Preguntas frecuentes y errores

| Situación                               | Qué hacer                                                                |
| --------------------------------------- | ------------------------------------------------------------------------ |
| La fecha es de un mes cerrado           | Registra el egreso con fecha de un mes abierto o pide que reabran el mes |
| El egreso supera el máximo del cajero   | Lo registra contabilidad                                                 |
| La caja no tiene turno abierto (cajero) | Abre el turno de tu caja                                                 |
| No aparece «Anular»                     | Es un premio de sorteo o tiene compra: la fila dice dónde se anula       |

## Relacionado

- [Libro](./libro.md)
- [Compras](../compras-y-activos/compras.md)
- [Reportes: egresos por categoría](../reportes/catalogo.md#egresos)
