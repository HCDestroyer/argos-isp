import PDFDocument from 'pdfkit'
import type { Columna, Fila, ValorCelda } from '#billing/reportes/definicion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import type { LibroLegal } from '#fiscal/libros_legales'

/**
 * PDF de un libro legal (contrato de localización fiscal §7): carta horizontal, encabezado en cada
 * página con razón social, NIT, nombre legal del libro, periodo, folio y «Página N de M»; «Vienen»
 * al inicio de cada página después de la primera y «Van» al pie de cada página que no es la última,
 * con los totales acumulados de las columnas de dinero (sin el saldo); la última cierra con
 * «Total del libro».
 *
 * - Vista previa: marca de agua «Borrador sin folio» en cada página y sin número de folio.
 * - Emisión oficial: folio = `folio_inicial` + página − 1; si es una reimpresión, la marca con los
 *   folios de la emisión anterior; al pie, el último sello y hash de la cadena del periodo (§10.10).
 *
 * El documento no depende de la hora de generación salvo por `generado_en` (que va en el pie y en
 * los metadatos), así que el SHA-256 de la emisión es el de este archivo tal como se guarda.
 */

export interface EmpresaLibro {
    nombre: string
    nit: string | null
}

export interface DatosOficiales {
    folio_inicial: number
    reimpresion: { id: number; folio_inicial: number; folio_final: number } | null
    ultimo_sello: number | null
    ultimo_hash: string | null
}

export interface OpcionesPdfLibro {
    libro: LibroLegal
    empresa: EmpresaLibro
    generado_en: Date
    /** sin esto, vista previa con marca de agua */
    oficial?: DatosOficiales | null
}

export interface PdfLibro {
    pdf: Buffer
    paginas: number
    /** página (0 = primera) en que quedó cada fila del reporte, en orden */
    paginaDeFila: number[]
}

const ANCHO = 792
const ALTO = 612
const MARGEN = 28
const ALTO_ENCABEZADO = 58
const ALTO_PIE = 16
const MARCA_AGUA = 'Borrador sin folio'

/** Columnas que no se dibujan (el tipo de fila se ve en el formato de la fila). */
const OCULTAS = new Set(['fila'])

/** Columnas de texto largo: más ancho. */
const LARGAS = new Set(['descripcion', 'proveedor', 'cliente', 'cuenta_nombre'])

function peso(c: Columna): number {
    if (LARGAS.has(c.clave)) return 3.2
    switch (c.tipo) {
        case 'dinero':
            return 1.25
        case 'fecha':
            return 1.05
        case 'id':
        case 'entero':
            return 0.95
        default:
            return c.clave === 'autorizacion' ? 2.2 : 1.1
    }
}

