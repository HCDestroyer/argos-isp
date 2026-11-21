---
orden: 5
pantallas:
    - /cobros/pasarela
---

# Pago en línea y conciliación de la pasarela

El cliente puede pagar con tarjeta desde el portal. El pago se registra solo cuando la pasarela confirma, y el servicio se reactiva en ese momento. Esta pantalla compara cada día los cobros en línea con lo que reporta la pasarela, para encontrar lo que no cuadra.

La configuración y la operación con Recurrente están en el [runbook de pago en línea](../../runbooks/pago-en-linea-recurrente.md).

## Cómo funciona un pago en línea

1. El cliente entra al portal y elige pagar. La pasarela le muestra su página de pago.
2. Cuando la pasarela confirma el pago, el sistema lo registra con el método «Pago en línea», lo aplica a sus facturas y reactiva el servicio si ya no debe lo vencido. La comisión de la pasarela queda registrada en el pago.
3. Si la pasarela avisa dos veces del mismo pago, **se registra una sola vez**.
4. Si el monto que pagó no coincide con el del cobro, el pago **no se registra**: lo verás en la conciliación como «El proveedor cobró y no hay pago registrado».

**Reembolsos:** si se reembolsa el pago en la pasarela, el sistema anula el pago solo (si el reembolso es parcial, registra un pago nuevo por lo que queda). La deuda vuelve y el servicio se reevalúa.

**Contracargos:** cuando el tarjetahabiente disputa el cobro, el sistema **no hace nada automático**: lo registra, avisa al equipo y la conciliación lo lista como «Contracargo abierto en el proveedor». Contabilidad responde en la pasarela. Si se pierde, anula el pago (ver [Pagos](./pagos.md#anular-un-pago)).

## Quién la usa

- **Ver:** `pagos.ver` (`admin`, `cajero`, `soporte`, `contabilidad`, `lectura`).
- **Conciliar un día a mano:** `facturas.generar` (`admin`, `contabilidad`).

Se llega desde **Facturación → Conciliación de la pasarela**.

## Qué ves

El sistema concilia **el día anterior cada madrugada**. Cada corrida es una tarjeta con la fecha, la pasarela, cuántos cobros concilian («… de … cobros conciliados») y la insignia «Concilia» o «… diferencias». Puedes filtrar por día.

Cada diferencia muestra el tipo, el detalle, el monto nuestro y el del proveedor, el identificador del proveedor y el enlace al pago:

| Diferencia                                       | Qué hacer                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| El proveedor cobró y no hay pago registrado      | Revisa en la pasarela qué pasó. Registra el pago a mano en [Cobrar](./cobrar.md) o reembolsa. |
| Hay pago registrado y el proveedor no lo reporta | Revisa con la pasarela. Si el cobro no existe, anula el pago.                                 |
| El monto no coincide                             | Revisa con la pasarela cuál es el correcto.                                                   |
| El pago está anulado y el proveedor lo cobró     | Revisa si hay que reembolsar al cliente o volver a registrar el pago.                         |
| Pago sin cobro de pasarela                       | Revisa el pago: no viene de un cobro en línea.                                                |
| No se pudo consultar al proveedor                | Vuelve a conciliar ese día más tarde.                                                         |
| Contracargo abierto en el proveedor              | Contabilidad responde en la pasarela. Si se pierde, anula el pago.                            |
| Reembolso del proveedor rechazado y sin aplicar  | El sistema no pudo aplicar el reembolso. Revisa el pago y avisa a contabilidad.               |

La conciliación **solo informa**: no cambia pagos.

## Acciones

### Conciliar un día

- **Permiso:** `facturas.generar`.
- **Dónde:** botón «Conciliar un día».
- **Qué pide:** el **Día** (vacío = ayer, hora de Guatemala).
- **Qué pasa:** consulta a la pasarela los cobros de ese día y deja una corrida nueva. El aviso dice «Todo concilia el …» o cuántas diferencias hubo.

## Relacionado

- [Runbook: pago en línea con Recurrente](../../runbooks/pago-en-linea-recurrente.md)
- [Cobros por liquidar](./cobros-por-liquidar.md)
- [Pagos](./pagos.md)
