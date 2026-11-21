import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { Problema } from '#shared/errores'

/**
 * Lectura del archivo del banco a una tabla de celdas de texto (A6, estados de cuenta).
 *
 * - `.xlsx` y `.xls` (BIFF8, y también los «.xls» que en realidad son HTML o XML de Excel 2003, que
 *   exportan varios bancos): SheetJS (`xlsx`, CDN oficial 0.20.3). Las fechas con formato de fecha
 *   salen como `AAAA-MM-DD` (desde el número de serie, sin pasar por la zona horaria); los números,
 *   como texto con punto decimal; el resto, tal cual (recortado).
 * - `.csv` (o `.txt`): lector propio, sin conversión de tipos: separador `,` `;` tabulador o `|` (el
 *   más frecuente fuera de comillas en las primeras líneas), comillas RFC 4180, UTF-8 con o sin BOM
 *   y, si no es UTF-8 válido, Windows-1252 (lo que guarda Excel en español).
 * - El tipo se decide por el contenido (firma ZIP, firma OLE, HTML/XML) y, si no, por la extensión.
 * - Celdas vacías → null. Las filas vacías se conservan (sirven para ubicar el encabezado) y las
 *   del final se recortan.
 */

export type TipoArchivo = 'xlsx' | 'xls' | 'csv'

/** Celda normalizada: texto, número como texto con punto o fecha `AAAA-MM-DD`; null si vacía. */
export type Celda = string | null

export interface HojaLeida {
    tipo: TipoArchivo
    hojas: string[]
    hoja: string
    filas: Celda[][]
}

export const TAMANO_MAXIMO_EXTRACTO = 10 * 1024 * 1024
export const FILAS_MAXIMAS_EXTRACTO = 20_000

export function sha256(contenido: Buffer): string {
    return createHash('sha256').update(contenido).digest('hex')
}

function problemaArchivo(detalle: string): Problema {
    return new Problema(422, 'archivo_no_legible', 'Archivo no legible', detalle, [
        { field: 'archivo', message: detalle, rule: 'archivo_no_legible' },
    ])
}

