import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { Problema, type ProblemaJson } from '#shared/errores'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { periodoCerrado } from '#ledger/cierres'
import { checkPasa, checksAutomaticosDelTipo, checksVigentes } from '#ledger/checks'
import { depositosEnCamino } from '#ledger/transitos'
import { sqlSaldoCompra } from '#ledger/compras'
import { cuentasPorPagar } from '#ledger/pagos_proveedores'
import { carteraVencida } from '#billing/reportes/reportes'
import { efectivoDisponible } from '#billing/panel/indicadores'
import { ultimasCorridas } from '#billing/corridas'
import { calcularDatos, impuestoDelMes } from '#fiscal/declaraciones'

/**
 * Inicio de contabilidad (`GET /contabilidad/inicio`, plan de contabilidad §5.2 y lote B2): lectura.
 *
 * - **Qué toca hoy**: nueve conteos de lo que espera por alguien, solo los que el rol puede atender
 *   (cada tarea pide el permiso de la acción que la resuelve) y solo los mayores que cero.
 * - **Pasos del mes**: siete pasos fijos con su estado calculado de los datos (corridas de
 *   facturación, turnos, borradores, extractos, lista de verificación, obligaciones y cierre);
 *   nunca casillas a mano.
 * - **Indicadores**: Te deben, Debes a proveedores, Dinero disponible e Impuestos del mes, con las
 *   mismas consultas de la cartera por antigüedad, las cuentas por pagar, el efectivo del panel
 *   financiero y el borrador de la declaración: el mismo número que ve el contador en esas pantallas.
 *
 * Reglas: nada se inventa. Sin datos que respondan (una empresa que nunca facturó, sin extractos,
 * sin obligación fiscal) el elemento dice `sin_datos`; sin el permiso del dato, `sin_permiso`; y si
 * una consulta falla, `error` con su problema RFC 9457 y sin cifras, sin tumbar lo demás.
 * Sin estado en memoria ni TTL: todo se calcula por consulta.
 */

export const DIAS_AVISO_COMPRAS = 7
export const DIAS_AVISO_OBLIGACIONES = 7

export type UrgenciaTarea = 'alta' | 'media' | 'baja'

export interface TareaInicio {
    clave: string
    cantidad: number
    /** monto asociado cuando la tarea mueve dinero; null si no aplica */
    monto: string | null
    /** fecha (YYYY-MM-DD) más antigua o más cercana de la tarea; null si no aplica */
    fecha: string | null
    /** solo en `compras_por_pagar` */
    proveedores: number | null
    urgencia: UrgenciaTarea
    /** permiso de la acción que resuelve la tarea (el panel enlaza solo si lo tiene) */
    permiso: string
}

export interface FalloInicio {
    clave: string
    error: ProblemaJson
}

export type EstadoPaso = 'listo' | 'pendiente' | 'sin_datos' | 'error'

export interface PasoInicio {
    numero: number
    clave: string
    estado: EstadoPaso
    /** pendientes (pendiente) o hechos (listo) según el paso; null si no aplica */
    cantidad: number | null
    /** fecha de interés (vencimiento, último estado de cuenta); null si no aplica */
    fecha: string | null
    error: ProblemaJson | null
}

export type EstadoIndicador = 'bien' | 'atencion' | 'urgente' | 'sin_datos' | 'sin_permiso' | 'error'

export interface IndicadorInicio {
    estado: EstadoIndicador
    valor: string | null
    /** facturas, compras o cuentas que componen el valor; null si no aplica */
    cantidad: number | null
    /** monto que pide atención (te_deben: más de 60 días; debes_proveedores: vencido); null si no aplica */
    monto_alerta: string | null
    /** fecha de interés (impuestos_mes: cuándo vence); null si no aplica */
    fecha: string | null
    /** permiso que faltó (con `sin_permiso`) */
    permiso: string | null
    error: ProblemaJson | null
}

export interface InicioContabilidad {
    hoy: string
    periodo: string
    generado_en: string
    empresas: Array<{ id: number; nombre: string }>
    consolidado: boolean
    pendientes: number
    tareas: TareaInicio[]
    tareas_con_error: FalloInicio[]
    pasos: PasoInicio[]
    paso_actual: number | null
    indicadores: {
        te_deben: IndicadorInicio
        debes_proveedores: IndicadorInicio
        dinero_disponible: IndicadorInicio
        impuestos_mes: IndicadorInicio
    }
}

