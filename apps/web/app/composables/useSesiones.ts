import type { Schema, paths } from '@argosisp/contracts'

export type Sesion = Schema<'Sesion'>
export type FiltrosSesiones = Omit<NonNullable<paths['/api/v1/sesiones']['get']['parameters']['query']>, 'cursor'>

/** Sesiones PPPoE (accounting de RADIUS). */
export function useSesiones() {
    const api = useApi()

    function listar(filtros: FiltrosSesiones = {}, cursor?: string): Promise<Resultado<Pagina<Sesion>>> {
        const query: FiltrosSesiones & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/sesiones', { params: { query } }))
    }

    /** Sesión abierta del servicio (la más reciente), o `null` si no está conectado. */
    async function activaDe(servicioId: number): Promise<Resultado<Sesion | null>> {
        const resultado = await listar({ servicio_id: servicioId, activa: true, limit: 1 })
        return resultado.ok ? { ok: true, data: resultado.data.data[0] ?? null } : resultado
    }

    return { listar, activaDe }
}
