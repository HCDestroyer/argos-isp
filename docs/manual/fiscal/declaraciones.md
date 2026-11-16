---
orden: 4
pantallas:
    - /declaraciones
    - /declaraciones/[id]#ficha-de-la-declaracion
    - /declaraciones/ajustes#ajustes-fiscales
---

# Declaraciones

Los borradores de IVA, pequeño contribuyente, ISR, ISO y retenciones, calculados desde los documentos y el libro del periodo. Revisar registra la liquidación; después registras que se presentó y que se pagó.

Está en **Contabilidad → Declaraciones**.

::: warning ArgosIsp no presenta nada a la SAT
La declaración se presenta en Declaraguate. Aquí solo queda el borrador, la liquidación en el libro, la constancia de que se presentó y el pago.
:::

## Quién la usa

- Ver: `declaraciones.ver` (**admin**, **contabilidad** y **lectura**).
- Calcular: `declaraciones.calcular`. Revisar: `declaraciones.revisar`. Marcar presentada: `declaraciones.presentar`. Registrar pago: `declaraciones.pagar`. Anular pago: `declaraciones.anular_pago`. Ajustes fiscales: `declaraciones.ajustar`. Todos los traen **contabilidad** y **admin**.

## Qué ves

Filtra por impuesto, por estado y por periodo (`AAAA-MM`, `AAAA-Tn` o `AAAA`). «Quitar filtros» los quita.

Cada fila muestra el impuesto y el periodo, la versión («sustitutiva» si lo es), el formulario, el estado y la etiqueta «Pagada» si ya tiene pago:

| Estado         | Qué significa                                                                     |
| -------------- | --------------------------------------------------------------------------------- |
| **Borrador**   | Calculada desde los libros; todavía sin liquidar                                  |
| **Revisada**   | Liquidada y con los impuestos del mes bloqueados; falta registrar la presentación |
| **Presentada** | Se registró su presentación en la SAT                                             |
| **Sustituida** | Una versión posterior la reemplaza                                                |

Impuestos y su formulario: IVA mensual (SAT-2237), pequeño contribuyente (SAT-2046), ISR opcional mensual (SAT-1311), ISR trimestral (SAT-1361), ISO trimestral (SAT-1608), ISR anual (SAT-1411), retenciones de IVA (SAT-2340) y retenciones de ISR (formulario por confirmar con el contador).

## Acciones

### Calcular una declaración

- **Permiso:** `declaraciones.calcular`
- **Dónde:** botón «Calcular declaración» (con una empresa elegida), o «Calcular borrador» desde el [calendario fiscal](./calendario.md).
- **Campos:** **Impuesto** y el **Mes**, **Trimestre** o **Año** según el impuesto.
- **Qué pasa:** se calcula un borrador desde los libros de ventas y compras y las constancias del periodo. Cada cálculo es una versión nueva; las anteriores quedan en el historial. Nada se envía a la SAT.
- Si la última versión ya está revisada o presentada, aparece «Calcular sustitutiva».

## Ficha de la declaración

Muestra el impuesto, el periodo, el estado, la versión y si está pagada, con:

- **Totales** por bloque (por ejemplo débitos, créditos, retenciones, impuesto determinado y liquidación con remanentes).
- **Renglones** por sección (ventas, compras, retenciones) con cada documento.
- **Datos**: formulario, vencimiento, cuándo se calculó, se revisó y se presentó, y el asiento de liquidación. «Ver en el calendario» abre su obligación.
- **Pago**: fecha, días de atraso, impuesto, mora, multa, total pagado, boleta y asiento.
- **Libros emitidos del periodo**: los libros de ventas y compras con folio que cubren el periodo.
- **Versiones del periodo**, con su estado.
- Para IVA, la lista de verificación de impuestos del mes (los checks que exige la revisión).

Avisos que puedes ver:

- **Versión sustituida**: abre la vigente.
- **Los datos cambiaron desde que se calculó**: revisar o marcar presentada responderá que está desactualizada. Pulsa «Recalcular» o «Calcular sustitutiva».
- **Se rectificaron también N meses posteriores**: una sustitutiva cambió el remanente que arrastran; cada uno tiene su sustitutiva revisada.
- **Criterios del cálculo · confirmar con el contador**.

### Revisar y liquidar

