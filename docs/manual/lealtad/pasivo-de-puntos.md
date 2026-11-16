---
orden: 5
pantallas:
    - /reportes/lealtad
---

# Reporte de lealtad

Cuántos puntos se emitieron, canjearon y vencieron en un rango de fechas, y si el pasivo de los puntos cuadra con el libro contable.

Menú: **Reportes y bitácora → Reportes → Lealtad**.

## Quién la usa

Permiso `reportes.ver` (`admin`, `contabilidad` y `lectura`).

## Qué ves

Arriba eliges **Desde** y **Hasta**. Los movimientos se cuentan en ese rango; el saldo y el pasivo son siempre al día de hoy.

Una tarjeta por empresa con programa, con la marca «Cuadra con el libro» o «No cuadra»:

| Dato                           | Qué significa                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Emitidos                       | Puntos ganados en el rango y su valor.                                              |
| Canjeados                      | Puntos que se cambiaron por premios.                                                |
| Vencidos                       | Puntos que vencieron sin usarse.                                                    |
| Revertidos y ajustes negativos | Puntos quitados por anulaciones y por ajustes manuales.                             |
| Valor liberado                 | Valor de los puntos que salieron (canjeados o vencidos).                            |
| Saldo de puntos                | Lo que tienen hoy los clientes de esa empresa.                                      |
| Puntos vivos en lotes          | Puntos ganados que todavía no vencen ni se usan.                                    |
| Pasivo: lotes / 2.1.10         | El valor de esos puntos vivos contra el saldo de la cuenta del pasivo del programa. |

El pasivo solo tiene valor si el programa difiere los puntos (ver [Programa de lealtad](./programa.md)). Sin diferimiento, los dos lados están en Q 0.00.

::: warning Si no cuadra
Arriba de todo verás «El pasivo de los puntos no cuadra con el libro» con la empresa y los dos valores. Avísale a contabilidad o al administrador del sistema.
:::

## Relacionado

- [Programa de lealtad](./programa.md)
- [Reportes](../reportes/index.md)
