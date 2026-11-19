---
orden: 7
---

# Entrar con documento y contraseña

El cliente puede entrar a su cuenta del portal de tres formas. Las tres llevan al mismo lugar: sus facturas, pagos y datos.

| Forma | Qué escribe el cliente | Cuándo sirve |
| --- | --- | --- |
| **Documento y contraseña** | Su NIT, CUI o pasaporte y su contraseña | Siempre, desde cualquier conexión |
| **Código** | Su NIT, CUI o usuario de conexión y un código de 6 dígitos que le llega al correo o Telegram | Cuando no sabe su contraseña |
| **«Ver mi cuenta»** en la página de corte | Nada | Desde su propia conexión, cuando la página de corte ya reconoció su servicio |

## La contraseña de la empresa

Para que los clientes puedan entrar desde el primer día, el administrador define **una contraseña por defecto** para la empresa. Todo cliente que todavía no tiene contraseña propia entra con su documento y esa contraseña.

- La primera vez que el cliente entra con ella, el portal **le pide elegir una propia** antes de dejarlo ver nada más. Puede salir si no quiere hacerlo ahora, pero no puede ver su cuenta hasta cambiarla.
- La nueva debe tener al menos 8 caracteres y no puede ser la de la empresa ni su número de documento.
- Cambiar la contraseña de la empresa no afecta a los clientes que ya eligieron la suya.

Por qué el cambio es obligatorio: la contraseña de la empresa la conocen todos los clientes y el personal. Mientras un cliente la use, cualquiera que sepa su documento (que aparece en facturas y recibos) podría ver sus datos. Al elegir una propia, solo él puede entrar.

### Dónde se configura

En el panel, en la configuración de la empresa, sección **Contraseña del portal**. Solo el administrador puede cambiarla (permiso `portal.configurar_contrasena_defecto`). El sistema nunca la vuelve a mostrar: guarda solo una huella cifrada. Si la olvidas, escribe una nueva.

Si la empresa no tiene contraseña por defecto, los clientes que aún no eligieron la suya solo pueden entrar con código o con «Ver mi cuenta».

## Cuando el cliente olvida su contraseña

Tiene dos caminos:

1. **Entrar con un código** (pestaña **Código** en **Entrar**) y, ya dentro, ir a **Cuenta** → «Cambiar contraseña». Para cambiarla le pide la actual: si no la recuerda, usa el camino 2.
2. **Pedir a soporte que la restaure.** En la ficha del cliente, «Restaurar contraseña del portal» (permiso `clientes.restaurar_contrasena_portal`, lo tienen administrador y soporte). Desde ese momento entra otra vez con la contraseña de la empresa y el portal le pide elegir una nueva. Restaurar también cierra las sesiones del portal que tuviera abiertas.

::: tip Al restaurar
Dile al cliente la contraseña de la empresa por un canal seguro (en persona o por teléfono al número registrado). Si el panel avisa que la empresa no tiene contraseña por defecto, configúrala primero o pídele que entre con código.
:::

## «Ver mi cuenta» desde la página de corte

Cuando la [página de corte](./pagina-de-corte.md) reconoce el servicio del cliente, el botón **«Ver mi cuenta»** abre su cuenta sin pedirle nada.

- Solo funciona si en ese momento la conexión es la de su servicio (su sesión de internet está activa con esa dirección) o si llegó con el código de corte que pone el router.
- La sesión dura como máximo 15 minutos. Para quedarse más tiempo, que entre con su documento y contraseña.
- Si el portal no logra confirmar la conexión, le ofrece entrar con documento o código.

## Qué hace el portal para proteger la cuenta

- **Mensaje igual para todo error.** Si el documento no existe o la contraseña está mal, el mensaje es el mismo: «El documento o la contraseña no son correctos». Así nadie puede averiguar qué documentos son de clientes.
- **Límite de intentos.** Tras 5 intentos fallidos con el mismo documento, o 20 desde la misma conexión, el portal espera 15 minutos antes de dejar intentar otra vez.
- **El documento se escribe como sea.** Con o sin guion, con espacios, en mayúsculas o minúsculas. «CF» no sirve para entrar.
- **Documento repetido.** Si dos clientes tienen el mismo documento, la contraseña de la empresa no sirve para ninguno (el portal no sabría de quién es la cuenta). Cada uno entra con código y elige su propia contraseña; desde entonces entra con documento y su contraseña.
- **Todo queda en la bitácora**, con el canal «portal»: cada entrada, cada cambio y cada restauración. Las contraseñas nunca se guardan ni se muestran: en la bitácora aparecen como `***`.

## Varias empresas

El portal es uno para todas las empresas de la instalación. El cliente entra con su documento sin importar de qué empresa son sus servicios, y la contraseña por defecto que le sirve es la de cualquiera de las empresas donde tiene servicios. Si el enlace al portal lleva la empresa (`/entrar?empresa=2`, por ejemplo desde el sitio de esa empresa), solo entran sus clientes y con la contraseña de esa empresa.

## Sección técnica (administrador)

- Endpoints, reglas y variables: `apps/api/app/portal/README.md`, sección «Acceso con documento y contraseña».
- Variables: `PORTAL_CONTRASENA_FALLOS_DOCUMENTO` (5), `PORTAL_CONTRASENA_FALLOS_IP` (20), `PORTAL_CONTRASENA_VENTANA_S` (900) y `PORTAL_SESION_CORTE_MAX_S` (900).
