---
orden: 6
---

# Conoce el panel

El panel es la página donde trabaja el personal del ISP. Funciona en la computadora y en el teléfono. Aquí está lo que se repite en todas las pantallas.

![Pantalla de cobro con el menú a la izquierda y la barra de arriba con el acceso a la caja, el botón Ayuda y el cambio de modo claro u oscuro](/capturas/cajero/cobro-cliente.png)

## El menú

A la izquierda, como una isla. Tiene dos formas y cada persona elige la suya (el panel la recuerda): el botón **‹ / ›** del propio menú o el de plegar en la barra de arriba la cambian.

- **Compacto** (la de fábrica): un icono con su nombre corto por área: **Inicio**, **Día a día**, **Facturas**, **Red**, **Inventario**, **Lealtad**, **Finanzas**, **Contable**, **Reportes** y, abajo, **Ajustes**. Al tocar un área se abre a su lado un menú con sus secciones agrupadas y sus contadores (por ejemplo, **Comprobantes 4** o **Caja Abierta**). Se recorre también con el teclado: Tab, flechas, Enter y Esc.
- **Expandido**: los nombres completos, con cada área como un grupo que se abre y se cierra; el del área donde estás se abre solo. Si dejas el puntero sobre una sección, aparece su descripción.
- Un punto junto a un área, o un número junto a una sección, avisa que hay algo pendiente.
- En el teléfono el menú se abre con el botón de tres rayas de arriba, con los nombres completos.

Las áreas: **Día a día** (Cobrar, Caja, Clientes, Servicios, Promesas, Comprobantes), **Facturación** (facturas, pagos, notas de crédito, bonificaciones, cola de DTE, conciliación de la pasarela), **Red** (routers, planes, prioridad QoS, adicionales, migración de router), **Inventario** (Movimientos y Catálogos y kardex), **Clientes y lealtad**, **Finanzas** (egresos, cartera, Bancos y Compras), **Contabilidad y fiscal**, **Reportes** (reportes y bitácora) y **Configuración** (Empresa y fiscal, Facturación y cobro, Red y portal, Usuarios y acceso, Sistema y apariencia, Notificaciones e integraciones; **Toda la configuración** las muestra en una página con buscador).

## Accesos rápidos

En la barra de arriba, a un clic: tus dos primeros accesos y **Más** (el rayo) con el resto, sus contadores y sus atajos **Alt + 1** a **Alt + 9**. **Personalizar mis accesos** elige hasta 12 y los ordena; **Usar los de mi rol** vuelve a los de fábrica (por ejemplo, el cajero: Cobrar, Caja, Clientes y Comprobantes). El **Inicio** muestra los mismos.

## El buscador

**Buscar…** en la barra de arriba o las teclas **Ctrl + K** (**Cmd + K** en Mac) abren el buscador de secciones. Escribe parte del nombre («caja», «facturas», «routers») y pulsa Enter. Solo muestra las secciones que puedes abrir.

Para buscar **clientes** usa la pantalla **Clientes** o **Cobrar**: buscan por nombre, NIT, teléfono, usuario PPP o IP.

## El encabezado de cada pantalla

Las pantallas del menú empiezan con las migas (por dónde llegaste, por ejemplo «Inicio › Facturación › Facturas»), el **título** con el botón **?** de ayuda, una frase que dice para qué sirve y, a la derecha, sus botones (por ejemplo, «Nuevo cliente»). Las fichas (un cliente, un servicio, una factura) tienen el título en la barra de arriba y, debajo, las migas hasta su lista con los botones de la ficha a la derecha.

## Listas: vista rápida y clic derecho

En **Clientes** y **Servicios**, un clic en la fila (fuera del nombre) abre la **vista rápida** a la derecha: un resumen con sus datos y los botones más usados, sin salir de la lista. El clic derecho sobre una fila abre el menú con todas sus acciones, agrupadas («Ver», «Cobro», «Cliente», «Red»). Los iconos al final de la fila hacen lo mismo y dicen su nombre al pasar el puntero.

## La barra de arriba

Liviana, en pastillas: a la izquierda el buscador y los accesos rápidos; a la derecha solo:

- **La caja** (si tienes `cajas.ver`): un icono de billetera con un punto verde si tu caja está abierta o gris si está cerrada. Al tocarlo dice qué caja y desde cuándo está abierta, con el fondo inicial, y ofrece **Ir a la caja** y **Cerrar caja…** o **Abrir caja…** (según tus permisos).
- **El estado del sistema** (solo administradores): un icono con un punto si algo del servidor hay que revisar; lleva a **Salud del sistema**.
- **La campana de avisos**: el número son los comprobantes por verificar.
- **Tu usuario**: tu nombre, tu rol y la empresa activa. Su menú tiene la **Empresa** (si trabajas con varias), el **Tema** (claro, oscuro o como el equipo), **Mi cuenta**, **Ayuda y atajos**, **Qué cambió** y, aparte, **Cerrar sesión**.

## La empresa activa

Si tu usuario trabaja con varias empresas (varios NIT), la eliges en el menú de tu usuario (arriba a la derecha) → **Empresa**; la activa se ve bajo tu nombre.

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

En el menú de tu usuario → **Tema**: **Claro**, **Oscuro** o **Sistema** (sigue el de tu teléfono o computadora). El color del panel y el modo de fábrica los elige el administrador en **Configuración → Sistema y apariencia → Apariencia**.

## El botón Ayuda

Cada pantalla tiene su ayuda: el **?** junto al título (en las fichas, en el menú de tu usuario → **Ayuda y atajos**, que también lista los atajos de teclado). Abre un panel a la derecha con el resumen de esa pantalla tomado de este manual y la lista de temas que explica; **Ver manual completo** abre la página en otra pestaña. Si la pantalla todavía no tiene su resumen, el botón abre directamente el manual.

## Fechas y montos

- Las fechas y horas se muestran en hora de Guatemala.
- Los montos van en quetzales con dos decimales: `Q 150.00`.

## Relacionado

- [Qué es ArgosIsp](./que-es-argosisp.md)
- [Glosario](./glosario.md)
- [Inicio](../manual/general/inicio.md)
