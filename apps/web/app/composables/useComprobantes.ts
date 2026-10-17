import type { Schema, paths } from '@argosisp/contracts'

export type Comprobante = Schema<'Comprobante'>
export type PaginaComprobantes = Schema<'PaginaComprobantes'>
export type ResumenComprobantes = Schema<'ResumenComprobantes'>
export type EstadoComprobante = Comprobante['estado']
export type FiltrosComprobantes = Omit<NonNullable<paths['/api/v1/comprobantes']['get']['parameters']['query']>, 'cursor'>
/** Cuerpo exacto de `POST /comprobantes/:id/aprobar` según `packages/contracts` (A3). */
export type DatosAprobarComprobante = paths['/api/v1/comprobantes/{id}/aprobar']['post']['requestBody']['content']['application/json']

export const LIMITE_COMPROBANTES = 25

/**
 * Comprobantes de depósito (A3): la cola que se verifica en el panel. Aprobar registra el pago
 * (como `POST /pagos`) y reactiva; rechazar exige motivo y avisa al cliente.
 */
export function useComprobantes() {
    const api = useApi()
    /** Pendientes de verificar para el menú: `null` si no se pudo leer (no se muestra nada inventado). */
    const contador = useState<number | null>('comprobantes-pendientes', () => null)

    /**
     * `GET /comprobantes` (`comprobantes.ver`) con estado, cliente, método, cuenta de destino y
     * fecha de depósito. `resumen` trae el total y el monto de lo filtrado (todas las páginas) y
     * los pendientes con los demás filtros sin importar el estado.
     */
    function listar(filtros: FiltrosComprobantes = {}, cursor?: string): Promise<Resultado<PaginaComprobantes>> {
        const query: FiltrosComprobantes & { cursor?: string } = { limit: LIMITE_COMPROBANTES, ...filtros }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/comprobantes', { params: { query } }))
    }

    function ver(id: number): Promise<Resultado<Comprobante>> {
        return resolver(api.GET('/api/v1/comprobantes/{id}', { params: { path: { id } } }))
    }

    /**
     * `GET /comprobantes/:id/archivo`: la foto o el PDF con su `Content-Type`. Va con el token
     * Bearer, así que se pide como `Blob` y la pantalla lo muestra con una URL de objeto.
     */
    function archivo(id: number): Promise<Resultado<Blob>> {
        return resolver(api.GET('/api/v1/comprobantes/{id}/archivo', {
            params: { path: { id } },
            parseAs: 'blob',
        }))
    }

    /**
     * `POST /comprobantes/:id/aprobar` (`comprobantes.aprobar`) con `Idempotency-Key`. Sin
     * `facturas` la API aplica primero a las del servicio del comprobante y luego a la más antigua.
     * 409 `comprobante_revisado` o `referencia_duplicada`.
     */
    async function aprobar(id: number, datos: DatosAprobarComprobante, claveIdempotencia: string): Promise<Resultado<Comprobante>> {
        const resultado = await resolver(api.POST('/api/v1/comprobantes/{id}/aprobar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: datos,
        }))
        void actualizarContador()
        return resultado
    }

    /** `POST /comprobantes/:id/rechazar { motivo }` (`comprobantes.rechazar`). */
    async function rechazar(id: number, motivo: string, claveIdempotencia: string): Promise<Resultado<Comprobante>> {
        const resultado = await resolver(api.POST('/api/v1/comprobantes/{id}/rechazar', {
            params: { path: { id }, header: { 'Idempotency-Key': claveIdempotencia } },
            body: { motivo },
        }))
        void actualizarContador()
        return resultado
    }

    /**
     * Vuelve a contar los pendientes para el menú con `GET /comprobantes?limit=1`: el número sale
     * de `resumen.pendientes`, no de las filas. Con error el contador desaparece.
     */
    async function actualizarContador(): Promise<void> {
        const resultado = await listar({ limit: 1 })
        contador.value = resultado.ok ? resultado.data.resumen.pendientes : null
    }

    return { listar, ver, archivo, aprobar, rechazar, contador, actualizarContador }
}

/** Texto del contador del menú: `3`, `99+`, o nada si no hay pendientes o no se pudo leer. */
export function textoContador(pendientes: number | null): string | undefined {
    if (pendientes === null || pendientes <= 0) {
        return undefined
    }
    return pendientes > 99 ? '99+' : String(pendientes)
}
