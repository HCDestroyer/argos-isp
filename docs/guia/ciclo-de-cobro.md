---
orden: 3
---

# El ciclo de cobro

Cómo pasa un servicio de tener su factura a estar al día, limitado o cortado, y cómo vuelve. En resumen: **el sistema factura, vence y corta solo, según la plantilla del servicio; y un pago o una promesa lo reactivan al instante.**

## 1. Cada servicio tiene una plantilla

La [plantilla de facturación](../manual/facturacion/plantillas.md) dice las reglas del servicio:

- **Cuándo se factura:** un día fijo del mes para todos (por ejemplo, el 5), o el día del mes en que se instaló cada servicio (aniversario).
- **Cuántos días tiene para pagar** (días de gracia).
- **Cuántas facturas vencidas** limitan la velocidad y cuántas suspenden el servicio.
- **A qué hora** se corta.
- Si se cobra **mora**, si se aceptan **promesas de pago** y con qué reglas.

Si cambias la plantilla, el cambio rige para las facturas nuevas. Cada factura emitida guarda las reglas con las que nació.

## 2. Se emite la factura del periodo

El sistema revisa cada hora y emite la factura de cada servicio activo, limitado o suspendido cuyo periodo ya empezó. Procesa **todo lo pendiente hasta hoy**: si el sistema estuvo apagado unos días, al volver emite lo que faltaba. Y nunca emite dos facturas del mismo servicio y periodo.

- La factura lleva el precio del plan (o el precio especial del servicio) y los cargos recurrentes. El **IVA (12 %) va incluido** en el precio y se desglosa en cada línea.
- **Primera factura (prorrateo):** si la plantilla prorratea, la primera factura cobra solo los días desde la instalación hasta el siguiente periodo. Ejemplo: plan de Q 300.00 al mes, factura el día 1, instalado el 21 de un mes de 30 días: la primera factura es por 10 días, Q 100.00. Sin prorrateo, la primera va por Q 300.00.
- Si el cliente tiene **saldo a favor**, se aplica solo a la factura nueva.
- Un mes regalado o con descuento del 100 % no genera factura de Q 0.00: queda como [bonificación](../manual/facturacion/bonificaciones.md).
- Un servicio pendiente de instalación no factura su periodo.

## 3. Vence

La factura vence **los días de gracia después de que empieza su periodo**. Ejemplo: periodo que empieza el 1 y 10 días de gracia → vence el 11. Si al día siguiente todavía tiene saldo, pasa a **Vencida**.

Si la plantilla cobra **mora**, al vencer se agrega un recargo (monto fijo o porcentaje) como una factura aparte. Si es mora recurrente, otro recargo por cada mes que siga vencida. Los recargos **no cuentan** para limitar o cortar.

## 4. Limitado y suspendido

Una sola función del sistema decide el estado del servicio, siempre con las mismas reglas:

| Situación                                                                          | Estado         |
| ---------------------------------------------------------------------------------- | -------------- |
| Tiene una promesa de pago activa                                                   | **Activo**     |
| Facturas vencidas ≥ las que la plantilla pide para suspender                       | **Suspendido** |
| Facturas vencidas ≥ las que pide para limitar (y el plan tiene velocidad limitada) | **Limitado**   |
| Ninguna de las anteriores                                                          | **Activo**     |

Ejemplo con una plantilla que limita con 1 vencida y suspende con 2: vence la primera → limitado; vence la segunda → suspendido; paga una → vuelve a limitado; paga las dos → activo.

- **Bajar de estado espera a la hora de corte** de la plantilla. Si la factura vence a medianoche y la hora de corte es 10:00, el servicio se limita a las 10:00.
- **Subir de estado es inmediato.** No espera a la hora de corte.
- Una suspensión que hizo una persona a mano se respeta: ni un pago ni una promesa la quitan.

## 5. El pago reactiva al momento

Cuando registras un pago (en [Cobrar](../manual/cobros/cobrar.md), al aprobar un comprobante o cuando el cliente paga en línea):

