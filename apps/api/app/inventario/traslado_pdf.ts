import PDFDocument from 'pdfkit'
import { DateTime } from 'luxon'
import type { OrdenTrasladoDetalle } from '#inventario/ordenes_traslado'

/**
 * PDF imprimible de una orden de traslado (fase D, `contratos/inventario.md` D.1), con `pdfkit` (el
 * motor del acta de sorteos y los libros). Encabezado de la empresa, número, fecha, origen y destino,
 * una fila por producto con sus series o MAC y una casilla, totales, el estado y los espacios de firma
 * de quien entrega y de quien recibe. Con firma digital, la imagen va en «Recibe» con nombre, fecha y
 * hash corto; si no, los espacios quedan en blanco para firmar en papel. Sin costos (lo firma el
 * técnico).
 */

export interface DatosPdfTraslado {
    orden: OrdenTrasladoDetalle
    empresa: { nombre: string; nit: string | null }
    logo?: Buffer | null
    firma?: Buffer | null
    generado_en?: Date
}

const MARGEN = 50

function fechaGt(valor: Date | string | null): string {
    if (!valor) return ''
    const fecha = valor instanceof Date ? DateTime.fromJSDate(valor) : DateTime.fromISO(String(valor))
    return fecha.setZone('America/Guatemala').toFormat('dd/MM/yyyy HH:mm')
}

function cantidad(valor: string): string {
    return valor.replace(/\.?0+$/, '') || '0'
}

export function estadoLegible(orden: OrdenTrasladoDetalle): string {
    switch (orden.estado) {
        case 'en_transito':
            return 'En tránsito'
        case 'cancelada':
            return `Cancelada el ${fechaGt(orden.cancelado_en)}: ${orden.motivo_cancelacion ?? ''}`
        default: {
            const quien = orden.recibido_por_nombre ?? `usuario ${orden.recibido_por ?? '—'}`
            const metodo =
                orden.metodo_recepcion === 'firma_digital'
                    ? 'firma digital'
                    : orden.metodo_recepcion === 'firma_papel'
                      ? 'firma en papel'
                      : 'aceptación en el sistema'
            const base = `Recibida por ${quien} el ${fechaGt(orden.recibido_en)} (${metodo})`
            return orden.estado === 'recibida_con_diferencias' ? `${base}, con diferencias` : base
        }
    }
}

