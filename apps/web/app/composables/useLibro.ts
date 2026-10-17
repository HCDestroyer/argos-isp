import type { Schema, paths } from '@argosisp/contracts'

export type Cuenta = Schema<'Cuenta'>
export type Asiento = Schema<'Asiento'>
export type MovimientoAsiento = Schema<'Movimiento'>
export type Mayor = Schema<'Mayor'>
export type LineaMayor = Schema<'LineaMayor'>
export type OrigenAsiento = Asiento['origen_tipo']
export type FiltrosDiario = Omit<NonNullable<paths['/api/v1/libro/diario']['get']['parameters']['query']>, 'cursor'>
export type FiltrosMayor = Omit<paths['/api/v1/libro/mayor']['get']['parameters']['query'], 'cursor'>
export type CierrePeriodo = Schema<'CierrePeriodo'>
export type BancoLibro = Schema<'BancoLibro'>

/** Libro contable: plan de cuentas, diario, mayor y cierre mensual. */
export function useLibro() {
    const api = useApi()

    function cuentas(): Promise<Resultado<Cuenta[]>> {
        return resolver(api.GET('/api/v1/libro/cuentas'))
    }

    function diario(filtros: FiltrosDiario = {}, cursor?: string): Promise<Resultado<Pagina<Asiento>>> {
        const query: FiltrosDiario & { cursor?: string } = { limit: 50, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libro/diario', { params: { query } }))
    }

    function mayor(filtros: FiltrosMayor, cursor?: string): Promise<Resultado<Mayor>> {
        const query: FiltrosMayor & { cursor?: string } = { limit: 100, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libro/mayor', { params: { query } }))
    }

    /**
     * Asientos de un origen (`factura 12`, `pago 30`), reversos incluidos. El diario no filtra
     * por `origen_id` (pedido a A3), así que se pide ese tipo de origen entre `desde` y `hasta`
     * y se filtra por id.
     */
    async function asientosDe(origen: OrigenAsiento, origenId: number, desde: string, hasta?: string): Promise<Resultado<Asiento[]>> {
        const encontrados: Asiento[] = []
        let cursor: string | undefined
        // Un día de facturación masiva puede tener cientos de asientos: hasta 5 páginas de 200.
        for (let pagina = 0; pagina < 5; pagina++) {
            const filtros: FiltrosDiario = { origen_tipo: origen, desde, limit: 200 }
            if (hasta) {
                filtros.hasta = hasta
            }
            const resultado = await diario(filtros, cursor)
            if (!resultado.ok) {
                return resultado
            }
            encontrados.push(...resultado.data.data.filter(a => a.origen_id === origenId))
            if (!resultado.data.nextCursor) {
                break
            }
            cursor = resultado.data.nextCursor
        }
        return { ok: true, data: encontrados.sort((a, b) => a.id - b.id) }
    }

    /** `GET /libro/periodos`: meses cerrados y reabiertos, el más reciente primero. */
    function periodos(cursor?: string): Promise<Resultado<Pagina<CierrePeriodo>>> {
        const query: { limit: number, cursor?: string } = { limit: 24 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/libro/periodos', { params: { query } }))
    }

    /**
     * `POST /libro/periodos/cerrar` (`libro.cerrar_periodo`): ningún asiento podrá tener fecha en
     * ese mes. 422 `periodo_en_curso` para el mes actual; 409 `periodo_cerrado`.
     */
    function cerrarPeriodo(periodo: string, claveIdempotencia: string): Promise<Resultado<CierrePeriodo>> {
        return resolver(api.POST('/api/v1/libro/periodos/cerrar', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: anioMes(periodo),
        }))
    }

    /** `POST /libro/periodos/reabrir` (`libro.reabrir_periodo`) con motivo; 409 `periodo_abierto`. */
    function reabrirPeriodo(periodo: string, motivo: string, claveIdempotencia: string): Promise<Resultado<CierrePeriodo>> {
        return resolver(api.POST('/api/v1/libro/periodos/reabrir', {
            params: { header: { 'Idempotency-Key': claveIdempotencia } },
            body: { ...anioMes(periodo), motivo },
        }))
    }

    /**
     * `GET /libro/bancos` (`egresos.ver`): cuentas bancarias contables de `ledger.bancos`; su `id`
     * es el `banco_id` de un egreso con método `banco`. El número viene enmascarado.
     */
    function bancos(): Promise<Resultado<BancoLibro[]>> {
        return resolver(api.GET('/api/v1/libro/bancos'))
    }

    return { cuentas, diario, mayor, asientosDe, periodos, cerrarPeriodo, reabrirPeriodo, bancos }
}
