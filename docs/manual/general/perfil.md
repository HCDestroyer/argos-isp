---
orden: 3
pantallas:
    - /perfil
---

# Mi cuenta

Tus datos de usuario y las cuentas de otros sistemas vinculadas a la tuya. Se abre desde el menú de tu nombre (abajo en la barra lateral) → **Mi cuenta**.

## Quién la usa

Cualquier usuario con sesión. No pide permiso: cada quien ve solo su propia cuenta.

## Qué ves

### Mis datos

Tu **Nombre**, tu **Correo** y tus **Roles** (por ejemplo, `cajero` o `soporte`). Estos datos no se cambian aquí: los cambia un administrador en **Configuración → Usuarios**.

### Cuentas vinculadas

Las cuentas de otros sistemas de la familia (hoy, **Horus Flow**) con las que entras a ArgosIsp sin volver a escribir la contraseña. Columnas: **Sistema**, **Cuenta en el otro sistema** (nombre y correo de esa cuenta) y **Vinculada** (fecha).

Una cuenta se vincula sola la primera vez que abres ArgosIsp desde Horus («Ver en ArgosIsp») e inicias sesión. Si no tienes ninguna, dice «Sin cuentas vinculadas».

## Acciones

### Quitar una vinculación

- **Permiso:** ninguno; solo las tuyas.
- **Dónde:** botón «Quitar» en la fila de la cuenta vinculada.
- **Qué pasa:** pide confirmación («Quitar vinculación»). Al confirmar, esa cuenta ya no abre ArgosIsp sin contraseña; la próxima vez que entres desde ese sistema te pedirá la contraseña. Se puede volver a vincular entrando desde Horus e iniciando sesión.
- El administrador puede quitar las de todos desde **Configuración → Integraciones**.

## Tu sesión

- La sesión se mantiene abierta mientras usas el panel. Si pasas **12 horas** sin usarlo, vence.
- Aunque lo uses todo el tiempo, la sesión dura como máximo **3 días** desde que entraste. Unos 15 minutos antes de ese tope aparece un aviso.
- Cuando la sesión vence, se abre una ventana que te pide **tu contraseña** para seguir. La pantalla de debajo no se pierde: tus filtros y lo que estabas escribiendo siguen ahí y, al desbloquear, el panel repite lo que no se pudo guardar.
- Para salir, menú de tu nombre → **Cerrar sesión**. Eso cierra la sesión también en el servidor, no solo en tu navegador.
- Si un administrador desactiva tu usuario, la sesión se corta en tu siguiente clic.

::: tip Lo que no está en esta pantalla
Hoy **Mi cuenta** no tiene cambio de contraseña, verificación en dos pasos (MFA) ni lista de sesiones abiertas. Si necesitas una contraseña nueva, pídela a un administrador.
:::

## Otras opciones del menú de tu nombre

- **Apariencia:** Claro, Oscuro o Sistema (sigue el modo de tu teléfono o computadora).
- **Qué cambió:** las novedades de la versión instalada. Cuando ArgosIsp se actualiza, la primera vez que entras aparece un aviso «ArgosIsp se actualizó a la versión …» con el mismo botón.
- **Cerrar sesión.**

## Preguntas frecuentes y errores

- **Aviso de error con «Reintentar» en Cuentas vinculadas.** No se pudo leer la lista. Reintenta; tus datos de arriba no cambian.
- **«No me deja cambiar mi correo».** Lo cambia un administrador en **Configuración → Usuarios**.

## Relacionado

- [Conoce el panel](../../guia/conoce-el-panel.md)
- [Usuarios y roles](../usuarios/)
