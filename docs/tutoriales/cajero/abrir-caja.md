---
orden: 1
---

# Abrir la caja

Al terminar, tu caja tiene un turno abierto con el fondo inicial y ya puedes cobrar en efectivo.

## Antes de empezar

- Permiso: `cajas.abrir` (lo trae el rol `cajero`).
- Ten contado el efectivo con el que empiezas: el fondo para dar vuelto.

## Pasos

1. Entra al panel. Si tu rol es `cajero`, entras directo a **Caja**; si no, ábrela en el menú.
2. Arriba, elige tu caja. Cada tarjeta dice «Turno abierto» o «Cerrada», y la tuya dice «Tu caja».
3. Si está cerrada, toca «Abrir caja» (en la barra de arriba o en el centro de la pantalla).
4. En **Fondo inicial** escribe el efectivo con el que empiezas, por ejemplo `500.00`.
5. Toca «Abrir caja».

![Caja abierta con el fondo inicial, los cobros en efectivo y el esperado en caja](/capturas/cajero/caja.png)

## Qué pasa después

- Aparece el aviso «Turno abierto» y la tarjeta «_Caja_ abierta» con el número de turno y la hora.
- Desde ahora, cada cobro en efectivo entra a este turno. En la tarjeta ves el **Fondo inicial**, los **Cobros en efectivo**, el **Efectivo cobrado**, los **Egresos en efectivo**, lo **Depositado al banco** y el **Esperado en caja**.
- En la barra de arriba de cualquier pantalla verás «Caja abierta» en verde.

## Si algo sale mal

| Mensaje                                     | Causa                               | Qué hacer                                             |
| ------------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| «Turno abierto» (la caja ya tiene un turno) | Alguien no cerró el turno anterior  | No abras otro: avisa al supervisor para que lo cierre |
| La caja está inactiva                       | La desactivaron                     | Pide al administrador que la active o te asigne otra  |
| «No hay cajas»                              | La empresa no tiene cajas           | Pide al administrador que cree una                    |
| No ves el botón «Abrir caja»                | No tienes `cajas.abrir`             | Pide a un supervisor que la abra                      |
| Monto inválido en el fondo                  | Negativo o con más de dos decimales | Escríbelo como `500.00`                               |

## Relacionado

- [Cerrar la caja y cuadrar](./cerrar-caja.md)
- [Cobrar una o varias facturas](./cobrar-facturas.md)
- [Runbook de cierre de caja](../../runbooks/cierre-de-caja.md)
- [Manual de cobros](../../manual/cobros/)
