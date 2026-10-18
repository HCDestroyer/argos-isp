import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { ZONA, fechaCalendario, fechaCorta, fechaHora, mesAnio, quetzales } from '#notify/formato'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import {
    COLUMNAS_DTE,
    dteDeFila,
    joinDteFactura,
    joinDteNota,
    numeroDocumento,
    type ColumnasDte,
} from '#portal/fel'
import { empresaDocumento, type EmpresaDocumento, type LineaVista } from '#portal/documentos/variables'

/**
 * Variables de la plantilla de la nota de crédito (Mustache): la representación gráfica de la NCRE
 * con la marca de la empresa de su factura. Montos ya formateados en quetzales; fechas en
 * `America/Guatemala`. Solo lectura de `billing.notas_credito*` y `fiscal.dte` (de A3).
 *
 * `{{nota.lineas}}` inserta la tabla de conceptos acreditados (las líneas de la nota, o una sola
 * con el motivo si la nota no es por línea).
 */

export interface VistaNotaCredito {
    empresa: EmpresaDocumento
    /** id de la empresa del documento (no es variable de la plantilla) */
    empresa_id?: number
    cliente: { nombre: string; nit: string; direccion: string | null; email: string | null }
    nota: {
        id: number
        numero: string
        documento: string
        fecha: string
        motivo: string
        subtotal: string
        iva: string
        monto: string
        anulada: boolean
        motivo_anulacion: string | null
        fel: boolean
        fel_uuid: string | null
        fel_serie: string | null
        fel_numero: string | null
        fel_fecha: string | null
        fel_anulado: boolean
    }
    factura: {
        id: number
        numero: string
        documento: string
        periodo: string
        emitida: string
        total: string
        fel_uuid: string | null
    }
    lineas: LineaVista[]
    generado: string
}

export const VARIABLES_NOTA_CREDITO: ReadonlyArray<{ nombre: string; descripcion: string }> = [
    { nombre: 'empresa.nombre', descripcion: 'Nombre comercial de la empresa que emite la nota' },
    { nombre: 'empresa.razon_social', descripcion: 'Razón social (nombre fiscal) de la empresa' },
    { nombre: 'empresa.nit', descripcion: 'NIT de la empresa' },
    { nombre: 'empresa.direccion', descripcion: 'Dirección fiscal de la empresa' },
    {
        nombre: 'empresa.logo',
        descripcion: 'Sección: la empresa tiene logo. Se dibuja con <img src="empresa:logo" height="48">',
    },
    { nombre: 'empresa.telefono', descripcion: 'Teléfono de atención' },
    { nombre: 'empresa.correo', descripcion: 'Correo de atención' },
    {
        nombre: 'cliente.nombre',
        descripcion: 'Receptor: nombre del DTE certificado o nombre fiscal del cliente',
    },
    { nombre: 'cliente.nit', descripcion: 'NIT o CUI del receptor; "CF" si no tiene' },
    { nombre: 'cliente.direccion', descripcion: 'Dirección fiscal (o la del cliente)' },
    { nombre: 'cliente.email', descripcion: 'Correo del cliente' },
    { nombre: 'nota.documento', descripcion: '"Nota de crédito"' },
    { nombre: 'nota.numero', descripcion: 'Serie-número de la NCRE o número interno de la nota' },
    { nombre: 'nota.fecha', descripcion: 'Fecha de la nota: 12/06/2026' },
    { nombre: 'nota.motivo', descripcion: 'Motivo de la nota' },
    { nombre: 'nota.subtotal', descripcion: 'Subtotal acreditado sin IVA' },
    { nombre: 'nota.iva', descripcion: 'IVA acreditado' },
    { nombre: 'nota.monto', descripcion: 'Total acreditado' },
    {
        nombre: 'nota.lineas',
        descripcion: 'Tabla de conceptos acreditados (concepto, cantidad, precio, total)',
    },
    {
        nombre: 'nota.anulada',
        descripcion: 'Sección: la nota se anuló (la SAT rechazó su NCRE o se anuló el DTE)',
    },
    { nombre: 'nota.motivo_anulacion', descripcion: 'Motivo de la anulación' },
    { nombre: 'nota.fel', descripcion: 'Sección: la NCRE está certificada (FEL)' },
    { nombre: 'nota.fel_uuid', descripcion: 'Número de autorización de la NCRE' },
    { nombre: 'nota.fel_serie', descripcion: 'Serie de la NCRE' },
    { nombre: 'nota.fel_numero', descripcion: 'Número de la NCRE' },
    { nombre: 'nota.fel_fecha', descripcion: 'Fecha y hora de certificación (Guatemala)' },
    { nombre: 'nota.fel_anulado', descripcion: 'Sección: la NCRE fue anulada ante la SAT' },
    {
        nombre: 'factura.documento',
        descripcion: 'Documento acreditado: "Factura", "Nota de débito" o "Aviso de cobro"',
    },
    { nombre: 'factura.numero', descripcion: 'Serie-número FEL o número del documento acreditado' },
    { nombre: 'factura.periodo', descripcion: 'Mes facturado: "junio 2026"' },
    { nombre: 'factura.emitida', descripcion: 'Fecha de emisión del documento acreditado' },
    { nombre: 'factura.total', descripcion: 'Total del documento acreditado' },
    { nombre: 'factura.fel_uuid', descripcion: 'Autorización FEL del documento acreditado' },
    {
        nombre: 'lineas',
        descripcion: 'Lista para {{#lineas}}: concepto, cantidad, precio_unitario, iva, total',
    },
    { nombre: 'generado', descripcion: 'Fecha y hora de generación (Guatemala)' },
]

