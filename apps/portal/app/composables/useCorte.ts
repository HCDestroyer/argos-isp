import type { Problem, Schema } from '@argosisp/contracts'

/** Lo que la API devuelve para la IP que consulta (`GET /api/v1/portal/quien-soy`). */
export type QuienSoy = Schema<'QuienSoy'>

/**
 * Identificación por IP para la página de corte. Se consulta solo en el navegador: la API
 * identifica al cliente por la IP de origen, y en SSR la petición saldría del servidor Nitro.
 * Solo trae nombre parcial, estado y montos: nunca datos personales completos.
 *
 * Si falla, `error.value.data` es el `Problem` (RFC 9457) para mostrarlo con "Reintentar":
 * sin conexión, la API caída (502/504 del proxy) o el límite de consultas (429).
 */
export function useCorte() {
    const api = useApi()

    return useAsyncData<QuienSoy>('portal:quien-soy', async () => {
        const resultado = await resolver(api.GET('/api/v1/portal/quien-soy', {
            headers: { 'X-Canal': 'portal' },
        }))
        if (!resultado.ok) {
            throw createError({
                statusCode: resultado.problema.status || 503,
                statusMessage: resultado.problema.title,
                data: resultado.problema,
            })
        }
        return resultado.data
    }, {
        server: false,
    })
}

/** El `Problem` guardado en el error de `useCorte` (o uno genérico si no lo trae). */
export function problemaDeCorte(error: { data?: unknown } | null | undefined): Problem {
    const data = error?.data
    if (typeof data === 'object' && data !== null && 'title' in data) {
        return data as Problem
    }
    return PROBLEMA_SIN_CONEXION
}
