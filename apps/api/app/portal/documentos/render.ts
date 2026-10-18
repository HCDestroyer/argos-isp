import Mustache from 'mustache'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'
import { htmlAPdf } from '#portal/documentos/html_a_pdf'
import { PLANTILLA_AVISO_COBRO, PLANTILLA_NOTA_CREDITO } from '#portal/documentos/plantilla_base'
import {
    VARIABLES_AVISO_COBRO,
    imagenesDocumento,
    variablesAvisoCobro,
    vistaDeEjemplo,
    type VistaAvisoCobro,
} from '#portal/documentos/variables'
import {
    VARIABLES_NOTA_CREDITO,
    variablesNotaCredito,
    vistaNotaDeEjemplo,
    type VistaNotaCredito,
} from '#portal/documentos/variables_nota'

/**
 * Plantillas de documentos (HTML + Mustache) → PDF. Mustache escapa el HTML de cada variable
 * (`{{x}}`); el triple bigote `{{{x}}}` no se permite, para que un dato del cliente nunca meta marcas.
 */

export const TIPOS_DOCUMENTO = ['aviso_cobro', 'nota_credito'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

/** Vista (datos) de cualquier documento: la de su tipo. */
export type VistaDocumento = VistaAvisoCobro | VistaNotaCredito

/** Plantillas de fábrica (`GET /documentos/plantillas/:tipo/fabrica` las devuelve tal cual). */
export const PLANTILLAS_BASE: Record<TipoDocumento, string> = {
    aviso_cobro: PLANTILLA_AVISO_COBRO,
    nota_credito: PLANTILLA_NOTA_CREDITO,
}

/** Variables de cada plantilla (para el editor de A4). */
export const VARIABLES_DOCUMENTO: Record<
    TipoDocumento,
    ReadonlyArray<{ nombre: string; descripcion: string }>
> = {
    aviso_cobro: VARIABLES_AVISO_COBRO,
    nota_credito: VARIABLES_NOTA_CREDITO,
}

/** Datos de ejemplo del tipo (vista previa y validación al guardar). */
export function vistaEjemplo(tipo: TipoDocumento, cliente?: QueryClientContract): Promise<VistaDocumento> {
    return tipo === 'nota_credito' ? vistaNotaDeEjemplo(cliente) : vistaDeEjemplo(cliente)
}

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
    return typeof valor === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(valor)
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

const MARCA_LINEAS = /\{\{\s*(?:factura|nota)\.lineas\s*\}\}/g

/** Tabla de líneas para `{{factura.lineas}}` y `{{nota.lineas}}` (los textos ya van escapados por Mustache). */
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

export function renderizarHtml(html: string, vista: VistaDocumento): string {
    validarPlantilla(html)
    return Mustache.render(html.replace(MARCA_LINEAS, TABLA_LINEAS), vista)
}

export async function pdfDesdePlantilla(
    html: string,
    vista: VistaDocumento,
    opciones: { comprimir?: boolean } = {},
): Promise<Buffer> {
    const titulo =
        'nota' in vista
            ? `${vista.nota.documento} ${vista.nota.numero}`
            : `${vista.factura.documento} ${vista.factura.numero}`
    return htmlAPdf(renderizarHtml(html, vista), {
        titulo,
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

/**
 * PDF de una nota de crédito (la NCRE certificada o la nota interna) con la plantilla vigente y la
 * marca de la empresa de su factura. Con `clienteId` solo la del cliente (404 si no).
 */
export async function notaCreditoPdf(
    notaId: number,
    opciones: { clienteId?: number; comprimir?: boolean } = {},
): Promise<DocumentoPdf> {
    const vista = await variablesNotaCredito(notaId, { clienteId: opciones.clienteId })
    const plantilla = await plantillaVigente('nota_credito')
    const pdf = await pdfDesdePlantilla(plantilla.html, vista, { comprimir: opciones.comprimir })
    const prefijo = vista.nota.fel ? 'ncre' : 'nota-credito'
    return { pdf, nombreArchivo: `${prefijo}-${vista.nota.numero.replace(/[^\w-]/g, '_')}.pdf` }
}
