import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { aTexto } from '#ledger/dinero'
import { marcasDeEmpresas, marcaDeEmpresa, type MarcaEmpresa } from '#portal/marca'

/**
 * FEL en el portal (contrato `localizacion-fiscal.md` §8 y §14, fila de A5). Solo lectura de
 * `fiscal.dte` y `billing.*` (de A3); nada aquí certifica, anula ni acredita.
 *
 * - Un documento es «Factura» (o «Nota de débito», o NCRE) solo cuando su DTE fue **certificado**:
 *   estado `certificado`, `anulacion_pendiente` (sigue vigente hasta que la SAT confirme) o
 *   `anulado` (la factura anulada se sigue llamando factura, con su autorización). Un DTE
 *   pendiente, en contingencia, con error o rechazado no cuenta: el cliente ve el aviso de cobro.
 * - El XML certificado (`fiscal.dte.xml`) se entrega solo al cliente dueño del documento.
 */

export const ESTADOS_DTE_CERTIFICADOS = ['certificado', 'anulacion_pendiente', 'anulado'] as const
export type EstadoDtePortal = (typeof ESTADOS_DTE_CERTIFICADOS)[number]

const LISTA_ESTADOS = ESTADOS_DTE_CERTIFICADOS.map((e) => `'${e}'`).join(', ')

/** Espejo del schema `PortalDte`. */
export interface DtePortal {
    tipo_dte: string
    estado: EstadoDtePortal
    autorizacion: string
    serie: string | null
    numero: string | null
    certificado_en: Date | null
    xml_disponible: boolean
}

/**
 * `LEFT JOIN LATERAL` con el último DTE certificado de cada fila de `billing.facturas as <alias>`
 * (para una mora, su NDEB). Expone las columnas `dte_*`.
 */
export function joinDteFactura(alias = 'f'): string {
    return `LEFT JOIN LATERAL (
        SELECT d.id AS dte_id, d.tipo_dte AS dte_tipo, d.estado AS dte_estado, d.autorizacion AS dte_autorizacion,
               d.serie AS dte_serie, d.numero AS dte_numero, d.certificado_en AS dte_certificado_en,
               (d.xml IS NOT NULL) AS dte_xml
          FROM fiscal.dte d
         WHERE d.documento_id = ${alias}.id
           AND d.documento_tipo = CASE WHEN ${alias}.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
           AND d.autorizacion IS NOT NULL
           AND d.estado IN (${LISTA_ESTADOS})
         ORDER BY d.id DESC
         LIMIT 1
    ) dte ON true`
}

/** Lo mismo para `billing.notas_credito as <alias>` (su NCRE). */
export function joinDteNota(alias = 'n'): string {
    return `LEFT JOIN LATERAL (
        SELECT d.id AS dte_id, d.tipo_dte AS dte_tipo, d.estado AS dte_estado, d.autorizacion AS dte_autorizacion,
               d.serie AS dte_serie, d.numero AS dte_numero, d.certificado_en AS dte_certificado_en,
               (d.xml IS NOT NULL) AS dte_xml
          FROM fiscal.dte d
         WHERE d.documento_id = ${alias}.id
           AND d.documento_tipo = 'nota_credito'
           AND d.autorizacion IS NOT NULL
           AND d.estado IN (${LISTA_ESTADOS})
         ORDER BY d.id DESC
         LIMIT 1
    ) dte ON true`
}

export const COLUMNAS_DTE = [
    'dte.dte_id',
    'dte.dte_tipo',
    'dte.dte_estado',
    'dte.dte_autorizacion',
    'dte.dte_serie',
    'dte.dte_numero',
    'dte.dte_certificado_en',
    'dte.dte_xml',
] as const

export interface ColumnasDte {
    dte_id: number | null
    dte_tipo: string | null
    dte_estado: EstadoDtePortal | null
    dte_autorizacion: string | null
    dte_serie: string | null
    dte_numero: string | null
    dte_certificado_en: Date | null
    dte_xml: boolean | null
}

export function dteDeFila(fila: ColumnasDte): DtePortal | null {
    if (fila.dte_id === null || !fila.dte_autorizacion || !fila.dte_estado) return null
    return {
        tipo_dte: fila.dte_tipo ?? 'FACT',
        estado: fila.dte_estado,
        autorizacion: fila.dte_autorizacion,
        serie: fila.dte_serie,
        numero: fila.dte_numero,
        certificado_en: fila.dte_certificado_en,
        xml_disponible: Boolean(fila.dte_xml),
    }
}

/** Quita las columnas `dte_*` de una fila (para no filtrarlas a la respuesta). */
export function sinColumnasDte<T extends ColumnasDte>(fila: T): Omit<T, keyof ColumnasDte> {
    const copia = { ...fila } as Record<string, unknown>
    for (const columna of COLUMNAS_DTE) delete copia[columna.slice('dte.'.length)]
    return copia as Omit<T, keyof ColumnasDte>
}

/** «Serie-número» del DTE certificado; si no hay, el número interno del documento. */
export function numeroDocumento(id: number, dte: Pick<DtePortal, 'serie' | 'numero'> | null): string {
    return dte?.serie && dte.numero ? `${dte.serie}-${dte.numero}` : String(id)
}

/** Espejo del schema `PortalNotaCredito`. */
export interface NotaCreditoPortal {
    id: number
    numero: string
    documento: 'nota_credito' | 'ncre'
    factura_id: number
    factura_numero: string
    servicio_id: number | null
    fecha: string
    subtotal: string
    iva: string
    monto: string
    motivo: string
    estado: 'vigente' | 'anulada'
    dte: DtePortal | null
    empresa: MarcaEmpresa
}

