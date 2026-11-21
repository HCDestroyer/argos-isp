---
orden: 4
pantallas:
    - /activos
    - /activos/[id]#ficha-del-activo
---

# Activos fijos

Los bienes de la empresa que se deprecian: equipo de red, cómputo, mobiliario, vehículos, herramientas, edificios. Aquí los das de alta, ves su depreciación y los das de baja por venta o retiro.

Está en **Finanzas → Compras → Activos fijos**.

## Quién la usa

- Ver: `activos.ver` (**admin**, **contabilidad** y **lectura**).
- Alta sin compra y depreciar lo pendiente: `activos.registrar` (**contabilidad** y **admin**).
- Dar de baja: `activos.dar_de_baja` (**contabilidad** y **admin**).

## Qué ves

Filtra por **Clase** y por estado (**Vigentes**, **Dados de baja** o todos). Cada fila muestra el activo con su clase, tasa anual y fecha de alta, el **Costo**, lo **Depreciado**, el valor **En libros** y el estado: **Vigente** (verde) o **Dado de baja** (gris).

## Acciones

### Alta de un activo

- **Permiso:** `activos.registrar`
- **Dónde:** botón «Alta de activo».
- **Cuándo:** para el inventario inicial o un aporte. Un activo comprado se registra con su compra (línea de tipo activo fijo en [Compras](./compras.md#registrar-una-compra)).
- **Campos:** **Clase**, **Fecha de alta** (vacía: hoy; se deprecia desde el mes siguiente), **Descripción**, **Serie**, **Ubicación** (sitio, nodo o cliente si es un equipo en comodato), **Costo** (sin el IVA tomado como crédito fiscal), **Valor residual**, **Depreciación acumulada al alta** (si llega ya depreciado), **Tasa anual** (vacía: el máximo legal de la clase) y **Contrapartida**: saldos de apertura (inventario inicial), aporte de capital social o utilidades acumuladas.
- **Qué pasa:** se registra el activo con su asiento y se abre su ficha, con la cuota mensual.

### Depreciar lo pendiente

- **Permiso:** `activos.registrar`
- **Dónde:** botón «Depreciar pendiente».
- **Qué pasa:** registra todas las cuotas de depreciación pendientes hasta el mes anterior, una por activo y mes. Repetirlo no duplica nada. El aviso dice cuántas cuotas se registraron o «Nada pendiente». Esto también corre solo cada día.

## Ficha del activo

Muestra la clase, serie, ubicación, fecha de alta, **Costo**, **Valor residual**, **Tasa anual**, **Cuota mensual**, **Depreciación acumulada**, **Valor en libros**, cuántas cuotas lleva, la depreciación al alta (si tuvo), sus cuentas contables y la compra con que se compró. Si se dio de baja, un aviso arriba dice cuándo, por qué, el valor en libros a la baja y, si se vendió, el precio.

### Dar de baja

- **Permiso:** `activos.dar_de_baja`
- **Dónde:** botón «Dar de baja» en la ficha de un activo vigente.
- **Campos:** **Tipo de baja** (retiro por pérdida o desecho, o venta), **Fecha** (vacía: hoy), y si es venta el **Precio de venta** (sin IVA) y la **Cuenta que recibe**; y **Motivo** (por ejemplo, «dañado sin reparación»).
- **Qué pasa:** se registra la depreciación pendiente y el asiento de la baja. El activo deja de depreciarse.

::: danger No se puede deshacer
La baja de un activo no se revierte desde el panel.
:::

## Preguntas frecuentes y errores

| Mensaje                                                 | Qué hacer                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| El activo ya está dado de baja                          | Nada; revisa su ficha                                                |
| La tasa pasa del máximo legal                           | Usa una tasa igual o menor que la máxima de la clase, o déjala vacía |
| Quiero anular la compra de un activo que ya se deprecia | No se puede: da de baja el activo                                    |

## Relacionado

- [Compras](./compras.md)
- [Tablero fiscal](../fiscal/tablero-y-comparador.md): bloque «Depreciación bajo el máximo».
