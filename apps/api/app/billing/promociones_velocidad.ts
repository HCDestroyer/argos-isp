import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { aTexto, dec, redondear } from '#ledger/dinero'
import type { Transaccion } from '#shared/domain_action'
import { lineaConIva, type LineaCalculada } from '#billing/facturas'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    diasEntre,
    periodosHasta,
    sumarDias,
    type ConfigCiclo,
    type PeriodoFacturable,
} from '#billing/periodos'

/**
 * Cobro de las promociones de velocidad (decisiones del PM 18 y 34; precio, 22 nov: «la promo puede
 * ser gratis, porque es una promo»).
 *
 * - **Sin `precio`** (lo normal): gratis. La factura cobra el plan que se factura
 *   (`sqlPlanFacturablePromocion`: el original aunque un tramo PCQ/árbol haya cambiado `plan_id`).
 * - **Con `precio`**: la factura cobra el precio normal del periodo y suma una línea propia
 *   «Promoción de velocidad <nombre>, N días» por la diferencia proporcional:
 *   `(precio_promo − precio_normal) × días del tramo en el periodo / días del ciclo del periodo`,
 *   redondeada a 2 decimales al final. Si la diferencia es ≤ 0 no se suma nada (una promoción nunca
 *   abarata). Días: en modo `dias`, cada día de Guatemala que toca el tramo (fin exclusivo; un tramo
 *   cerrado antes usa su `cerrado_en`); en modo `franja`, el día en que empieza cada franja.
 * - **Cuándo**: la parte de un tramo dentro de un periodo `P` se cobra cuando ya no puede cambiar
 *   (el tramo está cerrado o `P` ya terminó), en la primera factura que se emita desde entonces con
 *   periodo ≥ `P`: la de `P` si aún no se emitió, o la siguiente. `billing.promociones_cargos` guarda
 *   cada `(tramo, periodo)` cobrado con clave única: nunca dos veces. Una factura anulada no libera
 *   sus días (la anulación corrige el cobro; no se vuelve a cobrar solo).
 */

interface TramoConPrecio {
    tramo_id: number
    promocion_id: number
    nombre: string
    precio: string
    modo: 'dias' | 'franja'
    cerrado: boolean
    /** primer día (Guatemala) */
    desde: string
    /** último día (Guatemala, inclusivo) */
    hasta: string
}

/** Parte de una promoción que entra en la factura: una línea por promoción y periodo. */
export interface CargoPromocion {
    promocion_id: number
    nombre: string
    periodo: string
    dias: number
    dias_ciclo: number
    precio_promocion: string
    precio_normal: string
    monto: string
    tramos: Array<{ tramo_id: number; dias: number }>
}

/**
 * Cargos de promociones con `precio` que van en la factura del periodo `q` del servicio, con su
 * precio normal (`precioNormal`, el efectivo sin promoción). `hoy` = día de Guatemala de la emisión.
 */