/** Tipo por contenido (firma) y, si no, por la extensión del nombre. */
export function tipoDeArchivo(contenido: Buffer, nombre: string): TipoArchivo {
    if (contenido.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'xlsx'
    if (contenido.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
        return 'xls'
    }
    const inicio = contenido.subarray(0, 512).toString('latin1').trimStart().toLowerCase()
    if (/^(<\?xml|<html|<!doctype html|<table|<meta)/.test(inicio)) return 'xls'
    const ext = nombre.toLowerCase().split('.').pop() ?? ''
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx'
    if (ext === 'xls') return 'xls'
    return 'csv'
}

/** Lee el archivo. `hoja`: nombre de la hoja (por defecto la primera con datos). */
export function leerHoja(contenido: Buffer, nombre: string, hoja?: string | null): HojaLeida {
    if (contenido.length === 0) throw problemaArchivo('El archivo está vacío')
    if (contenido.length > TAMANO_MAXIMO_EXTRACTO) {
        throw new Problema(413, 'archivo_muy_grande', 'Archivo muy grande', 'El máximo es 10 MB', [
            { field: 'archivo', message: 'El máximo es 10 MB', rule: 'tamano' },
        ])
    }
    const tipo = tipoDeArchivo(contenido, nombre)
    if (tipo === 'csv') {
        return { tipo, hojas: ['csv'], hoja: 'csv', filas: recortar(leerCsvCrudo(textoDe(contenido))) }
    }
    let libro: XLSX.WorkBook
    try {
        libro = XLSX.read(contenido, { type: 'buffer', cellDates: false, cellNF: true, cellText: false })
    } catch (e) {
        throw problemaArchivo(
            `No se pudo leer el archivo de Excel: ${e instanceof Error ? e.message.slice(0, 200) : 'formato desconocido'}`,
        )
    }
    if (libro.SheetNames.length === 0) throw problemaArchivo('El libro no tiene hojas')
    let elegida = hoja ?? null
    if (elegida && !libro.SheetNames.includes(elegida)) {
        throw new Problema(
            422,
            'hoja_no_encontrada',
            'Hoja no encontrada',
            `El libro no tiene la hoja «${elegida}»`,
            [{ field: 'hoja', message: `Hojas: ${libro.SheetNames.join(', ')}`, rule: 'hoja_no_encontrada' }],
        )
    }
    const tablas = new Map<string, Celda[][]>()
    for (const nombreHoja of elegida ? [elegida] : libro.SheetNames) {
        const filas = recortar(celdasDe(libro.Sheets[nombreHoja]!))
        tablas.set(nombreHoja, filas)
        if (!elegida && filas.length > 0) elegida = nombreHoja
    }
    elegida = elegida ?? libro.SheetNames[0]!
    return { tipo, hojas: libro.SheetNames, hoja: elegida, filas: tablas.get(elegida) ?? [] }
}

function celdasDe(hoja: XLSX.WorkSheet): Celda[][] {
    const ref = hoja['!ref']
    if (!ref) return []
    const rango = XLSX.utils.decode_range(ref)
    const ultimaFila = Math.min(rango.e.r, rango.s.r + FILAS_MAXIMAS_EXTRACTO + 100)
    const filas: Celda[][] = []
    for (let r = 0; r <= ultimaFila; r++) {
        const fila: Celda[] = []
        for (let c = 0; c <= Math.min(rango.e.c, 60); c++) {
            fila.push(
                r < rango.s.r || c < rango.s.c ? null : valorCelda(hoja[XLSX.utils.encode_cell({ r, c })]),
            )
        }
        filas.push(fila)
    }
    return filas
}

function dos(n: number): string {
    return String(n).padStart(2, '0')
}

function valorCelda(celda: XLSX.CellObject | undefined): Celda {
    if (!celda || celda.v === undefined || celda.v === null) return null
    if (celda.t === 'd' && celda.v instanceof Date) {
        const d = celda.v
        return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
    }
    if (celda.t === 'n' && typeof celda.v === 'number') {
        const formato = typeof celda.z === 'string' ? celda.z : null
        if (formato && XLSX.SSF.is_date(formato)) {
            const f = XLSX.SSF.parse_date_code(celda.v) as { y: number; m: number; d: number } | null
            if (f) return `${f.y}-${dos(f.m)}-${dos(f.d)}`
        }
        return numeroATexto(celda.v)
    }
    if (celda.t === 'b') return celda.v ? 'VERDADERO' : 'FALSO'
    if (celda.t === 'e') return null
    const texto = String(celda.v)
        .replace(/\u00a0/g, ' ')
        .trim()
    return texto === '' ? null : texto
}

/** Número de Excel como texto con punto decimal, sin notación científica ni ruido de coma flotante. */
export function numeroATexto(n: number): string {
    if (!Number.isFinite(n)) return String(n)
    // 15 dígitos significativos: lo que Excel guarda; quita el 0.30000000000000004
    const t = Number(n.toPrecision(15))
    const s = t.toString()
    if (!/e/i.test(s)) return s
    return t.toFixed(Math.min(20, Math.max(0, -Math.floor(Math.log10(Math.abs(t))) + 14)))
}

function textoDe(contenido: Buffer): string {
    const utf8 = contenido.toString('utf8')
    const limpio = utf8.startsWith('﻿') ? utf8.slice(1) : utf8
    if (!limpio.includes('�')) return limpio
    return new TextDecoder('windows-1252').decode(contenido)
}

const SEPARADORES = [',', ';', '\t', '|'] as const

function separadorCsv(texto: string): string {
    const cuenta = new Map<string, number>(SEPARADORES.map((s) => [s, 0]))
    let entreComillas = false
    let lineas = 0
    for (const ch of texto) {
        if (ch === '"') entreComillas = !entreComillas
        else if (!entreComillas && ch === '\n' && ++lineas >= 50) break
        else if (!entreComillas && cuenta.has(ch)) cuenta.set(ch, cuenta.get(ch)! + 1)
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

/** CSV sin encabezado fijo ni conversión: cada fila tal cual, celdas recortadas (vacías → null). */
export function leerCsvCrudo(texto: string): Celda[][] {
    const sep = separadorCsv(texto)
    const filas: Celda[][] = []
    let fila: Celda[] = []
    let campo = ''
    let entreComillas = false
    const cerrarCampo = () => {
        const t = campo.replace(/\u00a0/g, ' ').trim()
        fila.push(t === '' ? null : t)
        campo = ''
    }
    for (let i = 0; i < texto.length; i++) {
        const ch = texto[i]!
        if (entreComillas) {
            if (ch === '"') {
                if (texto[i + 1] === '"') {
                    campo += '"'
                    i++
                } else entreComillas = false
            } else campo += ch
            continue
        }
        if (ch === '"' && campo.trim() === '') {
            entreComillas = true
            campo = ''
        } else if (ch === sep) cerrarCampo()
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && texto[i + 1] === '\n') i++
            cerrarCampo()
            filas.push(fila)
            fila = []
            if (filas.length > FILAS_MAXIMAS_EXTRACTO + 100) break
        } else campo += ch
    }
    if (campo !== '' || fila.length > 0) {
        cerrarCampo()
        filas.push(fila)
    }
    return filas
}

/** Quita las filas vacías del final y las columnas vacías de la derecha. */
function recortar(filas: Celda[][]): Celda[][] {
    let fin = filas.length
    while (fin > 0 && filas[fin - 1]!.every((c) => c === null)) fin--
    const recortadas = filas.slice(0, fin)
    let ancho = 0
    for (const f of recortadas) {
        for (let c = f.length - 1; c >= 0; c--) {
            if (f[c] !== null) {
                ancho = Math.max(ancho, c + 1)
                break
            }
        }
    }
    return recortadas.map((f) => Array.from({ length: ancho }, (_, c) => f[c] ?? null))
}
