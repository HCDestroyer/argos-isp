import type { Schema, paths } from '@argosisp/contracts'

export type CargoUnicoEmitido = Schema<'CargoUnicoEmitido'>
export type ConceptoCargo = Schema<'ConceptoCargo'>
export type MotivoSinCosto = Schema<'MotivoSinCosto'>
type CuerpoCargoUnico = paths['/api/v1/facturas/cargo-unico']['post']['requestBody']['content']['application/json']

/**
 * Cargo único manual (A3): instalación, equipo, visita técnica… con conceptos del catálogo de la
 * empresa. Con total Q0 no hay factura sino una bonificación (`documento = 'bonificacion'`), con su
 * motivo y el permiso `facturas.cargo_sin_costo`.
 */
export function useCargoUnico() {
    const api = useApi()

    /** `POST /facturas/cargo-unico` (`facturas.emitir_cargo_unico`). */
    function emitir(cuerpo: CuerpoCargoUnico, claveIdempotencia: string): Promise<Resultado<CargoUnicoEmitido>> {
        return resolver(api.POST('/api/v1/facturas/cargo-unico', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: cuerpo,
        }))
    }

    /** Conceptos activos del catálogo (`facturas.ver`); con alcance global, de todas las empresas. */
    function conceptos(todas = false): Promise<Resultado<ConceptoCargo[]>> {
        return resolver(api.GET('/api/v1/conceptos-cargo', { params: { query: todas ? { activo: true, empresas: 'todas' } : { activo: true } } }))
    }

    /** Motivos activos de un cargo sin costo (`facturas.ver`); con alcance global, de todas las empresas. */
    function motivos(todas = false): Promise<Resultado<MotivoSinCosto[]>> {
        return resolver(api.GET('/api/v1/motivos-sin-costo', { params: { query: todas ? { activo: true, empresas: 'todas' } : { activo: true } } }))
    }

    return { emitir, conceptos, motivos }
}