export interface OpcionesInicio {
    /** empresas pedidas (`null` = todas las activas) */
    empresas: number[] | null
    consolidado: boolean
    permisos: ReadonlySet<string>
    alcance?: Alcance
    /** `YYYY-MM` de los pasos del mes (por defecto el mes en curso de Guatemala) */
    periodo?: string
    ahora?: Date
}

const URGENCIA_ORDEN: Record<UrgenciaTarea, number> = { alta: 0, media: 1, baja: 2 }

function problemaDe(error: unknown, nombre: string): ProblemaJson {
    if (error instanceof Problema) return error.toJSON()
    logger.error({ err: error, elemento: nombre }, 'inicio de contabilidad')
    return new Problema(
        500,
        'error_interno',
        'Error interno',
        `${nombre} no se pudo calcular; lo demás sí`,
    ).toJSON()
}

function diasHasta(hoy: string, fecha: string): number {
    return Math.round(
        DateTime.fromISO(fecha, { zone: 'utc' }).diff(DateTime.fromISO(hoy, { zone: 'utc' }), 'days').days,
    )
}

/*
|--------------------------------------------------------------------------
| Qué toca hoy
|--------------------------------------------------------------------------
*/

interface DefinicionTarea {
    clave: string
    permiso: string
    calcular: (c: Contexto) => Promise<Omit<TareaInicio, 'clave' | 'permiso'> | null>
}

interface Contexto {
    c: QueryClientContract
    empresas: number[]
    hoy: string
    alcance?: Alcance
}

type FilaConteo = { cantidad: number; monto: string | null; fecha: string | null; proveedores?: number }

async function conteo(c: QueryClientContract, sql: string, valores: unknown[]): Promise<FilaConteo> {
    const { rows } = (await c.rawQuery(sql, valores as never[])) as { rows: FilaConteo[] }
    return rows[0]!
}

