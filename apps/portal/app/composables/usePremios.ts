import type { Schema } from '@argosisp/contracts'

export type PremioPortal = Schema<'PortalPremio'>

/**
 * Premios canjeables desde el portal (`GET /portal/premios`): los de `en_portal` de los programas
 * visibles del cliente, del más barato al más caro, con `faltan` y por qué no se puede todavía.
 */
export function usePremios() {
    const api = useApi()
    const consulta = useAsyncData<Resultado<PremioPortal[]>>(
        'portal:premios',
        async () => {
            const leido = await resolver(api.GET('/api/v1/portal/premios'))
            return leido.ok ? { ok: true, data: leido.data.data } : leido
        },
        { server: false, dedupe: 'defer' },
    )
    const premios = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    return { premios, problema, recargar: consulta.refresh }
}
