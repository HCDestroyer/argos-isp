import Mustache from 'mustache'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'
import { htmlAPdf } from '#portal/documentos/html_a_pdf'
import { PLANTILLA_AVISO_COBRO } from '#portal/documentos/plantilla_base'
import { imagenesDocumento, variablesAvisoCobro, type VistaAvisoCobro } from '#portal/documentos/variables'

/**
 * Plantillas de documentos (HTML + Mustache) → PDF. Mustache escapa el HTML de cada variable
 * (`{{x}}`); el triple bigote `{{{x}}}` no se permite, para que un dato del cliente nunca meta marcas.
 */

export const TIPOS_DOCUMENTO = ['aviso_cobro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export const PLANTILLAS_BASE: Record<TipoDocumento, string> = {
    aviso_cobro: PLANTILLA_AVISO_COBRO,
}

export interface PlantillaDocumento {
    tipo: TipoDocumento
    html: string
    /** 0 = la de fábrica (nadie la ha guardado) */
    version: number
}

export async function plantillaVigente(
    tipo: TipoDocumento,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaDocumento> {
    const fila = (await cliente
        .from('core.plantillas_documentos')
        .where('tipo', tipo)
        .select('html', 'version')
        .first()) as { html: string; version: number } | null
    return fila
        ? { tipo, html: fila.html, version: Number(fila.version) }
        : { tipo, html: PLANTILLAS_BASE[tipo], version: 0 }
}

const MARCA_LINEAS = /\{\{\s*factura\.lineas\s*\}\}/g

/** Tabla de líneas para `{{factura.lineas}}` (los textos ya van escapados por Mustache). */
const TABLA_LINEAS = `<table>
<thead><tr><th width="52%">Concepto</th><th width="12%" class="derecha">Cant.</th><th width="18%" class="derecha">Precio</th><th width="18%" class="derecha">Total</th></tr></thead>
<tbody>{{#lineas}}<tr><td>{{concepto}}</td><td class="derecha">{{cantidad}}</td><td class="derecha">{{precio_unitario}}</td><td class="derecha">{{total}}</td></tr>{{/lineas}}
{{^lineas}}<tr><td colspan="4" class="tenue">Sin detalle de líneas</td></tr>{{/lineas}}</tbody>
</table>`

/** Revisa la plantilla: Mustache válido y sin `{{{ }}}` ni `{{& }}`. Lanza 422 con `field: html`. */
export function validarPlantilla(html: string): void {
    if (/\{\{\{|\{\{\s*&/.test(html)) {
        throw new ValidacionFallida([
            {
                field: 'html',
                message: 'No se permite {{{ }}} ni {{& }}: usa {{variable}}',
                rule: 'plantilla',
            },
        ])
    }
    try {
        Mustache.parse(html)
    } catch (error) {
        throw new ValidacionFallida([
            {
                field: 'html',
                message: `La plantilla no es válida: ${error instanceof Error ? error.message : String(error)}`,
                rule: 'plantilla',
            },
        ])
    }
}

export function renderizarHtml(html: string, vista: VistaAvisoCobro): string {
    validarPlantilla(html)
    return Mustache.render(html.replace(MARCA_LINEAS, TABLA_LINEAS), vista)
}

export async function pdfDesdePlantilla(
    html: string,
    vista: VistaAvisoCobro,
    opciones: { comprimir?: boolean } = {},
): Promise<Buffer> {
    return htmlAPdf(renderizarHtml(html, vista), {
        titulo: `${vista.factura.documento} ${vista.factura.numero}`,
        comprimir: opciones.comprimir,
        // Solo el logo de la empresa del documento: `<img>` nunca descarga nada de afuera.
        imagenes: await imagenesDocumento(vista),
    })
}

export interface DocumentoPdf {
    pdf: Buffer
    nombreArchivo: string
}

/** PDF del aviso de cobro (o factura, con FEL) de una factura, con la plantilla vigente. */
export async function avisoCobroPdf(
    facturaId: number,
    opciones: { clienteId?: number; comprimir?: boolean } = {},
): Promise<DocumentoPdf> {
    const vista = await variablesAvisoCobro(facturaId, { clienteId: opciones.clienteId })
    const plantilla = await plantillaVigente('aviso_cobro')
    const pdf = await pdfDesdePlantilla(plantilla.html, vista, { comprimir: opciones.comprimir })
    const prefijo = vista.factura.fel ? 'factura' : 'aviso-cobro'
    return { pdf, nombreArchivo: `${prefijo}-${vista.factura.numero.replace(/[^\w-]/g, '_')}.pdf` }
}
