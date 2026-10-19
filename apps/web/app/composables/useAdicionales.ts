import type { Schema, paths } from '@argosisp/contracts'

export type Adicional = Schema<'Adicional'>
export type MotivoCortesia = Schema<'MotivoCortesia'>
export type FiltrosAdicionales = Omit<NonNullable<paths['/api/v1/adicionales']['get']['parameters']['query']>, 'cursor'>
export type FiltrosMotivosCortesia = NonNullable<paths['/api/v1/adicionales/motivos']['get']['parameters']['query']>
export type DatosAdicional = paths['/api/v1/adicionales']['post']['requestBody']['content']['application/json']
export type CambiosAdicional = paths['/api/v1/adicionales/{id}']['put']['requestBody']['content']['application/json']
export type DatosMotivoCortesia = paths['/api/v1/adicionales/motivos']['post']['requestBody']['content']['application/json']

/**
 * Catálogo de servicios adicionales de la empresa (A1, `contratos/adicionales.md`): streaming,
 * IPTV… y los motivos de cortesía (comunes, `empresa_id = null`, más los de la empresa). Nada se
 * borra: se desactiva con `version` (409 si alguien lo cambió).
 */
export function useAdicionales() {
    const api = useApi()

    function listar(filtros: FiltrosAdicionales = {}, cursor?: string): Promise<Resultado<Pagina<Adicional>>> {
        const query: FiltrosAdicionales & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/adicionales', { params: { query } }))
    }

    /** Todos los activos (hasta 4 páginas de 200), para elegir uno en un formulario. */
    async function activos(filtros: FiltrosAdicionales = {}): Promise<Resultado<Adicional[]>> {
        const filas: Adicional[] = []
        let cursor: string | undefined
        for (let pagina = 0; pagina < 4; pagina++) {
            const resultado = await listar({ ...filtros, activo: true, limit: 200 }, cursor)
            if (!resultado.ok) {
                return resultado
            }
            filas.push(...resultado.data.data)
            if (!resultado.data.nextCursor) {
                break
            }
            cursor = resultado.data.nextCursor
        }
        return { ok: true, data: filas }
    }

    /** `POST /adicionales` (`adicionales.crear`); 409 `adicional_duplicado` por el código. */
    function crear(datos: DatosAdicional, claveIdempotencia: string): Promise<Resultado<Adicional>> {
        return resolver(api.POST('/api/v1/adicionales', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `PUT /adicionales/:id` (`adicionales.editar`) con la `version` leída. */
    function editar(id: number, cambios: CambiosAdicional): Promise<Resultado<Adicional>> {
        return resolver(api.PUT('/api/v1/adicionales/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /adicionales/:id/desactivar` (`adicionales.desactivar`): ya no se asigna ni lo traen los planes. */
    function desactivar(id: number, version: number): Promise<Resultado<Adicional>> {
        return resolver(api.POST('/api/v1/adicionales/{id}/desactivar', { params: { path: { id } }, body: { version } }))
    }

    /** `GET /adicionales/motivos`: los comunes más los de la empresa. */
    function motivos(filtros: FiltrosMotivosCortesia = {}): Promise<Resultado<MotivoCortesia[]>> {
        return resolver(api.GET('/api/v1/adicionales/motivos', { params: { query: filtros } }))
    }

    /** `POST /adicionales/motivos` (`adicionales.crear_motivo`); 409 `motivo_duplicado`. */
    function crearMotivo(datos: DatosMotivoCortesia, claveIdempotencia: string): Promise<Resultado<MotivoCortesia>> {
        return resolver(api.POST('/api/v1/adicionales/motivos', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /** `POST /adicionales/motivos/:id/desactivar` (`adicionales.desactivar_motivo`); uno común, solo con alcance global (403). */
    function desactivarMotivo(id: number, version: number): Promise<Resultado<MotivoCortesia>> {
        return resolver(api.POST('/api/v1/adicionales/motivos/{id}/desactivar', { params: { path: { id } }, body: { version } }))
    }

    return { listar, activos, crear, editar, desactivar, motivos, crearMotivo, desactivarMotivo }
}