1. Se aplica primero a las facturas que elegiste; si no elegiste, a la más antigua.
2. Lo que sobra queda como **saldo a favor**.
3. En el mismo momento el sistema vuelve a decidir el estado de cada servicio. Si ya no debe lo suficiente para estar cortado, **se reactiva sin esperar a nada**, y el router recibe la orden.

Un pago parcial baja la deuda pero puede no alcanzar para reactivar: el servicio sigue limitado o suspendido hasta que las vencidas bajen del número de la plantilla.

Una persona puede pagar las facturas de otros (el **responsable de pago**): un solo pago baja la deuda de cada dueño y reactiva todos sus servicios.

## Promesas de pago

Una promesa es el compromiso de pagar **todo lo vencido** antes de una fecha. Mientras está activa, el servicio no se corta, y si estaba cortado se reactiva al momento.

- Se crean desde el panel (canal operador o supervisor), desde el portal del cliente o por el asistente de IA. **Todos pasan por las mismas reglas de la plantilla**: plazo máximo, cuántas por periodo, deuda máxima, abono inicial, antigüedad, historial de cumplimiento y bloqueo tras incumplir. La plantilla puede dar límites distintos a cada canal y pedir aprobación de un supervisor.
- Si una regla no se cumple, la promesa se rechaza y el sistema dice **cuál regla falló**.
- **Se cumple** cuando todas las facturas que cubre quedan pagadas. **Se incumple** si llega la fecha sin pagar: el servicio se corta a la hora de corte.

**Reconexión temporal:** cuando un cliente cortado manda su comprobante por Iris y caja no puede revisarlo pronto, se le puede reconectar unas horas mientras se revisa. Si caja lo aprueba, queda al día; si lo rechaza o no se revisa a tiempo, vuelve a cortarse.

Más detalle en [Promesas de pago](../manual/cobros/promesas.md).

## Saldo del cliente

El saldo del cliente **es la suma de su cuenta en el libro**: todo lo facturado menos todo lo pagado o acreditado. No hay un número escrito a mano que alguien pueda cambiar. Por eso el saldo siempre cuadra con las facturas y los pagos.

- **Saldo positivo:** el cliente debe.
- **Saldo a favor:** pagó de más. Se aplica solo a sus próximas facturas.

Lo ves en la pestaña «Estado de cuenta» de la ficha del cliente, con cada cargo y abono.

## Anular o nota de crédito

| Quieres…                                                                 | Usa                              |
| ------------------------------------------------------------------------ | -------------------------------- |
| Dejar sin efecto una factura que no debió emitirse, sin pagos ni notas   | **Anular la factura**            |
| Corregir una factura mal emitida (por ejemplo, el NIT) y emitirla bien   | **Sustituir la factura**         |
| Rebajar parte del saldo de una factura, o el resto cuando ya tiene notas | **Nota de crédito**              |
| Deshacer un pago mal registrado                                          | **Anular el pago**               |
| Cerrar unos centavos que faltaron                                        | **Cerrar diferencia** en el pago |

Una factura con pagos no se anula: primero se anula el pago. Una factura con DTE certificado se anula ante la SAT dentro de su plazo; fuera de plazo, se usa nota de crédito. Ver [Facturas](../manual/facturacion/facturas.md) y [Pagos](../manual/cobros/pagos.md).

## Por qué no se borra nada del libro

Todo lo que mueve dinero (facturas, pagos, notas, cierres de caja) deja un **asiento** en el libro contable, y ese asiento **nunca se edita ni se borra**. Un error se corrige con otro asiento que lo revierte: la anulación.

Así:

- siempre sabes qué pasó, cuándo y quién lo hizo, aunque se haya corregido;
- el saldo de cada cliente y de cada caja se puede volver a calcular en cualquier momento y da lo mismo;
- lo que ya se reportó a la SAT o se cerró en un mes no cambia por detrás.

Por eso en el panel no hay botones de «editar» ni «borrar» en facturas y pagos: solo «Anular», «Nota de crédito» y «Sustituir».

## Relacionado

- [Plantillas de facturación](../manual/facturacion/plantillas.md)
- [Cobrar](../manual/cobros/cobrar.md)
- [Caja](../manual/cobros/caja.md)
- [Runbook: cierre de caja](../runbooks/cierre-de-caja.md)
