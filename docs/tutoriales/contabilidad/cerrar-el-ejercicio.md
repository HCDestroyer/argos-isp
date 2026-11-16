---
orden: 5
---

# Cerrar el ejercicio

Al terminar, el año queda cerrado: ingresos y gastos en cero contra resultados, el ISR provisionado, la reserva legal registrada y diciembre cerrado, todo con fecha 31 de diciembre.

## Antes de empezar

- Permiso: `libro.cerrar_ejercicio` (rol **contabilidad**).
- Enero a noviembre cerrados y diciembre **abierto** (ahí van los asientos del cierre).
- Ningún DTE del año pendiente, enviando, con error temporal o en contingencia.
- Ningún año anterior sin cerrar.
- Si el año tiene declaración ISR anual en ArgosIsp, revisada (ver [Declaraciones](../../manual/fiscal/declaraciones.md#revisar-y-liquidar)).
- Elige la empresa en el selector de empresa.

## Pasos

1. Abre **Contabilidad → Libro** y entra a la pestaña **Ejercicios**.
2. Pulsa «Cerrar ejercicio» y elige el **Año**.
3. Revisa el ISR:
    - Si dice «El ISR sale de la declaración ISR anual …», revisa los montos (ISR del año, pagos trimestrales, ISO acreditado). No se escriben a mano.
    - Si dice que la declaración no está revisada, pulsa «Abrir la declaración», revísala y vuelve.
    - Si el año no tiene declaración, escribe el **ISR del ejercicio** (0.00 si no hay), los **Pagos trimestrales**, el **ISO acreditado** y una **Nota** de dónde salen.
4. Marca «Entiendo que el cierre de … registra sus asientos con fecha 31/12 y cierra diciembre».
5. Pulsa «Cerrar …».

## Qué pasa después

- El ejercicio aparece como **Cerrado** con el ISR, el resultado y la reserva legal.
- Diciembre queda cerrado.
- Reabrirlo es solo de un admin («Reabrir», con motivo): revierte los asientos del cierre y reabre diciembre.

## Si algo sale mal

| Mensaje                                   | Causa                                             | Qué hacer                                                                       |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| El ejercicio todavía no se puede cerrar   | Falta un requisito                                | El mensaje lista cada uno: meses abiertos, DTE pendientes, año anterior abierto |
| La declaración ISR anual no está revisada | El cierre toma el ISR de ella                     | Revísala y vuelve a intentar                                                    |
| Los datos cambiaron desde que se calculó  | La declaración ISR anual está desactualizada      | Recalcúlala, revísala y vuelve a cerrar                                         |
| Lo acreditado pasa del ISR                | Pagos trimestrales más ISO son mayores que el ISR | Corrige los montos                                                              |
| «Cerrar ejercicio» está gris              | Tienes «Todas» en el selector de empresa          | Elige la empresa                                                                |

Más detalle en el manual del [Libro](../../manual/contabilidad/libro.md#cerrar-el-ejercicio).
