import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { CERO, aTexto, dec, redondear } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { valorParametro } from '#fiscal/parametros'
import { LocalizacionNoInstalada } from '#fiscal/errores'
import { carteraVencida } from '#billing/reportes/reportes'
import { cuentasPorPagar } from '#ledger/pagos_proveedores'
import { resumenFondosEnTransito } from '#ledger/transitos'
import { resumenCobrosPorLiquidar } from '#ledger/cobros_liquidar'
import { verificarCadena } from '#ledger/sellos'
import { ivaPorCertificarDe } from '#billing/fel_facturas'

/**
 * Lista de verificación de cierre (contrato de localización fiscal §10.5). Cada check automático
 * compara un `esperado` con un `obtenido` y da `ok` o `anomalia`; `cierres.verificar` los corre y
 * guarda en `ledger.cierres_checks` (solo inserción; el vigente de cada clave es su última fila).
 *
 * - Mensuales (`periodo` = primer día del mes): cxc_antiguedad, cxc_auxiliar, cxp_antiguedad,
 *   apertura_cero, iva_por_certificar, turnos_cerrados, fondos_transito, cobros_por_liquidar,
 *   extractos_conciliados, dte_pendientes, por_certificar (aviso: nunca bloquea),
 *   compras_sin_periodo, secuencias_sin_huecos, hash_verificado, depreciacion_al_dia.
 * - Anuales (`periodo` = 1 de enero): incobrables. `resultados_cero` y `comprobacion_cuadra`
 *   llegan con el cierre anual (PR C); los de `impuestos` (iva_cuadrado, iva_liquidado), con las
 *   declaraciones (fase 7).
 * - Los que comparan saldos con documentos (cartera, proveedores, 2.1.11, tránsito, cobros por
 *   liquidar) miran el estado al verificar, como los reportes que comparan; los demás, el periodo.
 */

export const TIPOS_CHECK = ['mensual', 'impuestos', 'anual'] as const
export type TipoCheck = (typeof TIPOS_CHECK)[number]
export type ResultadoCheck = 'ok' | 'anomalia'
export type EstadoCheck = 'revisado' | 'anomalia' | 'supervisado'

export interface DefinicionCheck {
    clave: string
    tipo: TipoCheck
    titulo: string
    /** un aviso nunca bloquea (resultado siempre ok, con el conteo en `obtenido`) */
    aviso?: boolean
}

export const CHECKS: readonly DefinicionCheck[] = [
    { clave: 'cxc_antiguedad', tipo: 'mensual', titulo: 'Antigüedad de cartera = saldo de 1.1.03' },
    {
        clave: 'cxc_auxiliar',
        tipo: 'mensual',
        titulo: 'Auxiliar de clientes = 1.1.03 y 2.1.01 (sin partidas sin cliente)',
    },
    { clave: 'cxp_antiguedad', tipo: 'mensual', titulo: 'Antigüedad de proveedores = saldo de 2.1.03' },
    { clave: 'apertura_cero', tipo: 'mensual', titulo: '2.9.01 Saldos de apertura en cero' },
    {
        clave: 'iva_por_certificar',
        tipo: 'mensual',
        titulo: '2.1.11 = IVA de los avisos sin DTE certificado',
    },
    { clave: 'turnos_cerrados', tipo: 'mensual', titulo: 'Ningún turno de caja abierto del periodo' },
    { clave: 'fondos_transito', tipo: 'mensual', titulo: '1.1.11 = depósitos y traslados sin conciliar' },
    { clave: 'cobros_por_liquidar', tipo: 'mensual', titulo: 'Cobros por liquidar al día y cuadrados' },
    { clave: 'extractos_conciliados', tipo: 'mensual', titulo: 'Líneas de extracto del periodo conciliadas' },
    {
        clave: 'dte_pendientes',
        tipo: 'mensual',
        titulo: 'Ningún DTE pendiente, enviando o en contingencia del periodo',
    },
    {
        clave: 'por_certificar',
        tipo: 'mensual',
        titulo: 'Facturas por certificar del periodo (aviso)',
        aviso: true,
    },
    { clave: 'compras_sin_periodo', tipo: 'mensual', titulo: 'Compras sin periodo del IVA' },
    {
        clave: 'secuencias_sin_huecos',
        tipo: 'mensual',
        titulo: 'Numeración de los diarios sin huecos en el año',
    },
    {
        clave: 'hash_verificado',
        tipo: 'mensual',
        titulo: 'Cadena de hash verificada hasta el fin del periodo',
    },
    {
        clave: 'depreciacion_al_dia',
        tipo: 'mensual',
        titulo: 'Cuotas de activos y diferidos del periodo contabilizadas',
    },
    { clave: 'incobrables', tipo: 'anual', titulo: 'Estimación de incobrables (1.1.12) dentro del tope' },
]

