# Sistema visual Argos

Rediseño del panel (decisiones del PM, noviembre de 2026): interfaz más fresca y entendible, menú
con jerarquía clara y componentes congruentes. Se construye **sobre Nuxt UI** (nada de HTML crudo)
con tokens CSS propios (`--ax-*`), la configuración de `app.config.ts` y componentes compartidos.
Solo el panel de ArgosIsp: Iris y Horus conservan su teal; el portal (A5) usa los mismos tokens.

## Color

Los tokens `--ax-*` tienen **los mismos nombres y valores que el portal** (`apps/portal`, su
«Sistema visual»); el panel solo agrega `--ax-panel`.

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `primary` (Nuxt UI `indigo`) | 600 `#4f46e5` (6,3:1 sobre blanco) | 400 `#818cf8` | Acción primaria, enlaces, ítem activo, foco |
| `secondary` (`cyan`) | 700 | 300 | Acentos secundarios |
| `--ax-gradiente` | `#4f46e5` → `#06b6d4` | `#818cf8` → `#22d3ee` | Acento de marca sin texto encima: logo, filete del menú, tarjeta KPI destacada |
| `--ax-gradiente-texto` | `#4f46e5` → `#4338ca` → `#0e7490` | igual | El único degradado con texto blanco encima (4,5:1 en todo el recorrido): bienvenida del inicio, panel de marca del login |
| `--ax-tinte` | índigo y cian al 10 % | al 16 % y 10 % | Fondos suaves de marca |
| `--ax-fondo` | `#f8f9fa` | `#0b0f1a` (azul noche, nunca negro) | Fondo de página |
| `--ax-tarjeta` | `#ffffff` | `#121828` | Tarjetas, tablas, menús |
| `--ax-borde` | `#e7eaee` | `#222a40` | Bordes de tarjetas, tablas y separadores |
| `--ax-cabecera-tabla` / `--ax-fila-hover` | `#f8f9fa` / `#f8f9fb` | `#0f1424` / `#161c2e` | Cabecera y hover de tablas y listas |
| `--ax-radio` / `--ax-radio-modal` | 12 px / 16 px | igual | Tarjetas y tablas / modales |
| `--ax-sombra` / `--ax-sombra-flotante` | casi nada / flotante | más densas | Tarjetas / menús y modales |
| `--ax-panel` (solo panel) | `#f3f5f7` | `#0f1424` | Panel interno (mini gráficas, métricas) |
| `--viz-1…5` + `.tono-n` | paleta categórica | paleta categórica | Color de cada métrica (pastilla, mini barras, tendencia); nunca un estado |

- Texto blanco **nunca** sobre `--ax-gradiente` (el cian puro no da 4,5:1): donde hay texto va
  `--ax-gradiente-texto`.
- Estados: activo verde, limitado ámbar, suspendido rojo, retirado gris, pendiente de instalación
  azul, siempre color + icono + texto (`EstadoServicioBadge`, `utils/estadoServicio.ts`).
- `--tono-texto` oscurece (claro) o aclara (oscuro) el tono de la métrica para que el texto pase AA.

## Iconos y botones

- Todo botón, ítem de menú, pestaña, acción de fila y encabezado lleva **icono Lucide + texto**. Solo
  las acciones de fila van con icono solo, y siempre con tooltip (`title`) y `aria-label`.
- La misma acción lleva siempre el mismo icono: mapa único en `utils/iconosAcciones.ts` (`ICONOS`):
  cobrar = billete, promesa = calendario, reactivar = encender, retirar/eliminar = basurero, ver =
  ojo, editar = lápiz, exportar = descarga, subir = flecha arriba, guardar = check, cancelar = x,
  volver = chevron izquierda.
- Botones en pastilla (radio completo). Una sola acción primaria por pantalla (sólida, con
  `glow-brand`); secundarias `outline`/`soft`; destructivas `error`, al final y separadas. El color
  dice la intención: verde cobrar o reactivar, rojo lo destructivo, índigo navegación y lo principal.
- Textos con verbo + objeto («Registrar pago», «Suspender servicio»), nunca «Aceptar» o «Procesar».

## Cursores (globales, `main.css`)

`pointer` en lo clicable (enlaces, pestañas, opciones, interruptores, `[data-clicable]`);
`not-allowed` en deshabilitados; `text` en campos; `help` en ayudas (`[data-ayuda]`);
`context-menu` en filas con menú contextual (`[data-menu-contextual]`, con `pointer` en sus enlaces);
`copy` (`[data-copiar]`); `zoom-in` (`[data-ampliar]`); `grab`/`grabbing` en lo arrastrable;
`col-resize` (`[data-redimensionar]`); `progress` mientras algo procesa (`aria-busy`).

