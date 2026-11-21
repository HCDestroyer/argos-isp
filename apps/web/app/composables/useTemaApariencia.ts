import type { Schema } from '@argosisp/contracts'

type Publica = Schema<'AparienciaPublica'>

/**
 * Aplica la apariencia de la instalación (A6, `contratos/apariencia.md`) en tiempo de ejecución:
 * `appConfig.ui.colors.primary` (Nuxt UI regenera la escala del color), el primario exacto por
 * modo de la paleta (validado AA por la API: claro contra blanco, oscuro contra #0B0F1A), los
 * tokens `--ax-*` derivados (degradados y tinte) y el modo predeterminado si el usuario nunca eligió
 * uno. Se lee sin sesión (`GET /apariencia/publica`), así también el login sale con la marca.
 */
export function useTemaApariencia() {
    const publica = useState<Publica | null>('apariencia-publica', () => null)
    const appConfig = useAppConfig()
    const colorMode = useColorMode()
    const config = useRuntimeConfig()

    function aplicar(apariencia: Publica) {
        publica.value = apariencia
        appConfig.ui.colors.primary = apariencia.paleta.color
        const { claro, oscuro } = apariencia.paleta
        // Texto blanco sobre el degradado: del primario al primario oscurecido (pasa 4,5:1 si el
        // primario claro ya lo pasa contra blanco, que la API garantiza).
        const css = `:root,.light{--ui-primary:${claro};--ax-marca-1:${claro};--ax-gradiente:linear-gradient(135deg,${claro} 0%,#06b6d4 100%);--ax-gradiente-texto:linear-gradient(120deg,${claro} 0%,color-mix(in oklab,${claro} 80%,#000) 55%,color-mix(in oklab,${claro} 65%,#0e7490) 100%);--ax-tinte:linear-gradient(135deg,color-mix(in oklab,${claro} 10%,transparent),rgb(6 182 212 / 0.1))}`
            + `.dark{--ui-primary:${oscuro};--ax-gradiente:linear-gradient(135deg,${oscuro} 0%,#22d3ee 100%);--ax-tinte:linear-gradient(135deg,color-mix(in oklab,${oscuro} 16%,transparent),rgb(34 211 238 / 0.1))}`
        useHead({ style: [{ key: 'apariencia-tema', id: 'apariencia-tema', textContent: css }] })
        if (import.meta.client) {
            let elegido = false
            try {
                elegido = window.localStorage.getItem('nuxt-color-mode') !== null
            }
            catch {
                // Sin almacenamiento: manda el predeterminado de la instalación.
            }
            if (!elegido) {
                colorMode.preference = apariencia.modo_predeterminado === 'claro' ? 'light' : apariencia.modo_predeterminado === 'oscuro' ? 'dark' : 'system'
            }
        }
    }

    async function cargar() {
        const resultado = await useApariencia().publica()
        if (resultado.ok) {
            aplicar(resultado.data)
        }
        // Con error se queda la apariencia de fábrica (índigo): el panel sigue usable.
    }

    /** URL de un archivo de la apariencia: relativa a la API o, en fixtures, ya absoluta. */
    function urlArchivo(ruta: string | null): string | null {
        if (!ruta) {
            return null
        }
        return ruta.startsWith('/') ? `${String(config.public.apiBase).replace(/\/$/, '')}${ruta}` : ruta
    }

    return { publica, aplicar, cargar, urlArchivo }
}
