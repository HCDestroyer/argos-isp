# Rediseño de ArgosIsp: diseño aprobado y decisiones

Esta carpeta guarda **el diseño que el PM fue aprobando (21 nov 2026)** para que no se pierda y para que el código lo siga **fielmente**. Regla del PM: el panel en código debe verse y comportarse igual que estos tableros. Si algo del diseño no puede hacerse igual (accesibilidad, Nuxt UI, una regla de CLAUDE.md), se corrige el diseño para que los dos vuelvan a coincidir, nunca se deja una diferencia sin avisar.

- Artifact vivo (canvas de diseño): https://claude.ai/artifact/23h8ugCpjc33ue1KxYnsM5
- `tableros/`: copia de cada tablero (`*.dc.html`) y del índice `canvas.json` (páginas: Propuesta visual, Día a día, Lo nuevo, Inventario y bodegas, Red).
- `generadores/`: los scripts Python que generan los tableros (`c3.py` ficha, `c4.py` alta, `c8.py` cobro POS, `c9.py` cierre de caja, `c10.py` cajas, `c11.py` abrir caja y conciliación, `c12.py` importar extracto, `c13.py` inventario, `red*.py` red, `crons.py` tareas programadas). Escriben en una carpeta temporal; cambia la ruta de `os.chdir` antes de usarlos.
- `herramientas/render.js`: dibuja un tablero en PNG con Playwright para revisarlo: `node render.js <tablero> <png> <ancho> <alto> '<estado json>'` (el estado activa pestañas, pasos y ventanas; ver `renderVals()` de cada tablero).

## Sistema visual

- Índigo `#4F46E5` con acento cian; tarjetas blancas «isla» (borde `#E6E8F0`, sombra suave, radio 16–22); fondo con degradado suave; modo claro y oscuro.
- **Menú:** isla flotante a 16 px del borde. Compacto (de fábrica) y expandido. El botón para expandir y compactar es un círculo de 28 px **sobre el borde derecho, a la altura del logo, en los dos modos** (‹ y ›).
- **Encabezado:** sin barra ni pastillas. Cada control es un botón flotante suelto. A la izquierda, «lo que haces»: Buscar (Ctrl K), Cobrar, Cliente y «Más». En medio, aire. A la derecha, «lo que vigilas»: caja, sistema, avisos y la cuenta.
- **Accesos rápidos:** 2 directos y «Más», según permisos.
- **Caja:** ícono con menú contextual: ir a caja, cerrar caja (abre una ventana) y el resumen del turno con montos.
- Íconos en todo; estados con ícono, texto y color; pestañas segmentadas (barra gris, activa blanca) **dentro de la misma tarjeta** que su contenido.
- Listas en lugar de cuadros cuando hay muchos elementos. Buscador y filtros cuando una lista puede crecer.
- Ventanas (modales) solo para acciones cortas; páginas o paneles laterales para formularios largos.
- **Un solo campo destacado a la vez.**
- El desplazamiento ocurre dentro del contenedor, nunca en la página.
- Botón principal con aire alrededor; ayuda «?» del manual en cada pantalla.
- **Teléfono (390 px):** por pantallas y a pantalla completa, con la acción principal fija abajo.

## Decisiones por pantalla

- **Clientes:** contadores que filtran; vista rápida **flotante** que no le quita espacio a la lista; menú contextual.
- **Ficha del cliente:**
  - franja compacta con contadores (saldo, próximo vencimiento, servicios) que al bajar se reduce a nombre, estado, saldo y Cobrar;
  - pestañas segmentadas dentro de la tarjeta, incluida **Contactos**, con «A cargo de sus servicios» y «Está a cargo de»;
  - en el teléfono, la barra de abajo lleva Promesa y «Cobrar Q …».
- **Alta de cliente:**
  - 3 pasos (Cliente, Servicio, Cobro) con el progreso compacto arriba y el resumen en una línea junto a los botones;
  - varios teléfonos y contactos del servicio;
  - el router va antes que el plan, y la lista de planes se filtra por modo (residencial o empresarial) y por router (todos o específico), con buscador;
  - código automático del servicio (`S-000412`) y nombre opcional;
  - «Programar instalación» crea la orden en Iris; la IP se asigna al activar;
  - interruptores grandes en «Al crear el servicio»;
  - «Registrar prospecto» en un panel lateral que lo envía a Iris, con varios números.
