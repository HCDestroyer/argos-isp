import type { Schema, paths } from '@argosisp/contracts'

export type AccionAuditoria = Schema<'AccionAuditoria'>
export type FiltrosAcciones = Omit<NonNullable<paths['/api/v1/bitacora/acciones']['get']['parameters']['query']>, 'cursor'>

export interface EntidadAuditada {
    tipo: string
    id: number
}

/** Bitácora de acciones (`audit.acciones`). */
export function useBitacora() {
    const api = useApi()

    function acciones(filtros: FiltrosAcciones = {}, cursor?: string): Promise<Resultado<Pagina<AccionAuditoria>>> {
        const query: FiltrosAcciones & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/bitacora/acciones', { params: { query } }))
    }

    /**
     * Últimas acciones de varias entidades juntas, de la más reciente a la más vieja.
     * La ficha del cliente la usa con el cliente y cada uno de sus servicios mientras la API
     * no filtre la bitácora por cliente (pedido a A1 en INTEGRATION.md).
     */
    async function deEntidades(entidades: EntidadAuditada[], limitePorEntidad = 50): Promise<Resultado<AccionAuditoria[]>> {
        const resultados = await Promise.all(entidades.map(entidad => acciones({
            entidad_tipo: entidad.tipo,
            entidad_id: entidad.id,
            limit: limitePorEntidad,
        })))
        const unidas: AccionAuditoria[] = []
        for (const resultado of resultados) {
            if (!resultado.ok) {
                return resultado
            }
            unidas.push(...resultado.data.data)
        }
        unidas.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        return { ok: true, data: unidas }
    }

    return { acciones, deEntidades }
}
