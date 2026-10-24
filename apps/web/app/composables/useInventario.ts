import type { Schema, paths } from '@argosisp/contracts'

export type ExistenciaInventario = Schema<'ExistenciaInventario'>
export type MovimientoInventario = Schema<'MovimientoInventario'>
export type TrasladoInventario = Schema<'TrasladoInventario'>
export type TipoMovimientoInventario = MovimientoInventario['tipo']
export type FiltrosExistencias = Omit<NonNullable<paths['/api/v1/inventario/existencias']['get']['parameters']['query']>, 'cursor'>
export type FiltrosKardex = Omit<NonNullable<paths['/api/v1/inventario/movimientos']['get']['parameters']['query']>, 'cursor'>
export type DatosSaldoInicial = paths['/api/v1/inventario/saldos-iniciales']['post']['requestBody']['content']['application/json']
export type DatosConsumo = paths['/api/v1/inventario/consumos']['post']['requestBody']['content']['application/json']
export type DatosTraslado = paths['/api/v1/inventario/traslados']['post']['requestBody']['content']['application/json']
export type DatosAjuste = paths['/api/v1/inventario/ajustes']['post']['requestBody']['content']['application/json']
export type DatosBaja = paths['/api/v1/inventario/bajas']['post']['requestBody']['content']['application/json']

/**
 * Existencias, kardex y movimientos del inventario (A3, `contratos/inventario.md` §5 y §6). Todo
 * lo que mueve inventario lleva `Idempotency-Key`; una salida mayor que la existencia es 409
 * `existencia_insuficiente` y no deja nada.
 */
export function useInventario() {
    const api = useApi()
    const conClave = (clave: string) => ({ header: { 'Idempotency-Key': clave } })

    /** `GET /inventario/existencias`: cantidad, valor y costo promedio por producto × bodega. */
    function existencias(filtros: FiltrosExistencias = {}, cursor?: string): Promise<Resultado<Pagina<ExistenciaInventario>>> {
        const query: FiltrosExistencias & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/inventario/existencias', { params: { query } }))
    }

    /** `GET /inventario/movimientos`: el kardex, con saldo corrido por producto y bodega. */
    function kardex(filtros: FiltrosKardex = {}, cursor?: string): Promise<Resultado<Pagina<MovimientoInventario>>> {
        const query: FiltrosKardex & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/inventario/movimientos', { params: { query } }))
    }

    /** `POST /inventario/saldos-iniciales` (`inventario.cargar_saldo_inicial`): una vez por producto y bodega. */
    function saldoInicial(datos: DatosSaldoInicial, clave: string): Promise<Resultado<MovimientoInventario>> {
        return resolver(api.POST('/api/v1/inventario/saldos-iniciales', { body: datos, params: conClave(clave) }))
    }

    /** `POST /inventario/consumos` (`inventario.consumir`): materiales de una instalación o reparación. */
    function consumir(datos: DatosConsumo, clave: string): Promise<Resultado<MovimientoInventario>> {
        return resolver(api.POST('/api/v1/inventario/consumos', { body: datos, params: conClave(clave) }))
    }

    /** `POST /inventario/traslados` (`inventario.trasladar`): mismo costo, sin asiento. */
    function trasladar(datos: DatosTraslado, clave: string): Promise<Resultado<TrasladoInventario>> {
        return resolver(api.POST('/api/v1/inventario/traslados', { body: datos, params: conClave(clave) }))
    }

    /** `POST /inventario/ajustes` (`inventario.ajustar`): ± con motivo. */
    function ajustar(datos: DatosAjuste, clave: string): Promise<Resultado<MovimientoInventario>> {
        return resolver(api.POST('/api/v1/inventario/ajustes', { body: datos, params: conClave(clave) }))
    }

    /** `POST /inventario/bajas` (`inventario.dar_de_baja`): dañado, robado, obsoleto u otro. */
    function darDeBaja(datos: DatosBaja, clave: string): Promise<Resultado<MovimientoInventario>> {
        return resolver(api.POST('/api/v1/inventario/bajas', { body: datos, params: conClave(clave) }))
    }

    return { existencias, kardex, saldoInicial, consumir, trasladar, ajustar, darDeBaja }
}
