import type { Schema } from '@argosisp/contracts'

export type ConciliacionPasarela = Schema<'ConciliacionPasarela'>

/** Conciliación de los cobros en línea contra el proveedor de la pasarela (A3). */
export function usePasarela() {
    const api = useApi()

    /** `GET /pasarela/conciliaciones` (`pagos.ver`): corridas con sus diferencias, de la más reciente. */
    function conciliaciones(fecha?: string, cursor?: string): Promise<Resultado<Pagina<ConciliacionPasarela>>> {
        const query: { limit: number, fecha?: string, cursor?: string } = { limit: 20 }
        if (fecha) {
            query.fecha = fecha
        }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/pasarela/conciliaciones', { params: { query } }))
    }

    /** `POST /pasarela/conciliar` (`facturas.generar`): concilia un día de Guatemala (por defecto ayer). */
    function conciliar(fecha: string | null, clave: string): Promise<Resultado<ConciliacionPasarela>> {
        return resolver(api.POST('/api/v1/pasarela/conciliar', {
            params: { header: { 'Idempotency-Key': clave } },
            body: fecha ? { fecha } : {},
        }))
    }

    return { conciliaciones, conciliar }
}
