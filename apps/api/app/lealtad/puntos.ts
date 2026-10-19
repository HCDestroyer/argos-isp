import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { CERO, dec, type Dec } from '#ledger/dinero'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { valorDePuntos, type ProgramaVista } from '#lealtad/programas'

/**
 * Auxiliar de puntos (`contratos/lealtad.md` §3, §6 y §6.1). `lealtad.movimientos` es de solo
 * inserción; el saldo es la suma de sus puntos. Cada movimiento con puntos > 0 es un **lote** con su
 * `vence_en` y su `valor` (Q del pasivo fijados al acumular); las salidas (vencimiento, reverso,
 * ajuste negativo y, en la fase 2, canjes) consumen lotes en `lealtad.consumos`, el que vence antes
 * primero. Valor vivo de un lote = `valor − Σ consumos.valor`; con diferimiento, el saldo de
 * `2.1.10` de la empresa es la suma del valor vivo de sus lotes.
 *
 * Las funciones de escritura reciben la `Transaccion` de la acción que las llama (regla 1) y
 * suponen el cliente bloqueado (`bloquearClienteLealtad`). Los asientos van por
 * `RegistrarAsiento` anidada con origen `lealtad` y `origen_id` = el movimiento.
 */

/** Espacio de advisory locks por cliente (toda acción que mueve puntos; el canje de la fase 2 también). */
export const LOCK_LEALTAD_CLIENTE = 5101

export async function bloquearClienteLealtad(
    trx: TransactionClientContract,
    clienteId: number,
): Promise<void> {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_LEALTAD_CLIENTE, clienteId])
}

export const TIPOS_MOVIMIENTO = ['acumulacion', 'canje', 'vencimiento', 'reverso', 'ajuste'] as const
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number]

export const ORIGENES_MOVIMIENTO = [
    'factura',
    'pago',
    'servicio',
    'referido',
    'canje',
    'sorteo',
    'ajuste',
    'nota_credito',
    'lote',
] as const
export type OrigenMovimiento = (typeof ORIGENES_MOVIMIENTO)[number]

export interface MovimientoPuntos {
    id: number
    empresa_id: number
    programa_id: number
    cliente_id: number
    servicio_id: number | null
    tipo: TipoMovimiento
    /** con signo: positivo = lote, negativo = salida */
    puntos: number
    regla_id: number | null
    origen_tipo: OrigenMovimiento
    origen_id: number | null
    clave_unica: string
    vence_en: string | null
    /** Q diferidos (lote) o liberados (salida); "0.00" sin diferimiento */
    valor: string
    asiento_id: number | null
    reversa_de: number | null
    motivo: string | null
    creado_por: number | null
    created_at: Date
}

function columnasMovimiento(cliente: QueryClientContract, alias = 'm') {
    return [
        `${alias}.id`,
        `${alias}.empresa_id`,
        `${alias}.programa_id`,
        `${alias}.cliente_id`,
        `${alias}.servicio_id`,
        `${alias}.tipo`,
        `${alias}.puntos`,
        `${alias}.regla_id`,
        `${alias}.origen_tipo`,
        `${alias}.origen_id`,
        `${alias}.clave_unica`,
        cliente.raw(`to_char(${alias}.vence_en, 'YYYY-MM-DD') as vence_en`),
        `${alias}.valor`,
        `${alias}.asiento_id`,
        `${alias}.reversa_de`,
        `${alias}.motivo`,
        `${alias}.creado_por`,
        `${alias}.created_at`,
    ]
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function aMovimiento(fila: Record<string, any>): MovimientoPuntos {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        programa_id: Number(fila.programa_id),
        cliente_id: Number(fila.cliente_id),
        servicio_id: n(fila.servicio_id),
        puntos: Number(fila.puntos),
        regla_id: n(fila.regla_id),
        origen_id: n(fila.origen_id),
        asiento_id: n(fila.asiento_id),
        reversa_de: n(fila.reversa_de),
        creado_por: n(fila.creado_por),
    } as MovimientoPuntos
}

