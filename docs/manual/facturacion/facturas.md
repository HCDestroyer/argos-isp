---
orden: 2
pantallas:
    - /facturas
    - /facturas/[id]#detalle-de-una-factura
---

# Facturas

La lista de todas las facturas emitidas, con lo que falta pagar de cada una, y el detalle de cada factura con sus líneas, pagos, notas de crédito y asientos del libro.

Las facturas de cada periodo las genera el sistema solo, según la plantilla de cada servicio. Cómo funciona eso está en [El ciclo de cobro](../../guia/ciclo-de-cobro.md).

## Quién la usa

- **Ver:** `facturas.ver`. Lo traen `admin`, `cajero`, `soporte`, `contabilidad` y `lectura`.
- Las acciones piden su propio permiso (abajo). En general solo `contabilidad` y `admin` corrigen facturas.

Se llega desde **Cobros → Facturas**.

## Qué ves

### Filtros

- **Cliente:** busca por nombre, NIT o teléfono.
- **Servicio:** se habilita al elegir un cliente y lista sus servicios.
- **Estado:** «Todos los estados» o uno en particular (ver tabla de estados).
- **Periodo:** los últimos 12 meses.

«Limpiar filtros» los quita todos. Los filtros quedan en la dirección de la página, así que puedes compartir el enlace.

### Columnas

| Columna       | Qué muestra                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Factura**   | El número (enlace al detalle), el periodo, el servicio, el cliente y, si aplica, «Recargo por mora» o «Sustituida por #…». |
| **Cliente**   | Enlace a la ficha del cliente.                                                                                             |
| **Vence**     | Fecha de vencimiento.                                                                                                      |
| **Total**     | Total con IVA.                                                                                                             |
| **Pendiente** | Lo que falta pagar. Una factura «Por certificar» dice «No es deuda aún»; una anulada, «—».                                 |
| **Estado**    | El estado con su color.                                                                                                    |
| **FEL**       | El estado del documento electrónico, o «Aviso sin DTE» / «Sin DTE».                                                        |

### Estados de una factura

| Estado             | Color    | Qué significa                                                                                                        |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| **Emitida**        | azul     | Emitida y todavía no vence.                                                                                          |
| **Pago parcial**   | amarillo | Recibió parte del pago y aún no vence.                                                                               |
| **Vencida**        | rojo     | Pasó su fecha de vencimiento con saldo. Cuenta para limitar o suspender el servicio.                                 |
| **Pagada**         | verde    | Cubierta por completo (por pagos, notas de crédito o una diferencia pequeña cerrada).                                |
| **Por certificar** | gris     | La FEL de la empresa es obligatoria y la factura se certifica al emitirse: hasta que la SAT la autorice no es deuda. |
| **Acreditada**     | gris     | Cubierta entera por notas de crédito internas, sin cobro: no es una venta y no se certifica.                         |
| **Castigada**      | gris     | Contabilidad la dio por incobrable. Sale de la cartera y del corte.                                                  |
| **Anulada**        | gris     | Ya no se debe. Su asiento se revirtió.                                                                               |

### Correr el corte ahora

- **Permiso:** `facturas.generar` (`admin`, `contabilidad`).
- **Dónde:** botón «Correr corte», arriba a la derecha.
- **Qué pasa:** pide confirmación. Vence las facturas pendientes y decide el estado de los servicios cuya hora de corte ya pasó hoy. Es lo mismo que hace el corte automático, sin esperar al siguiente minuto. Los cortes y reactivaciones se aplican de inmediato. El aviso dice cuántos servicios se evaluaron y cuántos cambiaron de estado; si alguno dio error, revisa la bitácora.

## Detalle de una factura

Arriba: el número, el estado, el tipo de documento FEL («Aviso de cobro», «FACT certificada»…) y, si es un recargo, «Recargo por mora» con el enlace a la factura que lo originó. Debajo, el periodo, el cliente (enlace a su estado de cuenta) y el servicio.

Tarjetas y secciones:

- **Montos:** subtotal, IVA, total, pagado, pendiente y, si tiene notas de crédito, cuánto de lo pagado fue por notas. Una factura importada de otro sistema muestra «Importada de».
- **Fechas:** emitida, vence, cuándo se marcó vencida, cuándo se certifica y la clave única de la factura.
- **Certificación FEL:** el estado del DTE (con el permiso `fel.ver`).
- **Líneas:** concepto, cantidad, precio, IVA y total de cada línea. El IVA (12 %) va incluido en el precio y se desglosa por línea.
- **Pagos aplicados:** cada pago que cubrió esta factura y cuánto aplicó (con `pagos.ver`).
- **Asientos del libro:** el asiento de la factura y de sus notas de crédito (con `libro.ver`).
- **Notas de crédito:** la lista, con su monto, IVA y si están anuladas.

Avisos que puedes ver en el detalle:

- «Por certificar: todavía no es deuda»: no tiene asiento, no se cobra ni cuenta para el corte hasta que la SAT la autorice.
- «Sustituida por la factura #…» o «Sustituye a la factura #…», con el botón para ir a la otra.
- «Anulación pendiente con el certificador»: mientras la SAT no confirme, la factura no recibe pagos ni notas de crédito.
- «Factura acreditada».

## Acciones