export function checksDelTipo(tipo: TipoCheck): readonly DefinicionCheck[] {
    return CHECKS.filter((c) => c.tipo === tipo)
}

export interface CheckCalculado {
    clave: string
    esperado: string
    obtenido: string
    resultado: ResultadoCheck
    detalle: Record<string, unknown> | null
}

/** Periodo del check: `YYYY-MM` (mensual, impuestos) o `YYYY` (anual) → primer día. */
export function periodoDeCheck(tipo: TipoCheck, texto: string): string {
    const anual = tipo === 'anual'
    const valido = anual ? /^\d{4}$/.test(texto) : /^\d{4}-(0[1-9]|1[0-2])$/.test(texto)
    if (!valido) {
        throw new ValidacionFallida([
            {
                field: 'periodo',
                message: anual ? 'El periodo anual es AAAA' : 'El periodo es AAAA-MM',
                rule: 'periodo',
            },
        ])
    }
    return anual ? `${texto}-01-01` : `${texto}-01`
}

export function finDePeriodo(tipo: TipoCheck, periodo: string): string {
    const inicio = DateTime.fromISO(periodo, { zone: 'utc' })
    return (tipo === 'anual' ? inicio.endOf('year') : inicio.endOf('month')).toISODate()!
}

export function textoPeriodo(tipo: TipoCheck, periodo: string): string {
    return tipo === 'anual' ? periodo.slice(0, 4) : periodo.slice(0, 7)
}

const igual = (esperado: string, obtenido: string): ResultadoCheck =>
    esperado === obtenido ? 'ok' : 'anomalia'

