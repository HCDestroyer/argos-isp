/**
 * Lector de CSV (RFC 4180) sin dependencias: separador coma, comillas dobles para campos con
 * coma, comillas o saltos de línea (`""` dentro de comillas es una comilla), CRLF o LF, BOM de
 * UTF-8 opcional. La primera fila es el encabezado; los nombres de columna se recortan y pasan a
 * minúsculas. Las filas vacías se ignoran.
 */

export interface FilaCsv {
    /** número de línea donde empieza la fila (1 = encabezado) */
    linea: number
    valores: Record<string, string>
}

export class ErrorCsv extends Error {}

export function leerCsv(texto: string): FilaCsv[] {
    const registros = tokenizar(texto.startsWith('﻿') ? texto.slice(1) : texto)
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

function tokenizar(texto: string): Array<{ linea: number; campos: string[] }> {
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
        } else if (c === ',') {
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
