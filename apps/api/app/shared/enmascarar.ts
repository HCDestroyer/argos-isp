import string from '@adonisjs/core/helpers/string'

/**
 * Enmascarado de datos sensibles para auditoría (`audit.acciones.entrada`, `audit.cambios`).
 * Contraseñas PPPoE, credenciales de routers, secretos RADIUS, hashes y tokens se guardan como `***`.
 */
export const MASCARA = '***'

const SENSIBLE =
    /(^|_)(pass_ppp|password|passwd|contrasena|secret|secreto|token|tokens|hash|api_key|llave_[a-z_]+)($|_)/

export function esCampoSensible(campo: string): boolean {
    return SENSIBLE.test(string.snakeCase(campo))
}

/** Convierte a JSON plano (Date, DateTime, Decimal → string) y enmascara campos sensibles. */
export function enmascarar(valor: unknown): unknown {
    if (valor === undefined) return null
    const plano: unknown = JSON.parse(JSON.stringify(valor) ?? 'null')
    return recorrer(plano)
}

function recorrer(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map(recorrer)
    if (valor !== null && typeof valor === 'object') {
        const salida: Record<string, unknown> = {}
        for (const [clave, interno] of Object.entries(valor)) {
            salida[clave] = esCampoSensible(clave) && interno !== null ? MASCARA : recorrer(interno)
        }
        return salida
    }
    return valor
}