export async function movimientoPorClave(
    cliente: QueryClientContract,
    empresaId: number,
    clave: string,
): Promise<MovimientoPuntos | null> {
    const fila = await cliente
        .from('lealtad.movimientos as m')
        .where('m.empresa_id', empresaId)
        .where('m.clave_unica', clave)
        .select(columnasMovimiento(cliente))
        .first()
    return fila ? aMovimiento(fila) : null
}

/**
 * Otorgamientos con la clave `base` (la primera vez `base`, después `base#2`, `base#3`… si se
 * revirtió y se vuelve a ganar): el vigente (sin reverso) y la clave para otorgar de nuevo.
 */
export async function otorgamientoVigente(
    cliente: QueryClientContract,
    empresaId: number,
    base: string,
): Promise<{ vigente: MovimientoPuntos | null; siguienteClave: string }> {
    const filas = await cliente
        .from('lealtad.movimientos as m')
        .where('m.empresa_id', empresaId)
        .where((q) => q.where('m.clave_unica', base).orWhere('m.clave_unica', 'like', `${base}#%`))
        .where('m.puntos', '>', 0)
        .orderBy('m.id', 'asc')
        .select([
            ...columnasMovimiento(cliente),
            cliente.raw(
                `exists (select 1 from lealtad.movimientos r where r.reversa_de = m.id) as revertido`,
            ),
        ])
    const vigente = filas.find((f) => !f.revertido)
    return {
        vigente: vigente ? aMovimiento(vigente) : null,
        siguienteClave: filas.length === 0 ? base : `${base}#${filas.length + 1}`,
    }
}

export interface LoteVivo {
    id: number
    programa_id: number
    servicio_id: number | null
    regla_id: number | null
    tipo: TipoMovimiento
    puntos: number
    restante: number
    valor: string
    valor_restante: string
    vence_en: string | null
    created_at: Date
}

function consultaLotes(cliente: QueryClientContract) {
    return cliente
        .from('lealtad.movimientos as l')
        .leftJoin('lealtad.consumos as c', 'c.lote_id', 'l.id')
        .where('l.puntos', '>', 0)
        .groupBy('l.id')
        .havingRaw('l.puntos - coalesce(sum(c.puntos), 0) > 0')
        .select(
            'l.id',
            'l.empresa_id',
            'l.cliente_id',
            'l.programa_id',
            'l.servicio_id',
            'l.regla_id',
            'l.tipo',
            'l.puntos',
            'l.valor',
            'l.created_at',
            cliente.raw(`to_char(l.vence_en, 'YYYY-MM-DD') as vence_en`),
            cliente.raw('(l.puntos - coalesce(sum(c.puntos), 0))::int as restante'),
            cliente.raw('(l.valor - coalesce(sum(c.valor), 0))::text as valor_restante'),
        )
}

function aLote(fila: Record<string, any>): LoteVivo {
    return {
        id: Number(fila.id),
        programa_id: Number(fila.programa_id),
        servicio_id: n(fila.servicio_id),
        regla_id: n(fila.regla_id),
        tipo: fila.tipo,
        puntos: Number(fila.puntos),
        restante: Number(fila.restante),
        valor: fila.valor,
        valor_restante: dec(fila.valor_restante).toFixed(2),
        vence_en: fila.vence_en,
        created_at: fila.created_at,
    }
}