## Layout «islas»

El menú lateral es una isla flotante (separada 16 px del borde, radio 22 px, vidrio con
desenfoque y sombra suave sobre el aura). El encabezado no tiene barra ni pastillas: cada control
es un botón flotante suelto (`.boton-flotante`: fondo de tarjeta, borde fino, sombra corta y se
eleva 1 px al pasar el puntero; `.boton-circulo` para los de solo icono y `.boton-pastilla` /
`.boton-acceso` para los de icono y texto: 42 px de alto desde `lg`, 36 px en el teléfono, donde
los accesos quedan en círculo). Cobrar usa `.boton-exito` (verde claro) y la cuenta
`.boton-cuenta` (índigo claro con las iniciales). Los puntos de estado (`PUNTO_FLOTANTE`) miden
8 px con borde de 2 px, a 9 px del borde del círculo: caja verde, sistema ámbar o rojo, avisos cian.
Medidas de la isla (IslasA5/A6): 244 px expandida y 76 px compacta (`rem` en el layout), sin
redimensionar; logo de 36 px; secciones sin icono alineadas con el texto del área (42 px, 13 px). Diseño final
aprobado por el PM (maquetas IslasA5 y IslasA6). Con `prefers-reduced-transparency` todo pasa a
sólido y sin desenfoque.

## Menú lateral (`layouts/default.vue`, `utils/navegacion.ts`)

Dos modos que elige cada usuario (`useMenuCompacto`, recordado). Los alterna un círculo de 28 px
sobre el borde derecho de la isla, a la altura del logo, en el mismo lugar en los dos modos (‹
compacta, › expande; `data-prueba="alternar-menu"`). No hay otro botón de plegar:

- **Compacto (rail, de fábrica):** un icono con etiqueta corta (`GrupoSecciones.corta`) por área:
  Inicio, Día a día, Facturas, Red, Inventario, Lealtad, Finanzas, Contable, Reportes y, abajo,
  Ajustes. El área de la página se resalta y lleva un punto si algo suyo tiene pendientes. Al
  tocarla (o Enter) se abre a su derecha un menú flotante (`MenuArea`) con sus secciones agrupadas
  con separadores, iconos y contadores (Comprobantes 4, Caja «Abierta»); flechas, Tab, Enter y Esc.
- **Expandido (244 px):** Inicio y cada área como acordeón (solo la de la página abierta; la
  flecha y el contador del área solo cuando hace falta: flecha abierta, contador cerrada), con
  subgrupos dentro cuando pasan de ~7 secciones y la descripción en tooltip. **Ajustes** va abajo,
  aparte, en su propio acordeón (`data-prueba="menu-ajustes"`), como en el compacto.

En el teléfono y la tableta (< 1024 px) no hay menú lateral ni botón de menú: manda la **isla de
navegación abajo** (abajo). El buscador Ctrl/Cmd+K encuentra todas las secciones permitidas.

## Teléfono: isla de navegación abajo (`PanelIslaMovil`)

Pedido del PM (como la barra del portal; tablero `MarcoMovil` en `.claude/diseno/tableros/`):

- Isla flotante abajo, a 12 px de los bordes y del área segura (`env(safe-area-inset-bottom)`), con
  el radio (22 px), el vidrio y la sombra del menú lateral. Solo bajo `lg`; desde 1024 px no existe.
- Cinco destinos de 56 px de alto, ícono Lucide con texto corto debajo: **Inicio**, los **2 primeros
  accesos rápidos** del usuario (los mismos del encabezado de escritorio; Cobrar en verde), **Avisos**
  con su punto cian y **Más**. Todo según permisos (sin `comprobantes.ver` no hay Avisos). El activo va
  en índigo (700 claro, 300 oscuro, para pasar AA a 11 px) con fondo suave.
- **Más** abre el menú completo a pantalla completa (el mismo `UDashboardSidebar`, `mode="modal"`):
  marca y cerrar arriba, «Buscar una sección…» (abre el buscador), «Personalizar mis accesos», las
  áreas en acordeón con la de la página abierta, Ayuda y Ajustes abajo.
- En el teléfono el encabezado lleva la marca a la izquierda y, a la derecha, caja, sistema y la
  cuenta; los accesos y los avisos se mudan a la isla.
