import type { Problem } from '@argosisp/contracts'
import type { FormError } from '@nuxt/ui'

/**
 * Resultado de una llamada a la API desde un composable de recurso: las páginas nunca ven
 * `response` ni `error` de openapi-fetch, solo `data` o un `Problem` RFC 9457.
 */
export type Resultado<T> = { ok: true, data: T } | { ok: false, problema: Problem }

/** Página de una lista con cursor (`{ data, nextCursor }`). */
export interface Pagina<T> {
    data: T[]
    nextCursor: string | null
}

export const PROBLEMA_SIN_CONEXION: Problem = {
    type: 'about:blank',
    title: 'Sin conexión',
    status: 0,
    detail: 'No pudimos contactar al servidor. Revisa tu conexión e intenta de nuevo.',
}

function esProblema(valor: unknown): valor is Problem {
    return typeof valor === 'object' && valor !== null && 'title' in valor && typeof valor.title === 'string'
}

/**
 * El error de la API como `Problem`. Si no lo es (p. ej. un 502 en HTML de un proxy de por medio),
 * un texto claro según el status, nunca un "Error inesperado" sin explicación.
 */
export function aProblema(error: unknown, status: number): Problem {
    if (esProblema(error)) {
        return error
    }
    if (status === 429) {
        return {
            type: 'about:blank',
            title: 'Demasiadas consultas',
            status,
            detail: 'Hiciste muchas consultas seguidas. Espera un minuto e intenta de nuevo.',
        }
    }
    if (status >= 500) {
        return {
            type: 'about:blank',
            title: 'Servicio no disponible',
            status,
            detail: 'No pudimos contactar al sistema. Intenta de nuevo en unos segundos.',
        }
    }
    return {
        type: 'about:blank',
        title: 'Error inesperado',
        status,
        detail: 'Algo salió mal. Intenta de nuevo o comunícate con soporte.',
    }
}

interface RespuestaApi<T> {
    data?: T
    error?: unknown
    response: Response
}

/** Espera una llamada del cliente tipado y la convierte en `Resultado` (un 204 es `ok`). */
export async function resolver<T>(peticion: Promise<RespuestaApi<T>>): Promise<Resultado<T>> {
    try {
        const { data, error, response } = await peticion
        if (response.ok) {
            return { ok: true, data: data as T }
        }
        return { ok: false, problema: aProblema(error, response.status) }
    }
    catch {
        return { ok: false, problema: PROBLEMA_SIN_CONEXION }
    }
}

/** El problema es "no hay sesión del portal" (401): hay que pedir un código. */
export function esSinSesion(problema: Problem): boolean {
    return problema.status === 401
}

/** Texto para el cliente: el `detail` de la API o, si no hay, su `title`. */
export function mensajeProblema(problema: Problem): string {
    return problema.detail ?? problema.title
}

/** `errors[]` de un 422 en el formato de `UForm.setErrors()`. */
export function erroresDeFormulario(problema: Problem): FormError[] {
    return (problema.errors ?? []).map(error => ({ name: error.field, message: error.message }))
}

/** Tipo RFC 9457 de un problema de la API (`urn:argosisp:problema:<codigo>`). */
export function codigoProblema(problema: Problem): string | null {
    const prefijo = 'urn:argosisp:problema:'
    return problema.type?.startsWith(prefijo) ? problema.type.slice(prefijo.length) : null
}

/** 422 de A3: la cuenta bancaria del comprobante es de otra empresa que la del servicio (multiempresa). */
export function esCuentaDeOtraEmpresa(problema: Problem): boolean {
    return problema.status === 422 && codigoProblema(problema) === 'cuenta_de_otra_empresa'
}

/** 422: el pago en línea mezclaría facturas de varias empresas (cada NIT se paga por separado). */
export function esPagoDeVariasEmpresas(problema: Problem): boolean {
    return problema.status === 422 && codigoProblema(problema) === 'pago_de_varias_empresas'
}
