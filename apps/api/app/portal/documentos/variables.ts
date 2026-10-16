import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { D, dec } from '#ledger/dinero'
import { ZONA, fechaCalendario, fechaCorta, fechaHora, mesAnio, quetzales } from '#notify/formato'
import { numeroFactura } from '#portal/cuenta'
import { leerEmpresa, type DatosEmpresa } from '#portal/empresa'

/**
 * Variables de la plantilla del aviso de cobro (Mustache). Montos con `decimal.js` y ya
 * formateados en quetzales; fechas en `America/Guatemala`. Lista para el editor de A4:
 * `VARIABLES_AVISO_COBRO` (también en `GET /documentos/plantillas/aviso_cobro`).
 *
 * `{{factura.lineas}}` inserta la tabla de líneas ya armada (escapada). Para una tabla propia se
 * recorre `{{#lineas}}…{{/lineas}}` con `concepto`, `cantidad`, `precio_unitario`, `iva`, `total`.
 */

export interface LineaVista {
    concepto: string
    cantidad: string
    precio_unitario: string
    iva: string
    total: string
}

export interface VistaAvisoCobro {
    empresa: DatosEmpresa
    cliente: { nombre: string; nit: string; direccion: string | null; email: string | null }
    servicio: { plan: string | null; direccion: string | null }
    factura: {
        id: number
        numero: string
        documento: string
        periodo: string
        emitida: string
        vence: string
        estado: string
        subtotal: string
        iva: string
        total: string
        pagado: string
        saldo: string
        tiene_pagos: boolean
        fel: boolean
        fel_uuid: string | null
        fel_serie: string | null
        fel_numero: string | null
    }
    lineas: LineaVista[]
    generado: string
}

export const VARIABLES_AVISO_COBRO: ReadonlyArray<{ nombre: string; descripcion: string }> = [
    { nombre: 'empresa.nombre', descripcion: 'Nombre comercial de la empresa' },
    { nombre: 'empresa.nit', descripcion: 'NIT de la empresa' },
    { nombre: 'empresa.direccion', descripcion: 'Dirección de la empresa' },
    { nombre: 'empresa.telefono', descripcion: 'Teléfono de atención' },
    { nombre: 'empresa.whatsapp', descripcion: 'WhatsApp de atención' },
    { nombre: 'empresa.correo', descripcion: 'Correo de atención' },
    { nombre: 'empresa.horario', descripcion: 'Horario de atención' },
    { nombre: 'empresa.instrucciones_pago', descripcion: 'Texto de instrucciones de pago' },
    { nombre: 'cliente.nombre', descripcion: 'Nombre del cliente' },
    { nombre: 'cliente.nit', descripcion: 'NIT o CUI del cliente; "CF" si no tiene' },
    { nombre: 'cliente.direccion', descripcion: 'Dirección fiscal (o la del cliente)' },
    { nombre: 'cliente.email', descripcion: 'Correo del cliente' },
    { nombre: 'servicio.plan', descripcion: 'Plan del servicio facturado' },
    { nombre: 'servicio.direccion', descripcion: 'Dirección de instalación' },
    { nombre: 'factura.documento', descripcion: '"Aviso de cobro" o "Factura" si tiene FEL' },
    { nombre: 'factura.numero', descripcion: 'Serie-número FEL o número del aviso' },
    { nombre: 'factura.periodo', descripcion: 'Mes facturado: "octubre 2026"' },
    { nombre: 'factura.emitida', descripcion: 'Fecha de emisión: 01/10/2026' },
    { nombre: 'factura.vence', descripcion: 'Fecha de vencimiento: 10/10/2026' },
    { nombre: 'factura.estado', descripcion: 'Pendiente, Abono parcial, Vencida, Pagada o Anulada' },
    { nombre: 'factura.subtotal', descripcion: 'Subtotal sin IVA: "Q 156.25"' },
    { nombre: 'factura.iva', descripcion: 'IVA: "Q 18.75"' },
    { nombre: 'factura.total', descripcion: 'Total: "Q 175.00"' },
    { nombre: 'factura.pagado', descripcion: 'Abonado hasta hoy' },
    { nombre: 'factura.saldo', descripcion: 'Saldo a pagar' },
    { nombre: 'factura.lineas', descripcion: 'Tabla de líneas (concepto, cantidad, precio, total)' },
    { nombre: 'factura.tiene_pagos', descripcion: 'Sección: hay abonos' },
    { nombre: 'factura.fel', descripcion: 'Sección: la factura está certificada (FEL, semana 5)' },
    { nombre: 'factura.fel_uuid', descripcion: 'Número de autorización FEL' },
    { nombre: 'factura.fel_serie', descripcion: 'Serie FEL' },
    { nombre: 'factura.fel_numero', descripcion: 'Número FEL' },
    {
        nombre: 'lineas',
        descripcion: 'Lista para {{#lineas}}: concepto, cantidad, precio_unitario, iva, total',
    },
    { nombre: 'generado', descripcion: 'Fecha y hora de generación (Guatemala)' },
]

const ESTADOS: Record<string, string> = {
    emitida: 'Pendiente',
    parcial: 'Abono parcial',
    vencida: 'Vencida',
    pagada: 'Pagada',
    anulada: 'Anulada',
}

