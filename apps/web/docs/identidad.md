# Identidad visual del panel: "vidrio y luz"

Decisión del PM: el panel (y el portal, A5) usan la identidad de la skill `horus-identity` con la
marca y el nombre de **ArgosIsp**. En la interfaz nunca aparece "Horus". Los tokens son los de la
skill, sin variantes locales: `app/assets/css/main.css` y `app/app.config.ts` son copia de
`horus-identity/assets/nuxt-ui/`, con lo propio del panel al final de `main.css` (bloque "ArgosIsp").

## Marca

| Pieza | Dónde | Regla |
| --- | --- | --- |
| Marca | `LogoArgos` (`variante="marca"`), barra lateral | Trazo blanco del logo de ArgosIsp (ojo con ondas de señal, viewBox 64) sobre recuadro teal 700 `#0f766e`, radio 7/32 (14 de 64). El recuadro no cambia en oscuro. Mínimo 16 px. |
| En línea | `LogoArgos variante="linea"`, login | Solo el trazo, en `currentColor` (aquí `text-primary`). Para tamaños grandes. |
| Favicon | `public/favicon.svg` | La marca. |
| Logotipo | barra lateral | "ArgosIsp" en la fuente del sistema, semibold, tracking −0,015 em. |

Los tokens de la marca son `--argos-marca-fondo` (`primary-700`) y `--argos-marca-trazo` (blanco).

## Materiales

| Material | Dónde en el panel |
| --- | --- |
| Aura (`.app-aura`) | Primer hijo de `UDashboardGroup` (layout) y fondo del login |
| Vidrio (`.glass-material`, `.chrome-material`) | `UDashboardSidebar` y `UDashboardNavbar` (en `PanelPagina`) |
| Vidrio fuerte (`--hf-glass-strong`, por `app.config`) | `UModal` (incluida la ventana de sesión bloqueada), `USlideover` (también el menú en el teléfono), `UPopover`, `UDropdownMenu` |
| Tarjeta | `.surface-card` (KPIs, gráficas, fichas, filtros), `UPageCard variant="subtle"` y `UCard` (formularios y fichas), `UTable` (por `app.config`) |

- Nunca vidrio sobre vidrio: los `USelect`/`USelectMenu` quedan sólidos (`bg-default`) porque viven
  dentro de modales y slideovers de vidrio.
- Una tabla que ya va dentro de una tarjeta quita el material con
  `:ui="{ root: 'rounded-none bg-transparent ring-0 dark:shadow-none' }"` (tabla alternativa de las gráficas).
- Con `prefers-reduced-transparency` todo el vidrio y las tarjetas pasan a sólido y no hay aura.

## Menú (decisión del PM: resumido)

- Seis grupos plegables en `GRUPOS_PANEL` (`utils/navegacion.ts`): Operación (clientes, servicios,
  migración de router), Cobros (cobrar, facturas, pagos, comprobantes, promesas, notas de crédito),
  Contabilidad (caja, libro con sus cierres, egresos), Red (routers, planes), Reportes y bitácora,
  y Configuración (usuarios, plantillas, cuentas bancarias, empresa, plantilla del aviso).
- Un grupo sin ninguna sección permitida no aparece; el de la página actual se abre solo
  (`grupoDeRuta`). Cada enlace pide el mismo permiso que su página (`pnpm verificar:permisos`).
- Barra compacta (solo iconos con tooltip y `aria-label`; cada grupo abre sus secciones en un
  popover). Se compacta con el botón de la barra superior y se recuerda por usuario en
  `localStorage` (`argos_menu_compacto:<id>`, con try/catch: sin almacenamiento arranca expandida).
- En el teléfono el menú vive en un `USlideover` (vidrio fuerte) y no ocupa espacio.
- Buscador de secciones (`UDashboardSearch`, un `UCommandPalette` en modal) con Ctrl/Cmd+K o el
  botón "Buscar": las mismas secciones permitidas, por grupo, con su descripción.

## Luz

- **Acción primaria con halo:** clase `glow-brand` en una sola acción por vista (solo se ve en
  oscuro; hover 26 px). A diferencia de la skill, el halo **no** va en todos los botones primarios
  sólidos (`app.config`): el panel tiene varios por vista (p. ej. "Nuevo cliente" y "Guardar").
  Hoy la llevan: "Entrar" (login), "Nuevo cliente" (clientes), "Nuevo servicio" (servicios y ficha
  del cliente), "Crear cliente"/"Guardar cambios", "Crear servicio", "Registrar pago" (cobro) y
  "Abrir turno"/"Cerrar turno" (caja). Una pantalla nueva elige una sola.
- **Punto en vivo:** `EstadoSesionBadge` en la ficha del servicio (sesión releída cada 30 s; cada
  lectura lanza el anillo).
- **Números que ruedan:** `NumeroVivo` en los KPIs del dashboard (`IndicadorTablero`) y en los
  servicios por estado: cada dígito rueda 0,7 s solo cuando el dato cambia y el valor destella
  (en oscuro). El dígito real queda como texto.
