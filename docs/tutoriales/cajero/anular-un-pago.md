---
orden: 5
---

# Anular un pago

Al terminar, el pago queda anulado con su motivo, las facturas vuelven a deber lo que ese pago cubría y el libro tiene su asiento de reverso.

::: danger No se puede deshacer
Un pago anulado no vuelve a quedar vigente. Si te equivocaste al anular, hay que registrar el pago de nuevo.
:::

## Antes de empezar

- Permiso: `pagos.anular`. **El rol `cajero` no lo trae:** lo tienen `contabilidad` y `admin`. Si eres cajero, pide la anulación a tu supervisor o a contabilidad con el número del pago y el motivo.
- Ten claro el motivo: queda en la bitácora y en el pago.

## Pasos

1. Abre **Cobros → Pagos** y busca el pago (por cliente, fechas o método), o ábrelo desde la ficha del cliente.
2. Toca el pago para abrir su ficha. Revisa el monto, el cliente y a qué facturas se aplicó.
3. Toca «Anular pago».
4. Escribe el **Motivo**, por ejemplo «el depósito fue rechazado por el banco».
5. Toca «Anular pago» para confirmar.

## Qué pasa después

- El pago queda **Anulado** con la fecha y el motivo. Nada se borra.
- Se registra un **asiento de reverso** en el libro.
- Las facturas vuelven a deber lo que el pago cubría. Si ya estaban vencidas, vuelven a **vencida**.
- ArgosIsp vuelve a evaluar los servicios de esas facturas: **pueden volver a limitarse o cortarse**, respetando la hora de corte. La ficha del pago muestra cómo quedó cada servicio.
- Si el pago era parte de un cobro repartido entre varias empresas, solo se anula este pago; los de las otras empresas siguen vigentes.

## Si algo sale mal

| Situación                   | Causa                                               | Qué hacer                               |
| --------------------------- | --------------------------------------------------- | --------------------------------------- |
| No aparece «Anular pago»    | No tienes `pagos.anular`, o el pago ya está anulado | Pide la anulación a contabilidad        |
| «El pago ya está anulado»   | Otra persona lo anuló antes                         | Revisa la ficha: ya dice «Pago anulado» |
| Error por factura castigada | Una de sus facturas se castigó como incobrable      | Pide a contabilidad que lo revise       |
| El motivo es muy corto      | El motivo es obligatorio                            | Escribe un motivo claro                 |

## Relacionado

- [Cobrar una o varias facturas](./cobrar-facturas.md)
- [Manual de cobros](../../manual/cobros/)