/** Variables de una factura real. Si se pasa `clienteId`, la factura debe ser suya (404 si no). */
export async function variablesAvisoCobro(
    facturaId: number,
    opciones: { clienteId?: number; cliente?: QueryClientContract; ahora?: Date } = {},
): Promise<VistaAvisoCobro> {
    const cliente = opciones.cliente ?? db.connection()
    const fila = (await cliente
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .leftJoin('network.planes as p', 'p.id', 's.plan_id')
        .where('f.id', facturaId)
        .if(opciones.clienteId !== undefined, (q) => q.where('f.cliente_id', opciones.clienteId!))
        .select(
            'f.id',
            'f.tipo',
            cliente.raw(`to_char(f.periodo, 'YYYY-MM-DD') as periodo`),
            'f.emitida_en',
            cliente.raw(`to_char(f.vence_en, 'YYYY-MM-DD') as vence_en`),
            'f.estado',
            'f.subtotal',
            'f.iva',
            'f.total',
            'f.pagado',
            'f.fel_uuid',
            'f.fel_serie',
            'f.fel_numero',
            'c.nombre as cliente_nombre',
            'c.nombre_fiscal',
            'c.nit_cui',
            'c.direccion_fiscal',
            'c.direccion as cliente_direccion',
            'c.email',
            's.direccion as servicio_direccion',
            'p.nombre as plan',
        )
        .first()) as Record<string, any> | null
    if (!fila) throw new NoEncontrado(`La factura ${facturaId} no existe`)

    const lineas = (await cliente
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id', 'asc')
        .select(
            'concepto',
            cliente.raw('cantidad::text as cantidad'),
            'precio_unitario',
            'iva',
            'total',
        )) as Array<Record<string, string>>

    const total = dec(fila.total)
    const pagado = dec(fila.pagado)
    const saldo = fila.estado === 'anulada' ? new D(0) : D.max(total.minus(pagado), 0)
    const id = Number(fila.id)

    return {
        empresa: await leerEmpresa(cliente),
        cliente: {
            nombre: fila.nombre_fiscal || fila.cliente_nombre,
            nit: fila.nit_cui || 'CF',
            direccion: fila.direccion_fiscal || fila.cliente_direccion || null,
            email: fila.email ?? null,
        },
        servicio: { plan: fila.plan ?? null, direccion: fila.servicio_direccion ?? null },
        factura: {
            id,
            numero: numeroFactura({ id, fel_serie: fila.fel_serie, fel_numero: fila.fel_numero }),
            documento: fila.fel_uuid ? 'Factura' : 'Aviso de cobro',
            periodo: fila.tipo === 'mora' ? `Recargo por mora` : mesAnio(fechaCalendario(fila.periodo)),
            emitida: fechaCorta(DateTime.fromJSDate(fila.emitida_en as Date)),
            vence: fechaCorta(fechaCalendario(fila.vence_en)),
            estado: ESTADOS[fila.estado] ?? fila.estado,
            subtotal: quetzales(dec(fila.subtotal).toString()),
            iva: quetzales(dec(fila.iva).toString()),
            total: quetzales(total.toString()),
            pagado: quetzales(pagado.toString()),
            saldo: quetzales(saldo.toString()),
            tiene_pagos: pagado.greaterThan(0),
            fel: Boolean(fila.fel_uuid),
            fel_uuid: fila.fel_uuid ?? null,
            fel_serie: fila.fel_serie ?? null,
            fel_numero: fila.fel_numero ?? null,
        },
        lineas: lineas.map((l) => ({
            concepto: l.concepto!,
            cantidad: formatearCantidad(l.cantidad!),
            precio_unitario: quetzales(l.precio_unitario),
            iva: quetzales(l.iva),
            total: quetzales(l.total),
        })),
        generado: fechaHora(opciones.ahora ?? new Date()),
    }
}

/** "1.000" → "1"; "2.500" → "2.5". */
function formatearCantidad(cantidad: string): string {
    return dec(cantidad).toString()
}

/** Datos de ejemplo para la vista previa del editor y para validar una plantilla al guardarla. */
export async function vistaDeEjemplo(cliente?: QueryClientContract): Promise<VistaAvisoCobro> {
    const ahora = DateTime.now().setZone(ZONA)
    return {
        empresa: await leerEmpresa(cliente),
        cliente: {
            nombre: 'María José García López',
            nit: '1234567-8',
            direccion: '5a avenida 10-20 zona 1, Quetzaltenango',
            email: 'maria@example.com',
        },
        servicio: { plan: 'Hogar 20 Mbps', direccion: '5a avenida 10-20 zona 1' },
        factura: {
            id: 1203,
            numero: '1203',
            documento: 'Aviso de cobro',
            periodo: mesAnio(ahora),
            emitida: fechaCorta(ahora.startOf('month')),
            vence: fechaCorta(ahora.startOf('month').plus({ days: 9 })),
            estado: 'Pendiente',
            subtotal: quetzales('156.25'),
            iva: quetzales('18.75'),
            total: quetzales('175.00'),
            pagado: quetzales('50.00'),
            saldo: quetzales('125.00'),
            tiene_pagos: true,
            fel: false,
            fel_uuid: null,
            fel_serie: null,
            fel_numero: null,
        },
        lineas: [
            {
                concepto: 'Internet Hogar 20 Mbps',
                cantidad: '1',
                precio_unitario: quetzales('156.25'),
                iva: quetzales('18.75'),
                total: quetzales('175.00'),
            },
        ],
        generado: fechaHora(ahora.toJSDate()),
    }
}