type FilaNota = ColumnasDte & {
    id: number
    fecha: string
    motivo: string
    subtotal: string
    iva: string
    monto: string
    empresa_id: number
    anulada_motivo: string | null
    anulada: boolean
    dte_receptor: { tipo?: string; id?: string | null; nombre?: string | null } | null
    factura_id: number
    factura_tipo: string
    factura_periodo: string
    factura_emitida_en: Date | null
    factura_total: string
    cliente_nombre: string
    nombre_fiscal: string | null
    nit_cui: string | null
    direccion_fiscal: string | null
    cliente_direccion: string | null
    email: string | null
    fdte_autorizacion: string | null
    fdte_serie: string | null
    fdte_numero: string | null
    fdte_tipo: string | null
}

const DOCUMENTO_FACTURA: Record<string, string> = {
    FACT: 'Factura',
    FCAM: 'Factura cambiaria',
    NDEB: 'Nota de débito',
}

/**
 * Variables de una nota de crédito real. Con `clienteId` (portal) la nota debe ser suya y de una
 * factura visible (nunca `por_certificar`): si no, 404 igual que una inexistente.
 */
export async function variablesNotaCredito(
    notaId: number,
    opciones: { clienteId?: number; cliente?: QueryClientContract; ahora?: Date } = {},
): Promise<VistaNotaCredito> {
    const cliente = opciones.cliente ?? db.connection()
    const fila = (await cliente
        .from('billing.notas_credito as n')
        .join('billing.facturas as f', 'f.id', 'n.factura_id')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .joinRaw(joinDteNota('n'))
        .joinRaw(joinDteFactura('f', 'fdte'))
        .leftJoin('fiscal.dte as dn', 'dn.id', 'dte.dte_id')
        .where('n.id', notaId)
        .if(opciones.clienteId !== undefined, (q) =>
            q
                .where('n.cliente_id', opciones.clienteId!)
                .where('f.cliente_id', opciones.clienteId!)
                .whereNot('f.estado', 'por_certificar'),
        )
        .select(
            'n.id',
            cliente.raw(`to_char(n.fecha, 'YYYY-MM-DD') as fecha`),
            'n.motivo',
            'n.subtotal',
            'n.iva',
            'n.monto',
            'f.empresa_id',
            cliente.raw(
                'EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id) AS anulada',
            ),
            cliente.raw(
                '(SELECT x.motivo FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id) AS anulada_motivo',
            ),
            'dn.receptor as dte_receptor',
            'f.id as factura_id',
            'f.tipo as factura_tipo',
            cliente.raw(`to_char(f.periodo, 'YYYY-MM-DD') as factura_periodo`),
            'f.emitida_en as factura_emitida_en',
            'f.total as factura_total',
            'c.nombre as cliente_nombre',
            'c.nombre_fiscal',
            'c.nit_cui',
            'c.direccion_fiscal',
            'c.direccion as cliente_direccion',
            'c.email',
            'fdte.fdte_autorizacion',
            'fdte.fdte_serie',
            'fdte.fdte_numero',
            'fdte.fdte_tipo',
            ...COLUMNAS_DTE,
        )
        .first()) as FilaNota | null
    if (!fila) throw new NoEncontrado(`La nota de crédito ${notaId} no existe`)

    const lineas = (await cliente
        .from('billing.notas_credito_lineas as nl')
        .join('billing.facturas_lineas as fl', 'fl.id', 'nl.linea_id')
        .where('nl.nota_id', notaId)
        .orderBy('nl.id', 'asc')
        .select('fl.concepto', 'nl.monto', 'nl.iva')) as Array<{
        concepto: string
        monto: string
        iva: string
    }>

    const dte = dteDeFila(fila)
    const id = Number(fila.id)
    const facturaId = Number(fila.factura_id)
    const empresaId = Number(fila.empresa_id)
    const facturaDte = fila.fdte_autorizacion ? { serie: fila.fdte_serie, numero: fila.fdte_numero } : null
    const receptor = dte ? fila.dte_receptor : null
    const anulada = Boolean(fila.anulada) || dte?.estado === 'anulado'
    return {
        empresa: await empresaDocumento(empresaId, cliente),
        empresa_id: empresaId,
        cliente: {
            nombre: receptor?.nombre || fila.nombre_fiscal || fila.cliente_nombre,
            nit: receptor?.id || fila.nit_cui || 'CF',
            direccion: fila.direccion_fiscal || fila.cliente_direccion || null,
            email: fila.email ?? null,
        },
        nota: {
            id,
            numero: numeroDocumento(id, dte),
            documento: 'Nota de crédito',
            fecha: fechaCorta(fechaCalendario(fila.fecha)),
            motivo: fila.motivo,
            subtotal: quetzales(dec(fila.subtotal).toString()),
            iva: quetzales(dec(fila.iva).toString()),
            monto: quetzales(dec(fila.monto).toString()),
            anulada,
            motivo_anulacion: anulada
                ? fila.anulada
                    ? `Nota anulada: ${fila.anulada_motivo ?? 'la SAT no la aceptó'}. El monto volvió al saldo de la factura.`
                    : 'Nota de crédito anulada ante la SAT.'
                : null,
            fel: dte !== null,
            fel_uuid: dte?.autorizacion ?? null,
            fel_serie: dte?.serie ?? null,
            fel_numero: dte?.numero ?? null,
            fel_fecha: dte?.certificado_en ? fechaHora(dte.certificado_en) : null,
            fel_anulado: dte?.estado === 'anulado',
        },
        factura: {
            id: facturaId,
            numero: numeroDocumento(facturaId, facturaDte),
            documento: facturaDte
                ? (DOCUMENTO_FACTURA[fila.fdte_tipo ?? 'FACT'] ?? 'Factura')
                : 'Aviso de cobro',
            periodo:
                fila.factura_tipo === 'mora'
                    ? 'Recargo por mora'
                    : mesAnio(fechaCalendario(fila.factura_periodo)),
            emitida: fila.factura_emitida_en ? fechaCorta(DateTime.fromJSDate(fila.factura_emitida_en)) : '—',
            total: quetzales(dec(fila.factura_total).toString()),
            fel_uuid: fila.fdte_autorizacion,
        },
        lineas:
            lineas.length > 0
                ? lineas.map((l) => lineaVista(l.concepto, l.monto, l.iva))
                : [lineaVista(fila.motivo, fila.monto, fila.iva)],
        generado: fechaHora(opciones.ahora ?? new Date()),
    }
}