- **Permiso:** `declaraciones.revisar`
- **Dónde:** botón «Revisar y liquidar» en un borrador.
- **Qué pasa**, según el impuesto:
    - **IVA y pequeño contribuyente**: registra el asiento de liquidación y bloquea los impuestos hasta el último día del mes. Antes verifica que el IVA del libro cuadre con los libros de IVA y con el borrador, y que no haya NCRE sin certificar.
    - **Retenciones**: no hay asiento (ya están por pagar); bloquea los impuestos del mes y verifica que las retenciones del libro cuadren con las de las compras.
    - **ISR anual**: no registra asiento; fija el ISR que tomará el cierre del ejercicio.
    - **ISR trimestral, ISR opcional e ISO**: registra la liquidación sin bloquear impuestos.
- Una sustitutiva liquida solo la diferencia, con fecha de hoy, y puede rectificar meses posteriores ya revisados. Marca la casilla de confirmación y pulsa el botón.

### Marcar presentada

- **Permiso:** `declaraciones.presentar`
- **Dónde:** botón «Marcar presentada» en una declaración revisada.
- **Campos:** **Número del formulario** (por ejemplo `2237-0004602217`), **Fecha de presentación** y **Boleta**.
- Si se presenta después del vencimiento, el pago llevará la multa por presentación tardía.

### Registrar el pago

- **Permiso:** `declaraciones.pagar`
- **Dónde:** botón «Registrar pago» en una declaración revisada o presentada con impuesto por pagar.
- **Campos:** **Pagado con** (caja, banco del libro o cuenta bancaria propia), **Fecha del pago** (vacía: hoy), la caja, banco o cuenta, y **Boleta SAT**.
- **Qué pasa:** se registra el asiento del pago. Pagado después del vencimiento, se suma la mora por cada día de atraso y, si se presentó tarde, la multa; ArgosIsp las calcula y quedan en el pago.

### Anular el pago

- **Permiso:** `declaraciones.anular_pago`
- **Dónde:** botón «Anular pago» en el bloque **Pago**.
- **Campos:** **Motivo**, **Fecha del reverso** (vacía: hoy; no antes del pago) y la casilla de confirmación.
- **Qué pasa:** el asiento del pago se revierte con un asiento nuevo: el dinero vuelve a su caja o banco y el impuesto queda otra vez por pagar. Nada se borra.

### Recalcular o calcular sustitutiva

- **Permiso:** `declaraciones.calcular`
- **Qué pasa:** calcula la versión siguiente con los datos de hoy; la actual pasa a sustituida. Si ya estaba liquidada, la obligación vuelve a borrador y su revisión liquida solo la diferencia.

## Ajustes fiscales

Pantalla **Ajustes fiscales** (botón «Ajustes fiscales» en la ficha de una declaración de ISR trimestral o ISR anual). Los ajustes suman a la renta imponible del ISR (gastos no deducibles) o la restan (rentas exentas), para el cierre parcial de un trimestre o para el año.

Filtra por **Año** y **Trimestre**. Cada fila muestra el concepto, si suma o resta, el monto y si anula o fue anulado por otro ajuste.

- **Registrar ajuste** (`declaraciones.ajustar`, con una empresa elegida): **Año**, **Periodo** (anual o un trimestre), **Efecto** (suma o resta), **Monto** y **Concepto** (cita el criterio que confirmó el contador).
- **Anular ajuste**: con motivo. Registra otra fila que lo anula; nada se borra.
- Después de registrar o anular, el borrador de ISR del periodo queda desactualizado: recalcúlalo.

## Preguntas frecuentes y errores

| Mensaje                                       | Qué hacer                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Esa declaración ya está revisada / presentada | Para corregirla, calcula una sustitutiva                                           |
| Los datos cambiaron desde que se calculó      | Calcula otra versión y revísala                                                    |
| Hay notas de crédito sin certificar           | Certifica las NCRE pendientes o anula las rechazadas y vuelve a revisar            |
| El IVA no cuadra con los libros               | Revisa la lista de verificación de impuestos del mes: corrige o supervisa con nota |
| El mes todavía no termina                     | Se revisa después del último día del mes                                           |
| La empresa no tiene esa obligación en el mes  | Revisa el régimen y las banderas en Configuración → Fiscal                         |
| Falta un valor que debe confirmar el contador | Pide que lo registren en Configuración → Fiscal → Parámetros                       |
| No hay impuesto por pagar                     | La declaración no tiene monto a pagar                                              |
| El ejercicio está cerrado                     | Para cambiar el ISR anual o sus ajustes, reabre el ejercicio (Libro → Ejercicios)  |

## Relacionado

- [Calendario fiscal](./calendario.md)
- [Libros legales](../contabilidad/libros-legales.md)
- [Tutorial: declarar y pagar el IVA](../../tutoriales/contabilidad/declarar-el-iva.md)