### Aviso de cobro (PDF)

- **Permiso:** `facturas.ver`.
- **Dónde:** botón «Aviso de cobro (PDF)» en el detalle.
- **Qué pasa:** abre el PDF en otra pestaña. Si falla, aparece «No se pudo generar el PDF» con el motivo.

### Emitir una nota de crédito

- **Permiso:** `facturas.nota_credito` (`admin`, `contabilidad`).
- **Dónde:** botón «Nota de crédito». Solo aparece si la factura tiene saldo (emitida, parcial o vencida).
- **Qué pasa:** se abre un formulario con dos modos:
    - «Por monto»: por defecto todo el saldo; puede ser parcial. Se reparte en proporción entre ingresos e IVA.
    - «Por línea»: rebaja un concepto concreto, con su IVA.
    - El **motivo** es obligatorio (3 a 500 caracteres). El monto nunca puede pasar del saldo de la factura.
- Si la factura ya está certificada, la nota sale como **NCRE** (documento electrónico) y queda en cola para certificarse. Sobre un aviso sin DTE es una nota interna.
- La nota rebaja el saldo y deja su asiento en el libro. Si con eso el servicio queda sin deuda vencida, **se reactiva al instante**: lo verás en un aviso «Servicio #…: suspendido → activo».
- No se deshace. Solo se anula una nota cuya NCRE rechazó la SAT (ver [Notas de crédito](./notas-de-credito.md)).

### Sustituir una factura

- **Permiso:** `facturas.sustituir` (`admin`, `contabilidad`).
- **Dónde:** botón «Sustituir». Solo en facturas del periodo (no en recargos), no anuladas y que no se hayan sustituido ya.
- **Para qué:** corregir una factura mal emitida (por ejemplo, con el NIT equivocado) cuando el periodo ya está ocupado.
- **Qué pasa:** pide el **motivo** y, opcionalmente, «Corregir el receptor de la factura nueva» (documento, NIT o CUI, nombre y dirección fiscal). Eso solo cambia el documento nuevo; los datos del cliente se corrigen en su ficha.
    - Sin DTE certificado: la original se **anula** con su asiento de reverso.
    - Con DTE certificado: la original queda **acreditada** con una NCRE por todo su saldo.
    - En los dos casos se emite una factura nueva del mismo periodo, con las mismas líneas y vencimiento, y el panel te lleva a ella.
- No se puede sustituir una factura que ya tiene pagos: anula primero el pago.

### Anular una factura

- **Permiso:** `facturas.anular` (`admin`, `contabilidad`). Si tiene DTE certificado, además `fel.anular`.
- **Dónde:** botón «Anular».
- **Qué pasa:**
    - **Sin DTE certificado:** pide el motivo (queda en la bitácora con tu usuario). La factura deja de contar como deuda, se registra el asiento de reverso y sus recargos de mora pendientes también se anulan. El servicio se vuelve a evaluar y, si ya no debe, se reactiva al instante.
    - **Con DTE certificado:** en dos pasos. Primero el motivo, que viaja al certificador. Luego confirmas: el DTE pasa a «anulación pendiente» y la factura se anula (con su reverso) cuando la SAT lo confirma. Si la SAT rechaza la anulación, el DTE vuelve a certificado y la factura sigue vigente. Si ya pasó el plazo para anular el DTE, el panel ofrece «Emitir nota de crédito».
- El periodo queda ocupado: el sistema **no vuelve a emitir** la factura de ese periodo. Si necesitas una correcta, usa «Sustituir».

::: danger No se puede deshacer
Una factura anulada no vuelve a estar vigente. Nada se borra: la factura y su asiento original quedan en el historial junto con el reverso.
:::

## Preguntas frecuentes y errores

**¿Anular o nota de crédito?** Anula cuando la factura no debió existir y no tiene pagos ni notas. Usa nota de crédito para rebajar parte del saldo, o cuando la factura ya tiene notas o el plazo para anular su DTE ya pasó.

| Mensaje                                                                       | Qué hacer                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| «La factura … tiene pagos aplicados (…); anula primero el pago»               | Anula el pago desde su detalle y vuelve a intentarlo.                                          |
| «La factura … tiene notas de crédito (…); acredita el resto con otra nota…»   | No se puede anular: emite otra nota de crédito por el saldo que queda.                         |
| «La factura … ya está anulada»                                                | Nada que hacer.                                                                                |
| «La factura … está castigada (…); se corrige con un ajuste»                   | Pide a contabilidad un asiento de ajuste.                                                      |
| «La factura … tiene su ingreso diferido (…)»                                  | La factura tiene un diferido. Habla con contabilidad.                                          |
| «… tiene recargos de mora certificados como nota de débito: anúlalos primero» | Anula primero los recargos de mora certificados.                                               |
| «La anulación del DTE de la factura … ya se envió al certificador»            | Espera la respuesta de la SAT.                                                                 |
| «No se encontró el asiento de esta factura en el libro diario.»               | Una factura «Por certificar» todavía no tiene asiento. Si no es el caso, avisa a contabilidad. |

## Relacionado

- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
- [Notas de crédito](./notas-de-credito.md)
- [Pagos](../cobros/pagos.md)
- [Bonificaciones](./bonificaciones.md)