function lineaVista(concepto: string, monto: string, iva: string): LineaVista {
    return {
        concepto,
        cantidad: '1',
        precio_unitario: quetzales(dec(monto).minus(dec(iva)).toString()),
        iva: quetzales(dec(iva).toString()),
        total: quetzales(dec(monto).toString()),
    }
}

/** Datos de ejemplo de la nota para la vista previa y para validar la plantilla al guardarla. */
export async function vistaNotaDeEjemplo(
    cliente?: QueryClientContract,
    empresaId: number = EMPRESA_PRINCIPAL,
): Promise<VistaNotaCredito> {
    const ahora = DateTime.now().setZone(ZONA)
    return {
        empresa: await empresaDocumento(empresaId, cliente),
        empresa_id: empresaId,
        cliente: {
            nombre: 'María José García López',
            nit: '1234567-8',
            direccion: '5a avenida 10-20 zona 1, Quetzaltenango',
            email: 'maria@example.com',
        },
        nota: {
            id: 298,
            numero: '5D41402A-2874519',
            documento: 'Nota de crédito',
            fecha: fechaCorta(ahora),
            motivo: 'Descuento por falla de servicio',
            subtotal: quetzales('17.86'),
            iva: quetzales('2.14'),
            monto: quetzales('20.00'),
            anulada: false,
            motivo_anulacion: null,
            fel: true,
            fel_uuid: '5D41402A-BC4B-4A76-B971-9D911017C592',
            fel_serie: '5D41402A',
            fel_numero: '2874519',
            fel_fecha: fechaHora(ahora.toJSDate()),
            fel_anulado: false,
        },
        factura: {
            id: 1203,
            numero: 'A1B2C3D4-2814509',
            documento: 'Factura',
            periodo: mesAnio(ahora),
            emitida: fechaCorta(ahora.startOf('month')),
            total: quetzales('175.00'),
            fel_uuid: 'A1B2C3D4-A7C1-4E2B-9F10-5D6E7F8A9B0C',
        },
        lineas: [lineaVista('Internet Hogar 20 Mbps', '20.00', '2.14')],
        generado: fechaHora(ahora.toJSDate()),
    }
}
