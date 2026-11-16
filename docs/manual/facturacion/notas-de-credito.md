---
orden: 3
pantallas:
    - /notas-credito
    - /notas-credito/[id]#detalle-de-una-nota-de-credito
---

# Notas de crédito

Una nota de crédito rebaja el saldo de una factura, parcial o totalmente, y deja su asiento en el libro. Aquí ves todas las notas emitidas y el detalle de cada una.

Las notas **se emiten desde el detalle de la factura** (botón «Nota de crédito», ver [Facturas](./facturas.md#emitir-una-nota-de-credito)). Esta pantalla es para consultarlas.

## Quién la usa

- **Ver:** `facturas.ver` (`admin`, `cajero`, `soporte`, `contabilidad`, `lectura`).
- **Anular una nota:** `facturas.anular_nota_credito` (`admin`, `contabilidad`).

Se llega desde **Cobros → Notas de crédito**.

## Qué ves

Filtros: **cliente**, **número de factura** y un rango de fechas **desde / hasta** (fecha contable de la nota). «Limpiar filtros» los quita.

| Columna     | Qué muestra                                                                                |
| ----------- | ------------------------------------------------------------------------------------------ |
| **Nota**    | Número (enlace al detalle) y fecha.                                                        |
| **Cliente** | Enlace al estado de cuenta del cliente.                                                    |
| **Factura** | Enlace a la factura acreditada.                                                            |
| **Motivo**  | El motivo escrito al emitirla y quién la emitió.                                           |
| **IVA**     | El IVA que la nota rebaja.                                                                 |
| **Monto**   | El monto acreditado.                                                                       |
| **NCRE**    | El estado de su documento electrónico, o «Interna» si no lleva DTE. «Anulada» si se anuló. |

## Detalle de una nota de crédito

- **Datos de la nota:** monto acreditado, subtotal, IVA acreditado, factura, servicio, quién la emitió, cuándo se registró y el motivo.
- **NCRE (certificación FEL):** el estado del documento electrónico (con `fel.ver`). Desde ahí se puede reintentar si la SAT la rechazó.
- **Asiento del libro:** con `libro.ver`.
- Botón «NCRE (PDF)» (si está certificada) o «Nota (PDF)»: abre el documento en otra pestaña.

### Anular una nota

- **Permiso:** `facturas.anular_nota_credito`.
- **Dónde:** botón «Anular nota». Solo aparece cuando **la SAT rechazó su NCRE** y la nota no está anulada.
- **Qué pasa:** pides el motivo. Se registra el asiento de reverso, el monto vuelve al saldo de la factura y el servicio se vuelve a evaluar (si vuelve a deber, puede limitarse o suspenderse a la hora de corte).

Cuando la SAT rechaza la NCRE verás el aviso «La SAT rechazó la NCRE de esta nota». Tienes dos caminos: corregir el dato y reintentar la NCRE, o anular la nota. **Mientras siga sin certificar, el mes no se puede cerrar.**

::: danger No se puede deshacer
Una nota anulada no vuelve a valer. Si hacía falta, emite otra con el dato corregido.
:::

## Preguntas frecuentes y errores

**¿Por qué no puedo anular una nota cualquiera?** Una nota emitida y válida no se anula: es un documento definitivo. Solo se anula la que la SAT rechazó.

**¿La nota devuelve dinero al cliente?** No. Rebaja lo que debe en esa factura. Si quieres dejar saldo a favor, eso es un pago de más, no una nota.

| Situación                                        | Qué hacer                                               |
| ------------------------------------------------ | ------------------------------------------------------- |
| La API dice que la NCRE ya se certificó          | Ya es válida: no se anula.                              |
| La API dice que la NCRE sigue en proceso         | Espera la respuesta de la SAT y vuelve a abrir la nota. |
| «Esta nota no tiene asiento en el libro diario.» | Avisa a contabilidad.                                   |

## Relacionado

- [Facturas](./facturas.md)
- [El ciclo de cobro](../../guia/ciclo-de-cobro.md#anular-o-nota-de-credito)
