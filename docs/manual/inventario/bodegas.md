---
orden: 3
pantallas:
    - /inventario/bodegas
    - /inventario/mi-bodega#mi-bodega
---

# Bodegas y Mi bodega

Una bodega es un lugar donde se guarda inventario (la bodega central, una sucursal) o el vehículo de un técnico, que responde por lo que lleva.

Menú: **Inventario → Bodegas** y **Inventario → Mi bodega**.

## Quién la usa

- Ver: `inventario.ver` (todos los roles base).
- Crear, editar y desactivar: `bodegas.crear`, `bodegas.editar`, `bodegas.desactivar` (`admin` y `contabilidad`).

## Qué ves

Una fila por bodega con su nombre, su tipo («Bodega» o «Técnico») y su estado («Activa» o «Desactivada»). En una bodega de técnico aparece con un candado quién la mueve. Un clic en el nombre abre sus [existencias](./existencias.md).

::: tip La bodega del técnico es solo suya
Solo la mueve su técnico o quien tenga el permiso con alcance global. Para que un técnico opere únicamente su propia bodega, asígnale su rol con alcance de zona o de router en **Usuarios**.
:::

## Acciones

### Nueva bodega y editar

- **Permiso:** `bodegas.crear` / `bodegas.editar`.
- **Campos:** nombre, tipo y, si es de técnico, el técnico que responde por ella (si no puedes ver la lista de usuarios, escribe su número).
- **Límites:** el tipo no cambia después de crearla. No se puede cambiar el técnico de una bodega que tiene existencias.

### Desactivar

- **Permiso:** `bodegas.desactivar`.
- **Qué pasa:** pide motivo; la bodega deja de recibir movimientos.
- **Límites:** solo sin existencias y sin órdenes de traslado en tránsito hacia ella o desde ella. Recíbelas o cancélalas antes.

## Mi bodega

Menú: **Inventario → Mi bodega**. Permiso `inventario.ver`.

Es la pantalla del técnico: lo que tiene en su vehículo y lo que le están enviando.

- **Por recibir:** las órdenes de traslado que vienen hacia él, con el origen y la fecha de envío. El botón «Recibir y firmar» abre la recepción (ver [recibir una orden](./traslados.md#recibir-una-orden)). Necesita `inventario.recibir_traslado`, que trae el rol `tecnico`.
- **Existencias:** cada producto con su modalidad, cantidad y valor.
- **Equipos por serie:** los equipos disponibles o en reparación que tiene, con su serie o MAC.
- **Kardex:** sus últimos 50 movimientos, el más reciente primero. «Ver más» trae los anteriores.

Si tienes alcance global (un encargado), arriba puedes elegir un técnico para ver su bodega. Si el técnico tiene bodegas en varias empresas, la pantalla te pide elegir una.

## Preguntas frecuentes y errores

- **«No tienes una bodega de técnico».** Pide a un encargado que la cree en **Inventario → Bodegas** con tu usuario.
- **«Bodega con existencias».** No se puede desactivar ni cambiar de técnico mientras tenga algo. Trasládalo antes.
- **«Bodega con traslados en tránsito».** Recibe o cancela esas órdenes primero.

## Relacionado

- [Órdenes de traslado](./traslados.md)
- [Existencias](./existencias.md)