- `--ax-isla-reserva` (`main.css`) es el alto que la isla le quita a la pantalla (0 en escritorio):
  lo usan el contenido (`.panel-cuerpo`, el desplazamiento sigue dentro del contenedor), la barra
  de acciones de los formularios (`FormularioAcciones`, se detiene encima de la isla), la acción
  fija de cada pantalla (`PanelBarraAccion`) y los avisos emergentes (`toaster` en `app.config.ts`).
- **Acción principal fija** (`PanelBarraAccion`, por ejemplo «Promesa» y «Cobrar Q …» de la ficha del
  cliente): otra isla de vidrio justo encima de la de navegación, sin taparla; el contenido gana su
  aire. Desde `lg` va en su lugar, dentro del flujo.

## Encabezado (`PanelPagina`)

Botones flotantes sueltos; en medio, aire. El título nunca va en el encabezado.

- **Izquierda, «lo que haces»:** el buscador «Buscar…» (pastilla ancha con Ctrl K, desde `lg`) y
  los accesos rápidos (2 directos, Cobrar en verde, y «Más» en círculo). En el teléfono, la marca
  (los accesos van en la isla de abajo).
- **Derecha, «lo que vigilas»:** círculos con su punto de color: la caja (icono con punto verde abierta o gris cerrada; su menú dice la caja,
  desde cuándo, el fondo inicial, «Ir a la caja» y «Cerrar caja…» o «Abrir caja…», cada uno con su
  permiso; nunca montos en el icono), el estado del sistema (icono con punto si hay aviso, con
  `sistema.ver_salud`), los avisos y la cuenta (círculo con las iniciales; dentro: nombre, rol y correo,
  la empresa, tema, Mi cuenta, Ayuda y atajos, Qué cambió y, aparte en rojo, Cerrar sesión).
- **Página de una sección:** migas, título grande con el **?** del manual, descripción y acciones.
- **Ficha o subpágina:** migas, título con su icono y las acciones a la derecha.
- **Inicio** (`titulo-oculto`): el saludo de la bienvenida hace de título; el `h1` queda para
  lectores de pantalla.

## Inicio

Bienvenida (degradado con texto, saludo, avisos y dos acciones) → 4 KPI con mini gráfica y
tendencia → Últimos pagos (2/3) | Accesos rápidos (1/3) → Salud del sistema (2/3) | Registro del
sistema (1/3), estos dos solo con sus permisos → servicios por estado y gráficas de 12 meses.

## Sistema y apariencia

- `/sistema/salud`, `/sistema/registro` y `/sistema/almacenamiento` (Configuración → Sistema y
  apariencia), con sus permisos `sistema.*`; errores con «Reintentar», nunca cifras inventadas.
- `/configuracion/apariencia`: tema (presets validados AA por la API), modo predeterminado, marca,
  eslogan, logo y fondo del login. `useTemaApariencia` lo aplica al arrancar (también en el login,
  sin sesión): `appConfig.ui.colors.primary`, el primario exacto por modo y los `--ax-*` derivados.

## Accesos rápidos

En el encabezado, a un clic: los 2 primeros accesos del usuario (icono + etiqueta; en el teléfono
un círculo con el icono; Cobrar en verde) y «Más» (círculo con ⋯) con el resto por área, contadores, atajos **Alt+1…9** y «Personalizar
mis accesos» (panel lateral: hasta 12, arrastrar o flechas, «Usar los de mi rol»). El inicio muestra
los mismos. `GET/PUT /api/v1/me/accesos-rapidos` (`useAccesosRapidos`); sin lista guardada, los del
rol; sin permiso, el acceso no aparece.

## Componentes compartidos

| Componente | Para qué |
| --- | --- |
| `PanelPagina` | Encabezado de página (migas, título, descripción, ayuda, acciones) |
| `TarjetaKpi` + `MiniBarras` | KPI: icono en pastilla del tono, título, menú de tres puntos, panel interno con cifra, tendencia y mini barras |
| `ListaItem` | Fila de lista: avatar o icono, título, subtítulo, valor y dato secundario |
| `AvatarIniciales` | Iniciales con tono derivado del nombre (`utils/sistemaVisual.ts`) |
| `AccionesFila` + `useMenuFila` | Acciones de fila con icono y el mismo juego en el menú contextual (`UContextMenu`), agrupado con etiquetas y lo destructivo al final |
| `VistaRapida`, `ClienteVistaRapida`, `ServicioVistaRapida` | Maestro-detalle en `USlideover` sin salir de la lista |
| `TarjetaAcceso` | Acceso a una sección en las páginas índice (Configuración) |
| `FormularioSeccion` + `FormularioAcciones` | Formulario en página: secciones con título y descripción a la izquierda (consulta de contenedor: se apilan en paneles angostos) y barra de acciones fija abajo |
| `ModalTitulo` | Título de modal con icono en pastilla por tipo (info, advertencia, peligro) |
| `EstadoServicioBadge`, `EstadoPagoBadge`… | Estados con color + icono + texto |
| `AvisosBoton` | Campana de la barra superior (en el teléfono, Avisos va en la isla) |
| `PanelIslaMovil` | Navegación del teléfono: isla abajo con Inicio, 2 accesos, Avisos y «Más» |
| `PanelBarraAccion` | Acción principal fija de una pantalla en el teléfono, encima de la isla |