const TAREAS: DefinicionTarea[] = [
    {
        clave: 'comprobantes_por_revisar',
        permiso: 'comprobantes.aprobar',
        async calcular({ c, empresas }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, coalesce(sum(monto), 0)::numeric(14,2)::text AS monto,
                        to_char(min((created_at AT TIME ZONE 'America/Guatemala')::date), 'YYYY-MM-DD') AS fecha
                   FROM billing.comprobantes WHERE estado = 'pendiente' AND empresa_id = ANY(?::bigint[])`,
                [empresas],
            )
            return { ...f, proveedores: null, urgencia: 'alta' }
        },
    },
    {
        clave: 'lineas_banco_sin_pareja',
        permiso: 'bancos.conciliar',
        async calcular({ c, empresas }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, NULL::text AS monto,
                        (SELECT to_char(max(x.fecha), 'YYYY-MM-DD') FROM ledger.extractos_lineas x
                          WHERE x.empresa_id = ANY(?::bigint[])) AS fecha
                   FROM ledger.extractos_lineas l
                  WHERE l.empresa_id = ANY(?::bigint[])
                    AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id
                        AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id))`,
                [empresas, empresas],
            )
            return { ...f, proveedores: null, urgencia: 'media' }
        },
    },
    {
        clave: 'depositos_en_camino',
        permiso: 'bancos.ver',
        async calcular({ c, empresas }) {
            const d = await depositosEnCamino(empresas, c)
            return {
                cantidad: d.cantidad,
                monto: d.monto,
                fecha: d.mas_viejo,
                proveedores: null,
                urgencia: 'media',
            }
        },
    },
    {
        clave: 'compras_por_revisar',
        permiso: 'compras.confirmar_borrador',
        async calcular({ c, empresas }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, NULL::text AS monto,
                        to_char(min((created_at AT TIME ZONE 'America/Guatemala')::date), 'YYYY-MM-DD') AS fecha
                   FROM inventario.compras_borradores WHERE estado = 'borrador' AND empresa_id = ANY(?::bigint[])`,
                [empresas],
            )
            return { ...f, proveedores: null, urgencia: 'media' }
        },
    },
    {
        clave: 'facturas_por_certificar',
        permiso: 'fel.certificar',
        async calcular({ c, empresas }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, coalesce(sum(total), 0)::numeric(14,2)::text AS monto,
                        to_char(min((created_at AT TIME ZONE 'America/Guatemala')::date), 'YYYY-MM-DD') AS fecha
                   FROM billing.facturas WHERE estado = 'por_certificar' AND empresa_id = ANY(?::bigint[])`,
                [empresas],
            )
            return { ...f, proveedores: null, urgencia: 'media' }
        },
    },
    {
        clave: 'asientos_por_aprobar',
        permiso: 'libro.aprobar_asiento',
        async calcular({ c, empresas }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, coalesce(sum(b.total), 0)::numeric(14,2)::text AS monto,
                        to_char(min((b.created_at AT TIME ZONE 'America/Guatemala')::date), 'YYYY-MM-DD') AS fecha
                   FROM billing.asientos_borradores b
                  WHERE b.empresa_id = ANY(?::bigint[])
                    AND NOT EXISTS (SELECT 1 FROM billing.asientos_borradores_decisiones d WHERE d.borrador_id = b.id)`,
                [empresas],
            )
            return { ...f, proveedores: null, urgencia: 'media' }
        },
    },
    {
        clave: 'compras_por_pagar',
        permiso: 'compras.pagar',
        async calcular({ c, empresas, hoy }) {
            const saldo = sqlSaldoCompra('k')
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, coalesce(sum(${saldo}), 0)::numeric(14,2)::text AS monto,
                        to_char(min(k.vence_en), 'YYYY-MM-DD') AS fecha,
                        count(DISTINCT k.proveedor_id)::int AS proveedores
                   FROM ledger.compras k
                  WHERE k.empresa_id = ANY(?::bigint[]) AND ${saldo} > 0
                    AND k.vence_en <= (?::date + ?::int)`,
                [empresas, hoy, DIAS_AVISO_COMPRAS],
            )
            const vencida = f.fecha !== null && f.fecha < hoy
            return { ...f, proveedores: f.proveedores ?? null, urgencia: vencida ? 'alta' : 'media' }
        },
    },
    {
        clave: 'obligaciones_proximas',
        permiso: 'declaraciones.ver',
        async calcular({ c, empresas, hoy }) {
            const f = await conteo(
                c,
                `SELECT count(*)::int AS cantidad, NULL::text AS monto,
                        to_char(min(vence_en), 'YYYY-MM-DD') AS fecha
                   FROM fiscal.obligaciones
                  WHERE empresa_id = ANY(?::bigint[]) AND estado IN ('pendiente', 'borrador')
                    AND vence_en <= (?::date + ?::int)`,
                [empresas, hoy, DIAS_AVISO_OBLIGACIONES],
            )
            const urgente = f.fecha !== null && diasHasta(hoy, f.fecha) <= 3
            return { ...f, proveedores: null, urgencia: urgente ? 'alta' : 'media' }
        },
    },
    {
        clave: 'turnos_abiertos_anteriores',
        permiso: 'cajas.cerrar',
        async calcular({ c, empresas, hoy, alcance }) {
            const consulta = c
                .from('ledger.cajas_turnos as t')
                .join('ledger.cajas as k', 'k.id', 't.caja_id')
                .whereIn('k.empresa_id', empresas)
                .whereNull('t.cerrado_en')
                .whereRaw(`(t.abierto_en AT TIME ZONE 'America/Guatemala')::date < ?::date`, [hoy])
                .select(
                    c.raw('count(*)::int as cantidad'),
                    c.raw(
                        `to_char(min((t.abierto_en AT TIME ZONE 'America/Guatemala')::date), 'YYYY-MM-DD') as fecha`,
                    ),
                )
            filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('k.id', ids) })
            const f = (await consulta.first()) as { cantidad: number; fecha: string | null }
            return {
                cantidad: Number(f.cantidad),
                monto: null,
                fecha: f.fecha,
                proveedores: null,
                urgencia: 'alta',
            }
        },
    },
]

async function tareasDeHoy(
    ctx: Contexto,
    permisos: ReadonlySet<string>,
): Promise<{ tareas: TareaInicio[]; fallos: FalloInicio[] }> {
    const tareas: TareaInicio[] = []
    const fallos: FalloInicio[] = []
    for (const def of TAREAS) {
        if (!permisos.has(def.permiso)) continue
        try {
            const r = await def.calcular(ctx)
            if (r && r.cantidad > 0) tareas.push({ clave: def.clave, permiso: def.permiso, ...r })
        } catch (error) {
            fallos.push({ clave: def.clave, error: problemaDe(error, `La tarea ${def.clave}`) })
        }
    }
    // lo más urgente arriba; a igual urgencia, el orden del catálogo
    tareas.sort((a, b) => URGENCIA_ORDEN[a.urgencia] - URGENCIA_ORDEN[b.urgencia])
    return { tareas, fallos }
}

