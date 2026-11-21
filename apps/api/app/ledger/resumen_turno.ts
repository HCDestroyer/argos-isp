import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema } from '#shared/errores'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'

/**
 * Resumen de un turno de caja (rediseño del panel, `a4.md` fila del 21 nov: menú de la caja en la
 * barra superior y cierre). Una sola regla para lo que «debe haber» en efectivo, la misma que usa
 * `cajas.cerrar` para su `esperado`:
 *
 * `esperado = fondo_inicial + Σ ingresos en efectivo − Σ retiros de efectivo`, donde
 *
 * - **ingresos**: los cobros vigentes del turno en efectivo (método `caja`, `monto − retenido`; las
 *   constancias de retención no son efectivo, fase 5);
 * - **retiros**: egresos en efectivo vigentes del turno (`egresos.registrar`), depósitos al banco del
 *   turno (`cajas.depositar`) y pagos a proveedores en efectivo vigentes del turno (`compras.pagar`).
 *
 * Los cobros por otros medios (transferencia, depósito, pasarela…) no son efectivo de la caja: salen en
 * `otros_medios` para el menú, y son los que registró quien abrió el turno, en la misma empresa, entre
 * la apertura y el cierre (o ahora, si sigue abierto).
 */

export interface Conteo {
    cantidad: number
    monto: string
}

export interface CobroPorMetodo extends Conteo {
    metodo: string
}

export interface ResumenTurno {
    caja_id: number
    caja_nombre: string
    empresa_id: number
    turno_id: number
    abierto_en: Date
    abierto_por: number | null
    abierto_por_nombre: string | null
    /** null mientras está abierto */
    cerrado_en: Date | null
    fondo_inicial: string
    /** todos los cobros vigentes del turno (efectivo y otros medios), por método */
    cobros: Conteo & { por_metodo: CobroPorMetodo[] }
    /** cobros en efectivo: `monto − retenido` */
    efectivo_cobrado: Conteo
    /** cobros por otros medios del cajero en el turno (no entran a la caja) */
    otros_medios: Conteo
    /** efectivo que entró a la caja (sin el fondo): hoy, los cobros en efectivo */
    ingresos: Conteo & { cobros_efectivo: Conteo }
    /** efectivo que salió de la caja */
    retiros: Conteo & { egresos: Conteo; depositos: Conteo; pagos_proveedores: Conteo }
    /** lo que debe haber en efectivo: fondo + ingresos − retiros */
    esperado: string
}

interface FilaConteo {
    cantidad: string | number
    monto: string | null
}

function conteo(fila: FilaConteo | undefined | null): Conteo {
    return { cantidad: Number(fila?.cantidad ?? 0), monto: aTexto(dec(fila?.monto ?? '0')) }
}

function sumarConteos(...partes: Conteo[]): Conteo {
    let monto: Dec = CERO
    let cantidad = 0
    for (const p of partes) {
        monto = monto.plus(dec(p.monto))
        cantidad += p.cantidad
    }
    return { cantidad, monto: aTexto(monto) }
}

export class SinTurnoAbierto extends Problema {
    constructor(cajaId: number | null) {
        super(
            404,
            'sin_turno_abierto',
            'Sin turno abierto',
            cajaId === null
                ? 'No tienes una caja con turno abierto'
                : `La caja ${cajaId} no tiene turno abierto`,
        )
    }
}

