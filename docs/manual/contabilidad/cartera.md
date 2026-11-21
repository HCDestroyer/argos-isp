---
orden: 5
pantallas:
    - /cartera
---

# Cartera

La estimación para cuentas incobrables y el castigo de facturas que ya no se van a cobrar.

Está en **Finanzas → Cartera**.

## Quién la usa

- Ver: `reportes.ver` (**admin**, **contabilidad** y **lectura**).
- Provisionar: `cartera.provisionar` (**contabilidad** y **admin**).
- Castigar: `cartera.castigar` (**contabilidad** y **admin**).

## Qué ves

### Estimación de incobrables (1.1.12)

Una fila por estimación registrada: año, fecha de corte, porcentaje, **Saldos deudores** de los clientes al corte, **Tope**, **Ya estimado** y lo **Registrado**.

### Castigos

Cada castigo con su número, cliente (enlace a su estado de cuenta), fecha, motivo, la gestión de cobro, las facturas castigadas con su estado, cuánto salió **De la estimación**, cuánto **Al gasto** y el **Monto** (con el IVA, si aplica).

## Acciones

### Provisionar incobrables

- **Permiso:** `cartera.provisionar`
- **Dónde:** botón «Provisionar».
- **Campos:** **Año**, **Corte de los saldos** (vacío: hoy para el año en curso, 31 de diciembre para años anteriores) y **Confirmación**: escribe `PROVISIONAR` y el año, por ejemplo `PROVISIONAR 2026`.
- **Qué pasa:** registra la estimación hasta el tope legal (3 % de los saldos deudores al corte), solo por lo que falta para llegar a él. Si ya está en el tope, queda una fila en cero sin asiento.
- **Se puede deshacer:** no desde el panel.

### Castigar facturas

- **Permiso:** `cartera.castigar`
- **Dónde:** botón «Castigar».
- **Pasos:**
    1. Elige el **Cliente**.
    2. Marca las **Facturas a castigar** (solo las que tienen saldo; un castigo es de un solo cliente y una sola empresa).
    3. Escribe el **Motivo** y la **Evidencia de la gestión de cobro**: llamadas, cartas, avisos y fechas. Queda guardada con el castigo.
    4. Escribe `CASTIGAR` en **Confirmación** y pulsa «Castigar facturas».
- **Qué pasa:** las facturas dejan de deberse y quedan como castigadas. El saldo sale primero de la estimación y lo que falte va al gasto. El servicio se vuelve a evaluar. Si el cliente paga después, se registra como un pago normal (recuperación).
- **Se puede deshacer:** no desde el panel.

::: danger Sin vuelta atrás
Una factura se castiga una sola vez y el castigo no se revierte desde el panel.
:::

## Preguntas frecuentes y errores

| Situación                                | Qué hacer                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- |
| «Castigo sin evidencia»                  | Escribe el motivo y la gestión de cobro                             |
| El DTE de la factura está en proceso     | Espera a que se certifique o falle y vuelve a intentar              |
| La confirmación no pasa                  | Escribe la frase exacta (no importan mayúsculas ni espacios de más) |
| El cliente no tiene facturas castigables | Solo se castigan facturas con saldo                                 |

## Relacionado

- [Reportes: cartera vencida](../reportes/catalogo.md#cartera-vencida)
- [Tablero fiscal](../fiscal/tablero-y-comparador.md): bloque «Reserva de incobrables».
