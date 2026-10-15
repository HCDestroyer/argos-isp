/**
 * Credenciales PPPoE sugeridas en el alta del servicio. El operador puede editarlas; si las
 * borra, la API genera las suyas (`user_ppp` y `pass_ppp` son opcionales en `POST /servicios`).
 */

/** Sin 0/O, 1/l/I: se dictan por teléfono al instalar. */
const ALFABETO_CLAVE = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function aleatorios(cantidad: number): Uint32Array {
    const valores = new Uint32Array(cantidad)
    crypto.getRandomValues(valores)
    return valores
}

/** Igual que el patrón del backend: `^[A-Za-z0-9._@-]{3,64}$`. */
export const PATRON_USUARIO_PPP = /^[A-Za-z0-9._@-]{3,64}$/

/** `María José Pérez` → `maria.jose4821`: nombre y apellido sin acentos + 4 dígitos al azar. */
export function generarUsuarioPpp(nombreCliente: string): string {
    const partes = nombreCliente
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
    const base = (partes.join('.') || 'cliente').slice(0, 40)
    const numero = String(1000 + ((aleatorios(1)[0] ?? 0) % 9000))
    return `${base}${numero}`
}

/** Contraseña de `longitud` caracteres sin caracteres ambiguos. */
export function generarClavePpp(longitud = 10): string {
    return Array.from(aleatorios(longitud), valor => ALFABETO_CLAVE[valor % ALFABETO_CLAVE.length]).join('')
}
