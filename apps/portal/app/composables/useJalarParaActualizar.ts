/**
 * "Jalar para actualizar" sin dependencias: con la página arriba del todo, un arrastre hacia abajo
 * de al menos `umbral` px (ya amortiguado) llama a `alActualizar` al soltar.
 *
 * - Escucha `touch*` en `window` con `passive: true`: nunca bloquea el scroll nativo.
 * - No se activa con un modal abierto ni si el arrastre empezó con la página desplazada.
 * - Es un atajo: cada pantalla que lo usa tiene también un botón "Actualizar" (WCAG 2.5.1, gestos
 *   con alternativa de un solo toque).
 */
export function useJalarParaActualizar(alActualizar: () => void, opciones: { umbral?: number, maximo?: number } = {}) {
    const umbral = opciones.umbral ?? 64
    const maximo = opciones.maximo ?? 96
    const distancia = ref(0)
    const listo = computed(() => distancia.value >= umbral)
    let inicioY: number | null = null

    function hayModalAbierto(): boolean {
        return document.querySelector('[role="dialog"]') !== null
    }

    function alTocar(evento: TouchEvent) {
        inicioY = evento.touches.length === 1 && window.scrollY <= 0 && !hayModalAbierto()
            ? evento.touches[0]!.clientY
            : null
    }

    function alMover(evento: TouchEvent) {
        if (inicioY === null) {
            return
        }
        if (window.scrollY > 0) {
            inicioY = null
            distancia.value = 0
            return
        }
        const recorrido = evento.touches[0]!.clientY - inicioY
        // Amortiguado a la mitad, como el gesto nativo: hay que arrastrar con intención.
        distancia.value = recorrido > 0 ? Math.min(recorrido / 2, maximo) : 0
    }

    function alSoltar() {
        if (inicioY !== null && listo.value) {
            alActualizar()
        }
        inicioY = null
        distancia.value = 0
    }

    onMounted(() => {
        window.addEventListener('touchstart', alTocar, { passive: true })
        window.addEventListener('touchmove', alMover, { passive: true })
        window.addEventListener('touchend', alSoltar, { passive: true })
        window.addEventListener('touchcancel', alSoltar, { passive: true })
    })
    onBeforeUnmount(() => {
        window.removeEventListener('touchstart', alTocar)
        window.removeEventListener('touchmove', alMover)
        window.removeEventListener('touchend', alSoltar)
        window.removeEventListener('touchcancel', alSoltar)
    })

    return { distancia: readonly(distancia), listo, umbral }
}