async function saldoCuenta(c: QueryClientContract, empresaId: number, codigo: string, hasta?: string) {
    const fila = (await c
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as cu', 'cu.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where((q) => q.where('cu.codigo', codigo).orWhere('cu.codigo', 'like', `${codigo}.%`))
        .if(hasta, (q) => q.where('a.fecha', '<=', hasta!))
        .select(c.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
        .first()) as { saldo: string }
    return dec(fila.saldo)
}

async function contar(c: QueryClientContract, sql: string, valores: Array<string | number>): Promise<number> {
    const { rows } = (await c.rawQuery(sql, valores)) as { rows: Array<{ n: number }> }
    return Number(rows[0]?.n ?? 0)
}

type Calculo = (
    c: QueryClientContract,
    empresaId: number,
    periodo: string,
    fin: string,
) => Promise<CheckCalculado>

const CALCULOS: Record<string, Calculo> = {
    async cxc_antiguedad(c, empresaId) {
        const cartera = await carteraVencida({}, undefined, { empresas: [empresaId], consolidado: false })
        const esperado = aTexto(await saldoCuenta(c, empresaId, CUENTAS.CXC_CLIENTES))
        const obtenido = aTexto(String(cartera.totales.total ?? '0'))
        return {
            clave: 'cxc_antiguedad',
            esperado,
            obtenido,
            resultado: igual(esperado, obtenido),
            detalle: null,
        }
    },

    async cxc_auxiliar(c, empresaId, _p, fin) {
        const n = await contar(
            c,
            `SELECT count(*)::int AS n FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
              WHERE a.empresa_id = ? AND a.fecha <= ?::date AND m.cliente_id IS NULL
                AND (cu.codigo LIKE ? OR cu.codigo LIKE ?)`,
            [empresaId, fin, `${CUENTAS.CXC_CLIENTES}%`, `${CUENTAS.ANTICIPOS_CLIENTES}%`],
        )
        return {
            clave: 'cxc_auxiliar',
            esperado: '0',
            obtenido: String(n),
            resultado: n === 0 ? 'ok' : 'anomalia',
            detalle: { partidas_sin_cliente: n },
        }
    },

    async cxp_antiguedad(c, empresaId) {
        const cxp = await cuentasPorPagar({}, [empresaId], false)
        const saldo = await saldoCuenta(c, empresaId, CUENTAS_GT.PROVEEDORES)
        const esperado = aTexto(saldo.negated())
        const obtenido = aTexto(String(cxp.totales.total ?? '0'))
        return {
            clave: 'cxp_antiguedad',
            esperado,
            obtenido,
            resultado: igual(esperado, obtenido),
            detalle: null,
        }
    },

    async apertura_cero(c, empresaId, _p, fin) {
        const obtenido = aTexto(await saldoCuenta(c, empresaId, '2.9.01', fin))
        return {
            clave: 'apertura_cero',
            esperado: '0.00',
            obtenido,
            resultado: igual('0.00', obtenido),
            detalle: null,
        }
    },

    async iva_por_certificar(c, empresaId) {
        const avisos = (await c
            .from('billing.facturas as f')
            .where('f.empresa_id', empresaId)
            .where('f.aviso_cobro', true)
            .whereNotExists((q) =>
                q
                    .from('fiscal.dte as d')
                    .whereRaw(`d.documento_tipo IN ('factura', 'nota_debito') AND d.documento_id = f.id`)
                    .where('d.estado', 'certificado'),
            )
            .select('f.id')) as Array<{ id: number }>
        let suma = CERO
        for (const a of avisos) suma = suma.plus(await ivaPorCertificarDe(c, Number(a.id)))
        const esperado = aTexto(suma)
        const saldo = await saldoCuenta(c, empresaId, CUENTAS_GT.IVA_POR_CERTIFICAR)
        const obtenido = aTexto(saldo.negated())
        return {
            clave: 'iva_por_certificar',
            esperado,
            obtenido,
            resultado: igual(esperado, obtenido),
            detalle: { avisos: avisos.length },
        }
    },

    async turnos_cerrados(c, empresaId, inicio, fin) {
        // §10.5: turnos abiertos «con fecha del periodo» (abiertos en el mes, hora de Guatemala); uno
        // de un mes anterior ya lo señaló el cierre de ese mes
        const filas = (await c.rawQuery(
            `SELECT t.id FROM ledger.cajas_turnos t JOIN ledger.cajas k ON k.id = t.caja_id
              WHERE k.empresa_id = ? AND t.cerrado_en IS NULL
                AND (t.abierto_en AT TIME ZONE 'America/Guatemala')::date BETWEEN ?::date AND ?::date
              ORDER BY t.id`,
            [empresaId, inicio, fin],
        )) as { rows: Array<{ id: string | number }> }
        const turnos = filas.rows.map((f) => Number(f.id))
        return {
            clave: 'turnos_cerrados',
            esperado: '0',
            obtenido: String(turnos.length),
            resultado: turnos.length === 0 ? 'ok' : 'anomalia',
            detalle: turnos.length > 0 ? { turnos: turnos.slice(0, 20) } : null,
        }
    },

    async fondos_transito(c, empresaId) {
        const [r] = await resumenFondosEnTransito([empresaId], c)
        const esperado = r?.pendiente ?? '0.00'
        const obtenido = r?.saldo_libro ?? '0.00'
        return {
            clave: 'fondos_transito',
            esperado,
            obtenido,
            resultado: igual(esperado, obtenido),
            detalle: null,
        }
    },

    async cobros_por_liquidar(c, empresaId) {
        const proveedores = await resumenCobrosPorLiquidar([empresaId], c)
        const descuadrados = proveedores.filter((p) => !p.cuadra).map((p) => p.codigo)
        const viejos = proveedores.reduce((s, p) => s + p.anomalias.length, 0)
        return {
            clave: 'cobros_por_liquidar',
            esperado: '0',
            obtenido: String(descuadrados.length + viejos),
            resultado: descuadrados.length === 0 && viejos === 0 ? 'ok' : 'anomalia',
            detalle: { descuadrados, pagos_vencidos: viejos },
        }
    },

    async extractos_conciliados(c, empresaId, periodo, fin) {
        const n = await contar(
            c,
            `SELECT count(*)::int AS n FROM ledger.extractos_lineas l
              WHERE l.empresa_id = ? AND l.fecha BETWEEN ?::date AND ?::date
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id
                    AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id))`,
            [empresaId, periodo, fin],
        )
        return {
            clave: 'extractos_conciliados',
            esperado: '0',
            obtenido: String(n),
            resultado: n === 0 ? 'ok' : 'anomalia',
            detalle: null,
        }
    },

    async dte_pendientes(c, empresaId, periodo, fin) {
        const n = await contar(
            c,
            `SELECT count(*)::int AS n FROM fiscal.dte d
              WHERE d.empresa_id = ? AND d.estado IN ('pendiente', 'enviando', 'error_temporal', 'contingencia')
                AND (d.fecha_emision AT TIME ZONE 'America/Guatemala')::date BETWEEN ?::date AND ?::date`,
            [empresaId, periodo, fin],
        )
        return {
            clave: 'dte_pendientes',
            esperado: '0',
            obtenido: String(n),
            resultado: n === 0 ? 'ok' : 'anomalia',
            detalle: null,
        }
    },

    async por_certificar(c, empresaId, periodo, fin) {
        const n = await contar(
            c,
            `SELECT count(*)::int AS n FROM billing.facturas f
              WHERE f.empresa_id = ? AND f.estado = 'por_certificar'
                AND (f.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN ?::date AND ?::date`,
            [empresaId, periodo, fin],
        )
        // aviso: nunca bloquea
        return {
            clave: 'por_certificar',
            esperado: '0',
            obtenido: String(n),
            resultado: 'ok',
            detalle: { aviso: n > 0 },
        }
    },

    async compras_sin_periodo(c, empresaId, periodo, fin) {
        // ledger.compras.periodo_iva es obligatorio (NOT NULL): el check confirma que ninguna lo perdió
        const n = await contar(
            c,
            `SELECT count(*)::int AS n FROM ledger.compras x
              WHERE x.empresa_id = ? AND x.fecha BETWEEN ?::date AND ?::date AND x.periodo_iva IS NULL`,
            [empresaId, periodo, fin],
        )
        return {
            clave: 'compras_sin_periodo',
            esperado: '0',
            obtenido: String(n),
            resultado: n === 0 ? 'ok' : 'anomalia',
            detalle: null,
        }
    },

    async secuencias_sin_huecos(c, empresaId, periodo) {
        const anio = Number(periodo.slice(0, 4))
        const { rows } = (await c.rawQuery(
            `SELECT d.codigo, count(n.numero)::int AS asientos, coalesce(max(n.numero), 0)::int AS ultimo,
                    coalesce((SELECT s.ultimo FROM ledger.secuencias s WHERE s.diario_id = d.id AND s.anio = ?), 0)::int AS secuencia
               FROM ledger.diarios d
               LEFT JOIN ledger.asientos_numeros n ON n.diario_id = d.id AND n.anio = ?
              WHERE d.empresa_id = ?
              GROUP BY d.id, d.codigo`,
            [anio, anio, empresaId],
        )) as { rows: Array<{ codigo: string; asientos: number; ultimo: number; secuencia: number }> }
        const huecos = rows
            .filter((r) => r.asientos !== r.ultimo || r.ultimo !== r.secuencia)
            .map((r) => r.codigo)
        return {
            clave: 'secuencias_sin_huecos',
            esperado: '0',
            obtenido: String(huecos.length),
            resultado: huecos.length === 0 ? 'ok' : 'anomalia',
            detalle: { diarios: huecos },
        }
    },

    async hash_verificado(c, empresaId, _p, fin) {
        const integridad = await verificarCadena(empresaId, { hasta: fin }, c)
        const ok = !integridad.ruptura && integridad.sin_sellar === 0
        return {
            clave: 'hash_verificado',
            esperado: 'verificada',
            obtenido: integridad.ruptura
                ? `rota en el sello ${integridad.ruptura.sello}`
                : integridad.sin_sellar > 0
                  ? `${integridad.sin_sellar} sin sellar`
                  : 'verificada',
            resultado: ok ? 'ok' : 'anomalia',
            detalle: { ultimo_sello: integridad.ultimo_sello, ruptura: integridad.ruptura },
        }
    },

    async depreciacion_al_dia(c, empresaId, periodo) {
        const activos = await contar(
            c,
            `SELECT count(*)::int AS n FROM ledger.activos x
              WHERE x.empresa_id = ? AND x.inicio_depreciacion <= ?::date
                AND NOT EXISTS (SELECT 1 FROM ledger.activos_bajas b WHERE b.activo_id = x.id
                                 AND b.fecha < (?::date + interval '1 month'))
                AND NOT EXISTS (SELECT 1 FROM ledger.activos_cuotas q WHERE q.activo_id = x.id AND q.mes = ?::date)
                AND x.depreciacion_inicial + coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q
                                                        WHERE q.activo_id = x.id AND q.mes < ?::date), 0)
                    < x.costo - x.valor_residual`,
            [empresaId, periodo, periodo, periodo, periodo],
        )
        const diferidos = await contar(
            c,
            `SELECT count(*)::int AS n FROM ledger.diferimientos x
              WHERE x.empresa_id = ? AND x.inicio <= ?::date
                AND ?::date < (x.inicio + make_interval(months => x.meses))
                AND NOT EXISTS (SELECT 1 FROM ledger.diferimientos_cancelaciones k WHERE k.diferimiento_id = x.id)
                AND NOT EXISTS (SELECT 1 FROM ledger.diferimientos_cuotas q WHERE q.diferimiento_id = x.id AND q.mes = ?::date)`,
            [empresaId, periodo, periodo, periodo],
        )
        return {
            clave: 'depreciacion_al_dia',
            esperado: '0',
            obtenido: String(activos + diferidos),
            resultado: activos + diferidos === 0 ? 'ok' : 'anomalia',
            detalle: { activos_sin_cuota: activos, diferidos_sin_cuota: diferidos },
        }
    },

    async incobrables(c, empresaId, _p, fin) {
        const base = (await c.rawQuery(
            `SELECT coalesce(sum(s), 0)::text AS base FROM (
                 SELECT m.cliente_id, sum(m.debe - m.haber) AS s
                   FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                   JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
                  WHERE cu.codigo = ? AND a.empresa_id = ? AND a.fecha <= ?::date
                  GROUP BY m.cliente_id
             ) x WHERE s > 0`,
            [CUENTAS.CXC_CLIENTES, empresaId, fin],
        )) as { rows: Array<{ base: string }> }
        const saldoEstimacion = await saldoCuenta(c, empresaId, CUENTAS_GT.ESTIMACION_INCOBRABLES, fin)
        const estimacion = saldoEstimacion.negated()
        let valor: unknown
        try {
            valor = await valorParametro<string>(empresaId, 'reserva_incobrables_max', fin, c)
        } catch (error) {
            if (!(error instanceof LocalizacionNoInstalada)) throw error
            // sin localización no hay tope: solo pasa si no hay estimación que medir
            return {
                clave: 'incobrables',
                esperado: '0.00 (sin localización fiscal instalada)',
                obtenido: aTexto(estimacion),
                resultado: estimacion.isZero() ? 'ok' : 'anomalia',
                detalle: { base: aTexto(base.rows[0]!.base), sin_localizacion: true },
            }
        }
        const porcentaje = dec(String(valor))
        const tope = redondear(dec(base.rows[0]!.base).times(porcentaje).div(100))
        return {
            clave: 'incobrables',
            esperado: `<= ${aTexto(tope)}`,
            obtenido: aTexto(estimacion),
            resultado: estimacion.lte(tope) ? 'ok' : 'anomalia',
            detalle: {
                base: aTexto(base.rows[0]!.base),
                porcentaje: porcentaje.toString(),
                tope: aTexto(tope),
            },
        }
    },
}

/** Corre los checks automáticos del tipo (sin escribir). */
export async function calcularChecks(
    c: QueryClientContract,
    empresaId: number,
    tipo: TipoCheck,
    periodo: string,
): Promise<CheckCalculado[]> {
    const fin = finDePeriodo(tipo, periodo)
    const salida: CheckCalculado[] = []
    for (const def of checksDelTipo(tipo)) {
        const calculo = CALCULOS[def.clave]
        if (calculo) salida.push(await calculo(c, empresaId, periodo, fin))
    }
    return salida
}

/*
|--------------------------------------------------------------------------
| Estado vigente y exigencia
|--------------------------------------------------------------------------
*/

export interface CheckVista {
    id: number
    empresa_id: number
    tipo: TipoCheck
    periodo: string
    clave: string
    titulo: string
    aviso: boolean
    automatico: boolean
    esperado: string | null
    obtenido: string | null
    resultado: ResultadoCheck
    estado: EstadoCheck
    nota: string | null
    detalle: Record<string, unknown> | null
    revisado_por: number | null
    revisado_por_nombre: string | null
    created_at: Date
}

function consultaChecks(c: QueryClientContract) {
    return c
        .from('ledger.cierres_checks as k')
        .leftJoin('core.usuarios as u', 'u.id', 'k.revisado_por')
        .select(
            'k.id',
            'k.empresa_id',
            'k.tipo',
            c.raw(`to_char(k.periodo, 'YYYY-MM-DD') as periodo`),
            'k.clave',
            'k.automatico',
            'k.valor_esperado as esperado',
            'k.valor_obtenido as obtenido',
            'k.resultado',
            'k.estado',
            'k.nota',
            'k.detalle',
            'k.revisado_por',
            'u.nombre as revisado_por_nombre',
            'k.created_at',
        )
}

function normalizar(f: CheckVista): CheckVista {
    const def = CHECKS.find((d) => d.clave === f.clave)
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        revisado_por: f.revisado_por === null ? null : Number(f.revisado_por),
        titulo: def?.titulo ?? f.clave,
        aviso: Boolean(def?.aviso),
    }
}

