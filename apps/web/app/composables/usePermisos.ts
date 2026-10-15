/**
 * Permisos del usuario actual. El nombre del permiso es el de la acción del backend
 * (`servicios.suspender`), así que el botón y la ruta usan el mismo texto.
 *
 * ```ts
 * const { puede } = usePermisos()
 * puede('servicios.suspender')
 * ```
 */
export function usePermisos() {
    const usuario = useUsuarioActual()

    const permisos = computed(() => new Set(usuario.value?.permisos ?? []))

    function puede(permiso: string): boolean {
        return permisos.value.has(permiso)
    }

    function puedeAlguno(lista: readonly string[]): boolean {
        return lista.some(puede)
    }

    function puedeTodos(lista: readonly string[]): boolean {
        return lista.every(puede)
    }

    return { permisos, puede, puedeAlguno, puedeTodos }
}
