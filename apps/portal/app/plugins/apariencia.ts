/**
 * Tema que eligió el admin, en todo el portal y en `/corte` (sin assets: solo variables CSS).
 *
 * - En el servidor lee `GET /api/v1/apariencia/publica` (A6, `contratos/apariencia.md` §3) con un
 *   tope de 1,5 s: si falla o tarda, queda índigo y lo de fábrica, y la página sale igual. El
 *   resultado viaja en el payload (el navegador no la vuelve a pedir).
 * - Cambia la paleta primaria de Nuxt UI (`appConfig.ui.colors.primary` = `paleta.color`) y pone en
 *   `<html>` las variables del primario (`--ax-primario-claro|oscuro` = `paleta.claro|oscuro`,
 *   y su hover) y `data-tema`.
 * - `modo_predeterminado`: solo si el visitante no eligió claro u oscuro antes.
 */
export default defineNuxtPlugin(async () => {
    // Todo composable antes del primer `await` (después se pierde el contexto de Nuxt).
    const apariencia = useApariencia()
    const config = useRuntimeConfig()
    const appConfig = useAppConfig()
    const colorMode = useColorMode()
    const presetPedido = import.meta.server ? useRequestURL().searchParams.get('tema') : null

    const aplicar = (valor: Apariencia) => {
        appConfig.ui.colors.primary = valor.color
    }
    watch(apariencia, aplicar)

    useHead({
        htmlAttrs: {
            'data-tema': computed(() => apariencia.value.preset),
            'style': computed(() => variablesTema(apariencia.value)),
        },
    })

    if (import.meta.server) {
        apariencia.value = await leerApariencia(config.public.useFixtures === true, config.apiBaseInternal, presetPedido)
    }
    aplicar(apariencia.value)

    if (import.meta.client && apariencia.value.modo !== 'sistema') {
        let elegido: string | null = null
        try {
            elegido = localStorage.getItem('nuxt-color-mode')
        }
        catch {
            // sin almacenamiento: se respeta el sistema
        }
        if (!elegido) {
            colorMode.preference = apariencia.value.modo === 'oscuro' ? 'dark' : 'light'
        }
    }
})

async function leerApariencia(usarFixtures: boolean, apiBaseInternal: string | undefined, pedido: string | null): Promise<Apariencia> {
    if (usarFixtures) {
        const { aparienciaFixture } = await import('~~/fixtures/apariencia')
        return normalizarApariencia(aparienciaFixture(PRESETS_TEMA.find(p => p === pedido) ?? null))
    }
    if (!apiBaseInternal) {
        return APARIENCIA_DE_FABRICA
    }
    try {
        const datos = await $fetch<unknown>(`${apiBaseInternal.replace(/\/$/, '')}/api/v1/apariencia/publica`, { timeout: 1500 })
        return normalizarApariencia(datos)
    }
    catch {
        return APARIENCIA_DE_FABRICA
    }
}
