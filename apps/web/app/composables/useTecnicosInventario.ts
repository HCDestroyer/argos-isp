import type { Schema } from '@argosisp/contracts'

export type TecnicoInventario = Schema<'TecnicoInventario'>
export type MiBodegaInventario = Schema<'MiBodegaInventario'>

/** A quién se le pregunta por «Mi bodega»: el actor (sin nada) u otro técnico (solo con alcance global). */
export type TecnicoConsultado = { usuario_id?: number, empresa_id?: number }

/**
 * Técnicos con bodega y su bodega (A3, `contratos/inventario.md` D.6 y contrato Iris §3.3):
 * `GET /inventario/tecnicos` y `GET /inventario/mi-bodega` (existencias, unidades, órdenes por
 * recibir y los últimos 50 movimientos; el resto del kardex por `GET /inventario/movimientos`).
 */
export function useTecnicosInventario() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<TecnicoInventario>>> {
        return resolver(api.GET('/api/v1/inventario/tecnicos', { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } }))
    }

    /** Sin bodega: 404 `tecnico_sin_bodega`. Con bodegas en varias empresas y sin empresa: `{ bodegas }`. */
    function miBodega(consulta: TecnicoConsultado = {}): Promise<Resultado<MiBodegaInventario>> {
        return resolver(api.GET('/api/v1/inventario/mi-bodega', { params: { query: consulta } }))
    }

    return { listar, miBodega }
}
