import type { Problem } from '@argosisp/contracts'

/**
 * Estado de la caja del usuario, compartido por el acceso directo de la barra superior, la página
 * de caja y el cobro: se lee una vez (`GET /cajas`, `cajas.ver`) y se vuelve a leer al abrir o
 * cerrar un turno (`refrescar`). Sin `cajas.ver` no se pide nada.
 */
export function useMiCaja() {
    const usuario = useUsuarioActual()
    const { puede } = usePermisos()
    const cajas = useState<Caja[] | null>('mi-caja:cajas', () => null)
    const problema = useState<Problem | null>('mi-caja:problema', () => null)
    const cargando = useState('mi-caja:cargando', () => false)

    /** Las cajas activas que el usuario tiene asignadas o en las que abrió el turno. */
    const propias = computed(() => (cajas.value ?? []).filter(c => c.activa && (c.cajero_id === usuario.value?.id || c.turno_abierto_por === usuario.value?.id)))
    /** Su caja con turno abierto (la que recibe el efectivo que cobra), si tiene. */
    const abierta = computed(() => propias.value.find(c => c.turno_abierto_id !== null) ?? null)
    async function refrescar() {
        if (!puede('cajas.ver')) {
            return
        }
        cargando.value = true
        const resultado = await useCajas().listar()
        cargando.value = false
        cajas.value = resultado.ok ? resultado.data : null
        problema.value = resultado.ok ? null : resultado.problema
    }

    /** Lee las cajas si todavía no se leyeron en esta sesión. */
    async function cargar() {
        if (cajas.value === null && !cargando.value) {
            await refrescar()
        }
    }

    return { cajas, problema, cargando, propias, abierta, cargar, refrescar }
}
