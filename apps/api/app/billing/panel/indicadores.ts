import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { StrictValues } from '@adonisjs/lucid/types/querybuilder'
import { DateTime } from 'luxon'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { inicioFacturacionSql } from '#billing/configuracion'

/**
 * Cifras del panel financiero (decisiones del PM 3 y 4 del 21 nov; `contratos/reportes.md` §2).
 * Solo lectura: nada se guarda ni se cachea; cada cifra se calcula desde las tablas fuente.
 *
 * - **Ingreso mensual recurrente (MRR)**, IVA incluido: por cada servicio `activo` o `limitado`, lo
 *   que cobra al mes un periodo completo: el precio efectivo del plan (`costo_override` = precio
 *   especial pactado, o el precio del plan vigente; con un plan temporal activo ya es el temporal),
 *   menos la mejora de lealtad (plan temporal `lealtad` sin `costo_override`: se cobra el plan
 *   original, igual que `#lealtad/emision`), más los cargos recurrentes activos y los adicionales
 *   `cobrado` vigentes y no bloqueados. Sin mora, prorrateo, cargos únicos ni canjes de un solo mes.
 * - **Bajas (churn)**: servicios `retirado`, o `suspendido` hace más de `dias_baja` días (60 de
 *   fábrica, `billing.panel_ajustes`). La fecha de baja es la del retiro o la del inicio de la
 *   suspensión + `dias_baja` (la que llegue antes, si se retiró estando suspendido). Un servicio que
 *   se reactiva deja de contar, también en los meses pasados (decisión 4).
 * - **Ingreso promedio por servicio (ARPU)** = MRR / servicios que cuentan en el MRR.
 * - **Efectivo disponible**: saldo del libro (debe − haber) de las subcuentas de Cajas (1.1.01.*) y
 *   Bancos (1.1.02.*) a hoy.
 */

export const DIAS_BAJA_FABRICA = 60

/** Empresas pedidas como arreglo de SQL (null = todas). */
function filtroEmpresas(columna: string, empresas: number[] | null): { sql: string; params: StrictValues[] } {
    if (empresas === null) return { sql: 'true', params: [] }
    return { sql: `${columna} = ANY(?::bigint[])`, params: [empresas] }
}

export async function diasBaja(empresaId: number, c: QueryClientContract = db.connection()) {
    const fila = (await c
        .from('billing.panel_ajustes')
        .where('empresa_id', empresaId)
        .select('dias_baja')
        .first()) as {
        dias_baja: number
    } | null
    return fila ? Number(fila.dias_baja) : DIAS_BAJA_FABRICA
}

/*
|--------------------------------------------------------------------------
| Ingreso mensual recurrente
|--------------------------------------------------------------------------
*/

export interface IngresoRecurrente {
    /** servicios activos y limitados */
    servicios: number
    /** precio efectivo de los planes */
    planes: string
    /** mejora de plan por lealtad que no se cobra */
    descuentos: string
    cargos_recurrentes: string
    adicionales: string
    /** MRR = planes − descuentos + cargos_recurrentes + adicionales (IVA incluido) */
    mrr: string
    /** ARPU = mrr / servicios (null sin servicios) */
    arpu: string | null
}

