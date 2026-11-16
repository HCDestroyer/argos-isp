---
orden: 6
---

# Cerrar la caja y cuadrar

Al terminar, tu turno queda cerrado con el efectivo que contaste, el esperado que calculó ArgosIsp y la diferencia, si la hubo.

## Antes de empezar

- Permiso: `cajas.cerrar` (rol `cajero`).
- Termina los cobros del turno. Si vas a depositar efectivo al banco, hazlo antes de cerrar con «Depositar al banco».
- Cuenta todo el efectivo de la caja, **fondo inicial incluido**.

## Pasos

1. Abre **Caja**. En la tarjeta de tu caja abierta revisa el **Esperado en caja**: fondo inicial + efectivo cobrado − egresos en efectivo − depósitos al banco del turno. Es provisional; el oficial lo calcula ArgosIsp al cerrar.
2. Toca «Cerrar caja».
3. Escribe en **Efectivo contado** todo lo que hay en la caja. Si prefieres, activa «Contar por denominación» y escribe cuántos billetes y monedas hay de cada uno; el total se suma solo.
4. Arriba ves **Esperado**, **Contado** y **Diferencia**: «Cuadra», «Faltante Q …» o «Sobrante Q …».
5. Si no cuadra, escribe el **Motivo de la diferencia**, por ejemplo «faltaron Q 5.00, vuelto mal entregado». Es obligatorio cuando hay diferencia.
6. Toca «Cerrar caja».

![Ventana de cierre de caja con esperado, contado, diferencia, el efectivo contado y el motivo](/capturas/cajero/cierre-caja.png)

## Qué pasa después

- Aviso «Turno cerrado» con la diferencia. La caja queda **Cerrada** y aparece el resultado oficial del cierre, con su motivo si lo hubo.
- El turno pasa a la lista **Turnos de _caja_** con su fondo, esperado, contado y diferencia.
- Si hubo **faltante o sobrante**, ArgosIsp registra el asiento en el libro (faltantes o sobrantes de caja) con tu motivo.
- Los cobros que lleguen después ya no entran a ese turno: para cobrar en efectivo otra vez, hay que abrir la caja.

## Si algo sale mal

| Mensaje                                              | Causa                                    | Qué hacer                                                                   |
| ---------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| «Hay una diferencia de Q…: el motivo es obligatorio» | Lo contado no es igual al esperado       | Vuelve a contar; si sigue, escribe el motivo                                |
| «Sin turno abierto»                                  | La caja ya estaba cerrada                | Revisa la lista de turnos: ya está cerrado                                  |
| «Sin esperado provisional»                           | No se pudieron leer los cobros del turno | Puedes cerrar igual: ArgosIsp calcula el esperado y la diferencia al cerrar |

::: warning Un error de cierre no se edita
Si cerraste con un monto equivocado, no se puede cambiar el cierre. Avisa a contabilidad: lo corrigen con un asiento.
:::

## Relacionado

- [Abrir la caja](./abrir-caja.md)
- [Runbook de cierre de caja](../../runbooks/cierre-de-caja.md)
- [Manual de cobros](../../manual/cobros/)
