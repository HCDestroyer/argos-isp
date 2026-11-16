---
orden: 4
pantallas:
    - /bancos/conciliacion
---

# Reporte de conciliación

Para cada cuenta bancaria y una fecha, compara el saldo del libro con el del extracto y explica la diferencia con las partidas que todavía están en tránsito de un lado o del otro.

## Quién la usa

- **Permiso:** `reportes.ver` (`admin`, `contabilidad`, `lectura`).

Se llega desde **Bancos → Conciliación bancaria → Reporte**.

## Qué ves

Filtros: la **cuenta** y la fecha **al día**.

Por cada cuenta, una tarjeta con «Cuadra» o «Diferencia Q …» y:

- **Saldo del libro** y **Saldo del extracto**.
- **En el libro, no en el banco:** lo registrado que el banco todavía no muestra (por ejemplo, un depósito en tránsito).
- **En el banco, no en el libro:** líneas del extracto todavía sin conciliar.
- **Diferencia de apertura**, si la hay.
- Las tablas **Partidas del libro en tránsito** y **Partidas del extracto en tránsito**, con descripción, fecha y monto.

La diferencia que queda es: extracto − (libro − tránsito del libro + tránsito del extracto). Si no es cero, hay algo por conciliar o por registrar.

## Qué hacer con una diferencia

1. Abre los extractos de la cuenta y concilia las líneas pendientes (ver [Conciliación bancaria](./conciliacion.md)).
2. Registra las comisiones o intereses sin documento con «Registrar».
3. Si un depósito de caja sigue en tránsito mucho tiempo, revisa en [Fondos en tránsito](./fondos-en-transito.md).

## Relacionado

- [Conciliación bancaria](./conciliacion.md)
- [Fondos en tránsito](./fondos-en-transito.md)