export async function ingresoRecurrente(
    empresas: number[] | null,
    c: QueryClientContract = db.connection(),
): Promise<Map<number, IngresoRecurrente>> {
    const f = filtroEmpresas('s.empresa_id', empresas)
    const { rows } = (await c.rawQuery(
        `SELECT s.empresa_id,
                count(*)::int AS servicios,
                coalesce(sum(coalesce(s.costo_override, p.precio)), 0)::numeric(14, 2)::text AS planes,
                coalesce(sum(CASE WHEN s.costo_override IS NULL AND pt.origen = 'lealtad' AND po.precio IS NOT NULL
                                  THEN greatest(p.precio - po.precio, 0) ELSE 0 END), 0)::numeric(14, 2)::text AS descuentos,
                coalesce(sum(cr.monto), 0)::numeric(14, 2)::text AS cargos_recurrentes,
                coalesce(sum(ad.monto), 0)::numeric(14, 2)::text AS adicionales
           FROM core.servicios s
           JOIN network.planes p ON p.id = s.plan_id
           LEFT JOIN core.servicios_planes_temporales pt ON pt.servicio_id = s.id AND pt.estado = 'activo'
           LEFT JOIN network.planes po ON po.id = pt.plan_original_id
           LEFT JOIN LATERAL (
                SELECT sum(cr.monto) AS monto FROM billing.conceptos_recurrentes cr
                 WHERE cr.servicio_id = s.id AND cr.activo AND cr.monto > 0
           ) cr ON true
           LEFT JOIN LATERAL (
                SELECT sum(sa.precio) AS monto FROM core.servicios_adicionales sa
                 WHERE sa.servicio_id = s.id AND sa.estado = 'activo' AND sa.modalidad = 'cobrado'
                   AND sa.precio IS NOT NULL AND sa.cobrado_desde IS NOT NULL AND sa.cobrado_desde <= now()
                   AND sa.bloqueo = 'vigente'
           ) ad ON true
          WHERE s.estado IN ('activo', 'limitado') AND ${f.sql}
          GROUP BY s.empresa_id`,
        f.params,
    )) as { rows: Array<Record<string, string | number>> }
    const salida = new Map<number, IngresoRecurrente>()
    for (const r of rows) {
        const mrr = dec(String(r.planes))
            .minus(dec(String(r.descuentos)))
            .plus(dec(String(r.cargos_recurrentes)))
            .plus(dec(String(r.adicionales)))
        const servicios = Number(r.servicios)
        salida.set(Number(r.empresa_id), {
            servicios,
            planes: String(r.planes),
            descuentos: String(r.descuentos),
            cargos_recurrentes: String(r.cargos_recurrentes),
            adicionales: String(r.adicionales),
            mrr: aTexto(mrr),
            arpu: promedio(mrr, servicios),
        })
    }
    return salida
}

export function ingresoVacio(): IngresoRecurrente {
    return {
        servicios: 0,
        planes: '0.00',
        descuentos: '0.00',
        cargos_recurrentes: '0.00',
        adicionales: '0.00',
        mrr: '0.00',
        arpu: null,
    }
}

export function promedio(total: Dec, cantidad: number): string | null {
    return cantidad > 0 ? aTexto(redondear(total.dividedBy(cantidad))) : null
}

/*
|--------------------------------------------------------------------------
| Bajas
|--------------------------------------------------------------------------
*/

/** Inicio del mes `YYYY-MM` y del siguiente (fechas de Guatemala). */
export function limitesMes(mes: string): { desde: string; hasta: string } {
    const inicio = DateTime.fromISO(`${mes}-01`, { zone: 'utc' })
    return { desde: inicio.toISODate()!, hasta: inicio.plus({ months: 1 }).toISODate()! }
}

const instanteGt = (param = '?') => `((${param}::date)::timestamp AT TIME ZONE '${ZONA_NEGOCIO}')`

/**
 * Servicios dados de baja (con su fecha de baja hasta `ahora`), por empresa. Lee el historial de
 * estados de `audit.outbox` (`servicio.estado_cambiado`), igual que el reporte de altas y bajas.
 * Sin evento (servicio importado ya suspendido o retirado): el alta del servicio o su última edición.
 */
function consultaBajas(empresas: number[] | null): { sql: string; params: StrictValues[] } {
    const f = filtroEmpresas('s.empresa_id', empresas)
    return {
        sql: `WITH ev AS (
                SELECT (o.payload->>'servicio_id')::bigint AS sid, o.payload->>'a' AS a,
                       o.payload->>'de' AS de, o.created_at AS en
                  FROM audit.outbox o
                 WHERE o.evento = 'servicio.estado_cambiado' AND o.payload->>'a' IN ('suspendido', 'retirado')
            ), sv AS (
                SELECT s.id, s.empresa_id, s.estado, s.created_at, s.updated_at,
                       coalesce(aj.dias_baja, ${DIAS_BAJA_FABRICA}) AS dias
                  FROM core.servicios s
                  LEFT JOIN billing.panel_ajustes aj ON aj.empresa_id = s.empresa_id
                 WHERE s.estado IN ('suspendido', 'retirado') AND ${f.sql}
            )
            SELECT sv.id, sv.empresa_id, sv.estado,
                   CASE WHEN sv.estado = 'suspendido'
                        THEN coalesce(sus.en, sv.created_at) + make_interval(days => sv.dias)
                        ELSE least(coalesce(ret.en, sv.updated_at),
                                   CASE WHEN ret.de = 'suspendido' THEN prev.en + make_interval(days => sv.dias) END)
                   END AS baja_en
              FROM sv
              LEFT JOIN LATERAL (SELECT max(ev.en) AS en FROM ev WHERE ev.sid = sv.id AND ev.a = 'suspendido') sus
                ON sv.estado = 'suspendido'
              LEFT JOIN LATERAL (SELECT ev.en, ev.de FROM ev WHERE ev.sid = sv.id AND ev.a = 'retirado'
                                  ORDER BY ev.en DESC LIMIT 1) ret ON sv.estado = 'retirado'
              LEFT JOIN LATERAL (SELECT max(ev.en) AS en FROM ev
                                  WHERE ev.sid = sv.id AND ev.a = 'suspendido' AND ev.en <= ret.en) prev
                ON sv.estado = 'retirado'`,
        params: f.params,
    }
}