- **Cobro (POS):**
  - lista de facturas por servicio, incluidas las cuentas «a su cargo» (plegadas hasta «Verifiqué el DPI»);
  - pestañas **Pago completo / Abono**, sin mezclarse;
  - métodos Efectivo, Tarjeta, Transferencia (mismo banco o ACH, con banco de origen de un catálogo) y Depósito, cada uno con sus campos;
  - «Recibido» destacado, con el **cambio justo debajo**;
  - teclado con **punto** y uso del teclado físico (números, punto, Tab y Enter);
  - en escritorio no hay texto «Ticket» ni lista arriba de las pestañas;
  - en el teléfono, dos pantallas: lista y cobro a pantalla completa.
- **Caja:**
  - abrir caja con fondo inicial;
  - cierre en 3 pasos (contar por denominaciones, revisar por método, cerrada);
  - pantalla Cajas con cierres, depósitos con boleta y retiros o ingresos.
- **Bancos:**
  - conciliación con dos columnas, la del banco y la de Argos;
  - importar el estado de cuenta tal como lo baja el banco, con un paso de columnas **solo si no se reconoce** y la opción de recordarlo por cuenta.
- **Inventario:**
  - existencias, equipos por serie o MAC con su historial, kardex, por recuperar y no recuperados;
  - **Revisión y garantía**;
  - **Cambiar equipo** en un paso, con motivo y destino del que sale;
  - bodegas, **bodega de cuadrilla** con jefe, traslados, conteo físico y «Mi bodega» del técnico.
- **Red** (diseño de Fable 5.2):
  - routers y su ficha;
  - conectar un router en 4 pasos;
  - planes y su formulario en página;
  - direcciones IP, red de acceso y conectados ahora;
  - control de velocidad con **3 opciones visibles y «Ver las otras»**;
  - tipo de cola con su **«?»** que explica cómo funciona.

## Portal del cliente

- Tableros: `Portal` (teléfono: inicio, corte y entrar), `NuevoPortal` (escritorio) y los de la página «Portal del cliente» del artifact: `PortalFacturas` (Facturas y pagos con pestañas segmentadas y el corte con la acción fija abajo), `PortalSoporte` (tickets y solicitudes, reportar un problema, conversación) y `PortalContactos` («Mis contactos», un contacto con sus permisos, «Está a tu cargo»). Generador: `generadores/portal_tableros.py`.
- **Saldo una sola vez** por pantalla: en el banner. Ni los indicadores ni el botón de pagar lo repiten («Pagar en línea», no «Pagar Q …»).
- Escritorio: **el mismo menú isla del panel** (pedido del PM): compacto (76 px, de fábrica) o expandido (244 px), logo de 36 px y el botón ‹ › de 28 px sobre el borde derecho a la altura del logo, en el mismo lugar en los dos modos. Secciones: «Inicio, Facturas y pagos, Soporte, Mis puntos, Mi cuenta» (en el compacto, los nombres cortos) y el tema abajo; sin barra superior. Hoy es una réplica en el portal; pendiente extraerlo con el del panel a `packages/`. Teléfono: barra inferior (Inicio, Facturas, Soporte, Puntos, Cuenta) y la acción principal fija abajo en corte y formularios.
- «Facturas y pagos» es una tarjeta con dos pestañas segmentadas, Facturas y Pagar (`?seccion=facturas|pagar`).
- «Mi WiFi» del tablero `NuevoPortal` queda fuera hasta que exista la API (nombre de la red y cambio de clave); «Solicitar servicio» va como tarjeta del inicio, no en el menú.

## Decisiones de negocio que acompañan al diseño (contrato con Iris 0.9.0–0.12.0)

- **Prospecto:** vive en Iris; Argos lo registra con `telefonos[]`.
- **Instalación:** el técnico confirma titular, datos y plan; la foto del DPI es del cliente y se guarda en Argos; mayoría de edad por casilla.
- **Cliente que ya existe:** asignarle un servicio no pide código ni revisión, solo un aviso al titular (decisión 9).
- **Contactos:** por cliente y servicio, con permisos (todos de fábrica); también los que se crean desde Iris.
- **Promesas:** son por servicio.
- **Equipos:** el técnico nunca decide pérdidas ni cobros. Declarar no recuperado exige 2 intentos de técnicos distintos o un contacto registrado (de fábrica). Equipo dañado o en garantía no vuelve como «funciona».
- Lo que el diseño muestra se construye de verdad en el código (pedido del PM: «todo en código es posible»), sin pantallas con datos inventados.
- Decisiones del PM sobre estas pantallas: `decisiones-pm.md`.
