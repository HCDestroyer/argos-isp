import type { Schema, paths } from '@argosisp/contracts'

export type ResultadoCorte = Schema<'ResultadoCorte'>

export type Factura = Schema<'Factura'>
export type FacturaDetalle = Schema<'FacturaDetalle'>
export type FacturaLinea = Schema<'FacturaLinea'>
export type NotaCreditoEmitida = Schema<'NotaCreditoEmitida'>
export type DatosNotaCredito = paths['/api/v1/facturas/{id}/notas-credito']['post']['requestBody']['content']['application/json']
export type SustitucionFactura = Schema<'SustitucionFactura'>
export type DatosSustituir = paths['/api/v1/facturas/{id}/sustituir']['post']['requestBody']['content']['application/json']
export type FiltrosFacturas = Omit<NonNullable<paths['/api/v1/facturas']['get']['parameters']['query']>, 'cursor'>

export type ResultadoGeneracion = Schema<'ResultadoGeneracion'>
export type ResultadoVencimiento = Schema<'ResultadoVencimiento'>

export const LIMITE_FACTURAS = 25

/** Facturas (avisos de cobro): lista con filtros, detalle con líneas y anulación con motivo. */
export function useFacturas() {
    const api = useApi()

    function listar(filtros: FiltrosFacturas = {}, cursor?: string): Promise<Resultado<Pagina<Factura>>> {
        const query: FiltrosFacturas & { cursor?: string } = { limit: LIMITE_FACTURAS, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/facturas', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<FacturaDetalle>> {
        return resolver(api.GET('/api/v1/facturas/{id}', { params: { path: { id } } }))
    }

    /**
     * `POST /facturas/:id/anular` con motivo (`facturas.anular`): la API revierte su asiento. Con
     * DTE certificado exige además `fel.anular` y responde con `fel_estado = anulacion_pendiente`
     * (se anula cuando el certificador confirma); 422 `anulacion_fuera_de_plazo`, 409
     * `anulacion_en_proceso`, `factura_con_ndeb`.
     */
    function anular(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Factura>> {
        return resolver(api.POST('/api/v1/facturas/{id}/anular', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
    }

    /**
     * `POST /facturas/:id/notas-credito` (`facturas.nota_credito`): nota de crédito interna, parcial o
     * total, sobre el saldo. Devuelve la factura con su nuevo saldo y `servicios[]` (reactivación).
     * 422 `monto` si excede el saldo; 409 `factura_anulada` o `factura_sin_saldo`.
     */
    function notaCredito(id: number, datos: DatosNotaCredito, claveIdempotencia: string): Promise<Resultado<NotaCreditoEmitida>> {
        return resolver(api.POST('/api/v1/facturas/{id}/notas-credito', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /**
     * `POST /facturas/:id/sustituir` (`facturas.sustituir`): anula la original (sin DTE certificado)
     * o la acredita con una NCRE por todo su saldo, y emite una nueva del mismo periodo con el
     * receptor corregido. 409 `sustitucion_no_permitida`, `factura_anulada`; 422 `nota_fuera_de_plazo`.
     */
    function sustituir(id: number, datos: DatosSustituir, claveIdempotencia: string): Promise<Resultado<SustitucionFactura>> {
        return resolver(api.POST('/api/v1/facturas/{id}/sustituir', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
    }

    /**
     * `POST /facturas/generar` (`facturas.generar`): todo lo pendiente hasta hoy. Lo que cae bajo un
     * bloqueo del libro no se contabiliza: va en `bloqueados` y `bloqueos[]` y se reintenta después.
     */
    function generar(claveIdempotencia: string): Promise<Resultado<ResultadoGeneracion>> {
        return resolver(api.POST('/api/v1/facturas/generar', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: {},
        }))
    }

    /** `POST /facturas/vencer` (`facturas.generar`): vence lo vencido y crea las moras; igual con los bloqueos. */
    function vencer(claveIdempotencia: string): Promise<Resultado<ResultadoVencimiento>> {
        return resolver(api.POST('/api/v1/facturas/vencer', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: {},
        }))
    }

    /**
     * `GET /facturas/corridas` (`facturas.ver`): la última corrida de facturar y de vencer de cada
     * empresa, con lo que quedó pendiente por un bloqueo del libro. No corre nada.
     */
    function corridas(): Promise<Resultado<CorridasFacturacion[]>> {
        return resolver(api.GET('/api/v1/facturas/corridas'))
    }

    /**
     * `POST /facturas/corte` (`facturas.generar`): corre el corte ahora: vence lo pendiente y evalúa
     * el estado de los servicios cuya hora de corte ya pasó hoy (o solo `servicio_id`).
     */
    function corte(claveIdempotencia: string, servicioId?: number): Promise<Resultado<ResultadoCorte>> {
        return resolver(api.POST('/api/v1/facturas/corte', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: servicioId ? { servicio_id: servicioId } : {},
        }))
    }

    return { listar, ver, anular, notaCredito, sustituir, generar, vencer, corridas, corte }
}
