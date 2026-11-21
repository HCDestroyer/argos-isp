---
orden: 6
pantallas:
    - /cobros/por-liquidar
    - /cobros/liquidaciones/[id]#detalle-de-una-liquidacion
---

# Cobros por liquidar

Cuando cobras por una pasarela, un agente bancario o débito automático, el dinero no llega al banco al momento: el proveedor lo junta y te deposita después, ya con su comisión descontada. Mientras tanto, esos pagos esperan aquí. Cuando llega la liquidación del proveedor, la registras y los pagos quedan cerrados.

Esto solo aplica a los proveedores dados de alta en [Proveedores de cobro](./proveedores-de-cobro.md), y a sus pagos desde su fecha de corte. Sin proveedor configurado, esos pagos van directo al banco.

## Quién la usa

- **Ver:** `bancos.ver` (`admin`, `contabilidad`, `lectura`).
- **Registrar liquidación:** `cobros.liquidar` (`admin`, `contabilidad`).

Se llega desde **Finanzas → Bancos → Cobros por liquidar**.

## Qué ves

Una tarjeta por proveedor con su método, su cuenta puente y el límite de días:

- **Saldo del puente:** lo que dice el libro.
- **Pendiente de liquidar:** la suma de los pagos sin liquidar menos los contracargos.
- **Libro vs pendiente:** «Cuadra» o «Diferencia Q …».
- **Anomalías:** cuántos pagos llevan más días sin liquidar que el límite.

Debajo, la tabla de pagos sin liquidar: pago (o **contracargo**, que resta), fecha y referencia, cliente, antigüedad y monto.

Un **contracargo** aquí es un pago que el proveedor ya liquidó y luego se anuló: la siguiente liquidación lo descuenta.

Al final, **Liquidaciones registradas**: referencia, proveedor, fecha, cantidad de pagos, banco, bruto, comisión y neto.

## Acciones

### Registrar liquidación

- **Permiso:** `cobros.liquidar`.
- **Dónde:** botón «Registrar liquidación» en la tarjeta del proveedor.
- **Qué pide:**
    - **Pagos incluidos:** marca los pagos que trae la liquidación y los contracargos que descuenta.
    - **Bruto:** se propone como la suma de los pagos menos los contracargos. Si lo cambias, el panel avisa que no coincide y la API lo rechaza como descuadrado.
    - **Comisión:** lo que cobró el proveedor. El panel calcula el **neto** (bruto − comisión).
    - **Referencia:** el número de la liquidación del proveedor.
    - **Fecha del depósito** (vacía = hoy), **Banco** (sin elegir, el del proveedor), **Archivo de la liquidación** (opcional: se guarda su nombre y su huella, no el archivo) y **Nota**.
- **Qué pasa:** el bruto sale de la cuenta puente, el neto entra al banco y la comisión va a gastos. Cada pago se liquida una sola vez.

## Detalle de una liquidación

Montos (bruto que sale del puente, comisión, neto al banco), el banco, el archivo y su huella, la nota, cada pago o contracargo incluido con su monto y el asiento del libro (con `libro.ver`).

## Preguntas frecuentes y errores

| Situación                            | Qué hacer                                                           |
| ------------------------------------ | ------------------------------------------------------------------- |
| El bruto no es la suma de lo marcado | Revisa qué pagos trae la liquidación; el bruto debe coincidir.      |
| Un pago ya se liquidó                | No se puede incluir dos veces.                                      |
| La liquidación ya se registró        | Busca la referencia en «Liquidaciones registradas».                 |
| «Sin proveedores de cobro»           | Configura uno en [Proveedores de cobro](./proveedores-de-cobro.md). |

## Relacionado

- [Proveedores de cobro](./proveedores-de-cobro.md)
- [Conciliación bancaria](../bancos/conciliacion.md)
- [Pago en línea](./pasarela.md)
