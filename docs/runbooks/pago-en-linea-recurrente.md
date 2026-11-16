---
orden: 21
---

# Pago en línea con Recurrente

Para contabilidad y soporte. El detalle técnico está en `.claude/integration/contratos/pago-en-linea.md` § Recurrente. Las pantallas están en el manual: [Pago en línea y conciliación de la pasarela](../manual/cobros/pasarela.md), [Cobros por liquidar](../manual/cobros/cobros-por-liquidar.md) y [Proveedores de cobro](../manual/cobros/proveedores-de-cobro.md).

## Qué hace el sistema solo

- El cliente paga en la página de Recurrente desde el portal. El cobro mínimo es Q 5.00. El webhook firmado registra el pago «Pago en línea» (`pasarela`), lo aplica a las facturas del cobro y reactiva el servicio en la misma operación. Si Recurrente avisa dos veces del mismo pago, se registra una sola vez.
- El asiento depende de si Recurrente está dado de alta como [proveedor de cobro](../manual/cobros/proveedores-de-cobro.md):
    - **Sin proveedor de cobro:** `Banco (neto) + 5.1.02 Comisiones de pasarelas + 1.1.05 IVA retenido (si la emisora retuvo) / CxC (bruto)`. La comisión entra con cada pago.
    - **Con proveedor de cobro** (desde su fecha de corte): `1.1.10.NN Cobros por liquidar (bruto − retenido) + 1.1.05 IVA retenido / CxC (bruto)`, sin comisión. El neto al banco y la comisión se registran después, con la liquidación en **Bancos → Cobros por liquidar**.
- Si el monto pagado no coincide con el del cobro, el pago **no** se registra. La conciliación diaria lo muestra como «El proveedor cobró y no hay pago registrado» (`pago_sin_registrar`): revisen en Recurrente qué pasó y registren el pago a mano o reembolsen.
- **Reembolso** hecho en Recurrente (`refund.*`):
    - Total: el pago se anula solo, la deuda vuelve y el servicio se re-evalúa.
    - Parcial: el pago se anula y, en la misma operación, se registra otro por lo que queda, aplicado a las mismas facturas.
    - La comisión que Recurrente no devuelve queda de gasto. Sin proveedor de cobro, el sistema ajusta `5.1.02`; con proveedor, la comisión real sale en la liquidación.
    - Si el reembolso no se puede aplicar por una regla de negocio, la conciliación lo lista como «Reembolso del proveedor rechazado y sin aplicar» (`reembolso_sin_aplicar`).
- **Contracargo** (`dispute.*`): **no** hay acción automática sobre el pago. Queda registrado, se avisa al equipo y la conciliación diaria lo lista como «Contracargo abierto en el proveedor» (`disputa`). Contabilidad responde el contracargo en Recurrente. Si se pierde, anulen el pago desde su detalle en **Pagos** («Anular pago»). Si ese pago ya estaba liquidado, la siguiente liquidación lo descuenta como contracargo.
- Un aviso auténtico que no se puede aplicar (referencia repetida, mes cerrado…) se responde como recibido para que Recurrente no lo reintente sin fin, y la conciliación lo reporta.
- La conciliación corre sola cada madrugada (06:30, hora de Guatemala) con los cobros del día anterior. Con `facturas.generar`, «Conciliar un día» la corre a mano.

## Factura de comisiones de Recurrente

Recurrente cobra su comisión de cada pago, y esa comisión **ya entra al libro** en `5.1.02`: con cada pago si no hay proveedor de cobro, o con cada liquidación si lo hay.

- **No registren la factura de comisiones de Recurrente como compra a gasto.** Se duplicaría el gasto de `5.1.02`.
- Guárdenla como respaldo de los cargos de `5.1.02` del mes. Su total debe coincidir con la suma de `5.1.02` de los pagos (o de las liquidaciones) de Recurrente del mes.
- El crédito fiscal del IVA de esa factura está pendiente del contador (`localizacion-fiscal.md` §15 #102). Mientras tanto no se toma.

## Antes de activar en producción

Ver la lista «Pendiente del PM» del contrato: llaves, URL del webhook y su secreto, y **apagar la facturación electrónica de Recurrente** (ArgosIsp certifica con INFILE).
