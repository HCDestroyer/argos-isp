---
orden: 4
pantallas:
    - /configuracion/bancos-origen
---

# Bancos de origen

El catálogo de bancos de donde viene el dinero de una transferencia o un ACH. Es uno solo para todo el sistema: al cobrar una transferencia, el cajero elige de aquí el banco del cliente; también lo usan el portal del cliente y la conciliación bancaria.

## Quién la usa

- **Ver:** `cuentas_bancarias.ver` (`admin`, `cajero`, `contabilidad`, `lectura`).

Se llega desde **Configuración → Facturación y cobro → Bancos de origen**.

## Qué ves

- Un buscador («Buscar banco…») que filtra por nombre, sin importar tildes ni mayúsculas.
- Los bancos del catálogo, uno por pastilla.
- El bloque **Por empresa**, con el ajuste para ocultar en una empresa los bancos que no usa.

## Acciones

- **Agregar banco** y **Ocultar los bancos que esta empresa no usa** aparecen con la marca «Próximamente»: todavía no se pueden cambiar desde el panel. De fábrica, todas las empresas ven todos los bancos.

## Preguntas frecuentes y errores

| Mensaje                       | Qué hacer                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ |
| «Ningún banco coincide»       | Revisa lo que escribiste en el buscador o bórralo para ver el catálogo entero. |
| Error al leer con «Reintentar» | No se pudo leer el catálogo: pulsa «Reintentar».                               |

## Relacionado

- [Cuentas bancarias](../bancos/cuentas-bancarias.md)
- [Cobrar](../cobros/cobrar.md)
