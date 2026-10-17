/**
 * Orígenes permitidos para el panel (CORS con credenciales y verificación de `Origin` de la sesión
 * por cookie). Una sola fuente para `config/cors.ts` y `app/core/auth/sesion_panel.ts`.
 *
 * - `CORS_ORIGINS` (lista separada por comas, p. ej. `https://panel.isp.gt`): solo esos.
 * - Sin lista, fuera de producción: `http(s)://localhost`, `127.0.0.1` y `[::1]` en cualquier puerto
 *   (el panel en dev corre en `localhost:3000` y la API en `localhost:3333`).
 * - Sin lista, en producción: ninguno (solo el mismo origen de la API).
 *
 * Nunca se refleja un origen cualquiera: con `credentials: true` eso dejaría a cualquier sitio
 * leer respuestas con la cookie del panel.
 */

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/

export interface ConfigOrigenes {
    lista: string[]
    produccion: boolean
}

export function configOrigenes(entorno: NodeJS.ProcessEnv = process.env): ConfigOrigenes {
    return {
        lista: (entorno.CORS_ORIGINS ?? '')
            .split(',')
            .map((origen) => normalizarOrigen(origen))
            .filter((origen): origen is string => origen !== null),
        produccion: entorno.NODE_ENV === 'production',
    }
}

/** `scheme://host[:puerto]` en minúsculas y sin `/` final; null si no es un origen. */
export function normalizarOrigen(origen: string | undefined | null): string | null {
    const limpio = (origen ?? '').trim().replace(/\/+$/, '').toLowerCase()
    if (!limpio || limpio === 'null') return null
    try {
        const url = new URL(limpio)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        return url.origin
    } catch {
        return null
    }
}

/**
 * ¿Puede `origen` hacer peticiones con credenciales? `host` es el header `Host` de la petición:
 * el mismo origen de la API siempre vale.
 */
export function origenPermitido(
    origen: string | undefined | null,
    host?: string | null,
    config: ConfigOrigenes = configOrigenes(),
): boolean {
    const normal = normalizarOrigen(origen)
    if (!normal) return false
    if (host && new URL(normal).host === host.trim().toLowerCase()) return true
    if (config.lista.length > 0) return config.lista.includes(normal)
    return !config.produccion && LOCAL.test(normal)
}
