import type { Problem } from '@argosisp/contracts'
import type { FormError } from '@nuxt/ui'

/**
 * Resultado de una llamada a la API desde un composable de recurso: los componentes
 * nunca ven `response` ni `error` de openapi-fetch, solo `data` o un `Problem` RFC 9457.
 */
export type Resultado<T> = { ok: true, data: T } | { ok: false, problema: Problem }

/** Página de una lista con cursor (`{ data, nextCursor }`). */
export interface Pagina<T> {
    data: T[]
    nextCursor: string | null
}

export const PROBLEMA_SIN_CONEXION: Problem = {
    type: 'about:blank',
    title: 'Sin conexión con la API',
    status: 0,
    detail: 'No se pudo contactar al servidor. Revisa tu conexión e intenta de nuevo.',
}

function esProblema(valor: unknown): valor is Problem {
    return typeof valor === 'object' && valor !== null && 'title' in valor && typeof valor.title === 'string'
}

/** Convierte el `error` de openapi-fetch en `Problem`, aunque la API no haya respondido uno. */
export function aProblema(error: unknown, status: number): Problem {
    if (esProblema(error)) {
        return error
    }
    return { type: 'about:blank', title: status === 501 ? 'Aún no implementado en la API' : 'Error inesperado', status }
}

interface RespuestaApi<T> {
    data?: T
    error?: unknown
    response: Response
}

/**
 * Espera una llamada del cliente tipado y la convierte en `Resultado`.
 *
 * ```ts
 * return resolver(api.GET('/api/v1/clientes/{id}', { params: { path: { id } } }))
 * ```
 */
export async function resolver<T>(peticion: Promise<RespuestaApi<T>>): Promise<Resultado<T>> {
    try {
        const { data, error, response } = await peticion
        if (response.ok && data !== undefined) {
            return { ok: true, data }
        }
        return { ok: false, problema: aProblema(error, response.status) }
    }
    catch {
        return { ok: false, problema: PROBLEMA_SIN_CONEXION }
    }
}

/** `errors[]` de un 422 en el formato de `UForm.setErrors()`. */
export function erroresDeFormulario(problema: Problem): FormError[] {
    return (problema.errors ?? []).map(error => ({ name: error.field, message: error.message }))
}

/** Clave para el header `Idempotency-Key`: una por intento lógico (un formulario abierto). */
export function nuevaClaveIdempotencia(): string {
    return crypto.randomUUID()
}