- Las tres preferencias del sistema vienen de la skill: `prefers-reduced-motion` (sin aura en
  movimiento, sin anillos ni destellos, números sin rodar), `prefers-reduced-transparency` (vidrio
  y tarjetas sólidos, sin aura; el panel extiende la regla al vidrio fuerte de modales y menús) y
  `prefers-contrast: more` (texto atenuado más fuerte, bordes marcados, sin halos).

## Estados: color + icono + texto

Regla de la skill: la urgencia decide el color, el icono la identidad y el texto siempre está.
Nunca `primary` para un estado. Siempre `UBadge variant="subtle"` (salvo banderas en `outline`).

| Familia | Valor | Color | Icono (Lucide) | Texto | Fuente |
| --- | --- | --- | --- | --- | --- |
| Servicio | activo | `success` | `circle-check` | Activo | `utils/estadoServicio.ts` |
| | limitado | `warning` | `gauge` | Limitado | |
| | suspendido | `error` | `circle-x` | Suspendido (filtro: "Cortado") | |
| | retirado | `neutral` | `archive` | Retirado | |
| | promesa activa (bandera) | `info` | `calendar-clock` | Promesa activa | `utils/estados.ts` (`PROMESA_ACTIVA`) |
| | suspendido manualmente (bandera) | `error` | `hand` | Suspendido manualmente | `SuspensionManualBadge` |
| Factura | emitida | `info` | `file-text` | Emitida | `utils/estadoFactura.ts` |
| | parcial | `warning` | `circle-dot-dashed` | Pago parcial | |
| | vencida | `error` | `alarm-clock` | Vencida | |
| | pagada | `success` | `circle-check` | Pagada | |
| | anulada | `neutral` | `ban` | Anulada | |
| Sesión PPPoE | en línea | `success` | `plug-zap` + punto en vivo (`primary`) | En línea · En vivo · 10:42 | `utils/estados.ts` (`ESTADOS_SESION`) |
| | desconectada | `neutral` | `unplug` | Desconectada | |
| Router | en línea | `success` | `circle-check` | En línea | `utils/estados.ts` (`ESTADOS_ROUTER`); la API aún no lo expone |
| | caído | `error` | `circle-x` | Fuera de línea | |
| Comprobante | pendiente | `warning` | `hourglass` | Pendiente | `utils/comprobante.ts` |
| | aprobado | `success` | `circle-check` | Aprobado | |
| | rechazado | `neutral` | `circle-x` | Rechazado | |
| Promesa | pendiente de aprobación | `warning` | `hourglass` | Pendiente de aprobación | `utils/promesa.ts` |
| | activa | `info` | `calendar-clock` | Activa | |
| | cumplida | `success` | `circle-check` | Cumplida | |
| | incumplida | `error` | `circle-x` | Incumplida | |
| | rechazada | `neutral` | `ban` | Rechazada | |
| | cancelada | `neutral` | `circle-slash` | Cancelada | |
| Pago | registrado / por verificar / anulado | `success` / `warning` / `neutral` | `circle-check` / `hourglass` / `ban` | | `utils/estadoPago.ts` |
| Arqueo de caja | cuadra / sobrante / faltante | `success` / `warning` / `error` | `circle-check` / `circle-plus` / `circle-minus` | Cuadra · Sobrante Q … · Faltante Q … | `utils/caja.ts` |

Rechazos (comprobante, promesa) son `neutral`: son finales y no piden acción al operador. La
decisión de la evaluación de una promesa sí usa `error` cuando la rechaza, porque el servicio sigue
cortado.

## Gráficas

- Series con la paleta categórica de la skill (`utils/paletaGraficas.ts`, copia de
  `chart-palette.ts`: cinco ranuras en orden fijo, valor por tema, re-tematiza sin recargar) y
  rejilla, ejes y etiquetas con `CHART_INK`. La escala secuencial (antigüedad de cartera) es propia
  del panel, de un solo tono. Nunca un color de estado como serie.
- Cada gráfica lleva título (`h3` de la tarjeta), una frase con el hallazgo principal (`hallazgo`,
  también como `aria-describedby` del SVG; `hallazgoMontos` y `hallazgoConteos` en
  `utils/dashboard.ts`) y la tabla alternativa ("Ver tabla").
- Los reportes (`/reportes/:reporte`) son tablas con exportación XLSX/CSV; hoy no tienen gráficas.

## Tipografía

- Fuente del sistema (`--font-sans` de la skill, sin descargas: `ui.fonts: false`) y
  monoespaciada (`--font-mono`, utilidad `font-mono`) para IPs, prefijos IPv6, MAC, DUID, usuarios
  PPP, NAS, NIT/CUI y rutas de RouterOS, también en los campos de los formularios
  (`class="font-mono"` en el `UInput`) y en `DatoFicha` con `mono`.
- Cifras tabulares: en toda tabla (regla base de `main.css`), en los KPIs (`NumeroVivo` e
  `IndicadorTablero`) y en los ejes de las gráficas.
- `h1` con tracking −0,015 em (regla base); KPIs con −0,02 em; jerarquía por peso y tamaño en `rem`.
- Montos en quetzales con dos decimales (`formatearQuetzales`) y fechas `dd/mm/aaaa HH:mm` en
  America/Guatemala (`formatearFecha`, `formatearFechaHora`, `formatearHora`).
