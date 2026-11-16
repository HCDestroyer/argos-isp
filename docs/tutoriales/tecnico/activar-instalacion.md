---
orden: 2
---

# Activar un servicio pendiente de instalación

Al terminar, el servicio pasa a **Activo**: navega con su plan completo y la facturación empieza desde el día de la instalación.

Un servicio **Pendiente de instalación** (azul) ya tiene usuario PPPoE, router, plan e IP para configurar el equipo, pero no navega ni se factura.

## Antes de empezar

- Permiso: `servicios.activar_instalacion` (roles `tecnico`, `soporte` y `admin`).
- Configura el equipo del cliente con el usuario y la contraseña PPPoE del servicio (en su ficha, **Credenciales PPPoE**).

## Pasos

1. Abre la ficha del servicio. Arriba verás el aviso «Pendiente de instalación».
2. Toca «Activar instalación».
3. En **Instalado el** deja la fecha y hora de hoy o corrígela si instalaste antes. No puede ser futura ni anterior al día en que se creó el servicio.
4. Si quieres, abre «Datos de planta (opcional)» y anota **Caja (NAP)**, **Puerto**, **OLT**, **Slot**, **PON** y **Potencia óptica**.
5. Toca «Activar instalación».

## Qué pasa después

- El servicio queda **Activo** y el router le da navegación completa. Si el equipo ya estaba conectado, se vuelve a conectar solo.
- La facturación arranca desde la fecha de instalación (con prorrateo si la plantilla lo usa).
- Una factura que se emitió antes, como el cobro de la instalación, no vence el mismo día de la instalación: vence después de los días de gracia de la plantilla.
- Desde ahora aplican el corte, la mora y las promesas como en cualquier servicio.

## Si algo sale mal

| Mensaje                                        | Causa                                                | Qué hacer                           |
| ---------------------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| «El servicio no está pendiente de instalación» | Alguien ya lo activó o lo retiró                     | Recarga la ficha y revisa su estado |
| Error en **Instalado el**                      | Fecha futura o anterior al alta                      | Corrige la fecha                    |
| Conflicto de versión                           | El servicio cambió mientras tanto                    | Recarga la ficha y vuelve a activar |
| No aparece «Activar instalación»               | No tienes el permiso o el servicio no está pendiente | Pide ayuda a soporte                |

::: tip Si la venta se cae
Un servicio pendiente se puede retirar si el cliente ya no lo quiere (ver [Retirar un servicio](./retirar-servicio.md)). Mientras está pendiente no se puede suspender, limitar, reactivar ni desconectar.
:::

## Relacionado

- [Dar de alta un servicio nuevo](./instalar-servicio-nuevo.md)
- [Asignar y devolver un equipo en comodato](./equipo-en-comodato.md)
