import { crc32 } from 'node:zlib'
import type { Columna, Reporte, ValorCelda } from '#billing/reportes/definicion'

/**
 * Exportación de reportes a CSV y a Excel (XLSX) **sin dependencias**: un XLSX es un ZIP de
 * unos pocos XML (Office Open XML). Se escribe un ZIP sin compresión (método STORE, CRC-32 de
 * `node:zlib`), con una hoja, encabezados en negrita, dinero como número con 2 decimales y
 * cadenas en línea (`inlineStr`, sin tabla de cadenas compartidas). Los reportes son de miles de
 * filas, no de millones: no hace falta streaming ni compresión.
 */

export type FormatoExportacion = 'csv' | 'xlsx'

export const TIPOS_CONTENIDO: Record<FormatoExportacion, string> = {
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/*
|--------------------------------------------------------------------------
| CSV
|--------------------------------------------------------------------------
*/

/** Marca de orden de bytes UTF-8: Excel abre el CSV con tildes y eñes. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

function celdaCsv(valor: ValorCelda): string {
    if (valor === null || valor === undefined) return ''
    const texto = String(valor)
    // evita la inyección de fórmulas al abrirlo en una hoja de cálculo
    const seguro = /^[=+\-@\t\r]/.test(texto) && !/^-?\d+(\.\d+)?$/.test(texto) ? `'${texto}` : texto
    return /[",\n\r;]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro
}

/** CSV con BOM UTF-8 (Excel lo abre con tildes), separador coma y fila de totales al final. */
export function aCsv(reporte: Reporte): Buffer {
    const lineas = [reporte.columnas.map((c) => celdaCsv(c.titulo)).join(',')]
    for (const fila of reporte.filas) {
        lineas.push(reporte.columnas.map((c) => celdaCsv(fila[c.clave] ?? null)).join(','))
    }
    if (reporte.filas.length > 0 && tieneTotales(reporte)) {
        lineas.push(filaTotales(reporte).map(celdaCsv).join(','))
    }
    return Buffer.concat([BOM, Buffer.from(`${lineas.join('\r\n')}\r\n`, 'utf8')])
}

function tieneTotales(reporte: Reporte): boolean {
    return reporte.columnas.some(
        (c) => reporte.totales[c.clave] !== null && reporte.totales[c.clave] !== undefined,
    )
}

function filaTotales(reporte: Reporte): ValorCelda[] {
    return reporte.columnas.map((c, i) => {
        const total = reporte.totales[c.clave]
        if (total !== null && total !== undefined) return total
        return i === 0 ? 'Total' : null
    })
}

/*
|--------------------------------------------------------------------------
| XLSX
|--------------------------------------------------------------------------
*/

function xml(texto: string): string {
    return (
        texto
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .split('')
            // caracteres de control no válidos en XML 1.0 (se conservan tab y saltos de línea)
            .filter((c) => c.charCodeAt(0) >= 0x20 || c === '\t' || c === '\n' || c === '\r')
            .join('')
    )
}

function letraColumna(indice: number): string {
    let n = indice + 1
    let letra = ''
    while (n > 0) {
        const resto = (n - 1) % 26
        letra = String.fromCharCode(65 + resto) + letra
        n = Math.floor((n - 1) / 26)
    }
    return letra
}

/** Estilos: 0 normal, 1 encabezado en negrita, 2 dinero `#,##0.00`, 3 negrita con dinero. */
function celdaXlsx(ref: string, valor: ValorCelda, columna: Columna | null, negrita: boolean): string {
    if (valor === null || valor === undefined || valor === '') return ''
    const numerica = columna && ['dinero', 'entero', 'porcentaje', 'id'].includes(columna.tipo)
    if (numerica && /^-?\d+(\.\d+)?$/.test(String(valor))) {
        const estilo =
            columna.tipo === 'dinero' || columna.tipo === 'porcentaje' ? (negrita ? 3 : 2) : negrita ? 1 : 0
        return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}><v>${String(valor)}</v></c>`
    }
    return `<c r="${ref}" t="inlineStr"${negrita ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(valor))}</t></is></c>`
}

function hoja(reporte: Reporte): string {
    const filas: string[] = []
    const agregar = (valores: ValorCelda[], negrita: boolean, datos: boolean) => {
        const r = filas.length + 1
        const celdas = valores
            .map((valor, i) =>
                celdaXlsx(`${letraColumna(i)}${r}`, valor, datos ? reporte.columnas[i]! : null, negrita),
            )
            .join('')
        filas.push(`<row r="${r}">${celdas}</row>`)
    }
    agregar(
        reporte.columnas.map((c) => c.titulo),
        true,
        false,
    )
    for (const fila of reporte.filas) {
        agregar(
            reporte.columnas.map((c) => fila[c.clave] ?? null),
            false,
            true,
        )
    }
    if (reporte.filas.length > 0 && tieneTotales(reporte)) agregar(filaTotales(reporte), true, true)
    const anchos = reporte.columnas
        .map(
            (c, i) =>
                `<col min="${i + 1}" max="${i + 1}" width="${Math.max(12, Math.min(40, c.titulo.length + 4))}" customWidth="1"/>`,
        )
        .join('')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        `<cols>${anchos}</cols>` +
        `<sheetData>${filas.join('')}</sheetData>` +
        '</worksheet>'
    )
}

const ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '</cellXfs>' +
    '</styleSheet>'

/** Nombre de hoja válido en Excel: máximo 31 caracteres, sin `[]:*?/\`. */
function nombreHoja(titulo: string): string {
    return titulo.replaceAll(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Reporte'
}

export function aXlsx(reporte: Reporte): Buffer {
    const archivos: Array<[string, string]> = [
        [
            '[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                '</Types>',
        ],
        [
            '_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>',
        ],
        [
            'xl/workbook.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                `<sheets><sheet name="${xml(nombreHoja(reporte.titulo))}" sheetId="1" r:id="rId1"/></sheets>` +
                '</workbook>',
        ],
        [
            'xl/_rels/workbook.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                '</Relationships>',
        ],
        ['xl/worksheets/sheet1.xml', hoja(reporte)],
        ['xl/styles.xml', ESTILOS],
    ]
    return zipSinCompresion(archivos.map(([nombre, contenido]) => [nombre, Buffer.from(contenido, 'utf8')]))
}

/*
|--------------------------------------------------------------------------
| ZIP (STORE)
|--------------------------------------------------------------------------
*/

/** Fecha y hora DOS fijas (1980-01-01 00:00): el archivo no depende de la hora de generación. */
const FECHA_DOS = 0x0021
const HORA_DOS = 0

export function zipSinCompresion(archivos: Array<[string, Buffer]>): Buffer {
    const locales: Buffer[] = []
    const centrales: Buffer[] = []
    let desplazamiento = 0
    for (const [nombre, datos] of archivos) {
        const nombreBytes = Buffer.from(nombre, 'utf8')
        const crc = crc32(datos)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4) // versión necesaria
        local.writeUInt16LE(0x0800, 6) // nombres en UTF-8
        local.writeUInt16LE(0, 8) // STORE
        local.writeUInt16LE(HORA_DOS, 10)
        local.writeUInt16LE(FECHA_DOS, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(datos.length, 18)
        local.writeUInt32LE(datos.length, 22)
        local.writeUInt16LE(nombreBytes.length, 26)
        local.writeUInt16LE(0, 28)
        locales.push(local, nombreBytes, datos)

        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE(20, 4) // versión que lo creó
        central.writeUInt16LE(20, 6)
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(0, 10)
        central.writeUInt16LE(HORA_DOS, 12)
        central.writeUInt16LE(FECHA_DOS, 14)
        central.writeUInt32LE(crc, 16)
        central.writeUInt32LE(datos.length, 20)
        central.writeUInt32LE(datos.length, 24)
        central.writeUInt16LE(nombreBytes.length, 28)
        central.writeUInt16LE(0, 30) // extra
        central.writeUInt16LE(0, 32) // comentario
        central.writeUInt16LE(0, 34) // disco
        central.writeUInt16LE(0, 36) // atributos internos
        central.writeUInt32LE(0, 38) // atributos externos
        central.writeUInt32LE(desplazamiento, 42)
        centrales.push(central, nombreBytes)
        desplazamiento += local.length + nombreBytes.length + datos.length
    }
    const directorio = Buffer.concat(centrales)
    const fin = Buffer.alloc(22)
    fin.writeUInt32LE(0x06054b50, 0)
    fin.writeUInt16LE(0, 4)
    fin.writeUInt16LE(0, 6)
    fin.writeUInt16LE(archivos.length, 8)
    fin.writeUInt16LE(archivos.length, 10)
    fin.writeUInt32LE(directorio.length, 12)
    fin.writeUInt32LE(desplazamiento, 16)
    fin.writeUInt16LE(0, 20)
    return Buffer.concat([...locales, directorio, fin])
}

export function exportar(reporte: Reporte, formato: FormatoExportacion): Buffer {
    return formato === 'csv' ? aCsv(reporte) : aXlsx(reporte)
}
