---
orden: 7
pantallas:
    - /constancias
---

# Constancias de retención

Las constancias de las retenciones de IVA e ISR: las que te entregan los clientes al pagarte y las que tú emites a tus proveedores en una compra.

Está en **Compras → Constancias de retención**.

## Quién la usa

- Ver: `compras.ver` (**admin**, **contabilidad** y **lectura**).
- Registrar la constancia de una compra: `compras.registrar`, desde la ficha de la compra.

## Qué ves

Filtra por dirección (**Recibidas de clientes**, **Emitidas a proveedores** o ambas) y por impuesto (**IVA**, **ISR** o ambos).

Cada fila muestra la fecha, el número de constancia y:

- En las emitidas: «A» el proveedor, con enlace a su compra.
- En las recibidas: «De» el cliente, con el número de pago.
- «Su compra se anuló» o «Su pago se anuló» si el documento ya no está vigente.
- El monto.

## Acciones

Esta pantalla solo consulta. La constancia de una retención emitida se registra desde su compra: ver [Compras → Registrar la constancia de retención](../compras-y-activos/compras.md#registrar-la-constancia-de-retencion).

| Mensaje                            | Qué hacer                                  |
| ---------------------------------- | ------------------------------------------ |
| La retención ya tiene constancia   | Nada; búscala en esta lista                |
| Ese número de constancia ya se usó | Revisa el número; cada constancia es única |

## Relacionado

- [Compras](../compras-y-activos/compras.md)
- [Declaraciones](./declaraciones.md): retenciones de IVA e ISR.
