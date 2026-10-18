import { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { CERO, dec, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { leerServicio } from '#billing/configuracion'
import type { EstadoServicio } from '#shared/eventos'
import type { CondicionesPagoATiempo } from '#lealtad/reglas'

/**
 * Lecturas que necesitan las reglas para ganar (`contratos/lealtad.md` §4). Solo leen facturas,
 * pagos, notas de crédito, promesas, servicios y la bitácora de eventos; las decisiones (otorgar o
 * revertir) las toman las acciones con estos datos.
 */

/** Primer instante (UTC) del día siguiente a `fecha` en Guatemala. */
export function finDelDia(fecha: string): Date {
    return DateTime.fromISO(fecha, { zone: ZONA_NEGOCIO }).plus({ days: 1 }).startOf('day').toJSDate()
}

/** Primer instante (UTC) del día `fecha` en Guatemala. */
export function inicioDelDia(fecha: string): Date {
    return DateTime.fromISO(fecha, { zone: ZONA_NEGOCIO }).startOf('day').toJSDate()
}

export function sumarDias(fecha: string, dias: number): string {
    return DateTime.fromISO(fecha, { zone: 'utc' }).plus({ days: dias }).toISODate()!
}

export function sumarMeses(fecha: string, meses: number): string {
    return DateTime.fromISO(fecha, { zone: 'utc' }).plus({ months: meses }).toISODate()!
}

/** Meses completos entre dos fechas YYYY-MM-DD. */
export function mesesCompletos(desde: string, hasta: string): number {
    const meses = DateTime.fromISO(hasta, { zone: 'utc' }).diff(
        DateTime.fromISO(desde, { zone: 'utc' }),
        'months',
    ).months
    return Math.max(Math.floor(meses + 1e-9), 0)
}

export interface FacturaLealtad {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    tipo: 'servicio' | 'mora'
    estado: string
    total: string
    periodo: string
    vence_en: string
    emitida_en: Date
}

export async function facturaLealtad(
    cliente: QueryClientContract,
    id: number,
): Promise<FacturaLealtad | null> {
    const fila = await cliente
        .from('billing.facturas')
        .where('id', id)
        .select(
            'id',
            'empresa_id',
            'cliente_id',
            'servicio_id',
            'tipo',
            'estado',
            'total',
            'emitida_en',
            cliente.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
            cliente.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
        )
        .first()
    if (!fila) return null
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: Number(fila.cliente_id),
        servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
    } as FacturaLealtad
}

export interface ResultadoCondicion {
    cumple: boolean
    /** por qué no cumple (o `ok`) */
    motivo: string
}

/**
 * Pago a tiempo (§4): la factura quedó `pagada` con **todos** sus pagos vigentes aplicados antes del
 * fin del día `vence_en − dias_antes_vencimiento` (Guatemala). Una nota de crédito no cuenta como
 * pago: los pagos deben cubrir el total menos las notas vigentes, y tiene que haber al menos un pago.
 * `vigencia`: la fecha del último pago debe caer en la vigencia del programa y de la regla.
 */
export async function pagoATiempo(
    cliente: QueryClientContract,
    factura: FacturaLealtad,
    condiciones: CondicionesPagoATiempo,
    vigencia: { desde: string; hasta: string | null },
): Promise<ResultadoCondicion> {
    if (factura.estado !== 'pagada') return { cumple: false, motivo: `factura ${factura.estado}` }
    if (condiciones.solo_servicio && factura.tipo !== 'servicio') {
        return { cumple: false, motivo: 'factura de mora' }
    }
    if (condiciones.monto_minimo !== null && dec(factura.total).lessThan(dec(condiciones.monto_minimo))) {
        return { cumple: false, motivo: 'monto menor al mínimo' }
    }
    const aplicaciones = (await cliente
        .from('billing.pagos_aplicaciones as a')
        .join('billing.pagos as p', 'p.id', 'a.pago_id')
        .where('a.factura_id', factura.id)
        .where('p.estado', 'registrado')
        .select('a.monto', 'a.created_at')) as Array<{ monto: string; created_at: Date }>
    if (aplicaciones.length === 0) return { cumple: false, motivo: 'sin pagos' }
    const limite = finDelDia(sumarDias(factura.vence_en, -condiciones.dias_antes_vencimiento))
    let pagado: Dec = CERO
    let ultimo = aplicaciones[0]!.created_at
    for (const a of aplicaciones) {
        if (new Date(a.created_at) >= limite) return { cumple: false, motivo: 'pago después del límite' }
        pagado = pagado.plus(dec(a.monto))
        if (new Date(a.created_at) > new Date(ultimo)) ultimo = a.created_at
    }
    const notas = (await cliente
        .from('billing.notas_credito as n')
        .where('n.factura_id', factura.id)
        .whereNotExists((q) =>
            q
                .from('billing.notas_credito_anulaciones as x')
                .whereRaw('x.nota_id = n.id')
                .select(cliente.raw('1')),
        )
        .select(cliente.raw('coalesce(sum(n.monto), 0)::text as total'))
        .first()) as { total: string }
    if (pagado.plus(dec(notas.total)).lessThan(dec(factura.total))) {
        return { cumple: false, motivo: 'los pagos no cubren la factura' }
    }
    const fechaPago = hoyGuatemala(new Date(ultimo))
    if (fechaPago < vigencia.desde || (vigencia.hasta !== null && fechaPago > vigencia.hasta)) {
        return { cumple: false, motivo: 'pago fuera de la vigencia del programa o la regla' }
    }
    if (condiciones.sin_promesa && factura.servicio_id !== null) {
        const promesa = await cliente
            .from('billing.promesas')
            .where('servicio_id', factura.servicio_id)
            .whereNot('estado', 'rechazada')
            .where('created_at', '>=', factura.emitida_en)
            .where('created_at', '<=', ultimo)
            .select('id')
            .first()
        if (promesa) return { cumple: false, motivo: `promesa ${promesa.id}` }
    }
    return { cumple: true, motivo: 'ok' }
}

/**
 * Racha (§4, `racha.periodos`): facturas de servicio seguidas del servicio, de la más reciente hacia
 * atrás desde `factura`, con un otorgamiento de pago a tiempo vigente. Las anuladas no cortan la racha.
 */
export async function rachaHasta(cliente: QueryClientContract, factura: FacturaLealtad): Promise<number> {
    if (factura.servicio_id === null) return 0
    const filas = (await cliente
        .from('billing.facturas as f')
        .where('f.servicio_id', factura.servicio_id)
        .where('f.empresa_id', factura.empresa_id)
        .where('f.tipo', 'servicio')
        .whereNot('f.estado', 'anulada')
        .where('f.periodo', '<=', factura.periodo)
        .orderBy('f.periodo', 'desc')
        .orderBy('f.id', 'desc')
        .limit(240)
        .select(
            'f.id',
            cliente.raw(
                `exists (select 1 from lealtad.movimientos m
                          where m.empresa_id = f.empresa_id and m.puntos > 0
                            and (m.clave_unica = 'pago_a_tiempo:factura:' || f.id
                                 or m.clave_unica like 'pago_a_tiempo:factura:' || f.id || '#%')
                            and not exists (select 1 from lealtad.movimientos r where r.reversa_de = m.id)) as ganada`,
            ),
        )) as Array<{ id: number; ganada: boolean }>
    let racha = 0
    for (const fila of filas) {
        if (!fila.ganada) break
        racha++
    }
    return racha
}

/** Excedente que dejó el pago en Anticipos: monto − lo que aplicó en su misma transacción. */
export async function excedenteDelPago(
    cliente: QueryClientContract,
    pagoId: number,
): Promise<{
    pago: { id: number; empresa_id: number; cliente_id: number; estado: string; created_at: Date }
    excedente: Dec
} | null> {
    const pago = (await cliente
        .from('billing.pagos')
        .where('id', pagoId)
        .select('id', 'empresa_id', 'cliente_id', 'estado', 'monto', 'created_at')
        .first()) as {
        id: number
        empresa_id: number
        cliente_id: number
        estado: string
        monto: string
        created_at: Date
    } | null
    if (!pago) return null
    const aplicado = (await cliente
        .from('billing.pagos_aplicaciones')
        .where('pago_id', pagoId)
        .where('created_at', '<=', pago.created_at)
        .select(cliente.raw('coalesce(sum(monto), 0)::text as total'))
        .first()) as { total: string }
    const excedente = dec(pago.monto).minus(dec(aplicado.total))
    return {
        pago: {
            id: Number(pago.id),
            empresa_id: Number(pago.empresa_id),
            cliente_id: Number(pago.cliente_id),
            estado: pago.estado,
            created_at: pago.created_at,
        },
        excedente: excedente.isNegative() ? CERO : excedente,
    }
}

export interface ServicioCliente {
    id: number
    estado: EstadoServicio
    precio: string
}

/** Servicios no retirados del cliente en la empresa, con su precio efectivo (el primero = el más antiguo). */
export async function serviciosDelCliente(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<ServicioCliente[]> {
    const filas = (await cliente
        .from('core.servicios')
        .where('empresa_id', empresaId)
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .orderBy('id', 'asc')
        .select('id')) as Array<{ id: number }>
    const salida: ServicioCliente[] = []
    for (const fila of filas) {
        const servicio = await leerServicio(cliente, Number(fila.id))
        salida.push({ id: servicio.id, estado: servicio.estado, precio: servicio.precio })
    }
    return salida
}

export interface ServicioAntiguedad {
    id: number
    cliente_id: number
    estado: EstadoServicio
    fecha_instalacion: string
}

/** Servicios de la empresa en los estados dados con fecha de instalación, por id ascendente desde `despuesDe`. */
export async function serviciosParaAntiguedad(
    cliente: QueryClientContract,
    empresaId: number,
    estados: EstadoServicio[],
    despuesDe: number,
    limite: number,
): Promise<ServicioAntiguedad[]> {
    const filas = await cliente
        .from('core.servicios')
        .where('empresa_id', empresaId)
        .whereIn('estado', estados)
        .whereNotNull('fecha_instalacion')
        .where('id', '>', despuesDe)
        .orderBy('id', 'asc')
        .limit(limite)
        .select(
            'id',
            'cliente_id',
            'estado',
            cliente.raw(`to_char(fecha_instalacion, 'YYYY-MM-DD') as fecha_instalacion`),
        )
    return filas.map((f) => ({ ...f, id: Number(f.id), cliente_id: Number(f.cliente_id) }))
}

/** ¿El servicio pasó a `suspendido` entre dos fechas (inclusive), según `servicio.estado_cambiado`? */
export async function suspendidoEntre(
    cliente: QueryClientContract,
    servicioId: number,
    desde: string,
    hasta: string,
): Promise<boolean> {
    const fila = await cliente
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .whereRaw(`payload->>'a' = 'suspendido'`)
        .where('created_at', '>=', inicioDelDia(desde))
        .where('created_at', '<', finDelDia(hasta))
        .select('id')
        .first()
    return Boolean(fila)
}

/**
 * ¿Alguna factura de servicio del servicio que venció entre `desde` y `hasta` se pagó (o sigue sin
 * pagarse a `hoy`) más de `dias` días después de vencer?
 */
export async function vencidaMasDe(
    cliente: QueryClientContract,
    servicioId: number,
    desde: string,
    hasta: string,
    dias: number,
    hoy: string,
): Promise<boolean> {
    const filas = (await cliente
        .from('billing.facturas as f')
        .where('f.servicio_id', servicioId)
        .where('f.tipo', 'servicio')
        .whereNot('f.estado', 'anulada')
        .where('f.vence_en', '>', desde)
        .where('f.vence_en', '<=', hasta)
        .select(
            'f.estado',
            cliente.raw(`to_char(f.vence_en, 'YYYY-MM-DD') as vence_en`),
            cliente.raw(
                `(select max(a.created_at) from billing.pagos_aplicaciones a join billing.pagos p on p.id = a.pago_id
                   where a.factura_id = f.id and p.estado = 'registrado') as ultimo_pago`,
            ),
        )) as Array<{ estado: string; vence_en: string; ultimo_pago: Date | null }>
    for (const f of filas) {
        const pagadaEl = f.estado === 'pagada' && f.ultimo_pago ? hoyGuatemala(new Date(f.ultimo_pago)) : hoy
        if (pagadaEl > sumarDias(f.vence_en, dias)) return true
    }
    return false
}

/** Facturas de servicio pagadas del cliente en la empresa (para calificar un referido). */
export async function facturasPagadas(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<number> {
    const fila = (await cliente
        .from('billing.facturas')
        .where('empresa_id', empresaId)
        .where('cliente_id', clienteId)
        .where('tipo', 'servicio')
        .where('estado', 'pagada')
        .select(cliente.raw('count(*)::int as n'))
        .first()) as { n: number }
    return Number(fila.n)
}

/** Inicio del periodo de tope (`mes` o `anio`) que contiene `fecha`. */
export function inicioPeriodoTope(fecha: string, periodo: 'mes' | 'anio'): string {
    return DateTime.fromISO(fecha, { zone: 'utc' })
        .startOf(periodo === 'mes' ? 'month' : 'year')
        .toISODate()!
}

/** Otorgamientos vigentes (sin reverso) de la regla al cliente desde `desde` (fecha de Guatemala). */
export async function otorgamientosDesde(
    cliente: QueryClientContract,
    empresaId: number,
    reglaId: number,
    clienteId: number,
    desde: string,
): Promise<number> {
    const fila = (await cliente
        .from('lealtad.movimientos as m')
        .where('m.empresa_id', empresaId)
        .where('m.regla_id', reglaId)
        .where('m.cliente_id', clienteId)
        .where('m.tipo', 'acumulacion')
        .where('m.created_at', '>=', inicioDelDia(desde))
        .whereNotExists((q) =>
            q.from('lealtad.movimientos as r').whereRaw('r.reversa_de = m.id').select(cliente.raw('1')),
        )
        .select(cliente.raw('count(*)::int as n'))
        .first()) as { n: number }
    return Number(fila.n)
}
