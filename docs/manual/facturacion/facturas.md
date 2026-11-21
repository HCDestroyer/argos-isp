---
orden: 2
pantallas:
    - /facturas
    - /facturas/[id]#detalle-de-una-factura
    - /servicios/[id]/facturas-periodo#emitir-facturas-de-un-servicio-a-mano-meses-adelantados-o-meses-que-faltan
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

### Emitir facturas de un servicio a mano (meses adelantados o meses que faltan)

Normalmente el sistema emite solo la factura de cada mes. Esta acción sirve para tres casos:

- **Pago por adelantado:** el cliente quiere dejar pagados los próximos meses desde ya.
- **Meses que faltan:** el sistema no emitió la factura de un mes que ya pasó (por ejemplo, porque algo falló ese día).
- **Meses antes del inicio del servicio:** acabas de agregar el servicio, pero el cliente ya lo usaba y hay que cobrarle meses pasados (hasta 24).

- **Permiso:** `facturas.emitir_periodos` (`admin`, `cajero`, `contabilidad`).
- **Dónde:** en la ficha del servicio, botón «Emitir facturas de periodos». Se abre una pantalla propia (Servicios › el servicio › Emitir facturas de periodos); «Atrás» o «Cancelar» vuelven a la ficha sin emitir nada.

**Qué ves antes de emitir.** Cada mes del servicio, del más antiguo al más nuevo, con su estado, su monto y su fecha de vencimiento:

| Estado                                | Qué significa                                                                                  | ¿Se puede elegir?                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Emitida** (azul)                    | Ese mes ya tiene factura; al lado ves su estado (pagada, pendiente…) y el enlace a la factura. | No                                          |
| **Bonificada** (verde)                | Ese mes quedó en cero (mes gratis, descuento del 100 %), con el enlace a la bonificación.      | No                                          |
| **Sin emitir** (ámbar)                | Un mes que ya empezó y todavía no tiene factura. El sistema la emitiría en su próxima corrida. | Sí                                          |
| **Futuro** (gris)                     | Un mes que aún no empieza. Se puede emitir para cobrarlo por adelantado (hasta 12 meses).      | Sí                                          |
| **Antes del inicio del cobro** (gris) | Un mes anterior al día en que el servicio empezó a facturarse con su plantilla. Ver más abajo. | Solo con `facturas.emitir_periodo_anterior` |
| **Antes del inicio del servicio** (gris) | Uno de los 24 meses anteriores al primer mes del servicio. Van plegados: pulsa «Ver 24 periodos antes del inicio del servicio». Ver más abajo. | Solo con `facturas.emitir_periodo_anterior` |

El monto es **el mes completo**: el precio del plan del servicio (o su precio especial), sus cargos fijos y adicionales. A mano nunca se cobra proporcional a los días, aunque la plantilla tenga «Prorratear el primer periodo» (si un servicio vale Q200, la factura es de Q200). Lo que ya estaba emitido se muestra como se emitió. Si el cliente tiene **saldo a favor**, cada mes dice cuánto quedaría «cubierto por saldo a favor» (contando que los meses anteriores se emiten primero). Si un mes no se pudo calcular (por ejemplo, el libro está bloqueado), se muestra el motivo y no se puede elegir.

**Cómo eliges.** Marca la casilla de cada mes que quieras emitir. Para cobrar por adelantado, usa el atajo **«Adelantar N meses»**: escribe cuántos meses y pulsa el botón; marca los próximos N meses futuros (y desmarca los demás futuros, sin tocar los meses sin emitir que ya marcaste).

**Cambiar el monto.** Con el permiso `facturas.editar_monto_periodo` (`admin`, `contabilidad`), cada mes marcado muestra su monto en un campo que puedes cambiar (por ejemplo, un precio acordado con el cliente). Debajo aparece «calculado Q…» para que veas la diferencia. Si cambias un monto, el **motivo** es obligatorio. En la factura:

- **Si cobras menos:** la diferencia va como un descuento «Ajuste del monto del periodo» sobre la línea del servicio (con su IVA y su cuenta de descuentos).
- **Si cobras más:** se agrega una línea «Ajuste del monto del periodo» por la diferencia, como ingreso del servicio de internet.
- El monto calculado y el cobrado quedan guardados en la factura y en la bitácora.

Abajo, el **resumen** se actualiza con lo que marcaste (con los montos cambiados): el total, cuánto cubre el saldo a favor disponible y lo que **queda por cobrar**. El **motivo** es opcional (queda guardado en la factura y en la bitácora), salvo para los meses anteriores al inicio del servicio o del cobro y cuando cambias un monto.

**Qué pasa al emitir.** Pulsa «Emitir N facturas». El sistema emite las facturas en orden, del mes más antiguo al más nuevo, igual que si las hubiera emitido solo: mismas líneas, mismo asiento en el libro, mismo aviso al cliente y la misma certificación FEL. Si el cliente tiene saldo a favor, se aplica de una vez a esas facturas. Al terminar ves un aviso («3 facturas emitidas, 1 ya existía») y el resultado:

- **Creadas:** cada factura con su enlace, su estado (por ejemplo **Pagada** si la cubrió el saldo a favor), su total y su vencimiento.
- **Bonificadas:** un mes que quedó en cero no se factura; queda como bonificación.
- **No emitidas:** un mes que ya tenía factura o estaba bonificado no se duplica; aparece con su motivo.
- El saldo a favor que queda y el enlace «Ver facturas del servicio».

La lista se vuelve a cargar con los meses ya emitidos.

