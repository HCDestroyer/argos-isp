---
orden: 4
pantallas:
    - /bonificaciones
    - /bonificaciones/[id]#detalle-de-una-bonificacion
---

# Bonificaciones

Una bonificación es algo que se entregó sin cobrar: un mes gratis, un descuento del 100 %, un canje de lealtad o un cargo sin costo. **Nunca se emite una factura de Q 0.00**: lo que antes sería una factura en cero queda aquí, con su motivo y el valor que no se cobró.

## Quién la usa

- **Ver:** `facturas.ver` (`admin`, `cajero`, `soporte`, `contabilidad`, `lectura`).
- La pantalla es solo de consulta. Las bonificaciones nacen solas: de un mes gratis o un descuento del 100 % al facturar el periodo, de un canje de lealtad, o de un cargo único en Q 0.00 (permiso `facturas.cargo_sin_costo`).

Se llega desde **Facturación → Bonificaciones**. Desde la ficha de un cliente o servicio se abre ya filtrada.

## Qué ves

Arriba, el recordatorio: una bonificación no tiene IVA ni DTE; deja solo un asiento interno de descuento.

Filtros: **origen** y fechas **desde / hasta**. Si llegaste desde un cliente o servicio, verás su nombre en una insignia y el botón «Ver todas».

| Columna        | Qué muestra                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| **Periodo**    | El periodo (enlace al detalle), el concepto y el origen.                     |
| **Cliente**    | El cliente y el motivo.                                                      |
| **Origen**     | «Mes gratis», «Descuento del 100 %», «Canje de lealtad» o «Cargo sin costo». |
| **Sin cobrar** | El valor bruto (con IVA) que no se cobró.                                    |

Con `reportes.ver` aparece el botón «Reporte», que abre el reporte de bonificaciones por mes, motivo y origen.

## Detalle de una bonificación

- **Bonificación:** cliente, servicio (o «Sin servicio»), motivo del catálogo, explicación escrita, clave y fecha de registro.
- **Valor:** el valor bruto con IVA que no se cobró y la base sin IVA del asiento interno. Si vino de un canje, su número.
- **Líneas:** concepto, cantidad, precio y total.
- **Asiento del libro:** con `libro.ver`.

Si la bonificación es de un periodo del servicio, el aviso lo dice: **ese periodo quedó bonificado y la facturación automática ya no lo cobra**. Si es un cargo único sin costo, no ocupa ningún periodo.

## Preguntas frecuentes

**¿Puedo deshacer una bonificación?** No desde el panel. Es un registro definitivo; los canjes aplicados tampoco se revierten.

**¿Por qué el cliente no recibió factura del mes?** Revisa aquí: si el periodo está bonificado, no hay factura.

## Relacionado

- [Facturas](./facturas.md)
- [El ciclo de cobro](../../guia/ciclo-de-cobro.md)
