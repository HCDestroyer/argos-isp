import PDFDocument from 'pdfkit'
import type { GanadorVista, RequisitoVigente, SorteoVista } from '#lealtad/sorteos'

/**
 * Acta del sorteo en PDF (`contratos/lealtad.md` §7.3, punto 6): resolución, requisitos (fianza,
 * impuestos…), `bases_hash`, `lista_hash`, `compromiso`, semilla revelada, `valor_publico` con su fuente
 * y evidencia, algoritmo y su versión, titulares y suplentes (con seudónimo y, para la autoridad, nombre),
 * asistentes, constancia y medio de publicación. Lo genera `sorteos.cerrar_acta` una sola vez y se
 * guarda con su SHA-256 (`acta_hash`): el archivo es el acta, no se vuelve a generar.
 */

export interface DatosActa {
    sorteo: SorteoVista
    empresa: { nombre: string; nit: string | null }
    requisitos: RequisitoVigente[]
    ganadores: Array<GanadorVista & { nombre_cliente: string }>
    participantes: number
    boletos: number
    asistentes: Array<{ nombre: string; rol?: string | null }>
    constancia: string
    cerrada_en: Date
}

const MARGEN = 50

function texto(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (v instanceof Date) return v.toISOString()
    return String(v)
}

export function actaPdf(d: DatosActa): Promise<Buffer> {
    const s = d.sorteo
    const doc = new PDFDocument({
        size: 'LETTER',
        margin: MARGEN,
        info: {
            Title: `Acta del sorteo ${s.id}`,
            Producer: 'ArgosIsp',
            Creator: 'ArgosIsp',
            CreationDate: d.cerrada_en,
            ModDate: d.cerrada_en,
        },
    })
    const partes: Buffer[] = []
    const listo = new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (parte: Buffer) => partes.push(parte))
        doc.on('end', () => resolve(Buffer.concat(partes)))
        doc.on('error', reject)
    })
    const ancho = doc.page.width - MARGEN * 2
    const titulo = (t: string) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(t).moveDown(0.2)
    const campo = (etiqueta: string, valor: unknown) =>
        doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(`${etiqueta}: `, { continued: true, width: ancho })
            .font('Helvetica')
            .text(texto(valor), { width: ancho })

    doc.font('Helvetica-Bold').fontSize(16).text(`Acta del sorteo «${s.nombre}»`, { align: 'center' })
    doc.font('Helvetica')
        .fontSize(10)
        .text(`${d.empresa.nombre}${d.empresa.nit ? ` · NIT ${d.empresa.nit}` : ''}`, {
            align: 'center',
        })

    titulo('Datos del acto')
    campo('Sorteo', `${s.id} · ${s.descripcion ?? ''}`)
    campo('Fecha y hora previstas', s.fecha_sorteo)
    campo('Ejecutado', s.ejecutado_en)
    campo('Lugar', s.lugar)
    campo('Resolución de la Gobernación', s.bases.resolucion_gobernacion)
    campo('Participantes y boletos', `${d.participantes} participantes, ${d.boletos} boletos`)

    titulo('Checklist legal (§8)')
    for (const r of d.requisitos) {
        campo(
            r.clave,
            `${r.estado}${r.valor ? ` · ${r.valor}` : ''}${r.evidencia ? ` · ${r.evidencia}` : ''}`,
        )
    }

    titulo('Registro auditable (argos-sorteo-v1)')
    campo('Algoritmo', s.algoritmo)
    campo('bases_hash', s.bases_hash)
    campo('compromiso (SHA-256 de la semilla)', s.compromiso)
    campo('lista_hash', s.lista_hash)
    campo('Semilla revelada', s.semilla)
    campo('Fuente del valor público', s.bases.fuente_valor_publico)
    campo('Valor público', s.valor_publico)
    campo('Evidencia del valor público', s.valor_publico_evidencia)
    doc.font('Helvetica')
        .fontSize(8)
        .text(
            'Cualquiera lo recalcula con GET /api/v1/lealtad/sorteos/:id/verificacion y scripts/verificar-sorteo.mjs.',
            { width: ancho },
        )

    titulo('Ganadores')
    for (const g of d.ganadores) {
        const premio = s.premios.find((p) => p.posicion === g.premio_posicion)
        doc.font('Helvetica')
            .fontSize(9)
            .text(
                `${g.posicion}. ${g.tipo === 'titular' ? 'Titular' : 'Suplente'} · ${g.codigo_publico} · ${
                    premio ? `premio ${premio.posicion}: ${premio.nombre} (Q${premio.valor})` : 'sin premio'
                } · para la autoridad: ${g.nombre_cliente}`,
                { width: ancho },
            )
    }

    titulo('Asistentes')
    if (d.asistentes.length === 0) doc.font('Helvetica').fontSize(9).text('—')
    for (const a of d.asistentes) {
        doc.font('Helvetica')
            .fontSize(9)
            .text(`${a.nombre}${a.rol ? ` (${a.rol})` : ''}`, { width: ancho })
    }

    titulo('Constancia y publicación')
    campo('Firma o constancia', d.constancia)
    campo('Medio de publicación de los resultados', s.bases.publicacion_resultados)
    campo('Acta cerrada', d.cerrada_en)
    doc.end()
    return listo
}
