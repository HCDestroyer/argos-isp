---
orden: 3
---

# Cobrar a un responsable de pago

Al terminar, un solo pago cubre las facturas del cliente que viene a pagar y las de los clientes por los que él paga.

Un **responsable de pago** es el cliente que paga las facturas de otro (por ejemplo, la mamá que paga el servicio de su hija). Es solo una ayuda para el cobro: cualquiera puede pagar cualquier factura.

## Antes de empezar

- Permiso: `pagos.registrar` y `clientes.estado_cuenta` (rol `cajero`).
- Para cobrar en efectivo, tu caja abierta.
- Para que los dependientes aparezcan solos, el responsable debe estar asignado en la ficha de cada dependiente (ver abajo).

## Pasos

1. Abre **Cobrar** y busca al cliente que paga (el responsable).
2. Debajo de sus facturas aparece un grupo por cada cliente del que es responsable: «Responsable de pago de: _nombre_», con lo pendiente y cuántos avisos vencidos tiene.
3. Abre el grupo para ver sus facturas y marca las que paga. La casilla junto al nombre marca todas las de ese cliente.
4. ¿Paga también a alguien que no es su dependiente? Toca «Agregar facturas de otro cliente», búscalo y marca sus facturas. Ese grupo se puede quitar con la **X**.
5. Revisa el **Monto**: es la suma de todo lo marcado.
6. Elige el **Método** y toca «Registrar pago».
7. Imprime el recibo.

## Qué pasa después

- El pago queda a nombre de quien pagó y se aplica a las facturas de cada cliente marcadas.
- Cada servicio que ya no debe nada vencido se reactiva solo, aunque sea de otro cliente.

## Asignar el responsable de pago

Lo hace quien tiene `clientes.asignar_responsable_pago` (roles `cajero` y `soporte`):

1. Abre la ficha del cliente dependiente (**Operación → Clientes**).
2. En la tarjeta **Responsable de pago**, toca «Asignar responsable».
3. Busca al responsable, escribe el **Motivo** (por ejemplo, «la mamá paga el servicio de la hija») y toca «Asignar».

Para quitarlo, «Quitar» en la misma tarjeta: el cliente vuelve a pagar sus propias facturas.

## Si algo sale mal

| Situación                             | Causa                                                                                                  | Qué hacer                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| No aparece el grupo del dependiente   | No tiene asignado ese responsable                                                                      | Usa «Agregar facturas de otro cliente» o asigna el responsable |
| No deja asignar el responsable        | Solo hay un nivel: un dependiente no puede ser responsable de otro ni un responsable tener responsable | Asigna directamente al que paga                                |
| «No tienes caja abierta en _empresa_» | Las facturas son de otra empresa                                                                       | Abre una caja de esa empresa o desmarca esas facturas          |

## Relacionado

- [Cobrar una o varias facturas](./cobrar-facturas.md)
- [Manual de clientes](../../manual/clientes-y-servicios/)
