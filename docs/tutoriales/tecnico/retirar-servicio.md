---
orden: 6
---

# Retirar un servicio

Al terminar, el servicio queda **Retirado** (baja definitiva): ya no navega, sus IP quedan libres y sus equipos en comodato quedan por recuperar.

::: danger No se puede deshacer
Un servicio retirado no se reactiva. Si el cliente vuelve, hay que darle un servicio nuevo.
:::

## Antes de empezar

- Permiso: `servicios.retirar`. **El rol `tecnico` no lo trae** (tampoco `soporte`): lo tiene `admin`. Si eres técnico, pide el retiro a un administrador con el número del servicio y el motivo, o pide que te den el permiso.
- Revisa con cobros si el cliente tiene saldo pendiente: retirar no borra sus facturas.

## Pasos

1. Abre la ficha del servicio.
2. Toca «Retirar».
3. Lee el aviso: «Baja definitiva: se liberan la IPv4 y los prefijos IPv6 y no se puede deshacer».
4. Escribe el **Motivo** (al menos 3 caracteres), por ejemplo «cliente se muda fuera de cobertura».
5. Toca «Retirar servicio».

## Qué pasa después

- Aviso «Servicio retirado» y el estado pasa a **Retirado** (gris).
- La sesión se cierra y el router ya no lo deja conectarse.
- La IPv4 y los prefijos IPv6 se liberan; quedan en el historial de asignaciones.
- Sus adicionales activos se dan de baja y un plan temporal, si tenía, se cancela.
- Sus equipos en comodato pasan a **Por recuperar**. Cuando los recojas, [devuélvelos a tu bodega](./equipo-en-comodato.md).
- Las facturas que deba siguen en su estado de cuenta.

::: tip ¿Nunca se usó?
Un servicio que nunca se usó (sin facturas, pagos, sesiones ni otro historial) se puede **eliminar** en lugar de retirar, con `servicios.eliminar` (solo admin). La ficha dice si se puede y por qué no.
:::

## Si algo sale mal

| Situación              | Causa                                            | Qué hacer                         |
| ---------------------- | ------------------------------------------------ | --------------------------------- |
| No aparece «Retirar»   | No tienes `servicios.retirar` o ya está retirado | Pide el retiro a un administrador |
| El motivo es muy corto | Debe tener al menos 3 caracteres                 | Escribe un motivo claro           |

## Relacionado

- [Asignar y devolver un equipo en comodato](./equipo-en-comodato.md)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
