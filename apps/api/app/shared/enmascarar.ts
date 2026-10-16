import { nombreCampo } from '#shared/nombres_campo'

/**
 * Enmascarado de datos sensibles para auditoría (`audit.acciones.entrada`, `audit.cambios`).
 * Contraseñas PPPoE, credenciales de routers, secretos RADIUS, hashes y tokens se guardan como `***`.
 */
export const MASCARA = '***'

// Termina en fin, `_` o dígito: `token`, `api_token`, `token2`, `radius_secret_v2`.
const SENSIBLE =
    /(^|_)(pass_ppp|password|passwd|contrasena|secret|secreto|token|tokens|hash|api_key|llave_[a-z_]+)($|_|[0-9])/

/** Si `campo` (snake_case o camelCase) es sensible y se audita como `***`. */
export function esCampoSensible(campo: string): boolean {
    return SENSIBLE.test(nombreCampo(campo))
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
