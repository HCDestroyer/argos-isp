import Mustache from 'mustache'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Alcance } from '#core/acl'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { htmlAPdf, type FormatoPdf } from '#portal/documentos/html_a_pdf'
import {
    PLANTILLA_AVISO_COBRO,
    PLANTILLA_AVISO_COBRO_POS,
    PLANTILLA_NOTA_CREDITO,
    PLANTILLA_NOTA_CREDITO_POS,
    PLANTILLA_RECIBO_COBRO,
    PLANTILLA_RECIBO_COBRO_POS,
} from '#portal/documentos/plantilla_base'
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
import {
    VARIABLES_RECIBO_COBRO,
    variablesReciboCobro,
    vistaReciboDeEjemplo,
    type VistaReciboCobro,
} from '#portal/documentos/variables_recibo'

/**
 * Plantillas de documentos (HTML + Mustache) → PDF. Mustache escapa el HTML de cada variable
 * (`{{x}}`); el triple bigote `{{{x}}}` no se permite, para que un dato del cliente nunca meta marcas.
 *
 * Varias plantillas por tipo (`core.plantillas_documentos`), cada una con nombre y formato (`carta`
 * o `pos_80`). La predeterminada de cada tipo es la que usan el portal, el correo y los procesos
 * automáticos; el panel puede imprimir con otra activa del mismo tipo (`?plantilla_id=`).
 */

export const TIPOS_DOCUMENTO = ['aviso_cobro', 'nota_credito', 'recibo_cobro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export const FORMATOS_DOCUMENTO = ['carta', 'pos_80'] as const satisfies readonly FormatoPdf[]
export type FormatoDocumento = (typeof FORMATOS_DOCUMENTO)[number]

/** Vista (datos) de cualquier documento: la de su tipo. */
export type VistaDocumento = VistaAvisoCobro | VistaNotaCredito | VistaReciboCobro

/** Plantillas de fábrica por tipo y formato (`GET /documentos/plantillas/:tipo/fabrica`). */
export const PLANTILLAS_FABRICA: Record<TipoDocumento, Record<FormatoDocumento, string>> = {
    aviso_cobro: { carta: PLANTILLA_AVISO_COBRO, pos_80: PLANTILLA_AVISO_COBRO_POS },
    nota_credito: { carta: PLANTILLA_NOTA_CREDITO, pos_80: PLANTILLA_NOTA_CREDITO_POS },
    recibo_cobro: { carta: PLANTILLA_RECIBO_COBRO, pos_80: PLANTILLA_RECIBO_COBRO_POS },
}

/** Plantillas de fábrica en carta (compatibilidad: lo que devolvía `/fabrica` antes de los formatos). */
export const PLANTILLAS_BASE: Record<TipoDocumento, string> = {
    aviso_cobro: PLANTILLA_AVISO_COBRO,
    nota_credito: PLANTILLA_NOTA_CREDITO,
    recibo_cobro: PLANTILLA_RECIBO_COBRO,
}

/** Variables de cada plantilla (para el editor del panel). */
export const VARIABLES_DOCUMENTO: Record<
    TipoDocumento,
    ReadonlyArray<{ nombre: string; descripcion: string }>
> = {
    aviso_cobro: VARIABLES_AVISO_COBRO,
    nota_credito: VARIABLES_NOTA_CREDITO,
    recibo_cobro: VARIABLES_RECIBO_COBRO,
}

/** Datos de ejemplo del tipo (vista previa y validación al guardar). */
export function vistaEjemplo(tipo: TipoDocumento, cliente?: QueryClientContract): Promise<VistaDocumento> {
    if (tipo === 'nota_credito') return vistaNotaDeEjemplo(cliente)
    if (tipo === 'recibo_cobro') return vistaReciboDeEjemplo(cliente)
    return vistaDeEjemplo(cliente)
}

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
    return typeof valor === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(valor)
}

export interface PlantillaDocumento {
    /** null: la de fábrica en carta, porque el tipo aún no tiene plantilla predeterminada guardada */
    id: number | null
    tipo: TipoDocumento
    nombre: string
    formato: FormatoDocumento
    predeterminada: boolean
    activa: boolean
    /** sigue a la plantilla de fábrica de su tipo y formato (nadie la ha editado) */
    de_fabrica: boolean
    html: string
    /** 0 = la de fábrica sin fila (nadie la ha guardado) */
    version: number
    updated_at: Date | null
}

interface FilaPlantilla {
    id: number | string
    tipo: TipoDocumento
    nombre: string
    formato: FormatoDocumento
    predeterminada: boolean
    activa: boolean
    html: string | null
    version: number
    updated_at: Date
}

const COLUMNAS = [
    'id',
    'tipo',
    'nombre',
    'formato',
    'predeterminada',
    'activa',
    'html',
    'version',
    'updated_at',
]

