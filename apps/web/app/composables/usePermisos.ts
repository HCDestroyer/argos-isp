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
    const router = useRouter()

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

    /**
     * Si el usuario puede abrir una ruta del panel: lee el `permiso` de su `definePageMeta`, el
     * mismo que valida `02.permiso.global.ts`. Para enlaces entre secciones (de una factura al
     * cliente, de un pago a la caja…): sin permiso el enlace no se muestra o queda como texto.
     */
    function puedeAbrir(ruta: string): boolean {
        const permiso = router.resolve(ruta).meta.permiso
        return !permiso || puede(permiso)
    }

    /** `ruta` si el usuario puede abrirla, o `undefined` para que `ULink`/`UButton` no enlacen. */
    function enlace(ruta: string): string | undefined {
        return puedeAbrir(ruta) ? ruta : undefined
    }

    /** Destino de una navegación después de guardar: `ruta` si se puede abrir, si no `alterna`. */
    function destinoPermitido(ruta: string, alterna = '/'): string {
        return puedeAbrir(ruta) ? ruta : alterna
    }

    return { permisos, puede, puedeAlguno, puedeTodos, puedeAbrir, enlace, destinoPermitido }
}
