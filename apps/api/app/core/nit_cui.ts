import { ValidacionFallida } from '#shared/errores'

/**
 * Identificación tributaria de Guatemala (`contratos/localizacion-fiscal.md` §3.1).
 *
 * NIT: dígitos + dígito verificador (0-9 o K). Algoritmo módulo 11 que usa la SAT: cada dígito del
 * cuerpo se multiplica por un peso que empieza en `largo + 1` y baja hasta 2; el verificador es
 * `(11 − suma mod 11) mod 11` y, si da 10, es la letra K. Se guarda sin guion y en mayúsculas:
 * `5769373K`.
 *   Fuente: la SAT no publica el algoritmo como documento técnico en sat.gob.gt; es el descrito
 *   por la comunidad y por las implementaciones FEL, p. ej. M. Batres, "Validar el NIT con Módulo
 *   11" (2008, http://mariobatres7.blogspot.com/2008/02/validar-el-nit-con-modulo-11.html, con el
 *   ejemplo 42932-5 y el caso 1510972-0 que exige el segundo `mod 11`). Comprobado con NIT
 *   publicados: SAT 16693949 e INFILE, S.A. (certificador FEL) 12521337.
 *
 * CUI (DPI): 13 dígitos = 8 asignados + 1 verificador + 2 del departamento + 2 del municipio de
 * nacimiento (Ley del RENAP, Decreto 90-2005, art. 4). Se valida solo esa estructura: departamento
 * 01-22 (los 22 departamentos) y municipio distinto de 00. El RENAP no publica el algoritmo del
 * dígito verificador; el que circula (Σ dígito[i]·(i + 2) mod 11 sobre los 8 primeros) no está
 * verificado contra una fuente oficial, así que NO se aplica: rechazar un CUI real por una
 * suposición bloquearía su factura (`.claude/integration/a1.md`, confirmar con el contador o el
 * RENAP). Se guarda sin espacios.
 *
 * Pasaporte: 3 a 20 letras o dígitos, sin verificador. `CF`: consumidor final.
 */

export const TIPOS_DOCUMENTO_FISCAL = ['nit', 'cui', 'pasaporte', 'cf'] as const
export type TipoDocumentoFiscal = (typeof TIPOS_DOCUMENTO_FISCAL)[number]

/** Quita espacios y guiones y pasa a mayúsculas. */
export function limpiarDocumento(valor: string): string {
    return valor.replace(/[\s-]/g, '').toUpperCase()
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
    const limpio = nit.replace(/-/g, '').toUpperCase()
    if (!/^\d{1,12}[0-9K]$/.test(limpio)) return false
    return verificadorNit(limpio.slice(0, -1)) === limpio.at(-1)
}

/** Estructura del CUI (Ley del RENAP, art. 4); sin dígito verificador (ver arriba). */
export function cuiValido(cui: string): boolean {
    const limpio = cui.replace(/\s/g, '')
    if (!/^\d{13}$/.test(limpio)) return false
    const departamento = Number(limpio.slice(9, 11))
    const municipio = Number(limpio.slice(11, 13))
    // Los municipios por departamento cambian con el tiempo: solo se exige que no sea 00.
    return departamento >= 1 && departamento <= 22 && municipio >= 1
}

export function pasaporteValido(pasaporte: string): boolean {
    return /^[A-Z0-9]{3,20}$/.test(limpiarDocumento(pasaporte))
}

/**
 * Tipo que se deduce de un valor cuando no se indica (altas anteriores a la localización y
 * clientes que solo mandan `nit_cui`): vacío o `CF` → `cf`; 13 dígitos con estructura de CUI →
 * `cui`; NIT con verificador → `nit`. null si no es ninguno.
 */
export function deducirTipoDocumento(valor: string | null | undefined): TipoDocumentoFiscal | null {
    if (valor === null || valor === undefined) return 'cf'
    const limpio = limpiarDocumento(valor)
    if (limpio === '' || limpio === 'CF') return 'cf'
    if (cuiValido(limpio)) return 'cui'
    if (nitValido(limpio)) return 'nit'
    return null
}