export function plantillaDeFila(fila: FilaPlantilla): PlantillaDocumento {
    return {
        id: Number(fila.id),
        tipo: fila.tipo,
        nombre: fila.nombre,
        formato: fila.formato,
        predeterminada: fila.predeterminada,
        activa: fila.activa,
        de_fabrica: fila.html === null,
        html: fila.html ?? PLANTILLAS_FABRICA[fila.tipo][fila.formato],
        version: Number(fila.version),
        updated_at: fila.updated_at,
    }
}

/** La de fábrica en carta, cuando el tipo no tiene predeterminada guardada (versión 0). */
function predeterminadaDeFabrica(tipo: TipoDocumento): PlantillaDocumento {
    return {
        id: null,
        tipo,
        nombre: 'Carta',
        formato: 'carta',
        predeterminada: true,
        activa: true,
        de_fabrica: true,
        html: PLANTILLAS_FABRICA[tipo].carta,
        version: 0,
        updated_at: null,
    }
}

/** La plantilla predeterminada del tipo (la de portal, correo y procesos automáticos). */
export async function plantillaPredeterminada(
    tipo: TipoDocumento,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaDocumento> {
    const fila = (await cliente
        .from('core.plantillas_documentos')
        .where('tipo', tipo)
        .where('predeterminada', true)
        .select(COLUMNAS)
        .first()) as FilaPlantilla | null
    return fila ? plantillaDeFila(fila) : predeterminadaDeFabrica(tipo)
}

/** Compatibilidad: la plantilla vigente de un tipo es su predeterminada. */
export const plantillaVigente = plantillaPredeterminada

export async function plantillaPorId(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaDocumento> {
    const fila = (await cliente
        .from('core.plantillas_documentos')
        .where('id', id)
        .select(COLUMNAS)
        .first()) as FilaPlantilla | null
    if (!fila) throw new NoEncontrado(`La plantilla de documento ${id} no existe`)
    return plantillaDeFila(fila)
}

/** Plantillas guardadas (predeterminada primero, luego por nombre), de un tipo o de todos. */
export async function listarPlantillas(
    filtro: { tipo?: TipoDocumento; activa?: boolean } = {},
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaDocumento[]> {
    const filas = (await cliente
        .from('core.plantillas_documentos')
        .if(filtro.tipo !== undefined, (q) => q.where('tipo', filtro.tipo!))
        .if(filtro.activa !== undefined, (q) => q.where('activa', filtro.activa!))
        .orderBy('tipo', 'asc')
        .orderBy('predeterminada', 'desc')
        .orderByRaw('lower(nombre) asc')
        .select(COLUMNAS)) as FilaPlantilla[]
    return filas.map(plantillaDeFila)
}

/**
 * Plantilla con la que se imprime un documento del `tipo`: la pedida (activa y del mismo tipo;
 * si no, 422 en `plantilla_id`) o, sin `plantillaId`, la predeterminada.
 */
export async function plantillaParaImprimir(
    tipo: TipoDocumento,
    plantillaId?: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaDocumento> {
    if (plantillaId === undefined || plantillaId === null) return plantillaPredeterminada(tipo, cliente)
    const plantilla = await plantillaPorId(plantillaId, cliente).catch((error) => {
        if (error instanceof NoEncontrado) return null
        throw error
    })
    const motivo = !plantilla
        ? 'La plantilla no existe'
        : plantilla.tipo !== tipo
          ? `La plantilla es de otro documento (${plantilla.tipo}), no de ${tipo}`
          : !plantilla.activa
            ? 'La plantilla está desactivada'
            : null
    if (motivo) throw new ValidacionFallida([{ field: 'plantilla_id', message: motivo, rule: 'plantilla' }])
    return plantilla!
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
    opciones: { comprimir?: boolean; formato?: FormatoDocumento } = {},
): Promise<Buffer> {
    const titulo =
        'nota' in vista
            ? `${vista.nota.documento} ${vista.nota.numero}`
            : 'cobro' in vista
              ? `Recibo de cobro ${vista.cobro.numero}`
              : `${vista.factura.documento} ${vista.factura.numero}`
    return htmlAPdf(renderizarHtml(html, vista), {
        titulo,
        comprimir: opciones.comprimir,
        formato: opciones.formato,
        // Solo el logo de la empresa del documento: `<img>` nunca descarga nada de afuera.
        imagenes: await imagenesDocumento(vista),
    })
}

export interface DocumentoPdf {
    pdf: Buffer
    nombreArchivo: string
}

interface OpcionesDocumento {
    clienteId?: number
    comprimir?: boolean
    /** plantilla elegida al imprimir desde el panel; sin ella, la predeterminada */
    plantillaId?: number | null
}

function sufijo(plantilla: PlantillaDocumento): string {
    return plantilla.formato === 'pos_80' ? '-pos' : ''
}

/** PDF del aviso de cobro (o factura, con FEL) de una factura. */
export async function avisoCobroPdf(
    facturaId: number,
    opciones: OpcionesDocumento = {},
): Promise<DocumentoPdf> {
    const plantilla = await plantillaParaImprimir('aviso_cobro', opciones.plantillaId)
    const vista = await variablesAvisoCobro(facturaId, { clienteId: opciones.clienteId })
    const pdf = await pdfDesdePlantilla(plantilla.html, vista, {
        comprimir: opciones.comprimir,
        formato: plantilla.formato,
    })
    const prefijo = vista.factura.fel ? 'factura' : 'aviso-cobro'
    return {
        pdf,
        nombreArchivo: `${prefijo}-${vista.factura.numero.replace(/[^\w-]/g, '_')}${sufijo(plantilla)}.pdf`,
    }
}

/**
 * PDF de una nota de crédito (la NCRE certificada o la nota interna) con la marca de la empresa de
 * su factura. Con `clienteId` solo la del cliente (404 si no).
 */
export async function notaCreditoPdf(
    notaId: number,
    opciones: OpcionesDocumento = {},
): Promise<DocumentoPdf> {
    const plantilla = await plantillaParaImprimir('nota_credito', opciones.plantillaId)
    const vista = await variablesNotaCredito(notaId, { clienteId: opciones.clienteId })
    const pdf = await pdfDesdePlantilla(plantilla.html, vista, {
        comprimir: opciones.comprimir,
        formato: plantilla.formato,
    })
    const prefijo = vista.nota.fel ? 'ncre' : 'nota-credito'
    return {
        pdf,
        nombreArchivo: `${prefijo}-${vista.nota.numero.replace(/[^\w-]/g, '_')}${sufijo(plantilla)}.pdf`,
    }
}

/**
 * PDF del recibo de un cobro de caja (una sección por empresa). `permitidas` y `alcance` como en
 * `GET /cobros/:id`: solo las secciones de las empresas del usuario (403 si ninguna).
 */
export async function reciboCobroPdf(
    cobroId: number,
    opciones: {
        permitidas?: number[] | null
        alcance?: Alcance
        comprimir?: boolean
        plantillaId?: number | null
    } = {},
): Promise<DocumentoPdf> {
    const plantilla = await plantillaParaImprimir('recibo_cobro', opciones.plantillaId)
    const vista = await variablesReciboCobro(cobroId, {
        permitidas: opciones.permitidas,
        alcance: opciones.alcance,
    })
    const pdf = await pdfDesdePlantilla(plantilla.html, vista, {
        comprimir: opciones.comprimir,
        formato: plantilla.formato,
    })
    return { pdf, nombreArchivo: `recibo-cobro-${vista.cobro.numero}${sufijo(plantilla)}.pdf` }
}

/** Revisa que la plantilla genere su PDF con los datos de ejemplo del tipo (422 en `html` si no). */
export async function validarConEjemplo(
    tipo: TipoDocumento,
    formato: FormatoDocumento,
    html: string,
    cliente?: QueryClientContract,
): Promise<void> {
    await pdfDesdePlantilla(html, await vistaEjemplo(tipo, cliente), { formato })
}

/** 422 en `nombre` si otra plantilla del tipo ya se llama así (sin mayúsculas). */
export async function exigirNombreLibre(
    tipo: TipoDocumento,
    nombre: string,
    excepto: number | null,
    cliente: QueryClientContract,
): Promise<void> {
    const otra = await cliente
        .from('core.plantillas_documentos')
        .where('tipo', tipo)
        .whereRaw('lower(nombre) = lower(?)', [nombre])
        .if(excepto !== null, (q) => q.whereNot('id', excepto!))
        .select('id')
        .first()
    if (otra) {
        throw new ValidacionFallida([
            {
                field: 'nombre',
                message: 'Ya hay una plantilla de este documento con ese nombre',
                rule: 'unico',
            },
        ])
    }
}

/** Lo que se audita de una plantilla (`html` null = la de fábrica). */
export function camposAuditados(fila: {
    nombre: string
    formato: FormatoDocumento
    predeterminada: boolean
    activa: boolean
    html: string | null
}) {
    return {
        nombre: fila.nombre,
        formato: fila.formato,
        predeterminada: fila.predeterminada,
        activa: fila.activa,
        html: fila.html,
    }
}

/** Fila cruda (con `html` null si es la de fábrica) para el diff y las reglas de las acciones. */
export async function filaPlantilla(
    id: number,
    cliente: QueryClientContract,
    bloquear = false,
): Promise<{
    id: number
    tipo: TipoDocumento
    nombre: string
    formato: FormatoDocumento
    predeterminada: boolean
    activa: boolean
    html: string | null
    version: number
}> {
    const consulta = cliente
        .from('core.plantillas_documentos')
        .where('id', id)
        .select('id', 'tipo', 'nombre', 'formato', 'predeterminada', 'activa', 'html', 'version')
    const fila = await (bloquear ? consulta.forUpdate() : consulta).first()
    if (!fila) throw new NoEncontrado(`La plantilla de documento ${id} no existe`)
    return { ...fila, id: Number(fila.id), version: Number(fila.version) }
}
