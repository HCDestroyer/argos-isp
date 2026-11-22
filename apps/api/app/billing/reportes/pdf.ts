import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { Columna, Fila, Reporte, ValorCelda } from '#billing/reportes/definicion'
import { formatearDinero } from '#fiscal/libros_pdf'
import { leerArchivoLogo } from '#core/logos'
import { ZONA_NEGOCIO } from '#ledger/fechas'

/**
 * PDF de cualquier reporte (decisión 7 del PM: «todos los reportes en Excel y PDF con logo, empresa,
 * filtros y fecha»). Un solo generador, con `pdfkit` (el motor de los libros legales, el acta de
 * sorteos y las órdenes de traslado): sin dependencias nuevas.
 *
 * - Carta vertical hasta 6 columnas; horizontal con más.
 * - En cada página: logo de la empresa (PNG o SVG saneado) o, en el consolidado, sin logo; nombre y
 *   NIT; título del reporte; filtros usados; fecha y hora de generación (Guatemala) y «Página N de M».
 * - Tabla con títulos repetidos en cada página, dinero con separador de miles desde el texto (nunca
 *   `number`), y la fila de totales al final.
 */

export interface EmpresaPdf {
    nombre: string
    nit: string | null
    logo: { contenido: Buffer; tipo: string } | null
}

export interface OpcionesPdfReporte {
    empresa: EmpresaPdf
    generado_en: Date
    /** quién lo pidió o a quién se envió (opcional, va al pie) */
    generado_para?: string | null
}

/** Nombres legibles de los filtros más comunes; los demás van con su clave. */
const ETIQUETAS_FILTRO: Record<string, string> = {
    desde: 'Desde',
    hasta: 'Hasta',
    corte: 'Corte',
    mes: 'Mes',
    agrupar: 'Agrupado por',
    cliente_id: 'Cliente',
    zona_id: 'Zona',
    router_id: 'Router',
    plan_id: 'Plan',
    caja_id: 'Caja',
    metodo: 'Método',
    canal: 'Canal',
    tipo: 'Tipo',
    origen: 'Origen',
    estado: 'Estado',
    condicion: 'Condición',
    pendientes: 'Solo pendientes',
    empresas: 'Empresas',
    empresa_id: 'Empresa',
}

function fechaGt(texto: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : texto
}

/** «Desde: 01/10/2026 · Hasta: 31/10/2026 · Zona: 3»; sin filtros: «Sin filtros». */
export function describirFiltros(filtros: Record<string, unknown>): string {
    const partes: string[] = []
    for (const [clave, valor] of Object.entries(filtros)) {
        if (valor === undefined || valor === null || valor === '' || clave === 'formato') continue
        const etiqueta = ETIQUETAS_FILTRO[clave] ?? clave
        let texto: string
        if (typeof valor === 'boolean') texto = valor ? 'sí' : 'no'
        else if (Array.isArray(valor)) texto = valor.join(', ')
        else if (typeof valor === 'object') texto = JSON.stringify(valor)
        else texto = fechaGt(String(valor))
        partes.push(`${etiqueta}: ${texto}`)
    }
    return partes.length > 0 ? partes.join(' · ') : 'Sin filtros'
}

function celda(c: Columna, valor: ValorCelda | undefined): string {
    if (valor === null || valor === undefined || valor === '') return ''
    if (c.tipo === 'dinero') return formatearDinero(valor)
    if (c.tipo === 'porcentaje') return `${String(valor)} %`
    if (c.tipo === 'fecha') return fechaGt(String(valor))
    return String(valor)
}

function peso(c: Columna): number {
    if (['grupo', 'cliente', 'descripcion', 'motivo', 'empresa', 'nombre', 'concepto'].includes(c.clave)) {
        return 2.4
    }
    if (c.tipo === 'dinero') return 1.2
    if (c.tipo === 'id' || c.tipo === 'entero') return 0.8
    return 1.1
}

const MARGEN = 32
const ALTO_ENCABEZADO = 92
const ALTO_PIE = 18