/** Lotes con puntos del cliente en la empresa, el que vence antes primero (sin vencimiento al final). */
export async function lotesVivos(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<LoteVivo[]> {
    const filas = await consultaLotes(cliente)
        .where('l.empresa_id', empresaId)
        .where('l.cliente_id', clienteId)
        .orderByRaw('l.vence_en ASC NULLS LAST')
        .orderBy('l.id', 'asc')
    return filas.map(aLote)
}

/** Lo que le queda a un lote (0 si ya se consumió entero). */
export async function restanteDeLote(
    cliente: QueryClientContract,
    loteId: number,
): Promise<{ restante: number; valor_restante: Dec }> {
    const fila = (await cliente
        .from('lealtad.movimientos as l')
        .leftJoin('lealtad.consumos as c', 'c.lote_id', 'l.id')
        .where('l.id', loteId)
        .groupBy('l.id')
        .select(
            cliente.raw('(l.puntos - coalesce(sum(c.puntos), 0))::int as restante'),
            cliente.raw('(l.valor - coalesce(sum(c.valor), 0))::text as valor_restante'),
        )
        .first()) as { restante: number; valor_restante: string } | null
    if (!fila) return { restante: 0, valor_restante: CERO }
    return { restante: Math.max(Number(fila.restante), 0), valor_restante: dec(fila.valor_restante) }
}

/** Saldo de puntos del cliente en la empresa: suma de sus movimientos (puede ser negativo, §4). */
export async function saldoPuntos(
    cliente: QueryClientContract,
    empresaId: number,
    clienteId: number,
): Promise<number> {
    const fila = (await cliente
        .from('lealtad.movimientos')
        .where('empresa_id', empresaId)
        .where('cliente_id', clienteId)
        .select(cliente.raw('coalesce(sum(puntos), 0)::int as saldo'))
        .first()) as { saldo: number }
    return Number(fila.saldo)
}

/*
|--------------------------------------------------------------------------
| Escritura
|--------------------------------------------------------------------------
*/

interface Consumo {
    lote_id: number
    puntos: number
    valor: Dec
}

interface DatosMovimiento {
    programa: Pick<ProgramaVista, 'id' | 'empresa_id'>
    cliente_id: number
    servicio_id: number | null
    tipo: TipoMovimiento
    puntos: number
    regla_id: number | null
    origen_tipo: OrigenMovimiento
    origen_id: number | null
    clave: string
    vence_en: string | null
    valor: Dec
    reversa_de?: number | null
    motivo?: string | null
    /** fecha contable del asiento (YYYY-MM-DD, Guatemala) */
    fecha: string
    /** cuentas del asiento cuando `valor > 0`: debe / haber */
    asiento?: { debe: string; haber: string; descripcion: string }
    consumos?: Consumo[]
}

async function insertarMovimiento(t: Transaccion, datos: DatosMovimiento): Promise<MovimientoPuntos> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT nextval(pg_get_serial_sequence('lealtad.movimientos', 'id'))::bigint AS id`,
    )) as { rows: Array<{ id: string }> }
    const id = Number(rows[0]!.id)
    const valor = datos.valor.toDecimalPlaces(2)

    let asientoId: number | null = null
    if (valor.greaterThan(0)) {
        if (!datos.asiento) throw new Error('Movimiento de lealtad con valor y sin cuentas de asiento')
        const asiento = await new RegistrarAsiento().execute(
            {
                empresa_id: datos.programa.empresa_id,
                fecha: datos.fecha,
                descripcion: datos.asiento.descripcion,
                origen_tipo: 'lealtad',
                origen_id: id,
                movimientos: [
                    { cuenta: datos.asiento.debe, debe: valor.toFixed(2) },
                    { cuenta: datos.asiento.haber, haber: valor.toFixed(2) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        asientoId = asiento.id
    }

    await t.trx
        .insertQuery()
        .table('lealtad.movimientos')
        .insert({
            id,
            empresa_id: datos.programa.empresa_id,
            programa_id: datos.programa.id,
            cliente_id: datos.cliente_id,
            servicio_id: datos.servicio_id,
            tipo: datos.tipo,
            puntos: datos.puntos,
            regla_id: datos.regla_id,
            origen_tipo: datos.origen_tipo,
            origen_id: datos.origen_id,
            clave_unica: datos.clave,
            vence_en: datos.vence_en,
            valor: valor.toFixed(2),
            asiento_id: asientoId,
            reversa_de: datos.reversa_de ?? null,
            motivo: datos.motivo ?? null,
            creado_por: usuarioDelActor(t.ctx.actor),
        })
    if (datos.consumos && datos.consumos.length > 0) {
        await t.trx
            .insertQuery()
            .table('lealtad.consumos')
            .multiInsert(
                datos.consumos.map((c) => ({
                    movimiento_id: id,
                    lote_id: c.lote_id,
                    puntos: c.puntos,
                    valor: c.valor.toFixed(2),
                })),
            )
    }
    const fila = await t.trx
        .from('lealtad.movimientos as m')
        .where('m.id', id)
        .select(columnasMovimiento(t.trx))
        .firstOrFail()
    return aMovimiento(fila)
}

/** Valor que entrega un lote al consumir `puntos` (el último consumo se lleva el resto exacto). */
function valorConsumo(
    lote: { puntos: number; valor: string },
    restante: number,
    valorRestante: Dec,
    puntos: number,
) {
    if (puntos >= restante) return valorRestante
    const proporcional = dec(lote.valor).times(puntos).dividedBy(lote.puntos).toDecimalPlaces(2)
    return proporcional.greaterThan(valorRestante) ? valorRestante : proporcional
}

/** `fecha` + `meses` (YYYY-MM-DD); null si el programa no vence puntos. */
export function venceEn(fecha: string, meses: number | null): string | null {
    if (meses === null) return null
    return DateTime.fromISO(fecha, { zone: 'utc' }).plus({ months: meses }).toISODate()!
}

export interface DatosAcumulacion {
    cliente_id: number
    servicio_id: number | null
    puntos: number
    regla_id: number | null
    origen_tipo: OrigenMovimiento
    origen_id: number | null
    clave: string
    tipo?: 'acumulacion' | 'ajuste'
    motivo?: string | null
    fecha: string
    /** texto corto del asiento: "pago a tiempo de la factura 12" */
    concepto: string
}

/**
 * Lote nuevo. Con diferimiento, asiento `4.1.05 Ingresos diferidos / 2.1.10 Pasivo` por
 * `puntos × valor_punto × canje_esperado_pct` (§6). Evento `lealtad.puntos_acumulados`.
 */
export async function acumular(
    t: Transaccion,
    programa: ProgramaVista,
    datos: DatosAcumulacion,
): Promise<MovimientoPuntos> {
    const valor = valorDePuntos(programa, datos.puntos)
    const movimiento = await insertarMovimiento(t, {
        programa,
        cliente_id: datos.cliente_id,
        servicio_id: datos.servicio_id,
        tipo: datos.tipo ?? 'acumulacion',
        puntos: datos.puntos,
        regla_id: datos.regla_id,
        origen_tipo: datos.origen_tipo,
        origen_id: datos.origen_id,
        clave: datos.clave,
        vence_en: venceEn(datos.fecha, programa.vencimiento_meses),
        valor,
        motivo: datos.motivo,
        fecha: datos.fecha,
        asiento: {
            debe: CUENTAS_GT.INGRESOS_DIFERIDOS_LEALTAD,
            haber: CUENTAS_GT.PASIVO_LEALTAD,
            descripcion: `Lealtad · ${datos.puntos} puntos al cliente ${datos.cliente_id}: ${datos.concepto}`,
        },
    })
    await t.emit('lealtad.puntos_acumulados', {
        movimiento_id: movimiento.id,
        empresa_id: movimiento.empresa_id,
        cliente_id: movimiento.cliente_id,
        servicio_id: movimiento.servicio_id,
        regla_id: movimiento.regla_id,
        puntos: movimiento.puntos,
        vence_en: movimiento.vence_en,
    })
    return movimiento
}

export interface CausaReverso {
    origen_tipo: OrigenMovimiento
    origen_id: number | null
    fecha: string
    motivo: string
}

/**
 * Reverso de un otorgamiento (§4): devuelve lo que le queda vivo al lote (lo ya vencido no se
 * revierte: ya salió). Asiento espejo de la acumulación por el valor vivo, `2.1.10 / 4.1.05`, con
 * fecha de hoy. Idempotente por la clave `reverso:<clave del lote>`. Devuelve null si el lote ya
 * no tenía puntos (no deja movimiento).
 */
export async function revertirLote(
    t: Transaccion,
    lote: MovimientoPuntos,
    causa: CausaReverso,
): Promise<MovimientoPuntos | null> {
    const clave = `reverso:${lote.clave_unica}`
    const existente = await movimientoPorClave(t.trx, lote.empresa_id, clave)
    if (existente) return existente
    const { restante, valor_restante: valorRestante } = await restanteDeLote(t.trx, lote.id)
    if (restante <= 0) return null
    const movimiento = await insertarMovimiento(t, {
        programa: { id: lote.programa_id, empresa_id: lote.empresa_id },
        cliente_id: lote.cliente_id,
        servicio_id: lote.servicio_id,
        tipo: 'reverso',
        puntos: -restante,
        regla_id: lote.regla_id,
        origen_tipo: causa.origen_tipo,
        origen_id: causa.origen_id,
        clave,
        vence_en: null,
        valor: valorRestante,
        reversa_de: lote.id,
        motivo: causa.motivo,
        fecha: causa.fecha,
        asiento: {
            debe: CUENTAS_GT.PASIVO_LEALTAD,
            haber: CUENTAS_GT.INGRESOS_DIFERIDOS_LEALTAD,
            descripcion: `Lealtad · reverso de ${restante} puntos del cliente ${lote.cliente_id}: ${causa.motivo}`,
        },
        consumos: [{ lote_id: lote.id, puntos: restante, valor: valorRestante }],
    })
    await t.emit('lealtad.puntos_revertidos', {
        movimiento_id: movimiento.id,
        empresa_id: movimiento.empresa_id,
        cliente_id: movimiento.cliente_id,
        puntos: restante,
        origen_tipo: movimiento.origen_tipo,
        origen_id: movimiento.origen_id,
    })
    return movimiento
}

/**
 * Vencimiento de un lote (§6.1): sale lo que le queda, `2.1.10 / 4.1.06 Ingresos por puntos
 * canjeados o vencidos` por su valor vivo. Idempotente por `vencimiento:lote:<id>`.
 */
export async function vencerLote(
    t: Transaccion,
    lote: {
        id: number
        empresa_id: number
        programa_id: number
        cliente_id: number
        servicio_id: number | null
    },
    fecha: string,
): Promise<MovimientoPuntos | null> {
    const clave = `vencimiento:lote:${lote.id}`
    if (await movimientoPorClave(t.trx, lote.empresa_id, clave)) return null
    const { restante, valor_restante: valorRestante } = await restanteDeLote(t.trx, lote.id)
    if (restante <= 0) return null
    const movimiento = await insertarMovimiento(t, {
        programa: { id: lote.programa_id, empresa_id: lote.empresa_id },
        cliente_id: lote.cliente_id,
        servicio_id: lote.servicio_id,
        tipo: 'vencimiento',
        puntos: -restante,
        regla_id: null,
        origen_tipo: 'lote',
        origen_id: lote.id,
        clave,
        vence_en: null,
        valor: valorRestante,
        fecha,
        asiento: {
            debe: CUENTAS_GT.PASIVO_LEALTAD,
            haber: CUENTAS_GT.INGRESOS_PUNTOS,
            descripcion: `Lealtad · vencen ${restante} puntos del cliente ${lote.cliente_id} (lote ${lote.id})`,
        },
        consumos: [{ lote_id: lote.id, puntos: restante, valor: valorRestante }],
    })
    await t.emit('lealtad.puntos_vencidos', {
        movimiento_id: movimiento.id,
        empresa_id: movimiento.empresa_id,
        cliente_id: movimiento.cliente_id,
        puntos: restante,
    })
    return movimiento
}

/**
 * Ajuste negativo (§4, `lealtad.ajustar`): consume `puntos` de los lotes, el que vence antes
 * primero, y revierte su diferimiento (`2.1.10 / 4.1.05`, una corrección, no un ingreso). Quien
 * llama ya verificó el saldo.
 */
export async function descontar(
    t: Transaccion,
    programa: Pick<ProgramaVista, 'id' | 'empresa_id'>,
    datos: {
        cliente_id: number
        servicio_id: number | null
        puntos: number
        clave: string
        motivo: string
        fecha: string
    },
): Promise<MovimientoPuntos> {
    const lotes = await lotesVivos(t.trx, programa.empresa_id, datos.cliente_id)
    const consumos: Consumo[] = []
    let faltan = datos.puntos
    for (const lote of lotes) {
        if (faltan <= 0) break
        const toma = Math.min(faltan, lote.restante)
        consumos.push({
            lote_id: lote.id,
            puntos: toma,
            valor: valorConsumo(lote, lote.restante, dec(lote.valor_restante), toma),
        })
        faltan -= toma
    }
    const valor = consumos.reduce((s, c) => s.plus(c.valor), CERO)
    const movimiento = await insertarMovimiento(t, {
        programa,
        cliente_id: datos.cliente_id,
        servicio_id: datos.servicio_id,
        tipo: 'ajuste',
        puntos: -datos.puntos,
        regla_id: null,
        origen_tipo: 'ajuste',
        origen_id: null,
        clave: datos.clave,
        vence_en: null,
        valor,
        motivo: datos.motivo,
        fecha: datos.fecha,
        asiento: {
            debe: CUENTAS_GT.PASIVO_LEALTAD,
            haber: CUENTAS_GT.INGRESOS_DIFERIDOS_LEALTAD,
            descripcion: `Lealtad · ajuste de −${datos.puntos} puntos al cliente ${datos.cliente_id}: ${datos.motivo}`,
        },
        consumos,
    })
    await t.emit('lealtad.puntos_revertidos', {
        movimiento_id: movimiento.id,
        empresa_id: movimiento.empresa_id,
        cliente_id: movimiento.cliente_id,
        puntos: datos.puntos,
        origen_tipo: 'ajuste',
        origen_id: null,
    })
    return movimiento
}

/*
|--------------------------------------------------------------------------
| Lectura (GET /clientes/:id/puntos)
|--------------------------------------------------------------------------
*/

export interface FiltrosMovimientos extends OpcionesPaginacion {
    empresas: number[] | null
    cliente_id: number
}

export async function listarMovimientos(filtros: FiltrosMovimientos): Promise<Pagina<MovimientoPuntos>> {
    const consulta = db
        .from('lealtad.movimientos as m')
        .where('m.cliente_id', filtros.cliente_id)
        .if(filtros.empresas !== null, (q) => q.whereIn('m.empresa_id', filtros.empresas!))
        .select(columnasMovimiento(db.connection()))
    const pagina = await paginar(consulta, filtros, { columna: 'm.id' })
    return { data: pagina.data.map(aMovimiento), nextCursor: pagina.nextCursor }
}

export interface SaldoEmpresa {
    empresa_id: number
    saldo: number
    /** puntos de lotes que vencen en los próximos `aviso_vencimiento_dias` del programa */
    por_vencer: number
    proximo_vencimiento: string | null
    /** valor vivo de los lotes (Q del pasivo; "0.00" sin diferimiento) */
    valor_pasivo: string
    lotes: LoteVivo[]
}

/** Saldo, lotes vivos y lo que vence pronto, por cada empresa en la que el cliente tiene puntos. */
export async function puntosDelCliente(
    clienteId: number,
    empresas: number[] | null,
    hoy: string,
): Promise<SaldoEmpresa[]> {
    const saldos = (await db
        .from('lealtad.movimientos')
        .where('cliente_id', clienteId)
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .groupBy('empresa_id')
        .orderBy('empresa_id', 'asc')
        .select('empresa_id', db.raw('sum(puntos)::int as saldo'))) as Array<{
        empresa_id: number
        saldo: number
    }>
    const salida: SaldoEmpresa[] = []
    for (const fila of saldos) {
        const empresaId = Number(fila.empresa_id)
        const lotes = await lotesVivos(db.connection(), empresaId, clienteId)
        const aviso = (await db
            .from('lealtad.programas')
            .where('empresa_id', empresaId)
            .orderBy('activo', 'desc')
            .orderBy('id', 'desc')
            .select('aviso_vencimiento_dias')
            .first()) as { aviso_vencimiento_dias: number } | null
        const limite = DateTime.fromISO(hoy, { zone: 'utc' })
            .plus({ days: Number(aviso?.aviso_vencimiento_dias ?? 30) })
            .toISODate()!
        const pronto = lotes.filter((l) => l.vence_en !== null && l.vence_en <= limite)
        salida.push({
            empresa_id: empresaId,
            saldo: Number(fila.saldo),
            por_vencer: pronto.reduce((s, l) => s + l.restante, 0),
            proximo_vencimiento: lotes.find((l) => l.vence_en !== null)?.vence_en ?? null,
            valor_pasivo: lotes.reduce((s, l) => s.plus(l.valor_restante), CERO).toFixed(2),
            lotes,
        })
    }
    return salida
}
