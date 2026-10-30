import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { normalizarReglasPromesa, type ReglasPromesaParciales } from '#billing/reglas_promesa'
import GenerarFacturas from '#billing/actions/generar_facturas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import CrearCuentaBancaria from '#billing/actions/crear_cuenta_bancaria'

/**
 * Escenarios de facturación: plantilla + plan + cliente + servicio insertados directo (las
 * acciones de A1 ya tienen sus pruebas). Todo con nombres únicos: ledger y audit no se truncan.
 */

/**
 * Número que nunca se repite en esta base: el siguiente valor de la secuencia de `tabla.id` (misma
 * idea que A6 en `tests/notify/ayudas_notify.ts`). Las secuencias de Postgres no retroceden (ni con
 * rollback) y las comparten todas las conexiones y procesos. `unico()` (8 hex al azar) no lo
 * garantiza contra una restricción `UNIQUE`: ya hizo fallar una suite completa.
 */
export async function siguienteDeSecuencia(tabla: string): Promise<number> {
    const r = await db.rawQuery('SELECT nextval(pg_get_serial_sequence(?, ?)) AS n', [tabla, 'id'])
    return Number(r.rows[0].n)
}

/**
 * Texto único en la base para una columna con restricción `UNIQUE` (número de documento, referencia,
 * boleta, serie, SKU, id externo, nombre de plantilla, caja o bodega…): `<prefijo>-<n>` con `n` de
 * la secuencia de `tabla` (por defecto la de `audit.outbox`, que solo crece). Para lo que no choca
 * con ninguna restricción (nombres de clientes, textos) basta `unico()`.
 */
export async function unicoBd(prefijo: string, tabla = 'audit.outbox'): Promise<string> {
    return `${prefijo}-${await siguienteDeSecuencia(tabla)}`
}

/** `unicoBd` en mayúsculas (series, códigos y NIT que la base normaliza a mayúsculas). */
export async function unicoBdMayusculas(prefijo: string, tabla?: string): Promise<string> {
    const valor = await unicoBd(prefijo, tabla)
    return valor.toUpperCase()
}

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
            nombre: await unicoBd('Plantilla', 'billing.plantillas_facturacion'),
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

/**
 * Instante fijo coherente con `servicioCortado` (septiembre y octubre de 2026 vencidas al 2026-10-07):
 * el 13 de octubre de 2026 a las 08:00 de Guatemala. Para las acciones que aceptan `ahora`
 * (`CrearPromesaPago`, `simularPromesa`, `limitesPromesa`, `IncumplirPromesas`…): así la prueba no
 * depende del día real. Con el reloj real, una promesa a `Date.now() + 2 días` creada el 30 o el 31
 * del mes vence el día 1, que es la siguiente facturación, y `no_exceder_siguiente_facturacion` la
 * rechaza (con razón).
 */
export const AHORA_PROMESAS = new Date('2026-10-13T08:00:00-06:00')

/** `n` días después de `desde` (por defecto `AHORA_PROMESAS`). */
export function diasDespues(n: number, desde: Date = AHORA_PROMESAS): Date {
    return new Date(desde.getTime() + n * 86_400_000)
}

/**
 * `reglas_promesa` (JSON) para las pruebas que crean promesas por HTTP, donde el instante es el real y
 * no se puede fijar: las reglas por defecto (más `reglas`) sin el tope de la siguiente facturación,
 * la única regla que depende del día del mes (ver `AHORA_PROMESAS`). Las pruebas de esa regla la
 * dejan encendida y fijan su `ahora`.
 */
export function reglasPromesaSinTopeFacturacion(reglas: ReglasPromesaParciales = {}): string {
    return JSON.stringify(normalizarReglasPromesa({ ...reglas, no_exceder_siguiente_facturacion: false }))
}

/** Id de un banco del catálogo por nombre. */
export async function bancoId(nombre = 'Banrural'): Promise<number> {
    const fila = await db.from('billing.bancos').where('nombre', nombre).select('id').firstOrFail()
    return fila.id as number
}

/** Cuenta bancaria propia nueva (con su subcuenta de Bancos) creada por la acción. */
/** Cuenta de la empresa indicada (por defecto la principal): con varias empresas activas la acción la exige. */
export async function cuentaBancariaPrueba(banco = 'Banrural', empresaId = 1) {
    return new CrearCuentaBancaria().execute(
        {
            banco_id: await bancoId(banco),
            numero: await unicoBd('300', 'billing.cuentas_bancarias'),
            alias: unico('Recaudación'),
            empresa_id: empresaId,
        },
        contextoPrueba(),
    )
}

/** Movimientos del asiento como tuplas `[codigo, debe, haber, cliente_id]`. */
export async function lineasAsiento(origenTipo: string, origenId: number) {
    const movimientos = await asientoDe(origenTipo, origenId)
    return movimientos.map((m) => [m.codigo, m.debe, m.haber, m.cliente_id] as const)
}
