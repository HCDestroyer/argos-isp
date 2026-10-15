import { ValidacionFallida } from '#shared/errores'

/**
 * Identificación tributaria de Guatemala.
 *
 * - NIT: dígitos + dígito verificador (0-9 o K), módulo 11 con pesos descendentes desde
 *   `largo + 1` hasta 2. Se guarda sin guion y en mayúsculas: `5769373K`.
 * - CUI (DPI): 13 dígitos = 8 de número + 1 verificador + 2 de departamento + 2 de municipio.
 *   Verificador = Σ dígito[i]·(i + 2) mod 11; departamento 01-22. Se guarda sin espacios.
 * - `CF`: consumidor final.
 */

export function nitValido(nit: string): boolean {
    const limpio = nit.replace(/-/g, '').toUpperCase()
    if (!/^\d{1,12}[0-9K]$/.test(limpio)) return false
    const cuerpo = limpio.slice(0, -1)
    const esperado = limpio.at(-1)
    let factor = cuerpo.length + 1
    let total = 0
    for (const caracter of cuerpo) {
        total += Number(caracter) * factor
        factor -= 1
    }
    const modulo = (11 - (total % 11)) % 11
    return esperado === (modulo === 10 ? 'K' : String(modulo))
}

export function cuiValido(cui: string): boolean {
    const limpio = cui.replace(/\s/g, '')
    if (!/^\d{13}$/.test(limpio)) return false
    const numero = limpio.slice(0, 8)
    const verificador = Number(limpio[8])
    const departamento = Number(limpio.slice(9, 11))
    const municipio = Number(limpio.slice(11, 13))
    // Los municipios por departamento cambian con el tiempo: solo se exige que no sea 00.
    if (departamento < 1 || departamento > 22 || municipio < 1) return false
    let total = 0
    for (const [i, caracter] of [...numero].entries()) total += Number(caracter) * (i + 2)
    return total % 11 === verificador
}

/** Normaliza y valida; lanza 422 con `field` si no es un NIT, CUI o CF válido. */
export function normalizarNitCui(valor: string | null | undefined, campo = 'nit_cui'): string | null {
    if (valor === null || valor === undefined) return null
    const limpio = valor.replace(/[\s-]/g, '').toUpperCase()
    if (limpio === '') return null
    if (limpio === 'CF') return 'CF'
    if (/^\d{13}$/.test(limpio)) {
        if (cuiValido(limpio)) return limpio
        // Un CUI también puede usarse como NIT; si no cuadra como CUI se prueba como NIT.
        if (nitValido(limpio)) return limpio
        throw new ValidacionFallida([
            { field: campo, message: 'El CUI no es válido (dígito verificador o departamento)', rule: 'cui' },
        ])
    }
    if (nitValido(limpio)) return limpio
    throw new ValidacionFallida([
        { field: campo, message: 'El NIT no es válido (dígito verificador)', rule: 'nit' },
    ])
}
