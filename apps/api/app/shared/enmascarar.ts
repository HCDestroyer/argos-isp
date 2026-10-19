import { nombreCampo } from '#shared/nombres_campo'

/**
 * Enmascarado de datos sensibles para auditoría (`audit.acciones.entrada`, `audit.cambios`).
 * Contraseñas PPPoE, credenciales de routers (también la CA `api_ca`), secretos RADIUS, hashes y
 * tokens (también los tickets de autologin) y la credencial de un servicio adicional se guardan
 * como `***`.
 */
export const MASCARA = '***'

// Termina en fin, `_` o dígito: `token`, `api_token`, `token2`, `radius_secret_v2`.
const SENSIBLE =
    /(^|_)(pass_ppp|password|credencial|passwd|contrasena|secret|secreto|token|tokens|ticket|hash|api_key|api_ca|llave_[a-z_]+)($|_|[0-9])/

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