export function trasladoPdf(d: DatosPdfTraslado): Promise<Buffer> {
    const o = d.orden
    const generado = d.generado_en ?? new Date()
    const doc = new PDFDocument({
        size: 'LETTER',
        margin: MARGEN,
        info: {
            Title: `Orden de traslado ${o.numero}`,
            Producer: 'ArgosIsp',
            Creator: 'ArgosIsp',
            CreationDate: generado,
            ModDate: generado,
        },
    })
    const partes: Buffer[] = []
    const listo = new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (parte: Buffer) => partes.push(parte))
        doc.on('end', () => resolve(Buffer.concat(partes)))
        doc.on('error', reject)
    })
    const ancho = doc.page.width - MARGEN * 2

    // encabezado
    if (d.logo) {
        try {
            doc.image(d.logo, MARGEN, MARGEN, { fit: [120, 48] })
        } catch {
            // un logo dañado no impide la orden: queda el nombre de la empresa
        }
    }
    doc.font('Helvetica-Bold')
        .fontSize(12)
        .text(d.empresa.nombre, MARGEN, MARGEN, { align: 'right', width: ancho })
    if (d.empresa.nit) {
        doc.font('Helvetica').fontSize(9).text(`NIT ${d.empresa.nit}`, { align: 'right', width: ancho })
    }
    doc.moveDown(2)
    doc.font('Helvetica-Bold')
        .fontSize(16)
        .text(`Orden de traslado N.º ${o.numero}`, MARGEN, doc.y, { align: 'center', width: ancho })
    doc.moveDown(0.5)

    const campo = (etiqueta: string, valor: string) =>
        doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(`${etiqueta}: `, { continued: true, width: ancho })
            .font('Helvetica')
            .text(valor || '—', { width: ancho })
    campo('Fecha de envío', fechaGt(o.enviado_en))
    campo('Origen', o.bodega_origen_nombre)
    campo(
        'Destino',
        o.usuario_destino_nombre
            ? `${o.bodega_destino_nombre} (técnico: ${o.usuario_destino_nombre})`
            : o.bodega_destino_nombre,
    )
    if (o.motivo) campo('Motivo', o.motivo)
    campo('Estado', estadoLegible(o))
    doc.moveDown(0.8)

    // líneas
    const col = {
        casilla: MARGEN,
        sku: MARGEN + 22,
        nombre: MARGEN + 110,
        cantidad: MARGEN + 330,
        series: MARGEN + 390,
    }
    const encabezado = () => {
        const y = doc.y
        doc.font('Helvetica-Bold').fontSize(9)
        doc.text('Ok', col.casilla, y, { width: 18 })
        doc.text('SKU', col.sku, y, { width: 85 })
        doc.text('Producto', col.nombre, y, { width: 215 })
        doc.text('Cantidad', col.cantidad, y, { width: 55, align: 'right' })
        doc.text('Series / MAC', col.series, y, { width: ancho - (col.series - MARGEN) })
        doc.moveTo(MARGEN, doc.y + 2)
            .lineTo(MARGEN + ancho, doc.y + 2)
            .stroke()
        doc.moveDown(0.4)
    }
    encabezado()
    let totalCantidad = 0
    let totalUnidades = 0
    for (const linea of o.lineas) {
        if (doc.y > doc.page.height - 220) {
            doc.addPage()
            encabezado()
        }
        const y = doc.y
        doc.rect(col.casilla, y, 10, 10).stroke()
        const series = linea.unidades
            .map((u) => {
                const nombre = [u.serie, u.mac].filter(Boolean).join(' · ')
                return u.recibida === false ? `${nombre} (faltó)` : nombre
            })
            .join(', ')
        const recibida =
            linea.cantidad_recibida !== null && linea.cantidad_recibida !== linea.cantidad
                ? ` (recibido ${cantidad(linea.cantidad_recibida)})`
                : ''
        doc.font('Helvetica').fontSize(9)
        doc.text(linea.producto_sku, col.sku, y, { width: 85 })
        const altoNombre = doc.heightOfString(`${linea.producto_nombre} (${linea.unidad})`, { width: 215 })
        doc.text(`${linea.producto_nombre} (${linea.unidad})`, col.nombre, y, { width: 215 })
        doc.text(`${cantidad(linea.cantidad)}${recibida}`, col.cantidad, y, { width: 55, align: 'right' })
        const altoSeries = series ? doc.heightOfString(series, { width: ancho - (col.series - MARGEN) }) : 0
        if (series) doc.text(series, col.series, y, { width: ancho - (col.series - MARGEN) })
        doc.y = y + Math.max(14, altoNombre, altoSeries) + 4
        totalCantidad += Number(linea.cantidad)
        totalUnidades += linea.unidades.length
    }
    doc.moveTo(MARGEN, doc.y)
        .lineTo(MARGEN + ancho, doc.y)
        .stroke()
    doc.moveDown(0.4)
    doc.font('Helvetica-Bold')
        .fontSize(10)
        .text(
            `Totales: ${o.lineas.length} línea(s), ${cantidad(totalCantidad.toFixed(3))} en cantidad, ${totalUnidades} equipo(s) por serie`,
            MARGEN,
            doc.y,
            { width: ancho },
        )
    if (o.observaciones) {
        doc.moveDown(0.4)
        doc.font('Helvetica')
            .fontSize(9)
            .text(`Observaciones de la recepción: ${o.observaciones}`, { width: ancho })
    }

    // firmas
    if (doc.y > doc.page.height - 180) doc.addPage()
    const yFirmas = Math.max(doc.y + 30, doc.page.height - 190)
    const anchoFirma = (ancho - 40) / 2
    const bloque = (x: number, titulo: string, nombre: string, fecha: string, extra?: string) => {
        doc.font('Helvetica-Bold').fontSize(10).text(titulo, x, yFirmas, { width: anchoFirma })
        doc.moveTo(x, yFirmas + 80)
            .lineTo(x + anchoFirma, yFirmas + 80)
            .stroke()
        doc.font('Helvetica').fontSize(9)
        doc.text(`Nombre: ${nombre}`, x, yFirmas + 86, { width: anchoFirma })
        doc.text(`Fecha: ${fecha}`, x, yFirmas + 100, { width: anchoFirma })
        if (extra) doc.text(extra, x, yFirmas + 114, { width: anchoFirma })
    }
    bloque(MARGEN, 'Entrega', o.enviado_por_nombre ?? '', fechaGt(o.enviado_en))
    const xRecibe = MARGEN + anchoFirma + 40
    if (o.metodo_recepcion === 'firma_digital' && d.firma) {
        try {
            doc.image(d.firma, xRecibe, yFirmas + 14, { fit: [anchoFirma, 62] })
        } catch {
            // una firma ilegible no impide el PDF: queda su hash
        }
        bloque(
            xRecibe,
            'Recibe (firma digital)',
            o.recibido_por_nombre ?? '',
            fechaGt(o.recibido_en),
            `Firma SHA-256 ${o.firma_sha256?.slice(0, 12) ?? ''}`,
        )
    } else if (o.metodo_recepcion === 'aceptacion_sistema') {
        bloque(
            xRecibe,
            'Recibe (aceptación en el sistema)',
            o.recibido_por_nombre ?? '',
            fechaGt(o.recibido_en),
        )
    } else {
        // en tránsito o firma en papel: espacios en blanco para imprimir y firmar
        bloque(xRecibe, 'Recibe', '', '')
    }
    doc.font('Helvetica')
        .fontSize(7)
        .text(`Generado por ArgosIsp el ${fechaGt(generado)}`, MARGEN, doc.page.height - MARGEN - 10, {
            width: ancho,
            align: 'center',
        })
    doc.end()
    return listo
}
