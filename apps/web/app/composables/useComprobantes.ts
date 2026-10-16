import type { Schema, paths } from '@argosisp/contracts'

export type Comprobante = Schema<'Comprobante'>
export type EstadoComprobante = Comprobante['estado']
export type FiltrosComprobantes = Omit<NonNullable<paths['/api/v1/comprobantes']['get']['parameters']['query']>, 'cursor'>
/** Cuerpo exacto de `POST /comprobantes/:id/aprobar` según `packages/contracts` (A3). */
export type DatosAprobarComprobante = paths['/api/v1/comprobantes/{id}/aprobar']['post']['requestBody']['content']['application/json']

export const LIMITE_COMPROBANTES = 25
/** Hasta cuántos pendientes cuenta el menú; con más muestra "100+". */
export const TOPE_CONTADOR_PENDIENTES = 100

/** Contador de pendientes del menú: `null` si no se pudo leer (no se muestra nada inventado). */
export interface ContadorPendientes {
    cantidad: number
    hayMas: boolean
}

/**
 * Comprobantes de depósito (A3): la cola que se verifica en el panel. Aprobar registra el pago
 * (como `POST /pagos`) y reactiva; rechazar exige motivo y avisa al cliente.
 */
export function useComprobantes() {
    const api = useApi()
    const contador = useState<ContadorPendientes | null>('comprobantes-pendientes', () => null)

    function listar(filtros: FiltrosComprobantes = {}, cursor?: string): Promise<Resultado<Pagina<Comprobante>>> {
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
     * Vuelve a contar los pendientes para el menú. No hay endpoint de conteo: se lee una página de
     * hasta 100 y, si hay más, el menú dice "100+". Con error el contador desaparece.
     */
    async function actualizarContador(): Promise<void> {
        const resultado = await listar({ estado: 'pendiente', limit: TOPE_CONTADOR_PENDIENTES })
        contador.value = resultado.ok
            ? { cantidad: resultado.data.data.length, hayMas: resultado.data.nextCursor !== null && resultado.data.nextCursor !== '' }
            : null
    }

    return { listar, ver, archivo, aprobar, rechazar, contador, actualizarContador }
}

/** Texto del contador del menú: `3`, `100+`, o nada si no hay pendientes o no se pudo leer. */
export function textoContador(contador: ContadorPendientes | null): string | undefined {
    if (!contador || (contador.cantidad === 0 && !contador.hayMas)) {
        return undefined
    }
    return contador.hayMas ? `${contador.cantidad}+` : String(contador.cantidad)
}