export function reporteAPdf(reporte: Reporte, opciones: OpcionesPdfReporte): Promise<Buffer> {
    const columnas = reporte.columnas
    const horizontal = columnas.length > 6
    const ancho = horizontal ? 792 : 612
    const alto = horizontal ? 612 : 792
    const util = ancho - MARGEN * 2
    const tamano = columnas.length > 12 ? 6.5 : 8
    const altoFila = tamano * 1.8
    const generado = DateTime.fromJSDate(opciones.generado_en).setZone(ZONA_NEGOCIO)

    const doc = new PDFDocument({
        size: 'LETTER',
        layout: horizontal ? 'landscape' : 'portrait',
        margin: 0,
        bufferPages: true,
        info: {
            Title: reporte.titulo,
            Author: opciones.empresa.nombre,
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

    const totalPeso = columnas.reduce((s, c) => s + peso(c), 0) || 1
    const anchos = columnas.map((c) => (peso(c) / totalPeso) * util)
    const xs: number[] = []
    anchos.reduce((x, a) => (xs.push(x), x + a), MARGEN)
    const RELLENO = 3
    const derecha = (c: Columna) => ['dinero', 'entero', 'id', 'porcentaje'].includes(c.tipo)
    const ajustar = (texto: string, w: number) => {
        const disponible = w - RELLENO * 2
        if (doc.widthOfString(texto) <= disponible) return texto
        let fin = texto.length
        while (fin > 0 && doc.widthOfString(`${texto.slice(0, fin)}…`) > disponible) fin--
        return `${texto.slice(0, fin)}…`
    }
    const fila = (y: number, valores: string[], negrita: boolean, fondo?: string) => {
        if (fondo) {
            doc.rect(MARGEN, y - 2, util, altoFila)
                .fill(fondo)
                .fillColor('black')
        }
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamano)
        valores.forEach((texto, i) => {
            if (!texto) return
            doc.text(ajustar(texto, anchos[i]!), xs[i]! + RELLENO, y, {
                width: anchos[i]! - RELLENO * 2,
                align: derecha(columnas[i]!) ? 'right' : 'left',
                lineBreak: false,
            })
        })
    }
    const altoTitulos = altoFila * 2
    const titulos = (y: number) => {
        doc.rect(MARGEN, y - 2, util, altoTitulos)
            .fill('#e0e7ff')
            .fillColor('black')
        doc.font('Helvetica-Bold').fontSize(tamano)
        columnas.forEach((c, i) => {
            doc.text(c.titulo, xs[i]! + RELLENO, y, {
                width: anchos[i]! - RELLENO * 2,
                height: altoTitulos - 2,
                align: derecha(c) ? 'right' : 'left',
                ellipsis: true,
            })
        })
    }

    const inicio = MARGEN + ALTO_ENCABEZADO
    const limite = alto - MARGEN - ALTO_PIE
    let y = inicio
    const nuevaPagina = (primera: boolean) => {
        if (!primera) {
            doc.addPage({ size: 'LETTER', layout: horizontal ? 'landscape' : 'portrait', margin: 0 })
        }
        y = inicio
        titulos(y)
        y += altoTitulos
    }
    nuevaPagina(true)
    const filas = reporte.filas as Fila[]
    filas.forEach((f, i) => {
        if (y + altoFila > limite) nuevaPagina(false)
        fila(
            y,
            columnas.map((c) => celda(c, f[c.clave])),
            false,
            i % 2 === 1 ? '#f8fafc' : undefined,
        )
        y += altoFila
    })
    if (filas.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(tamano).text('Sin datos con estos filtros', MARGEN, y, {
            width: util,
            lineBreak: false,
        })
        y += altoFila
    } else if (
        columnas.some((c) => reporte.totales[c.clave] !== null && reporte.totales[c.clave] !== undefined)
    ) {
        if (y + altoFila > limite) nuevaPagina(false)
        fila(
            y,
            columnas.map((c, i) => {
                const t = reporte.totales[c.clave]
                if (t !== null && t !== undefined) return celda(c, t)
                return i === 0 ? 'Total' : ''
            }),
            true,
            '#e0e7ff',
        )
    }

    // encabezado y pie en cada página
    const rango = doc.bufferedPageRange()
    const filtros = describirFiltros(reporte.filtros)
    for (let i = 0; i < rango.count; i++) {
        doc.switchToPage(rango.start + i)
        let xTexto = MARGEN
        const logo = opciones.empresa.logo
        if (logo) {
            try {
                if (logo.tipo === 'image/svg+xml') {
                    SVGtoPDF(doc as never, logo.contenido.toString('utf8'), MARGEN, MARGEN, {
                        width: 110,
                        height: 44,
                        preserveAspectRatio: 'xMinYMin meet',
                    })
                } else {
                    doc.image(logo.contenido, MARGEN, MARGEN, { fit: [110, 44] })
                }
                xTexto = MARGEN + 122
            } catch {
                // un logo dañado no impide el reporte: queda el nombre de la empresa
            }
        }
        const anchoTexto = util - (xTexto - MARGEN)
        doc.fillColor('black').font('Helvetica-Bold').fontSize(11)
        doc.text(opciones.empresa.nombre, xTexto, MARGEN, { width: anchoTexto, lineBreak: false })
        doc.font('Helvetica').fontSize(8)
        doc.text(opciones.empresa.nit ? `NIT ${opciones.empresa.nit}` : '', xTexto, MARGEN + 14, {
            width: anchoTexto,
            lineBreak: false,
        })
        doc.font('Helvetica-Bold').fontSize(13)
        doc.text(reporte.titulo, MARGEN, MARGEN + 50, { width: util, lineBreak: false })
        doc.font('Helvetica').fontSize(7.5).fillColor('#374151')
        doc.text(`Filtros: ${filtros}`, MARGEN, MARGEN + 68, { width: util, height: 20, ellipsis: true })
        doc.text(
            `Generado el ${generado.toFormat('dd/MM/yyyy HH:mm')} (hora de Guatemala)`,
            MARGEN,
            MARGEN + 14,
            {
                width: util,
                align: 'right',
                lineBreak: false,
            },
        )
        const pie = [`ArgosIsp · ${reporte.reporte}`]
        if (opciones.generado_para) pie.push(`para ${opciones.generado_para}`)
        doc.fontSize(7).text(pie.join(' · '), MARGEN, alto - MARGEN - 4, {
            width: util * 0.7,
            lineBreak: false,
        })
        doc.text(`Página ${i + 1} de ${rango.count}`, MARGEN + util * 0.7, alto - MARGEN - 4, {
            width: util * 0.3,
            align: 'right',
            lineBreak: false,
        })
        doc.fillColor('black')
    }
    doc.end()
    return listo
}

/**
 * Datos de la cabecera: una empresa (nombre comercial, NIT y su logo) o el consolidado (sin logo).
 * Un logo que no se puede leer no impide el reporte.
 */
export async function empresaParaPdf(empresas: number[] | null): Promise<EmpresaPdf> {
    if (empresas === null || empresas.length !== 1) {
        return {
            nombre:
                empresas === null
                    ? 'Consolidado de todas las empresas'
                    : `Consolidado de ${empresas.length} empresas`,
            nit: null,
            logo: null,
        }
    }
    const fila = (await db
        .from('core.empresas')
        .where('id', empresas[0]!)
        .select('nombre_comercial', 'nit', 'logo', 'logo_tipo')
        .first()) as {
        nombre_comercial: string
        nit: string | null
        logo: string | null
        logo_tipo: string | null
    } | null
    if (!fila) return { nombre: `Empresa ${empresas[0]}`, nit: null, logo: null }
    let logo: EmpresaPdf['logo'] = null
    if (fila.logo && fila.logo_tipo) {
        const contenido = await leerArchivoLogo(fila.logo).catch(() => null)
        if (contenido) logo = { contenido, tipo: fila.logo_tipo }
    }
    return { nombre: fila.nombre_comercial, nit: fila.nit, logo }
}