`app.config.ts` unifica: tarjetas (radio 12 px, borde `--ax-borde`), tablas (cabecera en versalitas
sobre `--ax-panel`, filas con línea fina, hover suave, sin cebra), ítem activo del menú, botones en
pastilla, campos (`rounded-lg`, error con icono), modales (`--ax-radio-modal`, 16 px, fondo desenfocado, pie a la
derecha; **hoja inferior a todo el ancho en 390 px**), toasts, estados vacíos (icono en pastilla del
primario) y skeletons.

## Ventana, panel lateral o página

| Usar | Cuándo | Ejemplos |
| --- | --- | --- |
| **Acción directa** | Lo que no necesita confirmación ni datos | Copiar IP, actualizar, filtrar |
| **Ventana (`UModal`)** | Solo para confirmar algo que no se deshace o pedir 1–4 datos sin salir de donde estás | Suspender o retirar con motivo, anular con motivo, aprobar o rechazar comprobante, crear rápido un elemento de catálogo pequeño, elegir plantilla de impresión |
| **Panel lateral (`USlideover`)** | Consultar o editar algo mientras se sigue viendo la lista | Vista rápida de cliente y servicio, filtros avanzados, edición media (5–8 campos de una sección) de catálogos, historial de un elemento, ayuda de la pantalla |
| **Página propia** | Formulario largo o crítico (más de ~8 campos o varias secciones), flujo de varios pasos, ficha con URL para compartir, vista previa grande | Nuevo/editar cliente, alta y edición de servicio, router, plantilla de facturación, empresa, FEL, roles, plantillas de documentos, emisión por periodo, cierre de caja, declaraciones, sorteos |

Un modal nunca se abre encima de otro. Formularios en página: migas, «Atrás» vuelve a donde
estabas y aviso al salir con cambios sin guardar donde ya existe.

**Cambios hechos con este criterio:** «Nuevo cliente» de la lista pasó de panel lateral a su página
(`/clientes/nuevo`, que ya existía). La consulta de clientes y servicios ganó la vista rápida en
panel lateral. Las acciones del servicio siguen en ventanas (confirmación con motivo).

## Accesibilidad

AA en claro y oscuro (texto ≥ 4,5:1, componentes ≥ 3:1): primario 600 en claro y 400 en oscuro,
tonos de texto de las métricas mezclados (`--tono-texto`). `prefers-reduced-motion` apaga
transiciones y el alza de tarjetas; `prefers-reduced-transparency` vuelve sólido el vidrio. Las
pruebas de axe (`tests/e2e/accesibilidad.spec.ts`) recorren las pantallas principales en ambos temas.

## Clientes (fase 2 del rediseño)

- **Lista** (NuevoClientes): contadores que filtran (`data-contador`), tarjeta con buscador, pestañas
  «Todos / Al día / Con deuda / Suspendidos» y «Más filtros»; cada fila con «Cobrar» y «⋯» (mismo
  menú del clic derecho, `useMenuFila().itemsDe`). Vista rápida **flotante** (`VistaRapida`:
  `USlideover` en recuadro, sin velo ni bloqueo, título y descripción en sus slots para no perder el
  nombre accesible).
- **Ficha** (NuevoClienteFicha): `ClienteFranja` fija arriba que se compacta al bajar (centinela con
  `IntersectionObserver`), contadores con `TarjetaDato`, acciones en círculos flotantes,
  `PromesaServicioBoton` (la promesa es por servicio), pestañas segmentadas (`UTabs` pill) dentro de
  la tarjeta y `SeccionSinApi` para lo que la API aún no da. Teléfono: barra fija abajo
  (`PanelBarraAccion`, encima de la isla de navegación).
- **Alta** (NuevoAltaCliente): tarjeta centrada con el progreso de 3 pasos; `ClienteFormulario`
  con `con-servicio` y `ServicioAltaFormulario` con `pasos-externos`.
- Tonos de estado para pastillas: `tono-exito`, `tono-aviso`, `tono-error` (además de `tono-marca`).
