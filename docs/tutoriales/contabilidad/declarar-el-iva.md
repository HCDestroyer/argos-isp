---
orden: 3
---

# Declarar y pagar el IVA del mes

Al terminar, la declaración de IVA del mes queda calculada, liquidada en el libro, registrada como presentada y pagada. ArgosIsp no la envía a la SAT: tú la presentas en Declaraguate con los datos del borrador.

## Antes de empezar

- Permisos: `declaraciones.calcular`, `declaraciones.revisar`, `declaraciones.presentar` y `declaraciones.pagar` (rol **contabilidad**).
- El mes ya terminó.
- Las facturas, notas de crédito y compras del mes están registradas, y las NCRE del mes certificadas.
- Elige la empresa en el selector de empresa.

## Pasos

1. Abre **Contabilidad → Calendario fiscal** y busca el IVA del mes (o ve directo a **Contabilidad → Declaraciones**).
2. Pulsa el vencimiento y luego «Calcular borrador» (o «Calcular declaración», elige **IVA mensual** y el mes, y pulsa «Calcular»).
3. En la ficha, revisa los **Totales** (débitos, créditos, retenciones, impuesto determinado, remanentes) y los **Renglones** de ventas y compras. Compara con los libros de ventas y compras del mes.
4. Pulsa «Revisar y liquidar». Lee lo que hace, marca la casilla de confirmación y confirma. Se registra el asiento de liquidación y se bloquean los impuestos del mes.
5. Presenta la declaración en Declaraguate (formulario SAT-2237) con esos montos.
6. Vuelve a la ficha y pulsa «Marcar presentada». Escribe el **Número del formulario**, la **Fecha de presentación** y la **Boleta**.
7. Cuando pagues, pulsa «Registrar pago». Elige con qué se pagó (caja, banco o cuenta propia), la **Fecha del pago** y la **Boleta SAT**, y confirma.

## Qué pasa después

- La declaración queda **Presentada** con la etiqueta «Pagada», y en el calendario el vencimiento sale en verde.
- Ningún asiento con impuesto podrá caer en ese mes ni antes (bloqueo de impuestos).
- Si pagaste después del vencimiento, el pago lleva mora y, si presentaste tarde, la multa; las calcula ArgosIsp.

## Si algo sale mal

| Mensaje                                  | Causa                                             | Qué hacer                                                                              |
| ---------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| El IVA no cuadra con los libros          | Algún check de impuestos del mes está en anomalía | Revisa la lista de verificación de impuestos de la ficha; corrige o supervisa con nota |
| Hay notas de crédito sin certificar      | Hay NCRE del mes pendientes o rechazadas          | Certifícalas en la **Cola de DTE** y vuelve a revisar                                  |
| Los datos cambiaron desde que se calculó | Entró o se anuló algo del mes después del cálculo | Pulsa «Recalcular» y revisa la versión nueva                                           |
| Esa declaración ya está revisada         | Quieres corregir una ya liquidada                 | Pulsa «Calcular sustitutiva»: su revisión liquida solo la diferencia                   |
| Pagué con la cuenta equivocada           | Error al registrar el pago                        | «Anular pago» con motivo y regístralo de nuevo                                         |

Más detalle en el manual de [Declaraciones](../../manual/fiscal/declaraciones.md).
