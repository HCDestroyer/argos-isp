---
orden: 4
---

# Cambiar el plan de un servicio

Al terminar, el servicio tiene el plan nuevo y el router le aplica la velocidad nueva.

## Antes de empezar

- Permiso: `servicios.editar` (roles `soporte` y `tecnico`).
- El plan nuevo tiene que estar disponible en el router del servicio.

## Pasos

1. Abre la ficha del servicio (ficha del cliente → **Servicios** → el servicio).
2. Toca «Editar» en la barra de arriba.
3. En **Plan** elige el nuevo. La lista muestra solo los planes disponibles en este router.
4. Si el cliente tiene un precio distinto al del plan, revisa **Precio especial** (vacío = el precio del plan).
5. Toca «Guardar cambios».

## Qué pasa después

- Aviso de que se guardó y la ficha muestra el plan nuevo en **Plan y facturación**.
- La velocidad nueva se aplica sola en el router, sin que nadie toque el MikroTik. Según cómo esté configurado el router, la sesión del cliente puede cerrarse unos segundos y volver a conectarse.
- Si el servicio está suspendido, sigue suspendido: el plan nuevo rige cuando se reactive.
- Los adicionales incluidos en el plan se ajustan al plan nuevo: los que el nuevo no trae se dan de baja y los que trae se agregan. Los de cortesía o cobrados se conservan.
- El cambio queda en el **Historial de cambios** de la [bitácora](../../manual/general/bitacora.md) con el plan anterior y el nuevo.

## Si algo sale mal

| Mensaje                        | Causa                                                                  | Qué hacer                                                      |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| El plan que buscas no aparece  | No está implementado en este router                                    | Pide a un técnico que lo agregue al router en **Red → Planes** |
| Error por plan temporal activo | El servicio tiene un plan temporal (por ejemplo, un premio de lealtad) | Primero cancela el plan temporal en la ficha del servicio      |
| Plan inactivo                  | Ese plan se desactivó                                                  | Elige otro                                                     |
| Conflicto de versión           | Otra persona editó el servicio mientras tanto                          | Recarga la ficha y vuelve a hacer el cambio                    |
| No aparece «Editar»            | No tienes `servicios.editar` o el servicio está retirado               | Pide ayuda a un supervisor                                     |

## Relacionado

- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
- [Manual de red](../../manual/red/)