export interface BajasMes {
    mes: string
    dias_baja: number
    /** bajas con fecha en el mes (hasta hoy) */
    bajas: number
    /** de ellas, por retiro */
    retiros: number
    /** de ellas, por suspensión larga */
    suspendidos: number
    /** altas del mes (primer día facturable) */
    altas: number
    /** servicios que cuentan hoy: activos, limitados y suspendidos que aún no son baja */
    vigentes: number
    /** servicios al inicio del mes = vigentes + bajas desde el inicio − altas desde el inicio */
    base: number
    /** churn = bajas / base × 100 (null con base 0) */
    tasa: string | null
}

/**
 * Bajas de cada mes pedido, por empresa. `meses` en orden ascendente (`YYYY-MM`). La base de cada
 * mes se reconstruye desde hoy hacia atrás (vigentes + bajas − altas desde el inicio del mes).
 */
export async function bajasPorMes(
    empresas: number[] | null,
    meses: string[],
    ahora: Date = new Date(),
    c: QueryClientContract = db.connection(),
): Promise<Map<number, BajasMes[]>> {
    if (meses.length === 0) return new Map()
    const desdeTodo = limitesMes(meses[0]!).desde
    const b = consultaBajas(empresas)
    const { rows: bajas } = (await c.rawQuery(
        `SELECT empresa_id, estado,
                to_char(baja_en AT TIME ZONE '${ZONA_NEGOCIO}', 'YYYY-MM') AS mes,
                count(*)::int AS n
           FROM (${b.sql}) x
          WHERE baja_en <= ? AND baja_en >= ${instanteGt()}
          GROUP BY empresa_id, estado, mes`,
        [...b.params, ahora, desdeTodo],
    )) as { rows: Array<{ empresa_id: number; estado: string; mes: string; n: number }> }

    const f = filtroEmpresas('s.empresa_id', empresas)
    const alta = inicioFacturacionSql('s')
    const { rows: altas } = (await c.rawQuery(
        `SELECT s.empresa_id, to_char(${alta}, 'YYYY-MM') AS mes, count(*)::int AS n
           FROM core.servicios s
          WHERE s.estado <> 'pendiente_instalacion' AND ${alta} >= ?::date AND ${alta} <= ?::date AND ${f.sql}
          GROUP BY s.empresa_id, mes`,
        [desdeTodo, hoyGuatemala(ahora), ...f.params],
    )) as { rows: Array<{ empresa_id: number; mes: string; n: number }> }

    const { rows: vigentes } = (await c.rawQuery(
        `SELECT s.empresa_id, count(*)::int AS n
           FROM core.servicios s
          WHERE s.estado IN ('activo', 'limitado') AND ${f.sql}
          GROUP BY s.empresa_id
         UNION ALL
         SELECT empresa_id, count(*)::int FROM (${b.sql}) x
          WHERE estado = 'suspendido' AND baja_en > ?
          GROUP BY empresa_id`,
        [...f.params, ...b.params, ahora],
    )) as { rows: Array<{ empresa_id: number; n: number }> }

    const ids = new Set<number>([
        ...(empresas ?? []),
        ...bajas.map((r) => Number(r.empresa_id)),
        ...altas.map((r) => Number(r.empresa_id)),
        ...vigentes.map((r) => Number(r.empresa_id)),
    ])
    const salida = new Map<number, BajasMes[]>()
    for (const empresaId of ids) {
        const dias = await diasBaja(empresaId, c)
        const vig = vigentes
            .filter((r) => Number(r.empresa_id) === empresaId)
            .reduce((n, r) => n + Number(r.n), 0)
        const porMes = (filas: Array<{ empresa_id: number; mes: string; n: number }>, mes: string) =>
            filas
                .filter((r) => Number(r.empresa_id) === empresaId && r.mes === mes)
                .reduce((n, r) => n + Number(r.n), 0)
        const desde = (filas: Array<{ empresa_id: number; mes: string; n: number }>, mes: string) =>
            filas
                .filter((r) => Number(r.empresa_id) === empresaId && r.mes >= mes)
                .reduce((n, r) => n + Number(r.n), 0)
        const lista: BajasMes[] = meses.map((mes) => {
            const retiros = bajas
                .filter((r) => Number(r.empresa_id) === empresaId && r.mes === mes && r.estado === 'retirado')
                .reduce((n, r) => n + Number(r.n), 0)
            const total = porMes(bajas, mes)
            const base = vig + desde(bajas, mes) - desde(altas, mes)
            return {
                mes,
                dias_baja: dias,
                bajas: total,
                retiros,
                suspendidos: total - retiros,
                altas: porMes(altas, mes),
                vigentes: vig,
                base,
                tasa: base > 0 ? aTexto(redondear(dec(String(total)).times(100).dividedBy(base))) : null,
            }
        })
        salida.set(empresaId, lista)
    }
    return salida
}