export async function cargosPromocion(
    t: Transaccion,
    servicio: { id: number; inicio: string; precio: string },
    config: ConfigCiclo,
    q: PeriodoFacturable,
    hoy: string = hoyGuatemala(),
): Promise<CargoPromocion[]> {
    const dia = (expr: string) => `to_char((${expr}) AT TIME ZONE '${ZONA_NEGOCIO}', 'YYYY-MM-DD')`
    const finReal = `CASE WHEN tr.estado = 'cerrado' THEN least(tr.fin, coalesce(tr.cerrado_en, tr.fin)) ELSE tr.fin END`
    const tramos = (await t.trx
        .from('core.promociones_velocidad_tramos as tr')
        .join('core.promociones_velocidad as pv', 'pv.id', 'tr.promocion_id')
        .where('tr.servicio_id', servicio.id)
        .whereNotNull('pv.precio')
        .whereRaw(`(tr.inicio AT TIME ZONE '${ZONA_NEGOCIO}')::date < ?::date`, [q.fin])
        .orderBy('tr.inicio', 'asc')
        .select(
            'tr.id as tramo_id',
            'pv.id as promocion_id',
            'pv.nombre',
            t.trx.raw('pv.precio::text as precio'),
            'pv.modo',
            t.trx.raw(`tr.estado = 'cerrado' as cerrado`),
            t.trx.raw(`${dia('tr.inicio')} as desde`),
            t.trx.raw(`${dia(`${finReal} - interval '1 microsecond'`)} as hasta`),
        )) as TramoConPrecio[]
    if (tramos.length === 0) return []

    const cobrados = new Set(
        (
            (await t.trx
                .from('billing.promociones_cargos')
                .where('servicio_id', servicio.id)
                .select('tramo_id', t.trx.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`))) as Array<{
                tramo_id: number
                periodo: string
            }>
        ).map((c) => `${Number(c.tramo_id)}|${c.periodo}`),
    )
    const periodos = periodosHasta(config, servicio.inicio, q.periodo).filter((p) => p.periodo <= q.periodo)
    const normal = dec(servicio.precio)
    const grupos = new Map<string, CargoPromocion>()
    for (const p of periodos) {
        const terminado = p.fin <= hoy
        for (const tr of tramos) {
            if (!tr.cerrado && !terminado) continue
            if (cobrados.has(`${Number(tr.tramo_id)}|${p.periodo}`)) continue
            const ultimo = tr.modo === 'franja' ? tr.desde : tr.hasta
            const desde = tr.desde > p.periodo ? tr.desde : p.periodo
            const hastaExclusivo = sumarDias(ultimo, 1) < p.fin ? sumarDias(ultimo, 1) : p.fin
            const dias = diasEntre(desde, hastaExclusivo)
            if (dias <= 0) continue
            const diferencia = dec(tr.precio).minus(normal)
            if (diferencia.lte(0)) continue
            const clave = `${tr.promocion_id}|${p.periodo}`
            const grupo = grupos.get(clave) ?? {
                promocion_id: Number(tr.promocion_id),
                nombre: tr.nombre,
                periodo: p.periodo,
                dias: 0,
                dias_ciclo: p.dias_ciclo,
                precio_promocion: aTexto(tr.precio),
                precio_normal: aTexto(normal),
                monto: '0.00',
                tramos: [],
            }
            grupo.dias += dias
            grupo.tramos.push({ tramo_id: Number(tr.tramo_id), dias })
            grupos.set(clave, grupo)
        }
    }
    const salida: CargoPromocion[] = []
    for (const g of grupos.values()) {
        const monto = redondear(
            dec(g.precio_promocion).minus(g.precio_normal).times(g.dias).div(g.dias_ciclo),
        )
        if (monto.lte(0)) continue
        salida.push({ ...g, monto: aTexto(monto) })
    }
    return salida
}

/**
 * Línea de la factura de un cargo de promoción (IVA incluido, desglosado). Tipo `otro` con la cuenta de
 * ingresos por internet: es servicio de internet, pero no es «la línea del plan» (descuentos de
 * lealtad y ajustes de monto buscan la primera línea `servicio`).
 */
export function lineaPromocion(cargo: CargoPromocion, periodoFactura: string): LineaCalculada {
    const dias = cargo.dias === 1 ? '1 día' : `${cargo.dias} días`
    const otroPeriodo = cargo.periodo === periodoFactura ? '' : ` (periodo del ${cargo.periodo})`
    return lineaConIva({
        concepto: `Promoción de velocidad ${cargo.nombre}, ${dias}${otroPeriodo}`,
        tipo: 'otro',
        cuenta_codigo: CUENTAS.INGRESOS_INTERNET,
        cantidad: '1',
        gravable: true,
        total: cargo.monto,
    })
}

/** Registra los `(tramo, periodo)` cobrados en la factura (clave única: nunca dos veces). */
export async function registrarCargosPromocion(
    t: Transaccion,
    datos: { empresa_id: number; servicio_id: number; factura_id: number },
    cargos: CargoPromocion[],
): Promise<void> {
    const filas = cargos.flatMap((c) =>
        c.tramos.map((tr) => ({
            empresa_id: datos.empresa_id,
            servicio_id: datos.servicio_id,
            promocion_id: c.promocion_id,
            tramo_id: tr.tramo_id,
            periodo: c.periodo,
            dias: tr.dias,
            factura_id: datos.factura_id,
        })),
    )
    if (filas.length > 0) await t.trx.table('billing.promociones_cargos').multiInsert(filas)
}
