/**
 * Qué pantallas de Configuración puede abrir el usuario (`utils/configuracionSecciones.ts`): las de
 * permiso con `puede()`; las que todavía no tienen permiso propio (`permiso: null`, como Importar
 * desde Mikrowisp, decisión 24 del PM) solo con el rol `admin`.
 */
export function usePaginasConfiguracion() {
    const { puede } = usePermisos()
    const usuario = useUsuarioActual()

    const esAdmin = computed(() => usuario.value?.roles?.includes('admin') === true)

    function puedePagina(pagina: PaginaConfiguracion): boolean {
        return pagina.permiso === null ? esAdmin.value : puede(pagina.permiso)
    }

    return { esAdmin, puedePagina }
}
