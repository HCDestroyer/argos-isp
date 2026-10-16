# Video del tour de ArgosIsp

Video promocional y tour del producto, hecho con [Remotion](https://www.remotion.dev/) 4 (React + TypeScript).
Es un proyecto **independiente** del workspace pnpm del monorepo: tiene su propio `package.json` y
`pnpm-lock.yaml`, y no está en `pnpm-workspace.yaml`.

- Salida: MP4 H.264, 1920×1080, 30 fps, ~84 s (9 escenas con solapes de 0.6 s).
- Todo es determinista: el azar sale de `random(semilla)` y el audio de un PRNG con semilla.

## Uso rápido

```bash
cd video
pnpm install --ignore-workspace   # instala solo este proyecto
pnpm studio                        # Remotion Studio para iterar (composición "Tour" y cada escena sola)
pnpm render                        # out/tour.mp4         (1920×1080, CRF 18)
pnpm render:prueba                 # out/tour-prueba.mp4  (escala 0.5, rápido)
pnpm stills                        # out/stills/*.png     (portada, escenas intermedias y cierre)
pnpm typecheck
```

Otros scripts:

| Script | Qué hace |
| --- | --- |
| `pnpm audio` | Regenera `public/audio/*.wav` (música y efectos) con `scripts/generar-audio.mjs`. |
| `pnpm capturas:relleno` | Genera las capturas de relleno que falten en `public/capturas/` (`--forzar` las rehace todas). |
| `pnpm puntos:plantilla` | Escribe `out/puntos-plantilla.json` con todos los puntos de interés del guion. |
| `pnpm logo` | Exporta el símbolo elegido a `public/logo-argos.svg` (cian) y `public/logo-argos-mono.svg` (`currentColor`). |
| `pnpm fuentes` | Vuelve a bajar las fuentes a `public/fuentes/` (ver «Fuentes»). |

### Navegador para renderizar

`remotion.config.ts` usa, en este orden, `REMOTION_BROWSER` (si apunta a un binario), el
`headless_shell` de Playwright en `/opt/pw-browsers/chromium_headless_shell-1194/` o el `chrome` de
`/opt/pw-browsers/chromium-1194/`. Si no encuentra ninguno, Remotion baja su propio navegador.
En otra máquina: `REMOTION_BROWSER=/ruta/a/chrome pnpm render`. El GL es por software (`swangle`)
para que las transformaciones 3D se vean igual con o sin GPU. `ffmpeg` lo trae Remotion.

## Estructura

```
src/
  guion.ts            ÚNICA fuente de verdad: escenas, duraciones, momentos, textos, efectos,
                      capturas y puntos de interés. No importa nada (lo usan también los scripts).
  Tour.tsx            Composición completa: grilla de fondo, escenas en <Sequence>, fundidos, audio.
  Root.tsx            Composiciones: Tour, Escena-<id>, Relleno-<captura>, LogoVariantes, LogoMarca, LogoSolo.
  camara/             camara.ts (cámara virtual, órbita, dolly, enfoque acotado), Escena3D.tsx
                      (perspective + preserve-3d, transform inverso), Seguimiento.tsx (cursor, clic, halo, etiquetas).
  escenas/            Una por escena del guion (Portada … Cierre) y comun.ts.
  estilo/             tema.ts (colores, fuentes), neon.tsx (brillo, flicker de tubo), Grilla.tsx (synthwave).
  componentes/        Paneles (ventana y teléfono), Textos (título y leyenda), IconosNeon.
  logo/               LogoArgos.tsx (símbolo + wordmark), geometria.ts (trazos), variantes/.
  relleno/            CapturaRelleno.tsx: dibuja las capturas de relleno a partir del guion.
  audio/PistaAudio.tsx  Música con ducking y efectos sincronizados con los momentos del guion.
scripts/              generar-audio, generar-capturas, generar-stills, plantilla-puntos, exportar-logo, descargar-fuentes.
public/
  capturas/           <nombre>.png + puntos.json
  audio/              musica.wav y efectos
  fuentes/            woff2 de Google Fonts (OFL)
  logo-argos.svg
```

## Guion y tiempos

Todo se ajusta en `src/guion.ts`, sin tocar las escenas:

- `segundos` de cada escena, `momentos` (en segundos desde el inicio de la escena: clics, vuelos, salida)
  y `efectos` (sonido en un momento o segundo).
- `musica`: nivel de la música en esa escena (ducking; se suaviza entre escenas).
- `grilla`: intensidad de la grilla neón de fondo.
- `textos`: todos los textos en pantalla.

| # | Escena | s |
| --- | --- | --- |
| 1 | Portada: el logo se traza y se enciende, «ArgosIsp · Gestión completa para tu ISP» | 5 |
| 2 | Clientes con filtros; la cámara sigue el chip «Cortados» | 10 |
| 3 | Ficha de servicio: IPv4/IPv6, suspender y reactivar | 10 |
| 4 | Cobro rápido: facturas marcadas, las del dependiente, monto, 5 métodos, transferencia, recibo y «Servicio reactivado» | 14 |
| 5 | Diagrama neón del ciclo Factura → … → CoA/Disconnect → Activo | 12 |
| 6 | Montaje 3D: caja, promesas, facturas, libro, bitácora | 14 |
| 7 | Portal: página de corte en el teléfono, promesa aprobada, mi cuenta y el PDF del aviso | 10 |
| 8 | Red y operación: RADIUS, MikroTik, Telegram, respaldos, monitoreo | 8 |
| 9 | Cierre: el logo se traza, parpadea al encenderse y respira | 6 |

Si cambias duraciones, corre `pnpm audio` para que la música vuelva a medir lo mismo que el video.

## Capturas

`public/capturas/` tiene las capturas **reales** del panel y del portal (tema oscuro, 1280×800 px lógicos en
escritorio y 390×844 en móvil). Sin marco de navegador: el marco lo pone el video.

| Archivo | Escena | Dispositivo |
| --- | --- | --- |
| `clientes-filtros.png` | Clientes | escritorio |
| `servicio-ficha.png` | Servicio | escritorio |
| `cobro-facturas.png`, `cobro-recibo.png` | Cobro rápido | escritorio |
| `caja.png`, `promesas.png`, `facturas.png`, `libro.png`, `bitacora.png` | Montaje | escritorio |
| `portal-corte-movil.png`, `portal-promesa.png` | Portal | móvil |
| `portal-cuenta.png`, `portal-pdf.png` | Portal | escritorio |

No hay captura de la ficha en estado suspendido: el badge «Suspendido» y el botón «Reactivar» de la escena 3
los dibuja el video encima de `servicio-ficha.png`, con los colores del panel (`EstadoSuspendido` en
`src/escenas/Servicio.tsx`). Si algún día hay captura real, se puede volver a una segunda capa.

### Puntos de interés (`puntos.json`)

Dónde caen el cursor, el halo y las etiquetas se lee de `public/capturas/puntos.json`:

```json
[
    { "archivo": "clientes-filtros.png", "x": 397, "y": 102, "etiqueta": "Chip \"Cortados\": clientes con el servicio suspendido", "ancho": 96, "alto": 28 }
]
```

- `x`, `y`: **centro** del elemento, en px lógicos, desde la esquina superior izquierda de la captura.
- `etiqueta`: la clave del punto en `guion.ts` (`chipCortados`) o su `texto` (basta el comienzo, sin importar
  mayúsculas ni tildes). Muchas etiquetas en pantalla son ese mismo `texto`.
- `ancho`, `alto` (opcionales): tamaño del elemento, para el halo.
- Los puntos que no casan con ninguna captura o clave se avisan en la consola del render y se ignoran.

`public/capturas/originales/` guarda los dos JSON tal como llegaron con las capturas (`puntos-panel.json`,
`puntos-portal.json`). `puntos.json` los combina, con estas correcciones medidas sobre las imágenes:
el badge «Activo» de la ficha (x 306 → 392), la barra de acciones (760 → 600), el bloque de red
(1110,385 → 1004,360), el grupo del dependiente en Cobrar (409,350 → 556,358), los datos de la
transferencia (y 454 → 488), el badge «Servicio reactivado» (411 → 403), la lista de clientes, los cobros de
caja, la fila de la bitácora, el cuadre del libro y los puntos del PDF y de la cuenta del portal, que quedaban
a un lado del elemento. También se agregaron `ancho` y `alto` a todos.

`pnpm puntos:plantilla` escribe `out/puntos-plantilla.json` con todos los puntos del guion y sus valores
actuales, para volver a medir si cambian las capturas.

### Reemplazar las capturas

1. Exporta la pantalla al mismo tamaño lógico (puede ser @2x; se escala sola) y guárdala con el mismo nombre.
2. Vuelve a medir sus puntos en `puntos.json`.
3. Revisa con `pnpm stills` (un still por momento clave de cada escena) y luego `pnpm render`.

`pnpm capturas:relleno` genera capturas de relleno solo para los archivos que falten (nunca pisa una
existente salvo con `--forzar`).

## Reemplazar la música

`public/audio/musica.wav` es una pista synthwave sintetizada por `scripts/generar-audio.mjs`
(Am–F–C–G a 100 BPM: pad de sierra filtrada, bajo en corcheas, bombo y caja suaves, arpegio; con
fundidos, normalizada a −16 dB RMS con picos de −1 dBFS como máximo, sin clipping). No tiene derechos de terceros.

Para usar una pista con licencia, guárdala con el mismo nombre (`musica.wav`; WAV o cualquier formato que
lea Chromium si cambias la ruta en `src/audio/PistaAudio.tsx`). Debe durar al menos lo que el video
(~84.2 s); si dura más, se corta y el video le aplica un fundido final de 1.5 s. El ducking por escena
(campo `musica` del guion) y el volumen base (`VOLUMEN_MUSICA` en `PistaAudio.tsx`) se siguen aplicando.

Los efectos (`whoosh`, `clic`, `confirmacion`, `corte`, `neon`) se reemplazan igual, con el mismo nombre.
`pnpm audio` los regenera todos (sobrescribe también `musica.wav`).

## Logo

El símbolo es Argos Panoptes, el gigante que todo lo ve: un ojo almendrado cuya pupila es un nodo de red,
con tres arcos de señal. Son solo trazos (se animan con `stroke-dashoffset`) sobre una grilla de 64×64,
con grosor para leerse a 32 px. El wordmark es «Argos» en Space Grotesk 700 e «Isp» en 300, en cian.

- Geometría: `src/logo/geometria.ts` (`OJO_SENAL`, `OJO_NODOS`, `IRIS_ONDAS`; `LOGO_ELEGIDO = OJO_SENAL`).
- Componente: `src/logo/LogoArgos.tsx` (`<LogoArgos trazo brillo neon />` y `<Wordmark />`).
- Variantes: `src/logo/variantes/` y la composición `LogoVariantes` (comparación a 300, 32 y 16 px).
- Para cambiar de variante, cambia `LOGO_ELEGIDO` y corre `pnpm logo`; para un logo nuevo, agrega una
  `DefinicionLogo` (trazos `path` o `circle` con `orden` de dibujo).
- `public/logo-argos.svg` se genera; no lo edites a mano.

## Fuentes

Space Grotesk (títulos), Inter (texto) y JetBrains Mono (detalles), de Google Fonts (OFL). Las URLs salen de
`@remotion/google-fonts` (versión fijada), pero los archivos se descargan una vez a `public/fuentes/`
(`pnpm fuentes`) y se cargan localmente: así el render no depende de la red, y en entornos con proxy TLS el
Chromium de render no falla con el certificado. Con `FUENTES_EN_LINEA = true` en `src/estilo/tema.ts` se
cargan directo con `@remotion/google-fonts`.

## Dependencias

| Paquete | Versión | Motivo |
| --- | --- | --- |
| `remotion`, `@remotion/cli` | 4.0.535 (exacta) | Motor de video y CLI de render. |
| `@remotion/google-fonts` | 4.0.535 | URLs y rangos de las fuentes (y carga en línea opcional). |
| `react`, `react-dom` | 19.2.0 | Requeridos por Remotion. |
| `typescript`, `@types/react`, `@types/node` | 5.9.3 / 19.2.2 / 22.19.1 | Tipado (`pnpm typecheck`). |

El audio, las capturas de relleno y el logo se generan sin dependencias extra.
