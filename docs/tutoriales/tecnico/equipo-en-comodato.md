---
orden: 3
---

# Asignar y devolver un equipo en comodato

Al terminar, el equipo que dejaste en casa del cliente (router, ONU o antena) queda ligado a su servicio por su serie o MAC, o vuelve a tu bodega cuando lo recoges.

Un equipo en **comodato** sigue siendo del ISP: se presta al cliente mientras tiene el servicio.

## Antes de empezar

- Permisos: `inventario.ver` para ver la tarjeta, `inventario.asignar_comodato` para asignar y `inventario.devolver_comodato` para devolver (rol `tecnico`).
- El equipo debe estar registrado por serie o MAC y **disponible** en una bodega (por ejemplo, la tuya: ver [Recibir un traslado en tu bodega](./recibir-traslado.md)).

## Asignar el equipo

1. Abre la ficha del servicio y baja a la tarjeta **Equipos en comodato**.
2. Toca «Asignar equipo».
3. Escribe la serie o la MAC en el buscador («Busca por serie o MAC») y elige el equipo en **Equipo disponible**. Cada opción dice su bodega, si es nuevo o usado y su costo.
4. **Fecha**: opcional; si no la pones, es hoy. No puede ser futura.
5. Toca «Asignar».

**Qué pasa:** el equipo sale de su bodega y queda **en comodato** con el servicio. Contablemente pasa a activo fijo y se deprecia desde el mes siguiente.

## Devolver el equipo

1. En la misma tarjeta, toca «Devolver» en la fila del equipo.
2. Elige la **Bodega que lo recibe** (normalmente la tuya).
3. **Condición**: nuevo o usado.
4. Activa «Entra a reparación» si viene dañado: cuenta en la bodega, pero no se presta hasta marcarlo reparado.
5. **Fecha** y **Nota**, opcionales.
6. Toca «Devolver».

**Qué pasa:** el equipo vuelve a la bodega a su valor en libros y deja de estar ligado al servicio.

## Al retirar un servicio

Cuando un servicio se retira, sus equipos en comodato pasan solos a **Por recuperar**. Aparecen en **Inventario → Por recuperar** y en la ficha del servicio con la etiqueta «Por recuperar». Cuando los recojas, usa «Devolver».

Si el equipo no se puede recuperar, quien tenga `inventario.declarar_perdida_comodato` puede declarar su pérdida en la misma fila. El rol `tecnico` no trae ese permiso.

## Si algo sale mal

| Mensaje                                       | Causa                                                                                | Qué hacer                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| «No hay equipos disponibles con esa búsqueda» | La serie o MAC no está disponible (ya está prestado, en reparación o no se registró) | Revisa en **Inventario → Equipos por serie** dónde está |
| Error de servicio retirado                    | A un servicio retirado no se le asignan equipos                                      | Asígnalo al servicio vigente del cliente                |
| Error de fecha                                | Futura o anterior al último movimiento del equipo, o el mes contable está bloqueado  | Corrige la fecha o pregunta a contabilidad              |
| No aparece la tarjeta **Equipos en comodato** | No tienes `inventario.ver`                                                           | Pide el permiso                                         |

## Relacionado

- [Recibir un traslado en tu bodega](./recibir-traslado.md)
- [Manual de inventario](../../manual/inventario/)
