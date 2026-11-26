---
orden: 4
pantallas:
    - /configuracion/bancos-origen
---

# Bancos de origen

El catálogo de bancos de donde viene el dinero de una transferencia o un ACH. Es uno solo para todo el sistema: al cobrar una transferencia, el cajero elige de aquí el banco del cliente; también lo usan el portal del cliente y la conciliación bancaria. Cada empresa puede ocultar los que no usa.

## Quién la usa

- **Ver:** `cuentas_bancarias.ver` (`admin`, `cajero`, `contabilidad`, `lectura`).
- **Agregar** un banco: `bancos_origen.crear`. **Editar** (nombre o si sale en las listas): `bancos_origen.editar`. Los dos cambian el catálogo de todas las empresas.
- **Ocultar** y **mostrar** en la empresa activa: `bancos_origen.ocultar` y `bancos_origen.mostrar`.

Se llega desde **Ajustes → Facturación y cobro → Bancos de origen**.

## Qué ves

- Un buscador («Buscar banco…») que filtra por nombre, sin importar tildes ni mayúsculas.
- Los bancos del catálogo, uno por pastilla. Un banco **oculto** en la empresa activa se ve con el ojo tachado y borde punteado; uno fuera de las listas de todas las empresas se ve tachado.

## Acciones

- **Agregar banco:** escribe el nombre. Sale para todas las empresas, antes de «Otro».
- Toca un banco para su menú:
    - **Editar:** cambia el nombre o apaga «Sale en las listas» (ninguna empresa lo ve al cobrar). Los pagos y comprobantes que ya lo usan no cambian.
    - **Ocultar en esta empresa** / **Mostrar en esta empresa:** solo para la empresa elegida arriba. Con «Todas las empresas» pide elegir una.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Ya hay un banco con ese nombre en el catálogo» | Ese banco ya existe: búscalo en la lista. |
| «Ningún banco coincide» | Revisa lo que escribiste en el buscador o bórralo para ver el catálogo entero. |
| Error al leer con «Reintentar» | No se pudo leer el catálogo: pulsa «Reintentar». |

## Relacionado

- [Cuentas bancarias](../bancos/cuentas-bancarias.md)
- [Cobrar](../cobros/cobrar.md)
