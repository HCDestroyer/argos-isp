/**
 * Qué ajustes puede abrir el usuario (`utils/configuracionSecciones.ts`): las pantallas con permiso,
 * con `puede()`; las que todavía no tienen permiso propio (`permiso: null`, como Importar desde
 * Mikrowisp, decisión 24 del PM) solo con el rol `admin`. Un grupo sin ninguna pantalla permitida
 * no aparece (respuestas del PM, 26 nov 2026), y el buscador tampoco encuentra lo no permitido.
 */
export function usePaginasConfiguracion() {
    const { puede } = usePermisos()
    const usuario = useUsuarioActual()

    const esAdmin = computed(() => usuario.value?.roles?.includes('admin') === true)

    function puedePagina(pagina: PaginaConfiguracion): boolean {
        return pagina.permiso === null ? esAdmin.value : puede(pagina.permiso)
    }

    /** Los grupos de Ajustes con sus pantallas permitidas (sin grupos vacíos). */
    const grupos = computed(() => gruposAjustesVisibles(puedePagina))

    /** Si hay algo de Ajustes que el usuario pueda abrir (el enlace «Ajustes» del menú). */
    const hayAjustes = computed(() => grupos.value.length > 0)

    function buscar(texto: string): ResultadoAjuste[] {
        return buscarAjustes(grupos.value, texto)
    }

    return { esAdmin, puedePagina, grupos, hayAjustes, buscar }
}