/** `1234567.5` → `1,234,567.50` (desde el texto: nunca `number`). */
export function formatearDinero(valor: ValorCelda): string {
    if (valor === null || valor === undefined || valor === '') return ''
    const texto = aTexto(dec(String(valor)))
    const negativo = texto.startsWith('-')
    const [entero, decimales] = (negativo ? texto.slice(1) : texto).split('.')
    const conComas = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${negativo ? '-' : ''}${conComas}.${decimales}`
}

function fechaGt(fecha: string): string {
    const [a, m, d] = fecha.split('-')
    return `${d}/${m}/${a}`
}

function celda(c: Columna, valor: ValorCelda): string {
    if (valor === null || valor === undefined) return ''
    if (c.tipo === 'dinero') return formatearDinero(valor)
    if (c.tipo === 'fecha') return fechaGt(String(valor))
    return String(valor)
}

export function libroPdf(opciones: OpcionesPdfLibro): Promise<PdfLibro> {
    const { libro, empresa, oficial } = opciones
    const columnas = libro.reporte.columnas.filter((c) => !OCULTAS.has(c.clave))
    const filas = libro.reporte.filas as Fila[]
    const acumulables = libro.acumulables
    const tamano = columnas.length > 12 ? 6 : 7.5
    const altoFila = tamano * 1.75

    const doc = new PDFDocument({
        size: 'LETTER',
        layout: 'landscape',
        margin: 0,
        bufferPages: true,
        autoFirstPage: true,
        info: {
            Title: `${libro.nombre_legal} ${libro.desde} a ${libro.hasta}`,
            Author: empresa.nombre,
            Producer: 'ArgosIsp',
            Creator: 'ArgosIsp',
            CreationDate: opciones.generado_en,
            ModDate: opciones.generado_en,
        },
    })
    const partes: Buffer[] = []
    const listo = new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (parte: Buffer) => partes.push(parte))
        doc.on('end', () => resolve(Buffer.concat(partes)))
        doc.on('error', reject)
    })

    // anchos proporcionales al peso de cada columna
    const util = ANCHO - MARGEN * 2
    const total = columnas.reduce((s, c) => s + peso(c), 0)
    const anchos = columnas.map((c) => (peso(c) / total) * util)
    const xs: number[] = []
    anchos.reduce((x, a) => (xs.push(x), x + a), MARGEN)

    const RELLENO = 3
    const ajustar = (texto: string, ancho: number): string => {
        const disponible = ancho - RELLENO * 2
        if (doc.widthOfString(texto) <= disponible) return texto
        let fin = texto.length
        while (fin > 0 && doc.widthOfString(`${texto.slice(0, fin)}…`) > disponible) fin--
        return `${texto.slice(0, fin)}…`
    }

    const dibujarFila = (y: number, valores: string[], negrita: boolean, fondo?: string) => {
        if (fondo) {
            doc.rect(MARGEN, y - 1.5, util, altoFila)
                .fill(fondo)
                .fillColor('black')
        }
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamano)
        valores.forEach((texto, i) => {
            if (!texto) return
            const c = columnas[i]!
            const derecha = c.tipo === 'dinero' || c.tipo === 'entero' || c.tipo === 'id'
            doc.text(ajustar(texto, anchos[i]!), xs[i]! + RELLENO, y, {
                width: anchos[i]! - RELLENO * 2,
                align: derecha ? 'right' : 'left',
                lineBreak: false,
            })
        })
    }

    const acumulado = new Map<string, Dec>(acumulables.map((k) => [k, CERO]))
    // la etiqueta («Van», «Vienen», «Total del libro») ocupa las columnas antes de la primera que suma
    const primeraSuma = Math.max(
        1,
        columnas.findIndex((c) => acumulables.includes(c.clave)),
    )
    const dibujarAcumulado = (y: number, etiqueta: string, fondo: string) => {
        dibujarFila(
            y,
            columnas.map((c, i) => {
                if (i < primeraSuma) return ''
                const suma = acumulado.get(c.clave)
                return suma === undefined ? '' : formatearDinero(aTexto(suma))
            }),
            true,
            fondo,
        )
        doc.text(etiqueta, MARGEN + RELLENO, y, {
            width: xs[primeraSuma]! - MARGEN - RELLENO * 2,
            lineBreak: false,
        })
    }

    // títulos en hasta dos renglones
    const altoTitulos = altoFila * 1.9
    const encabezadoTabla = (y: number) => {
        doc.rect(MARGEN, y - 1.5, util, altoTitulos)
            .fill('#e5e7eb')
            .fillColor('black')
        doc.font('Helvetica-Bold').fontSize(tamano)
        columnas.forEach((c, i) => {
            const derecha = c.tipo === 'dinero' || c.tipo === 'entero' || c.tipo === 'id'
            doc.text(c.titulo, xs[i]! + RELLENO, y, {
                width: anchos[i]! - RELLENO * 2,
                height: altoTitulos - 2,
                align: derecha ? 'right' : 'left',
                ellipsis: true,
            })
        })
    }

    const pie = () => {
        const partesPie = [`ArgosIsp · generado ${opciones.generado_en.toISOString()}`]
        if (oficial?.ultimo_hash) {
            partesPie.push(
                `cadena del libro: sello ${oficial.ultimo_sello ?? '—'} · hash ${oficial.ultimo_hash}`,
            )
        }
        doc.font('Helvetica')
            .fontSize(6)
            .fillColor('#4b5563')
            .text(partesPie.join(' · '), MARGEN, ALTO - MARGEN + 4, { width: util, lineBreak: false })
            .fillColor('black')
    }

    const limite = ALTO - MARGEN - ALTO_PIE
    const inicioTabla = MARGEN + ALTO_ENCABEZADO
    let pagina = 0
    let y = inicioTabla
    const nuevaPagina = (primera: boolean) => {
        if (!primera) {
            doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 0 })
            pagina++
        }
        y = inicioTabla
        encabezadoTabla(y)
        y += altoTitulos
        if (!primera) {
            dibujarAcumulado(y, 'Vienen', '#f3f4f6')
            y += altoFila
        }
        pie()
    }

    const paginaDeFila: number[] = []
    nuevaPagina(true)
    filas.forEach((fila, indice) => {
        // reserva el renglón de «Van» (o del total del libro) al pie
        if (y + altoFila * 2 > limite) {
            dibujarAcumulado(y, 'Van', '#f3f4f6')
            nuevaPagina(false)
        }
        const tipo = String(fila.fila ?? 'movimiento')
        dibujarFila(
            y,
            columnas.map((c) => celda(c, fila[c.clave] ?? null)),
            tipo !== 'movimiento',
        )
        if (tipo === 'movimiento') {
            for (const clave of acumulables) {
                acumulado.set(clave, acumulado.get(clave)!.plus(dec((fila[clave] as string | null) ?? '0')))
            }
        }
        paginaDeFila[indice] = pagina
        y += altoFila
    })
    if (filas.length === 0) {
        doc.font('Helvetica-Oblique')
            .fontSize(tamano)
            .text('Sin movimientos en el periodo', MARGEN, y, { width: util, lineBreak: false })
        y += altoFila
    }
    dibujarAcumulado(y, 'Total del libro', '#e5e7eb')

    // encabezado de cada página (ahora que se sabe cuántas hay) y la marca de agua
    const rango = doc.bufferedPageRange()
    const paginas = rango.count
    for (let i = 0; i < paginas; i++) {
        doc.switchToPage(rango.start + i)
        doc.fillColor('black').font('Helvetica-Bold').fontSize(10)
        doc.text(empresa.nombre, MARGEN, MARGEN, { width: util * 0.7, lineBreak: false })
        const folio = oficial ? `Folio ${oficial.folio_inicial + i}` : MARCA_AGUA
        doc.text(folio, MARGEN + util * 0.7, MARGEN, { width: util * 0.3, align: 'right', lineBreak: false })
        doc.font('Helvetica').fontSize(8)
        doc.text(`NIT: ${empresa.nit ?? '—'}`, MARGEN, MARGEN + 13, { width: util * 0.7, lineBreak: false })
        doc.text(`Página ${i + 1} de ${paginas}`, MARGEN + util * 0.7, MARGEN + 13, {
            width: util * 0.3,
            align: 'right',
            lineBreak: false,
        })
        doc.font('Helvetica-Bold').fontSize(11)
        doc.text(libro.nombre_legal, MARGEN, MARGEN + 25, { width: util * 0.7, lineBreak: false })
        doc.font('Helvetica').fontSize(8)
        doc.text(`Periodo: del ${fechaGt(libro.desde)} al ${fechaGt(libro.hasta)}`, MARGEN, MARGEN + 40, {
            width: util * 0.6,
            lineBreak: false,
        })
        if (oficial?.reimpresion) {
            const r = oficial.reimpresion
            doc.font('Helvetica-Bold').text(
                `REIMPRESIÓN · sustituye la emisión ${r.id} (folios ${r.folio_inicial} a ${r.folio_final})`,
                MARGEN + util * 0.4,
                MARGEN + 40,
                { width: util * 0.6, align: 'right', lineBreak: false },
            )
        }
        if (!oficial) {
            doc.save()
            doc.rotate(-28, { origin: [ANCHO / 2, ALTO / 2] })
            doc.font('Helvetica-Bold')
                .fontSize(64)
                .fillColor('#9ca3af')
                .opacity(0.25)
                .text(MARCA_AGUA, 0, ALTO / 2 - 32, { width: ANCHO, align: 'center', lineBreak: false })
            doc.restore()
            doc.opacity(1).fillColor('black')
        }
    }
    doc.end()
    return listo.then((pdf) => ({ pdf, paginas, paginaDeFila }))
}
