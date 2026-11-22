---
orden: 5
pantallas:
    - /bancos/transito
---

# Fondos en tránsito

El dinero que ya salió de un lugar pero todavía no aparece en el banco: los depósitos de caja y los traslados entre cuentas propias. Un depósito o traslado pasa a **acreditado** cuando concilias su línea en el extracto del banco.

## Quién la usa

- **Ver:** `bancos.ver` (`admin`, `contabilidad`, `lectura`). Para ver los depósitos de caja hace falta además `cajas.ver`.
- **Trasladar entre bancos:** `bancos.trasladar` (`admin`, `contabilidad`).

Se llega desde **Finanzas → Bancos → Fondos en tránsito**.

## Qué ves

- **El resumen** (uno por empresa si hay varias): **Saldo del libro**, **Por acreditar**, **Depósitos en tránsito** y **Traslados en tránsito**, con «Cuadra» o «Diferencia Q …».
- Filtro de estado: «En tránsito», «Acreditados» o «Todos».
- **Depósitos de caja:** número y boleta, caja, turno, fecha, cuenta que recibe, estado («En tránsito» o «Acreditado» con su fecha) y monto. Los depósitos se hacen desde [Caja](../cobros/caja.md#depositar-al-banco).
- **Traslados entre bancos:** número y referencia, cuenta de origen → destino, fecha, estado y monto.

## Acciones

### Trasladar entre bancos

- **Permiso:** `bancos.trasladar`.
- **Dónde:** botón «Trasladar».
- **Qué pide:** **Sale de**, **Llega a** (cuentas propias de la misma empresa), **Monto**, **Referencia** y **Fecha** (vacía = hoy).
- **Qué pasa:** el dinero sale hoy de la cuenta de origen y queda en tránsito hasta que el extracto del destino lo acredite. Al conciliar esa línea, el traslado pasa a «Acreditado».

## Preguntas frecuentes

**Un depósito lleva días en tránsito.** Revisa el extracto de la cuenta que lo recibe y concilia su línea. Si se concilió con el depósito equivocado, usa «Reatribuir» en la línea (ver [Conciliación bancaria](./conciliacion.md#reatribuir-una-llegada)).

**«Sin acceso a los depósitos de caja».** Tu usuario necesita el permiso `cajas.ver`.

## Relacionado

- [Caja](../cobros/caja.md)
- [Conciliación bancaria](./conciliacion.md)
