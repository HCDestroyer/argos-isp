import type { Schema, paths } from '@argosisp/contracts'

export type ObligacionFiscal = Schema<'ObligacionFiscal'>
export type FiltrosObligaciones = Omit<NonNullable<paths['/api/v1/fiscal/obligaciones']['get']['parameters']['query']>, 'cursor' | 'empresas' | 'vencida'>

/** Páginas que se leen como máximo para llenar un mes (200 obligaciones por página). */
const PAGINAS_POR_RANGO = 10

/**
 * Calendario fiscal (A3, fase 7 PR A): obligaciones de la empresa activa (o de todas con «Todas») por
 * vencimiento ascendente. Las genera el cron `fiscal:calendario`; aquí solo se leen. `dias_restantes`
 * y `vencida` los calcula la API con la fecha de hoy en Guatemala.
 */
export function useObligacionesFiscales() {
    const api = useApi()

    /** `GET /fiscal/obligaciones` (`declaraciones.ver`): una página con los filtros. */
    function listar(filtros: FiltrosObligaciones = {}, cursor?: string): Promise<Resultado<Pagina<ObligacionFiscal>>> {
        return resolver(api.GET('/api/v1/fiscal/obligaciones', { params: { query: { limit: 25, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** Todas las obligaciones que vencen entre `desde` y `hasta` (la vista por mes), siguiendo el cursor. */
    async function delRango(desde: string, hasta: string, filtros: Omit<FiltrosObligaciones, 'desde' | 'hasta' | 'limit'> = {}): Promise<Resultado<ObligacionFiscal[]>> {
        const todas: ObligacionFiscal[] = []
        let cursor: string | undefined
        for (let pagina = 0; pagina < PAGINAS_POR_RANGO; pagina++) {
            const resultado = await resolver(api.GET('/api/v1/fiscal/obligaciones', { params: { query: { ...filtros, desde, hasta, limit: 200, ...(cursor ? { cursor } : {}) } } }))
            if (!resultado.ok) {
                return resultado
            }
            todas.push(...resultado.data.data)
            if (!resultado.data.nextCursor) {
                break
            }
            cursor = resultado.data.nextCursor
        }
        return { ok: true, data: todas }
    }

    /** Todas las vencidas sin presentar (`?vencida=true`, pendientes o borradores con el plazo pasado), siguiendo el cursor. */
    async function vencidas(): Promise<Resultado<ObligacionFiscal[]>> {
        const todas: ObligacionFiscal[] = []
        let cursor: string | undefined
        for (let pagina = 0; pagina < PAGINAS_POR_RANGO; pagina++) {
            const resultado = await resolver(api.GET('/api/v1/fiscal/obligaciones', { params: { query: { vencida: true, limit: 200, ...(cursor ? { cursor } : {}) } } }))
            if (!resultado.ok) {
                return resultado
            }
            todas.push(...resultado.data.data)
            if (!resultado.data.nextCursor) {
                break
            }
            cursor = resultado.data.nextCursor
        }
        return { ok: true, data: todas }
    }

    /** `GET /fiscal/obligaciones/:id`: con la regla del vencimiento (`regla`). */
    function ver(id: number): Promise<Resultado<ObligacionFiscal>> {
        return resolver(api.GET('/api/v1/fiscal/obligaciones/{id}', { params: { path: { id } } }))
    }

    return { listar, delRango, vencidas, ver }
}
