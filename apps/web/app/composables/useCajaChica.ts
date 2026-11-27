import type { Schema, paths } from '@argosisp/contracts'

export type EstadoCajaChica = Schema<'EstadoCajaChica'>
export type GastoCajaChica = Schema<'GastoCajaChica'>
export type ReposicionCaja = Schema<'ReposicionCaja'>
export type ConteoCaja = Schema<'ConteoCaja'>
type CuerpoGasto = paths['/api/v1/cajas/{id}/gastos']['post']['requestBody']['content']['multipart/form-data']
export type DatosGastoCajaChica = Omit<CuerpoGasto, 'archivo'>
export type DatosReponerCajaChica = paths['/api/v1/cajas/{id}/reponer']['post']['requestBody']['content']['application/json']
export type DatosContarCaja = paths['/api/v1/cajas/{id}/contar']['post']['requestBody']['content']['application/json']

/**
 * Caja chica (B9 del plan de contabilidad, §5.7; tablero PlanCajas): fondo fijo que cumple
 * «efectivo + comprobantes sin reponer = fondo». Gasto con comprobante obligatorio (sin tope por
 * gasto, decisión del PM), reposición por lo gastado desde la custodia o el banco, y conteo sorpresa.
 */
export function useCajaChica() {
    const api = useApi()

    /** `GET /cajas/:id/caja-chica` (`cajas.ver`); 422 `no_es_caja_chica` con una caja de cobros. */
    function estado(cajaId: number): Promise<Resultado<EstadoCajaChica>> {
        return resolver(api.GET('/api/v1/cajas/{id}/caja-chica', { params: { path: { id: cajaId } } }))
    }

    /**
     * `POST /cajas/:id/gastos` (`caja_chica.registrar_gasto`), multipart con el comprobante
     * (`archivo`, obligatorio). 422 `efectivo_insuficiente`; con factura, `pasar_a_compras`.
     */
    function registrarGasto(cajaId: number, datos: DatosGastoCajaChica, archivo: File, clave: string): Promise<Resultado<GastoCajaChica>> {
        return resolver(api.POST('/api/v1/cajas/{id}/gastos', {
            params: { path: { id: cajaId }, header: { 'Idempotency-Key': clave } },
            body: { ...datos, archivo: archivo.name },
            bodySerializer: () => {
                const formulario = new FormData()
                for (const [nombre, valor] of Object.entries(datos)) {
                    if (valor !== undefined && valor !== null) {
                        formulario.append(nombre, String(valor))
                    }
                }
                formulario.append('archivo', archivo, archivo.name)
                return formulario
            },
        }))
    }

    /** `POST /cajas/:id/reponer` (`caja_chica.reponer`): por lo gastado; sella los comprobantes. */
    function reponer(cajaId: number, datos: DatosReponerCajaChica, clave: string): Promise<Resultado<ReposicionCaja>> {
        return resolver(api.POST('/api/v1/cajas/{id}/reponer', {
            params: { path: { id: cajaId }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    /** `POST /cajas/:id/contar` (`caja_chica.contar`): con diferencia, motivo obligatorio. */
    function contar(cajaId: number, datos: DatosContarCaja, clave: string): Promise<Resultado<ConteoCaja>> {
        return resolver(api.POST('/api/v1/cajas/{id}/contar', {
            params: { path: { id: cajaId }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    function reposiciones(cajaId: number, cursor?: string): Promise<Resultado<Pagina<ReposicionCaja>>> {
        const query: { limit: number, cursor?: string } = { limit: 20 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cajas/{id}/reposiciones', { params: { path: { id: cajaId }, query } }))
    }

    function conteos(cajaId: number, cursor?: string): Promise<Resultado<Pagina<ConteoCaja>>> {
        const query: { limit: number, cursor?: string } = { limit: 20 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/cajas/{id}/conteos', { params: { path: { id: cajaId }, query } }))
    }

    return { estado, registrarGasto, reponer, contar, reposiciones, conteos }
}
