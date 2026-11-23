---
orden: 5
pantallas:
    - /configuracion/plantillas-conceptos
---

# Plantillas y conceptos

Un resumen en una sola pantalla de lo que define cómo se cobra y qué se imprime: las plantillas de facturación, las plantillas de documentos y los conceptos de cargo único. Cada bloque tiene «Abrir» para ir a su pantalla completa.

## Quién la usa

- **Ver:** `plantillas.ver` o `documentos.ver`. Cada bloque aparece solo si tienes su permiso: plantillas de facturación con `plantillas.ver`, plantillas de documentos con `documentos.ver` y conceptos con `facturas.ver`.

Se llega desde **Configuración → Facturación y cobro → Plantillas y conceptos**.

## Qué ves

| Bloque                        | Qué muestra                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Plantillas de facturación** | Cada plantilla vigente con su ciclo (día de emisión, vencimiento y corte). «Abrir» lleva a Plantillas.    |
| **Plantillas de documentos**  | Aviso de cobro, factura, recibo y nota de crédito con el formato que usan (carta o POS 80 mm), o «De fábrica». |
| **Conceptos de cargo único**  | Los conceptos activos (instalación, reconexión…) y si llevan IVA.                                         |

Cada bloque lee lo suyo: si uno falla, muestra el error con «Reintentar» y los demás siguen funcionando.

## Relacionado

- [Plantillas de facturación](../facturacion/plantillas.md)
- [Facturas](../facturacion/facturas.md)
