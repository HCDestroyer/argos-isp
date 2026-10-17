/**
 * Lector y escritor de CSV (RFC 4180) sin dependencias: comillas dobles para campos con
 * separador, comillas o saltos de línea (`""` dentro de comillas es una comilla), CRLF o LF, BOM
 * de UTF-8 opcional. La primera fila es el encabezado; los nombres de columna se recortan y pasan
 * a minúsculas. Las filas vacías se ignoran.
 *
 * Separador: coma, o punto y coma si el encabezado tiene `;` y ninguna coma (lo que guarda Excel
 * cuando la configuración regional usa coma decimal).
 */

export interface FilaCsv {
    /** número de línea donde empieza la fila (1 = encabezado) */
    linea: number
    valores: Record<string, string>
}

export class ErrorCsv extends Error {}

export function leerCsv(texto: string): FilaCsv[] {
    const limpio = texto.startsWith(BOM) ? texto.slice(1) : texto
    const registros = tokenizar(limpio, separadorDe(limpio))
    if (registros.length === 0) return []
    const [encabezado, ...filas] = registros
    const columnas = encabezado!.campos.map((c) => c.trim().toLowerCase())
    const repetida = columnas.find((c, i) => columnas.indexOf(c) !== i)
    if (repetida) throw new ErrorCsv(`Columna repetida en el encabezado: ${repetida}`)

    return filas
        .filter((fila) => fila.campos.some((campo) => campo.trim() !== ''))
        .map((fila) => {
            if (fila.campos.length > columnas.length) {
                throw new ErrorCsv(
                    `Línea ${fila.linea}: ${fila.campos.length} campos y el encabezado tiene ${columnas.length}`,
                )
            }
            const valores: Record<string, string> = {}
            for (const [i, columna] of columnas.entries()) valores[columna] = fila.campos[i] ?? ''
            return { linea: fila.linea, valores }
        })
}

const BOM = '﻿'

/** `;` si la primera línea lo tiene y no tiene comas; si no, coma. */
function separadorDe(texto: string): ',' | ';' {
    const primera = texto.split(/\r?\n/, 1)[0] ?? ''
    return primera.includes(';') && !primera.includes(',') ? ';' : ','
}

/** Un campo para CSV: entre comillas si lleva coma, punto y coma, comillas o saltos de línea. */
export function campoCsv(valor: string): string {
    return /[",;\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

/** CSV con encabezado, separador coma, CRLF y BOM de UTF-8 (Excel lo abre con acentos). */
export function escribirCsv(
    columnas: string[],
    filas: Array<Record<string, string | null | undefined>>,
): string {
    const lineas = [columnas.map(campoCsv).join(',')]
    for (const fila of filas) lineas.push(columnas.map((c) => campoCsv(fila[c] ?? '')).join(','))
    return BOM + lineas.join('\r\n') + '\r\n'
}

function tokenizar(texto: string, separador: ',' | ';'): Array<{ linea: number; campos: string[] }> {
    const registros: Array<{ linea: number; campos: string[] }> = []
    let campos: string[] = []
    let campo = ''
    let entreComillas = false
    let linea = 1
    let inicioRegistro = 1

    const cerrarRegistro = () => {
        campos.push(campo)
        registros.push({ linea: inicioRegistro, campos })
        campos = []
        campo = ''
    }

    for (let i = 0; i < texto.length; i++) {
        const c = texto[i]!
        if (entreComillas) {
            if (c === '"') {
                if (texto[i + 1] === '"') {
                    campo += '"'
                    i++
                } else {
                    entreComillas = false
                }
            } else {
                if (c === '\n') linea++
                campo += c
            }
            continue
        }
        if (c === '"' && campo === '') {
            entreComillas = true
        } else if (c === separador) {
            campos.push(campo)
            campo = ''
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && texto[i + 1] === '\n') i++
            cerrarRegistro()
            linea++
            inicioRegistro = linea
        } else {
            campo += c
        }
    }
    if (entreComillas) throw new ErrorCsv(`Comillas sin cerrar desde la línea ${inicioRegistro}`)
    if (campo !== '' || campos.length > 0) cerrarRegistro()
    return registros
}
