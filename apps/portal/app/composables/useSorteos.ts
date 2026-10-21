import type { Schema } from '@argosisp/contracts'

export type SorteoPortal = Schema<'PortalSorteo'>
export type SorteoPublico = Schema<'PortalSorteoPublico'>

/**
 * Sorteos del cliente de la sesión (`GET /portal/sorteos`, de A3): premios, regla de participación,
 * sus boletos, su seudónimo y, al terminar, los ganadores por seudónimo.
 */
export function useSorteos() {
    const api = useApi()
    const consulta = useAsyncData<Resultado<SorteoPortal[]>>(
        'portal:sorteos',
        () => resolver(api.GET('/api/v1/portal/sorteos')),
        { server: false, dedupe: 'defer' },
    )
    const sorteos = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    return { sorteos, problema, recargar: consulta.refresh }
}

/** Página pública de un sorteo (`GET /portal/sorteos/:id/publico`): bases, premios y resultado. */
export function useSorteoPublico(id: MaybeRefOrGetter<number>) {
    const api = useApi()
    const consulta = useAsyncData<Resultado<SorteoPublico>>(
        () => `portal:sorteo-publico:${toValue(id)}`,
        () => resolver(api.GET('/api/v1/portal/sorteos/{id}/publico', {
            params: { path: { id: toValue(id) } },
            headers: { 'X-Canal': 'portal' },
        })),
        { server: false },
    )
    const sorteo = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')
    return { sorteo, problema, cargando, recargar: consulta.refresh }
}
