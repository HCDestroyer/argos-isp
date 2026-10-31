import * as z from 'zod'

/**
 * Espejo de `normalizarTelefono` y `telefonoParaGuardar` (`apps/api/app/core/telefonos.ts`,
 * pedido A14 de Iris, contrato 0.5.0) para `telefono` y `movil` del cliente y `contacto_telefono`
 * del servicio. Si cambia la regla del backend, cambia esto.
 *
 * - Se toleran espacios, guiones, puntos y paréntesis; `00` al inicio vale como `+`.
 * - Guatemala: 8 dígitos que empiezan con 2 a 7, con `+502` (o `502`) opcional.
 * - Internacional: `+` y entre 8 y 15 dígitos (E.164), otro código de país que 502.
 *
 * La API lo guarda normalizado; el panel manda lo que se escribió (recortado).
 */
export const MENSAJE_TELEFONO = 'Teléfono de Guatemala de 8 dígitos (5512 3344 o +502 5512 3344) o internacional con + y 8 a 15 dígitos (+1 555 123 4567)'

/** Máximo de caracteres que acepta la API (`maxLength(30)`). */
export const MAXIMO_TELEFONO = 30

const SEPARADORES = /[\s().-]/g
const PERMITIDOS = /^\+?[\d\s().-]+$/

/** Forma normalizada (`+502 5512-3344`, `+15551234567`) o null si no cumple la regla. */
export function normalizarTelefono(valor: string): string | null {
    const texto = valor.trim()
    if (texto === '' || !PERMITIDOS.test(texto)) {
        return null
    }
    let compacto = texto.replace(SEPARADORES, '')
    if (compacto.startsWith('00')) {
        compacto = `+${compacto.slice(2)}`
    }
    const internacional = compacto.startsWith('+')
    const digitos = internacional ? compacto.slice(1) : compacto
    if (!/^\d+$/.test(digitos)) {
        return null
    }
    let local: string | null = null
    if (digitos.length === 8 && !internacional) {
        local = digitos
    }
    else if (digitos.length === 11 && digitos.startsWith('502')) {
        local = digitos.slice(3)
    }
    if (local !== null) {
        return /^[2-7]\d{7}$/.test(local) ? `+502 ${local.slice(0, 4)}-${local.slice(4)}` : null
    }
    if (internacional && !digitos.startsWith('502') && /^[1-9]\d{7,14}$/.test(digitos)) {
        return `+${digitos}`
    }
    return null
}

/**
 * Campo de teléfono opcional del formulario (string; `''` = vacío → `null`).
 *
 * `anterior` es el valor guardado: en una edición, si el texto no cambió no se valida (los
 * teléfonos viejos no se migraron y la API tampoco los revisa), igual que `telefonoParaGuardar`.
 */
export function telefonoFormulario(anterior?: string | null) {
    return z.string()
        .trim()
        .max(MAXIMO_TELEFONO, `Máximo ${MAXIMO_TELEFONO} caracteres`)
        .refine(
            valor => valor === '' || (anterior != null && valor === anterior.trim()) || normalizarTelefono(valor) !== null,
            MENSAJE_TELEFONO,
        )
        .transform(valor => valor || null)
}