type FilaNota = ColumnasDte & {
    id: number
    factura_id: number
    servicio_id: number | null
    fecha: string
    subtotal: string
    iva: string
    monto: string
    motivo: string
    anulada: boolean
    empresa_id: number
    factura_dte_serie: string | null
    factura_dte_numero: string | null
}

/**
 * Notas de crédito del cliente de la sesión (internas y NCRE), más recientes primero. Solo las de
 * sus facturas visibles en el portal (nunca de una `por_certificar`). Una nota anulada (su NCRE la
 * rechazó la SAT) sale como `anulada`: ya no reduce el saldo.
 */
export async function notasCreditoPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<NotaCreditoPortal>> {
    const conexion = db.connection()
    const consulta = conexion
        .from('billing.notas_credito as n')
        .join('billing.facturas as f', 'f.id', 'n.factura_id')
        .joinRaw(joinDteNota('n'))
        .joinRaw(
            `LEFT JOIN LATERAL (
                SELECT d.serie AS factura_dte_serie, d.numero AS factura_dte_numero
                  FROM fiscal.dte d
                 WHERE d.documento_id = f.id
                   AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                   AND d.autorizacion IS NOT NULL
                   AND d.estado IN (${LISTA_ESTADOS})
                 ORDER BY d.id DESC
                 LIMIT 1
            ) fdte ON true`,
        )
        .where('n.cliente_id', clienteId)
        .where('f.cliente_id', clienteId)
        .whereNot('f.estado', 'por_certificar')
        .select(
            'n.id',
            'n.factura_id',
            'n.servicio_id',
            conexion.raw(`to_char(n.fecha, 'YYYY-MM-DD') as fecha`),
            'n.subtotal',
            'n.iva',
            'n.monto',
            'n.motivo',
            'f.empresa_id',
            conexion.raw(
                'EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id) AS anulada',
            ),
            'fdte.factura_dte_serie',
            'fdte.factura_dte_numero',
            ...COLUMNAS_DTE,
        )
    const pagina = await paginar<FilaNota>(consulta, opciones, { columna: 'n.id' })
    const marcas = await marcasDeEmpresas(pagina.data.map((n) => Number(n.empresa_id)))
    const data: NotaCreditoPortal[] = []
    for (const fila of pagina.data) {
        const dte = dteDeFila(fila)
        const id = Number(fila.id)
        const facturaId = Number(fila.factura_id)
        const empresaId = Number(fila.empresa_id)
        data.push({
            id,
            numero: numeroDocumento(id, dte),
            documento: dte ? 'ncre' : 'nota_credito',
            factura_id: facturaId,
            factura_numero: numeroDocumento(facturaId, {
                serie: fila.factura_dte_serie,
                numero: fila.factura_dte_numero,
            }),
            servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
            fecha: fila.fecha,
            subtotal: aTexto(fila.subtotal),
            iva: aTexto(fila.iva),
            monto: aTexto(fila.monto),
            motivo: fila.motivo,
            estado: fila.anulada ? 'anulada' : 'vigente',
            dte,
            empresa: marcas.get(empresaId) ?? (await marcaDeEmpresa(empresaId)),
        })
    }
    return { data, nextCursor: pagina.nextCursor }
}

export interface XmlDte {
    xml: string
    nombreArchivo: string
}

/**
 * XML certificado de una factura (o de la NDEB de una mora) del cliente. 404 si la factura no es
 * suya, no existe, está `por_certificar` o no tiene DTE certificado con XML.
 */
export async function xmlDeFacturaCliente(
    clienteId: number,
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<XmlDte> {
    const fila = (await cliente
        .from('billing.facturas as f')
        .joinRaw(joinDteFactura('f'))
        .leftJoin('fiscal.dte as d', 'd.id', 'dte.dte_id')
        .where('f.id', facturaId)
        .where('f.cliente_id', clienteId)
        .whereNot('f.estado', 'por_certificar')
        .select('d.xml', 'd.serie', 'd.numero', 'd.tipo_dte')
        .first()) as {
        xml: string | null
        serie: string | null
        numero: string | null
        tipo_dte: string
    } | null
    if (!fila) throw new NoEncontrado(`La factura ${facturaId} no existe`)
    if (!fila.xml) throw new NoEncontrado(`La factura ${facturaId} no tiene un DTE certificado`)
    return { xml: fila.xml, nombreArchivo: nombreXml(fila.tipo_dte, fila.serie, fila.numero, facturaId) }
}

/** XML certificado de la NCRE de una nota de crédito del cliente (404 si no es suya o no tiene). */
export async function xmlDeNotaCliente(
    clienteId: number,
    notaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<XmlDte> {
    const fila = (await cliente
        .from('billing.notas_credito as n')
        .join('billing.facturas as f', 'f.id', 'n.factura_id')
        .joinRaw(joinDteNota('n'))
        .leftJoin('fiscal.dte as d', 'd.id', 'dte.dte_id')
        .where('n.id', notaId)
        .where('n.cliente_id', clienteId)
        .where('f.cliente_id', clienteId)
        .select('d.xml', 'd.serie', 'd.numero', 'd.tipo_dte')
        .first()) as {
        xml: string | null
        serie: string | null
        numero: string | null
        tipo_dte: string
    } | null
    if (!fila) throw new NoEncontrado(`La nota de crédito ${notaId} no existe`)
    if (!fila.xml) throw new NoEncontrado(`La nota de crédito ${notaId} no tiene un DTE certificado`)
    return { xml: fila.xml, nombreArchivo: nombreXml(fila.tipo_dte, fila.serie, fila.numero, notaId) }
}

function nombreXml(tipo: string, serie: string | null, numero: string | null, id: number): string {
    const base = serie && numero ? `${serie}-${numero}` : String(id)
    return `${tipo.toLowerCase()}-${base.replace(/[^\w-]/g, '_')}.xml`
}
