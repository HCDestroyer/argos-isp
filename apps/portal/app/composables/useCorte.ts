import type { Problem, Schema } from '@argosisp/contracts'

/** Lo que la API devuelve para la IP que consulta (`GET /api/v1/portal/quien-soy`). */
export type QuienSoy = Schema<'QuienSoy'>

/**
 * Identificación por IP para la página de corte. Se consulta solo en el navegador: la API
 * identifica al cliente por la IP de origen, y en SSR la petición saldría del servidor Nitro.
 * Solo trae nombre parcial, estado y montos: nunca datos personales completos.
 */
export function useCorte() {
    const api = useApi()

    return useAsyncData<QuienSoy>('portal:quien-soy', async () => {
        const { data, error, response } = await api.GET('/api/v1/portal/quien-soy', {
            headers: { 'X-Canal': 'portal' },
        })
        if (!data) {
            // El contrato solo declara el 200; cualquier error de la API llega como Problem (RFC 9457).
            const problema = error as Problem | undefined
            throw createError({
                statusCode: response.status,
                statusMessage: problema?.title ?? 'No se pudo consultar el estado del servicio',
            })
        }
        return data
    }, {
        server: false,
    })
}
