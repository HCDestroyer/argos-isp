# Pago en línea con Recurrente

Para contabilidad y soporte. El detalle técnico está en `.claude/integration/contratos/pago-en-linea.md` § Recurrente.

## Qué hace el sistema solo

- El cliente paga en la página de Recurrente. El webhook firmado registra el pago `pasarela` y reactiva el servicio. El asiento es `Banco (neto) + 5.1.02 Comisiones de pasarelas + 1.1.05 IVA retenido (si la emisora retuvo) / CxC (bruto)`.
- Si el monto pagado no coincide con el del cobro, el pago **no** se registra. La conciliación diaria lo muestra como `pago_sin_registrar`: revisen en Recurrente qué pasó y registren el pago a mano o reembolsen.
- Reembolso hecho en Recurrente (`refund.*`): el pago se anula solo, la deuda vuelve y el servicio se re-evalúa.
- Contracargo (`dispute.*`): **no** hay acción automática. Queda registrado y la conciliación diaria lo lista como `disputa`. Contabilidad responde el contracargo en Recurrente. Si se pierde, anulen el pago (`POST /pagos/:id/anular`).

## Factura de comisiones de Recurrente

Recurrente cobra su comisión de cada pago, y esa comisión **ya entra al libro con el webhook** (`5.1.02`, por pago).

- **No registren la factura de comisiones de Recurrente como compra a gasto.** Se duplicaría el gasto de `5.1.02`.
- Guárdenla como respaldo de los cargos de `5.1.02` del mes. Su total debe coincidir con la suma de `5.1.02` de los pagos de Recurrente del mes (reporte de ingresos por método).
- El crédito fiscal del IVA de esa factura está pendiente del contador (`localizacion-fiscal.md` §15 #102). Mientras tanto no se toma.

## Antes de activar en producción

Ver la lista «Pendiente del PM» del contrato: llaves, URL del webhook y su secreto, y **apagar la facturación electrónica de Recurrente** (ArgosIsp certifica con INFILE).
