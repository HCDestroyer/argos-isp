---
orden: 3
pantallas:
    - /inventario/bodegas
    - /inventario/mi-bodega#mi-bodega
---

# Bodegas y Mi bodega

Una bodega es un lugar donde se guarda inventario (la bodega central, una sucursal) o el vehículo de un técnico, que responde por lo que lleva.

Menú: **Inventario → Catálogos y kardex → Bodegas** y **Inventario → Movimientos → Mi bodega**.

## Quién la usa

- Ver: `inventario.ver` (todos los roles base).
- Crear, editar y desactivar: `bodegas.crear`, `bodegas.editar`, `bodegas.desactivar` (`admin` y `contabilidad`).

## Qué ves

Una tarjeta por bodega con su valor, sus artículos y equipos y, si algo viene en camino hacia ella, «1 traslado en camino». La bodega «En tránsito» es virtual: guarda lo que viaja en una orden y no se opera a mano. Cada tarjeta tiene su menú «⋯»: ver existencias y kardex, trasladar desde ahí, contarla, editar y desactivar.

Una **bodega de cuadrilla** llega de Iris con su jefe y sus miembros; «Jefe y miembros» los muestra (también los que Iris mandó y no se pudieron aplicar, con el motivo). No se edita en Argos.

Abajo están los **traslados** con «Todos», «En camino» y «Con faltante»; cada fila abre su orden.

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

Pensada para el teléfono del técnico: arriba, cada traslado por recibir con «Recibir»; luego sus **equipos** (los tres primeros y «Ver los …») y sus **materiales** con la cantidad (en rojo si está bajo el mínimo), y los movimientos recientes plegados. El botón de código de barras busca un equipo por serie o MAC.

Abajo, fijos: «Devolver a central» (abre un traslado desde su bodega) y «Pedir material», que aparece deshabilitado hasta que exista en la API. Con alcance global se elige el técnico; si su bodega es de cuadrilla se ve su jefe.

## Preguntas frecuentes y errores

- **«No tienes una bodega de técnico».** Pide a un encargado que la cree en **Inventario → Catálogos y kardex → Bodegas** con tu usuario.
- **«Bodega con existencias».** No se puede desactivar ni cambiar de técnico mientras tenga algo. Trasládalo antes.
- **«Bodega con traslados en tránsito».** Recibe o cancela esas órdenes primero.

## Relacionado

- [Órdenes de traslado](./traslados.md)
- [Existencias](./existencias.md)