/*
|--------------------------------------------------------------------------
| Pasos del mes
|--------------------------------------------------------------------------
*/

interface ResultadoPaso {
    estado: Exclude<EstadoPaso, 'error'>
    cantidad: number | null
    fecha: string | null
}

interface ContextoPaso extends Contexto {
    empresaId: number
    /** primer día del mes (YYYY-MM-01) */
    desde: string
    /** último día del mes */
    hasta: string
}

const PASOS: Array<{
    clave: string
    calcular: (p: ContextoPaso) => Promise<ResultadoPaso>
}> = [
    {
        clave: 'facturar',
        async calcular({ c, empresaId, desde }) {
            const corridas = await ultimasCorridas([empresaId])
            const corrida = corridas[0]?.procesos.find((p) => p.proceso === 'facturas.generar')
            const bloqueados = corrida?.bloqueados ?? 0
            const { rows } = (await c.rawQuery(
                `SELECT count(*)::int AS n FROM billing.facturas
                  WHERE empresa_id = ? AND periodo = ?::date AND estado <> 'anulada'`,
                [empresaId, desde],
            )) as { rows: Array<{ n: number }> }
            const facturas = Number(rows[0]!.n)
            if (bloqueados > 0) return { estado: 'pendiente', cantidad: bloqueados, fecha: null }
            const corrio = (corrida?.corrida_en ?? null) !== null && (corrida?.hasta ?? '') >= desde
            if (corrio || facturas > 0) return { estado: 'listo', cantidad: facturas, fecha: null }
            const { rows: servicios } = (await c.rawQuery(
                `SELECT count(*)::int AS n FROM core.servicios
                  WHERE empresa_id = ? AND estado IN ('activo', 'limitado', 'suspendido')`,
                [empresaId],
            )) as { rows: Array<{ n: number }> }
            return Number(servicios[0]!.n) > 0
                ? { estado: 'pendiente', cantidad: null, fecha: null }
                : { estado: 'sin_datos', cantidad: null, fecha: null }
        },
    },
    {
        clave: 'cobrar_y_cerrar_cajas',
        async calcular({ c, empresaId, hoy }) {
            const { rows } = (await c.rawQuery(
                `SELECT count(DISTINCT k.id)::int AS cajas,
                        count(t.id) FILTER (WHERE t.cerrado_en IS NULL
                            AND (t.abierto_en AT TIME ZONE 'America/Guatemala')::date < ?::date)::int AS abiertos,
                        to_char(min((t.abierto_en AT TIME ZONE 'America/Guatemala')::date)
                            FILTER (WHERE t.cerrado_en IS NULL), 'YYYY-MM-DD') AS fecha
                   FROM ledger.cajas k LEFT JOIN ledger.cajas_turnos t ON t.caja_id = k.id
                  WHERE k.empresa_id = ?`,
                [hoy, empresaId],
            )) as { rows: Array<{ cajas: number; abiertos: number; fecha: string | null }> }
            const f = rows[0]!
            if (Number(f.cajas) === 0) return { estado: 'sin_datos', cantidad: null, fecha: null }
            return Number(f.abiertos) > 0
                ? { estado: 'pendiente', cantidad: Number(f.abiertos), fecha: f.fecha }
                : { estado: 'listo', cantidad: 0, fecha: null }
        },
    },
    {
        clave: 'compras_y_gastos',
        async calcular({ c, empresaId, desde, hasta }) {
            const { rows } = (await c.rawQuery(
                `SELECT (SELECT count(*)::int FROM inventario.compras_borradores
                          WHERE empresa_id = ? AND estado = 'borrador') AS borradores,
                        (SELECT count(*)::int FROM ledger.compras
                          WHERE empresa_id = ? AND fecha BETWEEN ?::date AND ?::date) AS compras,
                        (SELECT count(*)::int FROM ledger.egresos e
                           JOIN ledger.cajas k ON k.id = e.caja_id
                          WHERE k.empresa_id = ? AND e.fecha BETWEEN ?::date AND ?::date) AS egresos`,
                [empresaId, empresaId, desde, hasta, empresaId, desde, hasta],
            )) as { rows: Array<{ borradores: number; compras: number; egresos: number }> }
            const f = rows[0]!
            if (Number(f.borradores) > 0) {
                return { estado: 'pendiente', cantidad: Number(f.borradores), fecha: null }
            }
            const registrados = Number(f.compras) + Number(f.egresos)
            return registrados > 0
                ? { estado: 'listo', cantidad: registrados, fecha: null }
                : { estado: 'sin_datos', cantidad: null, fecha: null }
        },
    },
    {
        clave: 'conciliar_bancos',
        async calcular({ c, empresaId, desde, hasta }) {
            const { rows } = (await c.rawQuery(
                `SELECT count(*)::int AS lineas,
                        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id
                            AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id))
                            )::int AS sin_pareja,
                        to_char(max(l.fecha), 'YYYY-MM-DD') AS fecha
                   FROM ledger.extractos_lineas l
                  WHERE l.empresa_id = ? AND l.fecha <= ?::date`,
                [empresaId, hasta],
            )) as { rows: Array<{ lineas: number; sin_pareja: number; fecha: string | null }> }
            const f = rows[0]!
            if (Number(f.sin_pareja) > 0) {
                return { estado: 'pendiente', cantidad: Number(f.sin_pareja), fecha: f.fecha }
            }
            const { rows: delMes } = (await c.rawQuery(
                `SELECT count(*)::int AS n FROM ledger.extractos_lineas
                  WHERE empresa_id = ? AND fecha BETWEEN ?::date AND ?::date`,
                [empresaId, desde, hasta],
            )) as { rows: Array<{ n: number }> }
            return Number(delMes[0]!.n) > 0
                ? { estado: 'listo', cantidad: 0, fecha: f.fecha }
                : { estado: 'sin_datos', cantidad: null, fecha: f.fecha }
        },
    },
    {
        clave: 'revisar_el_mes',
        async calcular({ c, empresaId, desde }) {
            const esperados = checksAutomaticosDelTipo('mensual')
            const vigentes = await checksVigentes(c, empresaId, 'mensual', desde)
            const fallan = esperados.filter((d) => {
                const v = vigentes.find((x) => x.clave === d.clave)
                return !v || !checkPasa(v)
            })
            return fallan.length > 0
                ? { estado: 'pendiente', cantidad: fallan.length, fecha: null }
                : { estado: 'listo', cantidad: esperados.length, fecha: null }
        },
    },
    {
        clave: 'declarar_impuestos',
        async calcular({ c, empresaId, desde }) {
            const filas = (await c
                .from('fiscal.obligaciones')
                .where('empresa_id', empresaId)
                .where('periodo_desde', desde)
                .whereNot('estado', 'no_aplica')
                .select('estado', c.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`))) as Array<{
                estado: string
                vence_en: string
            }>
            if (filas.length === 0) return { estado: 'sin_datos', cantidad: null, fecha: null }
            const abiertas = filas.filter((f) => f.estado === 'pendiente' || f.estado === 'borrador')
            if (abiertas.length === 0) return { estado: 'listo', cantidad: filas.length, fecha: null }
            return {
                estado: 'pendiente',
                cantidad: abiertas.length,
                fecha: abiertas.map((f) => f.vence_en).sort()[0]!,
            }
        },
    },
    {
        clave: 'cerrar_el_mes',
        async calcular({ c, empresaId, desde }) {
            const cerrado = await periodoCerrado(c, desde, empresaId)
            return { estado: cerrado ? 'listo' : 'pendiente', cantidad: null, fecha: null }
        },
    },
]

const PRIORIDAD_ESTADO: EstadoPaso[] = ['pendiente', 'listo', 'sin_datos']

/** Une el estado de un paso en varias empresas: pendiente si alguna lo está; listo si alguna lo hizo; si no, sin datos. */
function unirPaso(resultados: ResultadoPaso[]): ResultadoPaso {
    const estado = PRIORIDAD_ESTADO.find((e) => resultados.some((r) => r.estado === e)) ?? 'sin_datos'
    const delEstado = resultados.filter((r) => r.estado === estado)
    const cantidades = delEstado.map((r) => r.cantidad).filter((n): n is number => n !== null)
    const fechas = delEstado.map((r) => r.fecha).filter((f): f is string => f !== null)
    return {
        estado: estado as ResultadoPaso['estado'],
        cantidad: cantidades.length > 0 ? cantidades.reduce((s, n) => s + n, 0) : null,
        fecha: fechas.length > 0 ? fechas.sort()[0]! : null,
    }
}

async function pasosDelMes(ctx: Contexto, periodo: string): Promise<PasoInicio[]> {
    const desde = `${periodo}-01`
    const hasta = DateTime.fromISO(desde, { zone: 'utc' }).endOf('month').toISODate()!
    const salida: PasoInicio[] = []
    let numero = 0
    for (const def of PASOS) {
        numero += 1
        try {
            const resultados: ResultadoPaso[] = []
            for (const empresaId of ctx.empresas) {
                resultados.push(await def.calcular({ ...ctx, empresaId, desde, hasta }))
            }
            const r = unirPaso(resultados)
            salida.push({ numero, clave: def.clave, ...r, error: null })
        } catch (error) {
            salida.push({
                numero,
                clave: def.clave,
                estado: 'error',
                cantidad: null,
                fecha: null,
                error: problemaDe(error, `El paso ${def.clave}`),
            })
        }
    }
    return salida
}

/*
|--------------------------------------------------------------------------
| Indicadores
|--------------------------------------------------------------------------
*/

function indicador(parcial: Partial<IndicadorInicio> & Pick<IndicadorInicio, 'estado'>): IndicadorInicio {
    return {
        valor: null,
        cantidad: null,
        monto_alerta: null,
        fecha: null,
        permiso: null,
        error: null,
        ...parcial,
    }
}

async function existe(c: QueryClientContract, tabla: string, empresas: number[]): Promise<boolean> {
    const { rows } = (await c.rawQuery(
        `SELECT EXISTS (SELECT 1 FROM ${tabla} WHERE empresa_id = ANY(?::bigint[])) AS hay`,
        [empresas],
    )) as { rows: Array<{ hay: boolean }> }
    return Boolean(rows[0]!.hay)
}

async function conPermiso(
    permisos: ReadonlySet<string>,
    permiso: string,
    nombre: string,
    calcular: () => Promise<IndicadorInicio>,
): Promise<IndicadorInicio> {
    if (!permisos.has(permiso)) return indicador({ estado: 'sin_permiso', permiso })
    try {
        return await calcular()
    } catch (error) {
        return indicador({ estado: 'error', error: problemaDe(error, `El indicador ${nombre}`) })
    }
}

async function teDeben(ctx: Contexto): Promise<IndicadorInicio> {
    if (!(await existe(ctx.c, 'billing.facturas', ctx.empresas))) return indicador({ estado: 'sin_datos' })
    const reporte = await carteraVencida({}, ctx.alcance, { empresas: ctx.empresas, consolidado: false })
    const total = dec(String(reporte.totales.total ?? '0'))
    const m61 = dec(String(reporte.totales.dias_61_90 ?? '0'))
    const m90 = dec(String(reporte.totales.dias_mas_90 ?? '0'))
    const masDe60 = m61.plus(m90)
    // Conteo de facturas (no es dinero)
    const { facturas: numFacturas } = reporte.totales
    return indicador({
        estado: m90.gt(0) ? 'urgente' : masDe60.gt(0) ? 'atencion' : 'bien',
        valor: aTexto(total),
        cantidad: Number(numFacturas ?? 0),
        monto_alerta: aTexto(masDe60),
    })
}

async function debesAProveedores(ctx: Contexto): Promise<IndicadorInicio> {
    if (!(await existe(ctx.c, 'ledger.compras', ctx.empresas))) return indicador({ estado: 'sin_datos' })
    const reporte = await cuentasPorPagar({}, ctx.empresas, false)
    const vencido = dec(String(reporte.totales.vencido ?? '0'))
    // Conteo de compras (no es dinero)
    const { compras: numCompras } = reporte.totales
    return indicador({
        estado: vencido.gt(0) ? 'atencion' : 'bien',
        valor: aTexto(String(reporte.totales.total ?? '0')),
        cantidad: Number(numCompras ?? 0),
        monto_alerta: aTexto(vencido),
    })
}

async function dineroDisponible(ctx: Contexto): Promise<IndicadorInicio> {
    const porEmpresa = await efectivoDisponible(ctx.empresas, new Date(), ctx.c)
    if (porEmpresa.size === 0) return indicador({ estado: 'sin_datos' })
    let total: Dec = CERO
    let cuentas = 0
    for (const e of porEmpresa.values()) {
        total = total.plus(dec(e.total))
        cuentas += e.cuentas.length
    }
    return indicador({
        estado: total.isNegative() ? 'urgente' : total.isZero() ? 'atencion' : 'bien',
        valor: aTexto(total),
        cantidad: cuentas,
    })
}

async function impuestosDelMes(ctx: Contexto, periodo: string): Promise<IndicadorInicio> {
    const desde = `${periodo}-01`
    let total: Dec = CERO
    let con = 0
    const vencimientos: string[] = []
    for (const empresaId of ctx.empresas) {
        const impuesto = await impuestoDelMes(ctx.c, empresaId, desde)
        if (!impuesto) continue
        const obligacion = (await ctx.c
            .from('fiscal.obligaciones')
            .where({ empresa_id: empresaId, impuesto, periodo_desde: desde })
            .select('estado', ctx.c.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`))
            .first()) as { estado: string; vence_en: string } | null
        const presentada = (await ctx.c
            .from('fiscal.declaraciones')
            .where({ empresa_id: empresaId, impuesto, periodo_desde: desde, estado: 'presentada' })
            .orderBy('version', 'desc')
            .select('totales')
            .first()) as { totales: Record<string, string> } | null
        // lo ya presentado es lo que se declaró; si no, el borrador con los datos de hoy
        const datos = presentada ? null : await calcularDatos(ctx.c, empresaId, impuesto, desde)
        const aPagar = dec((presentada?.totales ?? datos?.totales)?.a_pagar ?? '0')
        total = total.plus(aPagar)
        con += 1
        if (obligacion && obligacion.estado !== 'presentada') vencimientos.push(obligacion.vence_en)
    }
    if (con === 0) return indicador({ estado: 'sin_datos' })
    const vence = vencimientos.sort()[0] ?? null
    const pronto = vence !== null && diasHasta(hoyGuatemala(), vence) <= DIAS_AVISO_OBLIGACIONES
    return indicador({
        estado: total.gt(0) && pronto ? 'atencion' : 'bien',
        valor: aTexto(total),
        fecha: vence,
    })
}

