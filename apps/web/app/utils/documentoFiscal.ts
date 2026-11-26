import type { Schema } from '@argosisp/contracts'

/**
 * Documento fiscal del receptor (Guatemala), espejo de `apps/api/app/core/nit_cui.ts` (A1):
 *
 * - NIT: cuerpo + dígito verificador (0-9 o K), módulo 11 con pesos de `largo + 1` a 2.
 * - CUI (DPI): 13 dígitos con departamento 01-22 y municipio distinto de 00 (sin verificador:
 *   el RENAP no lo publica).
 * - Pasaporte: 3 a 20 letras o dígitos. CF: consumidor final, sin número.
 *
 * NIT y CUI son de Guatemala: un receptor extranjero se identifica con pasaporte.
 *
 * NIT tolerante (`contratos/fel-establecimientos.md` R1): letras, dígitos y guiones; el módulo 11 es
 * una advertencia (`avisoDocumentoFiscal`), no un error. Lo decide el certificador.
 */

export type TipoDocumentoFiscal = NonNullable<Schema<'Cliente'>['tipo_documento_fiscal']>

export const TIPOS_DOCUMENTO_FISCAL: Record<TipoDocumentoFiscal, string> = {
    nit: 'NIT',
    cui: 'CUI (DPI)',
    pasaporte: 'Pasaporte',
    cf: 'Consumidor final (CF)',
}

/** Quita espacios y guiones y pasa a mayúsculas, como la API al guardar. */
export function limpiarDocumento(valor: string): string {
    return valor.replace(/[\s-]/g, '').toUpperCase()
}

/** Forma de un NIT ya limpio, como `FORMA_NIT` de la API. */
export const FORMA_NIT = /^[0-9A-Z]{2,20}$/

/** Espejo de `revisarNit` de la API: `null` si no tiene forma de NIT (la API responde 422). */
export function revisarNit(valor: string): { nit: string, valido: boolean } | null {
    const nit = limpiarDocumento(valor)
    if (!FORMA_NIT.test(nit)) {
        return null
    }
    return { nit, valido: nitValido(nit) }
}

/** Advertencia del NIT que no cuadra con el módulo 11 (no bloquea Guardar). */
export const AVISO_NIT_SIN_VERIFICADOR = 'El dígito verificador no cuadra: sirve para pruebas; la SAT lo rechazará en producción.'

/** Texto de advertencia del documento (NIT con forma pero sin módulo 11), o `null`. */
export function avisoDocumentoFiscal(tipo: TipoDocumentoFiscal, valor: string): string | null {
    if (tipo !== 'nit') {
        return null
    }
    const revisado = revisarNit(valor)
    return revisado && !revisado.valido ? AVISO_NIT_SIN_VERIFICADOR : null
}

/** Dígito verificador (0-9 o K) del cuerpo de un NIT. */
export function verificadorNit(cuerpo: string): string {
    let factor = cuerpo.length + 1
    let total = 0
    for (const caracter of cuerpo) {
        total += Number(caracter) * factor
        factor -= 1
    }
    const modulo = (11 - (total % 11)) % 11
    return modulo === 10 ? 'K' : String(modulo)
}

export function nitValido(nit: string): boolean {
    const limpio = limpiarDocumento(nit)
    if (!/^\d{1,12}[0-9K]$/.test(limpio)) {
        return false
    }
    return verificadorNit(limpio.slice(0, -1)) === limpio.at(-1)
}

export function cuiValido(cui: string): boolean {
    const limpio = cui.replace(/\s/g, '')
    if (!/^\d{13}$/.test(limpio)) {
        return false
    }
    const departamento = Number(limpio.slice(9, 11))
    const municipio = Number(limpio.slice(11, 13))
    return departamento >= 1 && departamento <= 22 && municipio >= 1
}

export function pasaporteValido(pasaporte: string): boolean {
    return /^[A-Z0-9]{3,20}$/.test(limpiarDocumento(pasaporte))
}

/** Tipo que la API deduce cuando no se indica: vacío o CF → cf; CUI → cui; NIT válido → nit. */
export function deducirTipoDocumento(valor: string | null | undefined): TipoDocumentoFiscal | null {
    const limpio = limpiarDocumento(valor ?? '')
    if (limpio === '' || limpio === 'CF') {
        return 'cf'
    }
    if (cuiValido(limpio)) {
        return 'cui'
    }
    return nitValido(limpio) ? 'nit' : null
}

export interface ErrorDocumento {
    campo: 'nit_cui' | 'pais_fiscal'
    mensaje: string
}

/** El error que daría `validarDocumentoFiscal` de la API (mismo campo y texto), o `null`. */
export function errorDocumentoFiscal(tipo: TipoDocumentoFiscal, valor: string, pais: string): ErrorDocumento | null {
    const limpio = limpiarDocumento(valor)
    if (tipo === 'cf') {
        return limpio === '' || limpio === 'CF' ? null : { campo: 'nit_cui', mensaje: 'Consumidor final no lleva NIT, CUI ni pasaporte' }
    }
    if (limpio === '' || limpio === 'CF') {
        return { campo: 'nit_cui', mensaje: `Falta el número del documento (${TIPOS_DOCUMENTO_FISCAL[tipo]})` }
    }
    if (tipo === 'nit' && !revisarNit(limpio)) {
        return { campo: 'nit_cui', mensaje: 'El NIT lleva de 2 a 20 letras o dígitos (se admiten guiones)' }
    }
    if (tipo === 'cui' && !cuiValido(limpio)) {
        return { campo: 'nit_cui', mensaje: 'El CUI debe tener 13 dígitos con departamento 01-22 y municipio' }
    }
    if (tipo === 'pasaporte' && !pasaporteValido(limpio)) {
        return { campo: 'nit_cui', mensaje: 'El pasaporte debe tener de 3 a 20 letras o dígitos' }
    }
    if ((tipo === 'nit' || tipo === 'cui') && pais.toUpperCase() !== 'GT') {
        return { campo: 'pais_fiscal', mensaje: 'El NIT y el CUI son de Guatemala: un receptor extranjero se identifica con pasaporte' }
    }
    return null
}

/** `1234567K` → `1234567-K` para mostrar un NIT; el CUI va en grupos de 4-5-4. */
export function formatearDocumento(tipo: TipoDocumentoFiscal | null | undefined, valor: string | null | undefined): string {
    if (!valor) {
        return 'CF'
    }
    const limpio = limpiarDocumento(valor)
    if (tipo === 'nit' && limpio.length > 1) {
        return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
    }
    if (tipo === 'cui' && limpio.length === 13) {
        return `${limpio.slice(0, 4)} ${limpio.slice(4, 9)} ${limpio.slice(9)}`
    }
    return limpio
}
