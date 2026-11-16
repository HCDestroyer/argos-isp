---
orden: 6
---

# Conoce el panel

El panel es la página donde trabaja el personal del ISP. Funciona en la computadora y en el teléfono. Aquí está lo que se repite en todas las pantallas.

![Pantalla de cobro con el menú a la izquierda y la barra de arriba con el acceso a la caja, el botón Ayuda y el cambio de modo claro u oscuro](/capturas/cajero/cobro-cliente.png)

## El menú

A la izquierda, en la computadora; en el teléfono se abre con el botón de tres rayas de arriba.

- **Inicio** arriba de todo. Al cajero lo lleva a su **Caja**.
- **Cobrar** y **Caja**, sueltos, siempre a la vista para quien cobra.
- Los grupos: **Operación**, **Cobros**, **Contabilidad**, **Compras**, **Inventario**, **Bancos**, **Red**, **Reportes y bitácora** y **Configuración**. El grupo de la pantalla donde estás se abre solo.
- Un número junto a una sección avisa que hay algo pendiente. Por ejemplo, junto a **Comprobantes**, los que esperan verificación.
- El botón de la barra de arriba con un cuadro y una flecha deja el menú **compacto**, solo con iconos. El panel lo recuerda para tu usuario.
- Abajo, tu nombre abre el menú de tu cuenta: **Mi cuenta**, **Apariencia**, **Qué cambió** y **Cerrar sesión** (ver [Mi cuenta](../manual/general/perfil.md)).

## El buscador

**Buscar** (arriba del menú) o las teclas **Ctrl + K** (**Cmd + K** en Mac) abren el buscador de secciones. Escribe parte del nombre («caja», «facturas», «routers») y pulsa Enter. Solo muestra las secciones que puedes abrir.

Para buscar **clientes** usa la pantalla **Clientes** o **Cobrar**: buscan por nombre, NIT, teléfono, usuario PPP o IP.

## La barra de arriba

Cada pantalla tiene arriba su título y, a la derecha:

- **El selector de empresa**, si trabajas con varias (ver abajo).
- **El acceso a la caja**, si tienes caja: dice «Caja abierta» en verde o «Caja cerrada», y te lleva a **Caja**.
- **Los botones de la pantalla** (por ejemplo, «Nuevo cliente» o «Editar»).
- **Ayuda** (ver abajo).
- **El botón de sol o luna** para pasar a modo claro u oscuro.

## La empresa activa

Si tu usuario trabaja con varias empresas (varios NIT), arriba aparece el selector de empresa. En el teléfono va en su propia fila, debajo de la barra.

- Todo lo que ves y creas es de la empresa elegida: clientes, servicios, facturas, cajas, anuncios.
- **«Todas las empresas»** muestra todo junto (el consolidado). Solo aparece si tu usuario tiene alcance sobre todas. Algunas cosas no se pueden crear así, como un anuncio: el panel te pide elegir una empresa.
- Al cambiar de empresa, la pantalla vuelve a cargar sus datos sin cerrar tu sesión.

Con una sola empresa el selector no aparece.

## Permisos: por qué no ves un botón

Cada acción del panel tiene un permiso con su nombre (por ejemplo, `servicios.suspender` o `pagos.anular`). Los roles agrupan permisos: `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad` y `lectura`. Un usuario puede tener varios roles.

- **Si no tienes el permiso de una sección, no aparece en el menú** ni en el buscador ni en los accesos del Inicio.
- **Si no tienes el permiso de una acción, su botón no aparece.** Por ejemplo, el rol `cajero` no ve «Suspender» en la ficha de un servicio ni «Anular pago» en un pago.
- Algunos botones dependen también del estado. Por ejemplo, «Reactivar» solo aparece en un servicio suspendido y «Publicar» no aparece en un anuncio ya publicado.
- Unos pocos botones se ven desactivados con un «¿Por qué?» al lado que explica la razón (por ejemplo, «Ver en Horus» cuando la integración está apagada).
- Si abres un enlace a una pantalla sin tener su permiso, ves «No tienes acceso a esta sección», el permiso que hace falta («Permiso requerido: …») y «Volver al inicio». No se muestra ningún dato.

Si necesitas un permiso, pídelo a un administrador con el nombre exacto que te muestra el panel. Hay permisos que además se limitan a un router, una zona o una caja.

## Los avisos

- **Después de cada acción** aparece un aviso abajo que dice qué pasó: «Pago registrado», «Turno abierto», «Servicio suspendido». Los verdes salieron bien.
- **Si algo falla**, el aviso o un recuadro rojo dice qué pasó y qué hacer. Los errores de un formulario aparecen junto a su campo.
- **Si una pantalla no pudo leer sus datos**, muestra el error con «Reintentar». El panel nunca muestra totales ni estados inventados cuando no pudo leerlos.
- **Cuando ArgosIsp se actualiza**, la primera vez que entras aparece «ArgosIsp se actualizó a la versión …» con el botón «Qué cambió».
- **Cuando tu sesión está por llegar a su tope de 3 días**, aparece un aviso. Si vence, una ventana te pide tu contraseña sin perder lo que estabas haciendo.

## Modo claro y oscuro

El botón de sol o luna de la barra cambia el modo. También en el menú de tu nombre → **Apariencia**: **Claro**, **Oscuro** o **Sistema** (sigue el de tu teléfono o computadora).

## El botón Ayuda

Cada pantalla tiene el botón **Ayuda** en la barra de arriba (en el teléfono, solo el icono del signo de pregunta). Abre en otra pestaña la página de este manual que explica esa pantalla. Si la pantalla todavía no tiene su página, abre el inicio del manual.

## Fechas y montos

- Las fechas y horas se muestran en hora de Guatemala.
- Los montos van en quetzales con dos decimales: `Q 150.00`.

## Relacionado

- [Qué es ArgosIsp](./que-es-argosisp.md)
- [Glosario](./glosario.md)
- [Inicio](../manual/general/inicio.md)
