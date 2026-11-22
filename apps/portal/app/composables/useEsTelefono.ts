/**
 * `true` por debajo de 640 px (teléfono): el drawer de detalle sube desde abajo en vez de entrar
 * por la derecha. En el servidor y antes de montar, `false` (escritorio); se corrige al montar.
 */
export function useEsTelefono() {
    const telefono = ref(false)
    onMounted(() => {
        const consulta = window.matchMedia('(max-width: 639px)')
        telefono.value = consulta.matches
        const cambio = (evento: MediaQueryListEvent) => {
            telefono.value = evento.matches
        }
        consulta.addEventListener('change', cambio)
        onBeforeUnmount(() => consulta.removeEventListener('change', cambio))
    })
    return telefono
}