- Los meses futuros y los meses sin emitir vencen en su fecha normal (inicio del mes más los días de gracia de la plantilla). Una factura de un mes futuro **no cuenta para limitar ni cortar** antes de esa fecha.
- Los meses **antes del inicio del servicio** o **del cobro** vencen **desde hoy**: hoy más los días de gracia de la plantilla. Así el cliente no queda cortado en cuanto los emites; si no paga en ese plazo, se corta como siempre.
- El asiento y la factura electrónica (FEL) llevan la fecha de hoy, aunque el mes sea pasado.
- Un mes pasado que emites tarde y cuyo vencimiento ya pasó se marca como vencido en el próximo corte y cuenta para limitar o suspender, como cualquier factura vencida.
- El precio es el de hoy. Si después cambias el plan, las facturas que ya emitiste por adelantado no cambian.
- Si algo falla (sin conexión, un error del servidor), la pantalla muestra el error con «Reintentar» y no muestra totales que no pudo leer. Reintentar no duplica facturas.

::: tip Ejemplo: el cliente paga 3 meses adelantados
Hoy es 19 de noviembre. El cliente tiene un plan de Q150 al mes, ya pagó noviembre y quiere dejar pagados diciembre, enero y febrero.

1. En caja registras su pago de **Q450**. Como no tiene facturas pendientes, los Q450 quedan como **saldo a favor**.
2. En la ficha del servicio pulsas «Emitir facturas de periodos». Ves diciembre, enero y febrero como «Futuro», de Q150 cada uno y «Q150.00 cubierto por saldo a favor».
3. En «Adelantar meses» dejas **3** y pulsas «Adelantar 3 meses». El resumen dice total Q450, cubre el saldo a favor Q450, queda por cobrar Q0.
4. Pulsas «Emitir 3 facturas». Se emiten las tres y quedan **Pagadas** al momento; el saldo a favor queda en Q0.
5. Cuando llega diciembre, el sistema ve que esa factura ya existe y no emite otra. El cliente no vuelve a deber hasta marzo.

Puedes hacerlo también al revés: primero emitir los meses y después registrar el pago.
:::

**Meses antes del inicio del servicio.** Un servicio recién agregado no tiene meses pasados. Si el cliente ya usaba el servicio y hay que cobrarle meses de antes:

- Pulsa «Ver 24 periodos antes del inicio del servicio»: aparecen los 24 meses anteriores al primer mes del servicio, del más antiguo al más nuevo, cada uno por el mes completo y con su vencimiento desde hoy.
- Se necesitan el mismo permiso y el mismo motivo que para los meses antes del inicio del cobro (abajo).

::: tip Ejemplo: cobrar septiembre y octubre de un servicio agregado en noviembre
Hoy es 19 de noviembre y agregaste el servicio de Q150 con inicio el 1 de noviembre. El cliente ya lo usaba desde septiembre y la plantilla da 5 días de gracia.

1. En la ficha del servicio pulsas «Emitir facturas de periodos» y luego «Ver 24 periodos antes del inicio del servicio».
2. Marcas septiembre y octubre. Cada uno dice Q150 y «vence 24/11/2026».
3. Escribes el motivo («Usaba el servicio desde septiembre») y pulsas «Emitir 2 facturas».
4. El servicio sigue activo. Si el 24 de noviembre no ha pagado, esas facturas vencen y el corte funciona como siempre.
:::

**Meses antes del inicio del cobro.** Cuando un servicio que no tenía plantilla la recibe, el sistema solo le factura desde el siguiente mes (nunca hacia atrás). Si de verdad hay que cobrar uno de esos meses anteriores:

- Se necesita además el permiso `facturas.emitir_periodo_anterior` (`admin`, `contabilidad`). Sin él (el cajero no lo tiene), esos meses se ven pero no tienen casilla.
- Al marcar uno, la pantalla avisa que es una **excepción a «no cobrar hacia atrás»** y el **motivo** pasa a ser obligatorio; queda guardado en la factura y en la bitácora. El atajo «Adelantar N meses» nunca los marca.

No se pueden emitir facturas de periodo a un servicio **retirado** (el botón no aparece), **pendiente de instalación** o **sin plantilla**: la pantalla explica el motivo y no deja emitir.

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
| «Se pueden emitir hasta 12 periodos futuros…»                                 | Elige meses más cercanos; los siguientes podrás emitirlos más adelante.                        |
| «…: anterior a facturar_desde (…); requiere el permiso…»                      | Pide a contabilidad o a un administrador que emita ese mes, con su motivo.                     |
| «Para emitir un periodo anterior al inicio del servicio hace falta el permiso…» | Pide a contabilidad o a un administrador que emita ese mes, con su motivo.                   |
| «Solo se pueden emitir hasta 24 periodos antes del inicio del servicio.»        | Solo se cobra hasta dos años hacia atrás.                                                    |
| «Para cambiar el monto de una factura hace falta el permiso…»                   | Emite con el monto calculado o pide a contabilidad que la emita con el monto acordado.       |
| «El monto es tan bajo que la rebaja pasa del precio del servicio…»              | Sube el monto: la rebaja no puede ser mayor que el precio del servicio de ese mes.           |
| «… no es el inicio de un periodo del servicio»                                | Elige los meses de la lista; las fechas deben ser el primer día de cada periodo.               |
| «No se encontró el asiento de esta factura en el libro diario.»               | Una factura «Por certificar» todavía no tiene asiento. Si no es el caso, avisa a contabilidad. |

## Relacionado

- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
- [Notas de crédito](./notas-de-credito.md)
- [Pagos](../cobros/pagos.md)
- [Bonificaciones](./bonificaciones.md)