/** Resumen de un turno (abierto o cerrado). */
export async function resumenDeTurno(
    turnoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ResumenTurno> {
    const turno = (await cliente
        .from('ledger.cajas_turnos as t')
        .join('ledger.cajas as c', 'c.id', 't.caja_id')
        .where('t.id', turnoId)
        .select(
            't.id',
            't.caja_id',
            'c.nombre as caja_nombre',
            'c.empresa_id',
            't.abierto_en',
            't.abierto_por',
            cliente.raw(
                '(select u.nombre from core.usuarios u where u.id = t.abierto_por) as abierto_por_nombre',
            ),
            't.cerrado_en',
            't.fondo_inicial',
        )
        .first()) as {
        id: number
        caja_id: number
        caja_nombre: string
        empresa_id: number
        abierto_en: Date
        abierto_por: number | null
        abierto_por_nombre: string | null
        cerrado_en: Date | null
        fondo_inicial: string
    } | null
    if (!turno) throw new Problema(404, 'no_encontrado', 'No encontrado', `El turno ${turnoId} no existe`)

    const efectivo = (await cliente
        .from('billing.pagos')
        .where('turno_id', turno.id)
        .whereNot('estado', 'anulado')
        .select(cliente.raw('count(*) as cantidad'), cliente.raw('sum(monto - retenido)::text as monto'))
        .first()) as FilaConteo
    // otros medios: lo que registró el cajero del turno mientras estuvo abierto, en la empresa de la caja
    const otros = turno.abierto_por
        ? ((await cliente
              .from('billing.pagos')
              .whereNull('turno_id')
              .whereNot('metodo', 'caja')
              .where('estado', 'registrado')
              .where('historico', false)
              .where('empresa_id', turno.empresa_id)
              .where('registrado_por', turno.abierto_por)
              .where('created_at', '>=', turno.abierto_en)
              .if(turno.cerrado_en !== null, (q) => q.where('created_at', '<=', turno.cerrado_en!))
              .groupBy('metodo')
              .orderBy('metodo')
              .select(
                  'metodo',
                  cliente.raw('count(*) as cantidad'),
                  cliente.raw('sum(monto)::text as monto'),
              )) as Array<FilaConteo & { metodo: string }>)
        : []
    const egresos = (await cliente
        .from('ledger.egresos as e')
        .where('e.turno_id', turno.id)
        .whereNotExists((q) => q.from('ledger.egresos_anulaciones as an').whereRaw('an.egreso_id = e.id'))
        .select(cliente.raw('count(*) as cantidad'), cliente.raw('sum(e.monto)::text as monto'))
        .first()) as FilaConteo
    const depositos = (await cliente
        .from('ledger.depositos')
        .where('turno_id', turno.id)
        .select(cliente.raw('count(*) as cantidad'), cliente.raw('sum(monto)::text as monto'))
        .first()) as FilaConteo
    const proveedores = (await cliente
        .from('ledger.pagos_proveedores as pp')
        .where('pp.turno_id', turno.id)
        .whereNotExists((q) =>
            q.from('ledger.pagos_proveedores_anulaciones as x').whereRaw('x.pago_id = pp.id'),
        )
        .select(cliente.raw('count(*) as cantidad'), cliente.raw('sum(pp.monto)::text as monto'))
        .first()) as FilaConteo

    const efectivoCobrado = conteo(efectivo)
    const porMetodo: CobroPorMetodo[] = []
    if (efectivoCobrado.cantidad > 0) porMetodo.push({ metodo: 'caja', ...efectivoCobrado })
    for (const fila of otros) porMetodo.push({ metodo: fila.metodo, ...conteo(fila) })
    const otrosMedios = sumarConteos(...otros.map(conteo))
    const retirosEgresos = conteo(egresos)
    const retirosDepositos = conteo(depositos)
    const retirosProveedores = conteo(proveedores)
    const retiros = sumarConteos(retirosEgresos, retirosDepositos, retirosProveedores)
    const ingresos = sumarConteos(efectivoCobrado)
    const esperado = dec(turno.fondo_inicial).plus(ingresos.monto).minus(retiros.monto)

    return {
        caja_id: Number(turno.caja_id),
        caja_nombre: turno.caja_nombre,
        empresa_id: Number(turno.empresa_id),
        turno_id: Number(turno.id),
        abierto_en: turno.abierto_en,
        abierto_por: turno.abierto_por === null ? null : Number(turno.abierto_por),
        abierto_por_nombre: turno.abierto_por_nombre,
        cerrado_en: turno.cerrado_en,
        fondo_inicial: aTexto(turno.fondo_inicial),
        cobros: { ...sumarConteos(efectivoCobrado, otrosMedios), por_metodo: porMetodo },
        efectivo_cobrado: efectivoCobrado,
        otros_medios: otrosMedios,
        ingresos: { ...ingresos, cobros_efectivo: efectivoCobrado },
        retiros: {
            ...retiros,
            egresos: retirosEgresos,
            depositos: retirosDepositos,
            pagos_proveedores: retirosProveedores,
        },
        esperado: aTexto(esperado),
    }
}

/** Resumen del turno abierto de una caja; 404 `sin_turno_abierto` si no tiene. */
export async function resumenTurnoAbierto(
    cajaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ResumenTurno> {
    const turno = await cliente
        .from('ledger.cajas_turnos')
        .where('caja_id', cajaId)
        .whereNull('cerrado_en')
        .select('id')
        .first()
    if (!turno) throw new SinTurnoAbierto(cajaId)
    return resumenDeTurno(Number(turno.id), cliente)
}

/**
 * Lo que debe haber en efectivo en el turno (la regla de arriba), dentro de la transacción del cierre.
 */
export async function esperadoDelTurno(cliente: QueryClientContract, turnoId: number): Promise<Dec> {
    const resumen = await resumenDeTurno(turnoId, cliente)
    return dec(resumen.esperado)
}

/*
|--------------------------------------------------------------------------
| Denominaciones (cierre)
|--------------------------------------------------------------------------
*/

/** Billetes y monedas de quetzal, de mayor a menor (los mismos del panel, `apps/web/app/utils/caja.ts`). */
export const DENOMINACIONES = [
    '200',
    '100',
    '50',
    '20',
    '10',
    '5',
    '1',
    '0.50',
    '0.25',
    '0.10',
    '0.05',
    '0.01',
] as const

export type Denominacion = (typeof DENOMINACIONES)[number]

export interface LineaDenominacion {
    valor: Denominacion
    cantidad: number
}

/** Total de un conteo por denominaciones. */
export function totalDenominaciones(lineas: readonly LineaDenominacion[]): Dec {
    let total: Dec = CERO
    for (const l of lineas) total = total.plus(dec(l.valor).times(l.cantidad))
    return total
}
