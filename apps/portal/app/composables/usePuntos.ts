import type { Schema } from '@argosisp/contracts'

export type PuntosEmpresa = Schema<'PortalPuntosEmpresa'>
export type MovimientoPuntos = PuntosEmpresa['movimientos'][number]

/**
 * Puntos de lealtad del cliente de la sesión (`GET /portal/puntos`, contrato `lealtad.md` §12): una
 * sección por empresa cuyo programa tiene `visible_portal`. Lista vacía = el programa no está
 * activado en el portal, y entonces ni la sección ni su pestaña aparecen.
 *
 * Una sola petición compartida (layout, `/cuenta`): misma clave y `dedupe: 'defer'`. Solo en el
 * navegador y solo con la sesión confirmada (sin ella respondería 401).
 */
export function usePuntos() {
    const api = useApi()
    const sesion = useSesionPortal()

    const consulta = useAsyncData<Resultado<PuntosEmpresa[]> | null>(
        'portal:puntos',
        async () => {
            if (!sesion.activa.value) {
                return null
            }
            const leido = await resolver(api.GET('/api/v1/portal/puntos'))
            return leido.ok ? { ok: true, data: leido.data.data } : leido
        },
        { server: false, dedupe: 'defer', watch: [sesion.activa] },
    )

    const empresas = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    /** ¿El cliente tiene el programa visible en alguna empresa? (la pestaña "Puntos") */
    const visible = computed(() => (empresas.value?.length ?? 0) > 0)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')

    return { empresas, problema, visible, cargando, recargar: consulta.refresh }
}