export async function verCheck(
    id: number,
    c: QueryClientContract = db.connection(),
): Promise<CheckVista | null> {
    const fila = (await consultaChecks(c).where('k.id', id).first()) as CheckVista | null
    return fila ? normalizar(fila) : null
}

/** Última fila de cada clave del tipo y periodo (en el orden del catálogo). */
export async function checksVigentes(
    c: QueryClientContract,
    empresaId: number,
    tipo: TipoCheck,
    periodo: string,
): Promise<CheckVista[]> {
    const filas = (await consultaChecks(c)
        .where('k.empresa_id', empresaId)
        .where('k.tipo', tipo)
        .where('k.periodo', periodo)
        .whereRaw(
            `k.id = (SELECT max(x.id) FROM ledger.cierres_checks x WHERE x.empresa_id = k.empresa_id
                      AND x.tipo = k.tipo AND x.periodo = k.periodo AND x.clave = k.clave)`,
        )) as CheckVista[]
    const orden = CHECKS.map((d) => d.clave)
    return filas.map(normalizar).sort((a, b) => orden.indexOf(a.clave) - orden.indexOf(b.clave))
}

/** Historia completa de un tipo y periodo (la más reciente primero). */
export async function historialChecks(
    empresaId: number,
    tipo: TipoCheck,
    periodo: string,
): Promise<CheckVista[]> {
    const filas = (await consultaChecks(db.connection())
        .where('k.empresa_id', empresaId)
        .where('k.tipo', tipo)
        .where('k.periodo', periodo)
        .orderBy('k.id', 'desc')) as CheckVista[]
    return filas.map(normalizar)
}

