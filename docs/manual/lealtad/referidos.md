---
orden: 3
pantallas:
    - /lealtad/referidos
---

# Referidos

Un cliente trae a otro con su código de referido y, cuando el nuevo cliente paga sus primeras facturas, los dos pueden ganar puntos. Aquí ves quién refirió a quién y en qué va cada referido.

Menú: **Cobros → Lealtad → Referidos**.

## Quién la usa

- Ver: `lealtad.ver` (`admin`, `contabilidad`, `cajero`, `soporte` y `lectura`).
- Rechazar un referido: `lealtad.ajustar` (`admin` y `contabilidad`).

## Cómo llega un referido

1. Cada cliente tiene un código de referido de 8 caracteres en cada empresa donde tiene servicio. Se crea solo con su primer servicio en la empresa.
2. Al crear al cliente nuevo se escribe ese código.
3. Cuando el cliente nuevo tiene su primer servicio en esa empresa, el referido aparece aquí como «Pendiente», aunque la empresa todavía no tenga programa.
4. Cuando el referido paga las facturas que pide la regla «Referido» del [programa](./programa.md), dentro del plazo, pasa a «Calificado» y se otorgan los puntos: al que refirió y, si la regla tiene bono, al referido.

Un cliente no puede referirse a sí mismo ni a otro con su mismo NIT o CUI.

## Qué ves

Una fila por referido con su nombre, el código usado, la fecha, quién lo refirió y su estado. Los nombres llevan a la pestaña de puntos de cada cliente. Filtro por estado.

| Estado     | Qué significa                                                              |
| ---------- | -------------------------------------------------------------------------- |
| Pendiente  | Todavía no paga las facturas que pide la regla.                            |
| Calificado | Cumplió; se otorgaron los puntos. Debajo verás la fecha.                   |
| Rechazado  | Se rechazó a mano, venció el plazo o se retiró sin servicio en la empresa. |

Si se anula un pago y el referido queda sin las facturas pagadas que pide la regla, sus puntos se quitan y vuelve a «Pendiente».

## Acciones

### Rechazar

- **Permiso:** `lealtad.ajustar`.
- **Dónde:** botón «Rechazar» en un referido pendiente o calificado. Pide motivo (por ejemplo, «es el mismo hogar que el cliente que lo refirió»).
- **Qué pasa:** el referido queda rechazado y se quitan los puntos que se otorgaron por él, al que refirió y al referido.

::: danger No se deshace
Un referido rechazado no vuelve a pendiente ni a calificado.
:::

Si las notificaciones están configuradas, el cliente que refirió recibe un aviso cuando su referido califica.

## Relacionado

- [Programa de lealtad](./programa.md)
- [Clientes y servicios](../clientes-y-servicios/index.md)
