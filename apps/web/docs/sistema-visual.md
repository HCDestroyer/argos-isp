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

## Menú lateral

`utils/navegacion.ts` (`GRUPOS_PANEL`): cada grupo tiene un `bloque` (encabezado en versalitas, no
clicable, con divisor) y puede tener `subgrupos` (más de ~7 secciones se dividen).

1. Arriba: logo con el degradado, filete de marca y tarjeta de usuario (avatar, nombre, rol, menú).
2. **Inicio**.
3. **Día a día** (suelto, siempre a la vista): Cobrar, Caja, Clientes, Servicios, Promesas, Comprobantes.
4. **Gestión**: Facturación · Red · Inventario (Movimientos / Catálogos y kardex) · Clientes y lealtad.
5. **Administración**: Finanzas (Egresos, Cartera, Bancos / Compras) · Contabilidad y fiscal · Reportes.
6. **Sistema**: Configuración (Toda la configuración; Empresa y fiscal; Facturación y cobro; Red y
   portal; Usuarios y acceso; Notificaciones e integraciones).

Solo el grupo (y subgrupo) de la página actual abre por defecto. El ítem activo lleva fondo del
primario al 10 % y texto primario; las secciones dentro de un grupo llevan viñeta de punto y su
descripción en tooltip. Contadores en pastilla del primario. En el menú compacto los subgrupos se
aplanan en el popover. Buscador Ctrl/Cmd+K con todas las secciones permitidas.

## Estructura de página (`PanelPagina`)

- Barra superior de vidrio: plegar menú, buscador «Buscar…» con Ctrl K, empresa, caja, campana de
  avisos (comprobantes por verificar), tema, avatar con el menú de la cuenta.
- **Página de una sección del menú**: migas, título grande (28 px, negrita) con el **?** de ayuda,
  la descripción de la sección y las acciones a la derecha.
- **Ficha o subpágina**: título y acciones en la barra superior; migas hasta su sección.
- **Ayuda contextual** (`AyudaBoton`): panel lateral con el resumen de la pantalla del manual
  (`utils/indiceAyuda.ts`, generado de `docs/manual/**` y su frontmatter `pantallas:` con
  `pnpm --filter @argosisp/web ayuda:indice`; una prueba falla si quedó desfasado) y «Ver manual
  completo».

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
| `AvisosBoton` | Campana de la barra superior |

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
