---
orden: 3
---

# Crear una promesa de pago

Al terminar, la promesa queda registrada con el resultado de su evaluación y, si se aprobó, el servicio vuelve a navegar hasta la fecha prometida.

Una promesa **cubre todo lo vencido** del servicio: nadie escribe el monto. Las reglas de la plantilla de facturación deciden si se aprueba, queda pendiente de aprobación o se rechaza.

## Antes de empezar

- Permisos: `promesas.crear` y `promesas.ver` (roles `soporte` y `cajero`).
- El servicio debe tener facturas vencidas y no tener otra promesa activa o pendiente.

## Pasos

1. Abre la ficha del servicio (desde la ficha del cliente → **Servicios**).
2. Toca «Promesa de pago».
3. Revisa lo que cubre: las facturas vencidas, el total, el abono inicial que pide la plantilla y lo ya abonado, y la fecha máxima.
4. En **Pagará a más tardar** elige la fecha. Viene puesta en 3 días; no puede pasar de la fecha máxima que permite la plantilla.
5. **Canal**: deja «Operador». «Supervisor» solo aparece si tienes `promesas.aprobar` y sus límites son más amplios.
6. Toca «Crear promesa».
7. La ventana muestra el **Resultado de la promesa**: su estado, la regla que decidió y las reglas revisadas. Toca «Listo», o «Probar otra fecha» si se rechazó por la fecha.

## Qué pasa después

| Resultado           | Estado                      | Qué pasa                                                                        |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Aprobada            | **Activa**                  | El servicio se reactiva al momento y el cliente navega hasta la fecha           |
| Necesita aprobación | **Pendiente de aprobación** | Espera a que alguien con `promesas.aprobar` la apruebe en **Cobros → Promesas** |
| Rechazada           | **Rechazada**               | El servicio sigue igual; el resultado dice exactamente qué regla falló          |

- La promesa se **cumple** sola cuando se pagan todas las facturas que cubre.
- Si llega la fecha y no pagó, queda **incumplida** y el servicio vuelve a evaluarse con las reglas de corte.
- Si el servicio tiene **suspensión manual**, la promesa queda activa pero el servicio sigue suspendido hasta que alguien toque «Reactivar».

## Si algo sale mal

| Mensaje                                                         | Causa                                                                      | Qué hacer                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| «El servicio no tiene facturas vencidas: no hace falta promesa» | No hay nada vencido                                                        | No hace falta promesa                                |
| «Falta abonar Q … antes de prometer»                            | La plantilla pide un abono inicial                                         | Registra el abono en **Cobrar** y vuelve a intentar  |
| «…: ciérrala antes de crear otra»                               | Ya tiene una promesa activa o pendiente                                    | Revisa la promesa existente en **Cobros → Promesas** |
| Error en la fecha                                               | La fecha ya pasó o supera la máxima                                        | Elige otra fecha                                     |
| No aparece «Promesa de pago»                                    | No tienes el permiso, el servicio está pendiente de instalación o retirado | Pide ayuda a un supervisor                           |

::: tip Simular antes de crear
«Simular promesa» (con `promesas.ver`) te deja probar fechas y ver qué regla aplicaría sin crear nada.
:::

## Relacionado

- [Atender un «no tengo internet»](./no-tengo-internet.md)
- [Manual de cobros](../../manual/cobros/)