/*
|--------------------------------------------------------------------------
| Lectura completa
|--------------------------------------------------------------------------
*/

export async function inicioContabilidad(opciones: OpcionesInicio): Promise<InicioContabilidad> {
    const c = db.connection()
    const ahora = opciones.ahora ?? new Date()
    const hoy = hoyGuatemala(ahora)
    const periodo =
        opciones.periodo && opciones.periodo <= hoy.slice(0, 7) ? opciones.periodo : hoy.slice(0, 7)
    const empresas = (await c
        .from('core.empresas')
        .where('activa', true)
        .if(opciones.empresas !== null, (q) => q.whereIn('id', opciones.empresas!))
        .orderBy('id', 'asc')
        .select('id', 'nombre_comercial')) as Array<{ id: number; nombre_comercial: string }>
    const ids = empresas.map((e) => Number(e.id))
    const ctx: Contexto = { c, empresas: ids, hoy, alcance: opciones.alcance }
    const permisos = opciones.permisos

    const { tareas, fallos } = await tareasDeHoy(ctx, permisos)
    const pasos = await pasosDelMes(ctx, periodo)
    const indicadores = {
        te_deben: await conPermiso(permisos, 'reportes.ver', 'te_deben', () => teDeben(ctx)),
        debes_proveedores: await conPermiso(permisos, 'compras.ver', 'debes_proveedores', () =>
            debesAProveedores(ctx),
        ),
        dinero_disponible: await conPermiso(permisos, 'libro.ver', 'dinero_disponible', () =>
            dineroDisponible(ctx),
        ),
        impuestos_mes: await conPermiso(permisos, 'declaraciones.ver', 'impuestos_mes', () =>
            impuestosDelMes(ctx, periodo),
        ),
    }
    return {
        hoy,
        periodo,
        generado_en: ahora.toISOString(),
        empresas: empresas.map((e) => ({ id: Number(e.id), nombre: e.nombre_comercial })),
        consolidado: opciones.consolidado || ids.length > 1,
        pendientes: tareas.reduce((s, t) => s + t.cantidad, 0),
        tareas,
        tareas_con_error: fallos,
        pasos,
        paso_actual: pasos.find((p) => p.estado === 'pendiente')?.numero ?? null,
        indicadores,
    }
}
