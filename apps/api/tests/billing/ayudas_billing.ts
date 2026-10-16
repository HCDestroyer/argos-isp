import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import GenerarFacturas from '#billing/actions/generar_facturas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * Escenarios de facturación: plantilla + plan + cliente + servicio insertados directo (las
 * acciones de A1 ya tienen sus pruebas). Todo con nombres únicos: ledger y audit no se truncan.
 */

export interface OpcionesEscenario {
    precio?: string
    fecha_instalacion?: string
    /** kbps limitados del plan (0 = el plan no se puede limitar) */
    limitada?: number
    plantilla?: Record<string, unknown>
    servicio?: Record<string, unknown>
}

export interface Escenario {
    clienteId: number
    servicioId: number
    planId: number
    plantillaId: number
}

export async function crearPlantillaFila(campos: Record<string, unknown> = {}): Promise<number> {
    const [fila] = (await db
        .table('billing.plantillas_facturacion')
        .insert({
            nombre: unico('Plantilla'),
            ciclo: 'dia_fijo',
            dia: 1,
            prorrateo: true,
            dias_gracia: 5,
            facturas_para_limitar: 1,
            facturas_para_cortar: 2,
            hora_corte: '08:00',
            reglas_promesa: JSON.stringify(normalizarReglasPromesa({})),
            ...campos,
        })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

export async function escenario(opciones: OpcionesEscenario = {}): Promise<Escenario> {
    const plantillaId = await crearPlantillaFila(opciones.plantilla)
    const limitada = opciones.limitada ?? 1000
    const planId = await crearPlanFila({
        precio: opciones.precio ?? '150.00',
        bajada_limitada_kbps: limitada,
        subida_limitada_kbps: limitada,
    })
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        fecha_instalacion: opciones.fecha_instalacion ?? '2026-09-01',
        ...opciones.servicio,
    })
    return { clienteId, servicioId, planId, plantillaId }
}

/** Genera lo pendiente de un servicio hasta la fecha dada. */
export function generar(servicioId: number, hasta: string) {
    return new GenerarFacturas().execute({ servicio_id: servicioId, hasta }, contextoPrueba())
}

export async function facturasDe(servicioId: number) {
    return db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .orderBy('id', 'asc')
        .select(
            'id',
            'tipo',
            'estado',
            'total',
            'pagado',
            'subtotal',
            'iva',
            'factura_origen_id',
            db.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
            db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
        )
}

export async function estadoServicio(servicioId: number): Promise<string> {
    const fila = await db.from('core.servicios').where('id', servicioId).select('estado').firstOrFail()
    return fila.estado
}

export async function eventosDe(evento: string, clave: string, valor: number) {
    return db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>?)::bigint = ?`, [clave, valor])
        .orderBy('id', 'asc')
}

/** Movimientos del asiento de un origen: [codigo, debe, haber]. */
export async function asientoDe(origenTipo: string, origenId: number) {
    return db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', origenTipo)
        .where('a.origen_id', origenId)
        .orderBy('m.id', 'asc')
        .select('a.id as asiento_id', 'c.codigo', 'm.debe', 'm.haber', 'm.cliente_id')
}

/**
 * Servicio instalado el 2026-09-01 con septiembre y octubre vencidas (vencimiento al 2026-10-07)
 * y ya cortado. Hora de corte 00:00: baja sin esperar.
 */
export async function servicioCortado(opciones: OpcionesEscenario = {}): Promise<Escenario> {
    const datos = await escenario({
        fecha_instalacion: '2026-09-01',
        ...opciones,
        plantilla: { hora_corte: '00:00', ...opciones.plantilla },
    })
    await generar(datos.servicioId, '2026-10-01')
    await new VencerFacturas().execute(
        { servicio_id: datos.servicioId, hasta: '2026-10-07' },
        contextoPrueba(),
    )
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    return datos
}

/** Movimientos del asiento como tuplas `[codigo, debe, haber, cliente_id]`. */
export async function lineasAsiento(origenTipo: string, origenId: number) {
    const movimientos = await asientoDe(origenTipo, origenId)
    return movimientos.map((m) => [m.codigo, m.debe, m.haber, m.cliente_id] as const)
}
