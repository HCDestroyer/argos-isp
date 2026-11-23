---
orden: 0
pantallas:
    - /finanzas
---

# Panel financiero

El resumen del dinero de la empresa en una pantalla: lo cobrado contra lo facturado, lo vencido por antigüedad, el efectivo en cajas y bancos, los impuestos por pagar y los avisos del libro. Las cifras se actualizan con cada cobro.

Está en **Finanzas → Panel financiero**. Necesitas `reportes.ver`; el efectivo pide además `libro.ver` y los impuestos `fiscal.ver`.

## Qué ves

- **Avisos** arriba: si la cadena del libro está íntegra, si el mes pasado sigue sin cerrar, el próximo impuesto que vence y, al 80 % y al 95 % del límite, el aviso del pequeño contribuyente.
- **Indicadores**: cobrado en el mes (y qué parte de lo facturado es), cartera vencida y efectivo disponible (saldo de las cuentas de caja 1.1.01 y bancos 1.1.02). El ingreso recurrente con IVA, las bajas del mes (retirados o suspendidos más de 60 días) y el ingreso por servicio dicen «Sin datos todavía» hasta que la API los dé.
- **Facturado y cobrado** de los últimos 12 meses, con «Ver tabla».
- **Lo vencido por antigüedad**, con «Ver cartera».
- **Impuestos por pagar** de los próximos 30 días, con «Calendario fiscal». Son borradores: Argos no presenta nada a la SAT.
- **Por empresa** (solo con alcance global): cada NIT lleva su libro; el total del grupo es solo informativo.

Cuando una cifra no se pudo leer, la tarjeta dice «No se pudo leer» con **Reintentar**: nunca se muestra un cero en su lugar.

## En el teléfono

Tres pantallas: **Resumen**, **Empresas** y **Reportes**. En el teléfono solo se consulta; cerrar un mes, declarar o castigar se hace en la computadora.

## Relacionado

- [Libro](./libro.md)
- [Cartera](./cartera.md)
- [Reportes](../reportes/catalogo.md)
