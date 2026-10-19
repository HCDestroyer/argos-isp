/**
 * `prefers-reduced-motion: reduce` del sistema, reactivo. Sin `window` (SSR) se asume reducido:
 * nada se anima hasta saber que se puede.
 */
export function useMovimientoReducido() {
    const reducido = ref(true)
    let consulta: MediaQueryList | null = null
    const actualizar = () => {
        reducido.value = consulta?.matches ?? true
    }
    onMounted(() => {
        if (typeof window.matchMedia !== 'function') {
            reducido.value = false
            return
        }
        consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
        actualizar()
        consulta.addEventListener('change', actualizar)
    })
    onBeforeUnmount(() => consulta?.removeEventListener('change', actualizar))
    return reducido
}
