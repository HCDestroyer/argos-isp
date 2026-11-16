/**
 * Permisos del usuario actual. El nombre del permiso es el de la acción del backend
 * (`servicios.suspender`), así que el botón y la ruta usan el mismo texto.
 *
 * ```ts
 * const { puede } = usePermisos()
 * puede('servicios.suspender')
 * puede(['horus.ver', 'iris.ver']) // basta uno (el `permiso` de una página o sección con varias tarjetas)
 * ```
 */
export function usePermisos() {
    const usuario = useUsuarioActual()
    const router = useRouter()

    const permisos = computed(() => new Set(usuario.value?.permisos ?? []))

    /** Con una lista, basta uno (igual que `puedeAlguno`): así se lee el `permiso` de páginas y secciones. */
    function puede(permiso: string | readonly string[]): boolean {
        return typeof permiso === 'string' ? permisos.value.has(permiso) : puedeAlguno(permiso)
    }

    function puedeAlguno(lista: readonly string[]): boolean {
        return lista.some(permiso => permisos.value.has(permiso))
    }

    function puedeTodos(lista: readonly string[]): boolean {
        return lista.every(permiso => permisos.value.has(permiso))
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
