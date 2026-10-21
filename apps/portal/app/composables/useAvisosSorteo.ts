import type { Problem, Schema } from '@argosisp/contracts'
import type { LugarAnuncio } from '~/composables/useAnuncios'

export type AvisoSorteo = Schema<'PortalAvisoSorteo'>

/**
 * Sorteos próximos para el carrusel (`GET /portal/avisos-sorteo?lugar=`): solo los que el panel ya
 * abrió al público (bases publicadas). En la página de corte la API identifica al cliente por la IP;
 * en el inicio, por la sesión. Sin ninguno, lista vacía y la página queda igual.
 */
export function useAvisosSorteo(lugar: LugarAnuncio) {
    const api = useApi()
    const avisos = ref<AvisoSorteo[]>([])
    const problema = ref<Problem | null>(null)

    async function cargar(): Promise<void> {
        const resultado = await resolver(api.GET('/api/v1/portal/avisos-sorteo', {
            params: { query: { lugar } },
            headers: { 'X-Canal': 'portal' },
        }))
        if (resultado.ok) {
            avisos.value = resultado.data.data
            problema.value = null
        }
        else {
            problema.value = resultado.problema
        }
    }

    return { avisos, problema, cargar }
}