/** Meses `YYYY-MM` de `desde` a `hasta` (inclusive). */
export function mesesEntre(desde: string, hasta: string): string[] {
    const salida: string[] = []
    let m = DateTime.fromISO(`${desde.slice(0, 7)}-01`, { zone: 'utc' })
    const fin = DateTime.fromISO(`${hasta.slice(0, 7)}-01`, { zone: 'utc' })
    while (m <= fin && salida.length < 120) {
        salida.push(m.toFormat('yyyy-MM'))
        m = m.plus({ months: 1 })
    }
    return salida
}

/*
|--------------------------------------------------------------------------
| Efectivo disponible
|--------------------------------------------------------------------------
*/

export interface CuentaEfectivo {
    cuenta_id: number
    codigo: string
    nombre: string
    tipo: 'caja' | 'banco'
    saldo: string
}

export interface EfectivoDisponible {
    cajas: string
    bancos: string
    total: string
    cuentas: CuentaEfectivo[]
}

export async function efectivoDisponible(
    empresas: number[] | null,
    ahora: Date = new Date(),
    c: QueryClientContract = db.connection(),
): Promise<Map<number, EfectivoDisponible>> {
    const f = filtroEmpresas('a.empresa_id', empresas)
    const { rows } = (await c.rawQuery(
        `SELECT a.empresa_id, cu.id AS cuenta_id, cu.codigo, cu.nombre,
                (sum(m.debe) - sum(m.haber))::numeric(14, 2)::text AS saldo
           FROM ledger.movimientos m
           JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE (cu.codigo LIKE ? OR cu.codigo LIKE ?) AND a.fecha <= ?::date AND ${f.sql}
          GROUP BY a.empresa_id, cu.id, cu.codigo, cu.nombre
          ORDER BY a.empresa_id, cu.codigo`,
        [`${CUENTAS.CAJAS}.%`, `${CUENTAS.BANCOS}.%`, hoyGuatemala(ahora), ...f.params],
    )) as {
        rows: Array<{ empresa_id: number; cuenta_id: number; codigo: string; nombre: string; saldo: string }>
    }
    const salida = new Map<number, EfectivoDisponible>()
    const acumulado = new Map<number, { cajas: Dec; bancos: Dec; cuentas: CuentaEfectivo[] }>()
    for (const r of rows) {
        const id = Number(r.empresa_id)
        const a = acumulado.get(id) ?? { cajas: CERO, bancos: CERO, cuentas: [] }
        const tipo = r.codigo.startsWith(`${CUENTAS.CAJAS}.`) ? 'caja' : 'banco'
        if (tipo === 'caja') a.cajas = a.cajas.plus(dec(r.saldo))
        else a.bancos = a.bancos.plus(dec(r.saldo))
        a.cuentas.push({
            cuenta_id: Number(r.cuenta_id),
            codigo: r.codigo,
            nombre: r.nombre,
            tipo,
            saldo: r.saldo,
        })
        acumulado.set(id, a)
    }
    for (const [id, a] of acumulado) {
        salida.set(id, {
            cajas: aTexto(a.cajas),
            bancos: aTexto(a.bancos),
            total: aTexto(a.cajas.plus(a.bancos)),
            cuentas: a.cuentas,
        })
    }
    return salida
}

export function efectivoVacio(): EfectivoDisponible {
    return { cajas: '0.00', bancos: '0.00', total: '0.00', cuentas: [] }
}