/** Normaliza y valida; lanza 422 con `field` si no es un NIT, CUI o CF válido. */
export function normalizarNitCui(valor: string | null | undefined, campo = 'nit_cui'): string | null {
    if (valor === null || valor === undefined) return null
    const limpio = limpiarDocumento(valor)
    if (limpio === '') return null
    if (limpio === 'CF') return 'CF'
    if (/^\d{13}$/.test(limpio)) {
        if (cuiValido(limpio)) return limpio
        // Un CUI también puede usarse como NIT; si no cuadra como CUI se prueba como NIT.
        if (nitValido(limpio)) return limpio
        throw new ValidacionFallida([
            { field: campo, message: 'El CUI no es válido (departamento o municipio)', rule: 'cui' },
        ])
    }
    if (nitValido(limpio)) return limpio
    throw new ValidacionFallida([
        { field: campo, message: 'El NIT no es válido (dígito verificador)', rule: 'nit' },
    ])
}

export interface DocumentoFiscal {
    tipo_documento_fiscal: TipoDocumentoFiscal
    nit_cui: string | null
    pais_fiscal: string
}

/**
 * Valida el documento del receptor según su tipo y lo devuelve normalizado. Sin `tipo` se deduce
 * del valor (`deducirTipoDocumento`), como antes de la localización. 422 por campo:
 * - `nit`: verificador módulo 11; `cui`: estructura del RENAP; `pasaporte`: 3-20 letras o dígitos.
 *   Los tres exigen el número.
 * - `cf`: sin número (o `CF`).
 * - NIT y CUI son de Guatemala: `pais_fiscal` debe ser `GT`.
 */
export function validarDocumentoFiscal(datos: {
    tipo?: TipoDocumentoFiscal
    valor: string | null | undefined
    pais?: string | null
}): DocumentoFiscal {
    const pais = (datos.pais ?? 'GT').toUpperCase()
    const limpio = datos.valor === null || datos.valor === undefined ? '' : limpiarDocumento(datos.valor)
    if (!datos.tipo) {
        const nit = normalizarNitCui(datos.valor)
        const tipo = deducirTipoDocumento(nit)!
        exigirPaisDelDocumento(tipo, pais)
        return { tipo_documento_fiscal: tipo, nit_cui: nit, pais_fiscal: pais }
    }
    const tipo = datos.tipo
    const error = (message: string, rule: string) =>
        new ValidacionFallida([{ field: 'nit_cui', message, rule }])
    if (tipo === 'cf') {
        if (limpio !== '' && limpio !== 'CF') {
            throw error('Consumidor final no lleva NIT, CUI ni pasaporte', 'cf')
        }
        return { tipo_documento_fiscal: 'cf', nit_cui: limpio === 'CF' ? 'CF' : null, pais_fiscal: pais }
    }
    if (limpio === '' || limpio === 'CF') throw error(`Falta el número del documento (${tipo})`, 'required')
    if (tipo === 'nit' && !nitValido(limpio)) throw error('El NIT no es válido (dígito verificador)', 'nit')
    if (tipo === 'cui' && !cuiValido(limpio)) {
        throw error('El CUI debe tener 13 dígitos con departamento 01-22 y municipio', 'cui')
    }
    if (tipo === 'pasaporte' && !pasaporteValido(limpio)) {
        throw error('El pasaporte debe tener de 3 a 20 letras o dígitos', 'pasaporte')
    }
    exigirPaisDelDocumento(tipo, pais)
    return { tipo_documento_fiscal: tipo, nit_cui: limpio, pais_fiscal: pais }
}

function exigirPaisDelDocumento(tipo: TipoDocumentoFiscal, pais: string) {
    if ((tipo === 'nit' || tipo === 'cui') && pais !== 'GT') {
        throw new ValidacionFallida([
            {
                field: 'pais_fiscal',
                message:
                    'El NIT y el CUI son de Guatemala: un receptor extranjero se identifica con pasaporte',
                rule: 'pais',
            },
        ])
    }
}
