import { existsSync } from 'node:fs'
import { Config } from '@remotion/cli/config'

/**
 * Navegador para renderizar.
 *
 * Remotion intenta bajar su propio "chrome-headless-shell". En entornos sin
 * salida a internet (o con proxy) eso falla, así que usamos un Chromium ya
 * instalado. Orden de preferencia:
 *   1. REMOTION_BROWSER (variable de entorno), si apunta a un binario.
 *   2. El headless shell de Playwright en /opt/pw-browsers.
 *   3. Nada: Remotion descarga el suyo (comportamiento por defecto).
 */
const candidatos = [
    process.env.REMOTION_BROWSER,
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter((ruta): ruta is string => Boolean(ruta))

const navegador = candidatos.find((ruta) => existsSync(ruta))
if (navegador) {
    Config.setBrowserExecutable(navegador)
}

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(92)
Config.setOverwriteOutput(true)
Config.setCodec('h264')
Config.setPixelFormat('yuv420p')
// GL por software: las transformaciones 3D CSS y los filtros se ven igual en
// cualquier máquina (sin GPU) y el render es reproducible.
Config.setChromiumOpenGlRenderer('swangle')
