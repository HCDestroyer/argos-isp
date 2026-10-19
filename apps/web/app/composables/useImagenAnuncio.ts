import type { Problem } from '@argosisp/contracts'

/**
 * Imagen de un anuncio para verla en el panel: `GET /anuncios/:id/imagen` va con la sesión de la
 * API (otro origen), así que se pide como `Blob` y se muestra con una URL de objeto que se libera
 * al cambiar o al salir. Se vuelve a pedir cuando cambia `imagen.url` (lleva la huella `?v=`).
 */
export function useImagenAnuncio(anuncio: () => Anuncio | null) {
    const url = ref<string | null>(null)
    const cargando = ref(false)
    const problema = ref<Problem | null>(null)

    function liberar() {
        if (url.value) {
            URL.revokeObjectURL(url.value)
            url.value = null
        }
    }

    async function cargar() {
        const actual = anuncio()
        liberar()
        problema.value = null
        if (!actual?.imagen) {
            return
        }
        cargando.value = true
        const resultado = await useAnuncios().imagen(actual.id)
        cargando.value = false
        if (!resultado.ok) {
            problema.value = resultado.problema
            return
        }
        const blob = resultado.data.type ? resultado.data : new Blob([resultado.data], { type: actual.imagen.tipo })
        url.value = URL.createObjectURL(blob)
    }

    watch(() => anuncio()?.imagen?.url ?? null, () => void cargar(), { immediate: true })
    onBeforeUnmount(liberar)

    return { url, cargando, problema, cargar }
}
