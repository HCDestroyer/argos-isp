---
orden: 2
pantallas:
    - /pagos
    - /pagos/[id]#detalle-de-un-pago
---

# Pagos

La lista de todos los pagos recibidos, de cualquier método, y el detalle de cada uno: a qué facturas se aplicó, su asiento y las acciones para corregirlo.

Los pagos se registran en [Cobrar](./cobrar.md), al aprobar un comprobante o solos cuando el cliente paga en línea.

## Quién la usa

- **Ver:** `pagos.ver` (`admin`, `cajero`, `soporte`, `contabilidad`, `lectura`).
- **Anular:** `pagos.anular` (`admin`, `contabilidad`).
- **Cerrar diferencia:** `pagos.cerrar_diferencia` (`admin`, `contabilidad`).

Se llega desde **Cobros → Pagos**. Con `pagos.registrar`, el botón «Cobrar» lleva a la pantalla de cobro (con el cliente ya elegido si filtraste por uno).

## Qué ves

Filtros: **cliente**, **método** (incluye «Pago en línea»), **estado**, **caja** (con `cajas.ver`) y fechas **desde / hasta** (días en hora de Guatemala). «Limpiar filtros» los quita.

| Columna     | Qué muestra                                                                            |
| ----------- | -------------------------------------------------------------------------------------- |
| **Pago**    | Número (enlace al detalle) y fecha y hora.                                             |
| **Cliente** | Quien pagó (enlace a su estado de cuenta).                                             |
| **Método**  | El método, la referencia o la caja, e «Importado (histórico)» si vino de otro sistema. |
| **Monto**   | Lo pagado.                                                                             |
| **Estado**  | «Registrado» (verde), «Por verificar» (amarillo) o «Anulado» (gris).                   |

## Detalle de un pago

- **Datos del pago:** monto, comisión (en pagos en línea), método, referencia, banco de origen, cuenta de destino, caja, pasarela, proveedor de cobro y su liquidación (o «Por liquidar»), saldo que quedó pendiente en sus facturas, quién lo registró, anticipo sin aplicar y nota.
- **Facturas pagadas:** cada factura y cuánto se le aplicó. Si está vacía, todo el monto quedó como anticipo (saldo a favor) del cliente.
- **Asientos del libro:** con `libro.ver`.
- Un pago importado de otro sistema dice «Pago histórico de otro sistema, con su fecha original: no pasó por caja ni bancos».

## Acciones

### Anular un pago

- **Permiso:** `pagos.anular`.
- **Dónde:** botón «Anular pago».
- **Qué pide:** el motivo (3 a 500 caracteres). Queda en la bitácora con tu usuario.
- **Qué revierte:**
    - Se registra un **asiento de reverso**. El pago original queda en el historial como «Anulado», con fecha y motivo.
    - Las facturas vuelven a deber lo que este pago cubría. Las que ya habían vencido vuelven a «Vencida».
    - Si con el pago se había cerrado una diferencia pequeña, también se revierte.
    - Si el pago cubría facturas de otros clientes (responsable de pago), se revierte en la cuenta de cada uno.
    - El saldo a favor que tengan el que pagó o los dueños de las facturas se vuelve a aplicar a lo que quedó debiendo.
    - Se vuelven a evaluar los servicios: **pueden limitarse o suspenderse** (la bajada de estado se aplica a la hora de corte de su plantilla). El detalle muestra cómo quedó cada servicio.
- **Lo que no cambia:** si el pago era en efectivo y su turno de caja ya se cerró, ese cierre no cambia; el reverso sale de la caja en el libro. Si era un pago en línea ya liquidado por el proveedor, queda como **contracargo** que la siguiente liquidación descuenta.

::: danger No se puede deshacer
Un pago anulado no se reactiva. Si el pago era bueno, regístralo de nuevo.
:::

### Cerrar una diferencia pequeña

Cuando un cliente paga unos centavos de menos (por redondeo, por ejemplo) y la factura queda con un saldo mínimo.

- **Permiso:** `pagos.cerrar_diferencia`.
- **Dónde:** botón «Cerrar diferencia». Aparece en pagos registrados que dejaron saldo en sus facturas.
- **Qué pasa:** pide el motivo. El saldo pequeño de cada factura se cierra como gasto (diferencias de cobro). No toca el IVA ni el DTE, y las facturas quedan pagadas. El sistema vuelve a evaluar los servicios (puede reactivarlos).
- **Tope:** solo se cierra hasta el tope de la empresa (por defecto Q 1.00; es un parámetro fiscal de la empresa). Si el saldo es mayor, el sistema no lo cierra: cóbralo o emite una nota de crédito.
- Se hace una vez por pago y factura. Anular el pago revierte la diferencia.

## Preguntas frecuentes y errores

**¿Por qué no puedo editar un pago?** Nada que mueva dinero se edita ni se borra. Se anula y se registra de nuevo.

**Pagó de más.** Lo que sobra queda como saldo a favor y se aplica solo a sus próximas facturas. Lo verás como «Anticipo sin aplicar».

| Mensaje o situación                                          | Qué hacer                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| «El pago … se aplicó a facturas ya castigadas (…)»           | El pago no se puede anular: contabilidad corrige con un asiento de ajuste. |
| La diferencia supera el tope                                 | No se cierra: cobra el saldo o emite una nota de crédito.                  |
| No hay diferencia que cerrar                                 | Las facturas del pago ya no tienen saldo.                                  |
| El DTE de una factura está en anulación                      | Espera la respuesta de la SAT.                                             |
| «No se encontró el asiento de este pago en el libro diario.» | Avisa a contabilidad.                                                      |

## Relacionado

- [Cobrar](./cobrar.md)
- [Caja](./caja.md)
- [Cobros por liquidar](./cobros-por-liquidar.md)
- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