/** Un check pasa si su última fila está en `revisado` (ok) o `supervisado` (anomalía con nota). */
export function checkPasa(check: Pick<CheckVista, 'estado'>): boolean {
    return check.estado === 'revisado' || check.estado === 'supervisado'
}

/** 422 `checks_pendientes` si algún check automático del tipo y periodo no pasa (o falta). */
export async function exigirChecks(
    c: QueryClientContract,
    empresaId: number,
    tipo: TipoCheck,
    periodo: string,
): Promise<void> {
    const vigentes = await checksVigentes(c, empresaId, tipo, periodo)
    const errores: ErrorCampo[] = []
    for (const def of checksDelTipo(tipo)) {
        if (!CALCULOS[def.clave]) continue
        const v = vigentes.find((x) => x.clave === def.clave)
        if (!v) {
            errores.push({
                field: def.clave,
                message: `${def.titulo}: sin verificar`,
                rule: 'checks_pendientes',
            })
        } else if (!checkPasa(v)) {
            errores.push({
                field: def.clave,
                message: `${def.titulo}: esperado ${v.esperado}, obtenido ${v.obtenido}`,
                rule: 'checks_pendientes',
            })
        }
    }
    if (errores.length > 0) {
        throw new Problema(
            422,
            'checks_pendientes',
            'Checks de cierre pendientes',
            `Hay ${errores.length} checks del cierre ${tipo} ${textoPeriodo(tipo, periodo)} en anomalía o sin verificar: ${errores
                .map((e) => e.field)
                .join(', ')}. Corrige la causa o supervísalos con una nota`,
            errores,
        )
    }
}
