---
orden: 2
---

# Cobrar una o varias facturas

Al terminar, el pago queda registrado, las facturas pagadas, el recibo impreso y, si el servicio estaba cortado y ya no debe nada vencido, reactivado.

## Antes de empezar

- Permiso: `pagos.registrar`. Para ver lo que debe el cliente, también `clientes.estado_cuenta`. El rol `cajero` trae los dos.
- Para cobrar en efectivo, tu caja abierta (ver [Abrir la caja](./abrir-caja.md)).

## Pasos

1. Toca **Cobrar** en el menú (o el botón «Cobrar» de la caja).
2. En **Cliente** escribe su nombre, NIT, teléfono, usuario PPP o IP, y elige al cliente de la lista.
3. Revisa arriba **Vencido** (en rojo si debe) y **Pendiente total**, y debajo sus servicios con su estado.
4. Las facturas vencidas ya vienen marcadas. Marca o desmarca las que va a pagar. Se aplican en el orden de la pantalla.
5. **Monto** se llena con la suma de las marcadas. Si el cliente paga otra cantidad, cámbialo:
    - Si no alcanza, el panel te dice qué factura queda parcial.
    - Si sobra, te dice a qué otras facturas va o cuánto queda como saldo a favor.
6. En **Método** deja «Efectivo en caja» para efectivo. La **Caja** es opcional: sin elegirla, va a tu caja abierta.
7. Si quieres, escribe una **Nota**.
8. Toca «Registrar pago» (o pulsa **Enter**).
9. Toca «Imprimir» para dar el recibo. «Nuevo cobro» (o **Esc**) deja la pantalla lista para el siguiente.

![Cobro con el cliente elegido, lo vencido y lo pendiente a la izquierda y el formulario de pago a la derecha](/capturas/cajero/cobro-cliente.png)

## Qué pasa después

- Aviso «Pago registrado» con el monto y el cliente. Si se reactivó un servicio, el aviso lo dice y el servicio muestra «Servicio reactivado».
- La reactivación es inmediata: no espera a ningún proceso de la noche. Si a los 30 segundos no se reactivó, aparece «El servicio no se ha reactivado»: puede que aún deba facturas vencidas o que tenga una **suspensión manual** (solo se quita con «Reactivar» en la ficha del servicio).
- El pago entra al turno de tu caja y al libro contable. Si la empresa usa FEL y certifica al cobrar, las facturas pagadas se certifican.
- Si las facturas marcadas son de varias empresas, se registra un pago por empresa y cada uno va a la caja de su empresa. El panel muestra el reparto.

## Si algo sale mal

| Mensaje                               | Causa                                                              | Qué hacer                                                                   |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| «_Caja_ está cerrada»                 | Cobras en efectivo y tu caja no tiene turno                        | Toca «Abrir caja» en el aviso (o pide a un supervisor) y vuelve a registrar |
| «No tienes caja abierta en _empresa_» | Marcaste facturas de otra empresa y no tienes caja abierta en ella | Abre una caja de esa empresa o desmarca esas facturas                       |
| «Esa referencia ya se registró»       | Ese número de boleta o referencia ya está en otro pago             | No se cobró de nuevo: revisa el comprobante o busca el pago en **Pagos**    |
| Error junto al Monto                  | Monto vacío, en cero o con más de dos decimales                    | Corrígelo                                                                   |

::: tip Cobrar por banco
Para depósitos, transferencias, ACH o remesas, mira [Registrar un pago por depósito o un comprobante](./pago-por-deposito-o-comprobante.md).
:::

## Relacionado

- [Cobrar a un responsable de pago](./cobrar-a-un-responsable.md)
- [Anular un pago](./anular-un-pago.md)
- [Manual de cobros](../../manual/cobros/)
