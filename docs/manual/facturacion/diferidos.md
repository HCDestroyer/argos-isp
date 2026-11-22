---
orden: 5
pantallas:
    - /diferimientos
    - /diferimientos/[id]#detalle-de-un-diferido
---

# Diferidos

Un diferido reparte en varios meses un monto que se pagó o cobró de una vez:

- **Gasto anticipado (compras):** por ejemplo, un seguro o una licencia anual. El gasto se reconoce mes a mes.
- **Ingreso diferido (facturas):** por ejemplo, un plan anual cobrado por adelantado. El ingreso se reconoce mes a mes.

Cada mes que termina, el sistema registra la cuota de ese mes en el libro.

## Quién la usa

- **Ver:** `libro.ver` (`admin`, `contabilidad`, `lectura`).
- **Amortizar a mano y diferir:** `libro.registrar_asiento` (`admin`, `contabilidad`).

Se llega desde **Finanzas → Compras → Diferidos**.

## Qué ves

Filtro de origen: «Gastos e ingresos», «Gastos anticipados (compras)» o «Ingresos diferidos (facturas)».

| Columna       | Qué muestra                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- |
| **Diferido**  | Número y descripción (enlace al detalle), el tipo, los meses, desde cuándo y cuántas cuotas lleva. |
| **Total**     | El monto diferido.                                                                                 |
| **Pendiente** | Lo que falta reconocer.                                                                            |
| **Estado**    | «Vigente», «Amortizado» o «Cancelado».                                                             |

## Acciones

### Amortizar pendiente

- **Permiso:** `libro.registrar_asiento`.
- **Dónde:** botón «Amortizar pendiente».
- **Qué pasa:** registra las cuotas pendientes hasta el mes anterior. Es lo mismo que hace el sistema cada madrugada, así que no hace falta usarlo a diario. El aviso dice cuántas cuotas registró, o «Nada pendiente» si ya estaba al día.

### Diferir una línea de compra

Se hace desde la ficha de una compra vigente, botón «Diferir línea»: eliges la línea, los meses (de 2 a 120), el mes de inicio y una descripción. El gasto pasa a la cuenta de gastos pagados por anticipado y se amortiza cada mes. Una línea se difiere una sola vez.

## Detalle de un diferido

- Origen, la compra o factura de la que salió (enlace), las cuentas (de dónde a dónde se reconoce), los meses y desde cuándo, el total, lo amortizado y lo pendiente.
- La tabla de cuotas: el mes, el asiento y el monto de cada una. Si todavía no hay ninguna, verás «Todavía sin cuotas»: la primera se registra al terminar su mes.

## Preguntas frecuentes

**¿Cómo se difiere el ingreso de una factura?** Desde el panel solo se difieren líneas de compras. Los ingresos diferidos de facturas que veas en la lista se registraron por la API.

**No puedo anular una factura: dice que tiene su ingreso diferido.** Es lo esperado. Habla con contabilidad.

## Relacionado

- [Facturas](./facturas.md)
