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
import { balanceComprobacion } from '#ledger/comprobacion'

/**
 * Lista de verificación de cierre (contrato de localización fiscal §10.5). Cada check automático
 * compara un `esperado` con un `obtenido` y da `ok` o `anomalia`; `cierres.verificar` los corre y
 * guarda en `ledger.cierres_checks` (solo inserción; el vigente de cada clave es su última fila).
 *
 * - Mensuales (`periodo` = primer día del mes): cxc_antiguedad, cxc_auxiliar, cxp_antiguedad,
 *   apertura_cero, iva_por_certificar, turnos_cerrados, fondos_transito, cobros_por_liquidar,
 *   extractos_conciliados, dte_pendientes, por_certificar (aviso: nunca bloquea),
 *   compras_sin_periodo, secuencias_sin_huecos, hash_verificado, depreciacion_al_dia.
 * - Anuales (`periodo` = 1 de enero): incobrables, resultados_cero (ingresos, gastos, 3.3.03 y
 *   3.3.02 en cero al 31-dic: pasa solo con el ejercicio cerrado) y comprobacion_cuadra (balance de
 *   comprobación del año cuadrado antes y después del cierre). `libro.cerrar_ejercicio` los verifica
 *   y exige después de sus asientos; el duro que cruza un fin de año, también.
 * - De impuestos (`periodo` = primer día del mes; fase 7 PR B, `#fiscal/declaraciones`):
 *   iva_cuadrado (Σ `V_IVA`, `C_IVA` y `RET_IVA_REC` del mes = libros de ventas, compras y
 *   constancias = última versión del borrador; pequeño contribuyente: ventas y retenciones) e
 *   iva_liquidado (con la versión revisada: el neto del mes de `2.1.02` en cero y el de `1.1.04` =
 *   lo que dejó la liquidación; pequeño contribuyente: `2.1.09` = a pagar). `declaraciones.revisar`
 *   exige iva_cuadrado antes de liquidar y los dos después. retenciones_cuadradas (PR C): con
 *   obligación de retenciones en el mes (si no, no deja fila), Σ `RET_IVA_EMI` / `RET_ISR_EMI` =
 *   retenciones de las compras; la revisión de una declaración de retenciones lo exige antes y después.
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
    {
        clave: 'iva_cuadrado',
        tipo: 'impuestos',
        titulo: 'Cuadrículas del libro = libros de IVA = borrador de la declaración',
    },
    {
        clave: 'iva_liquidado',
        tipo: 'impuestos',
        titulo: 'Débito y crédito del periodo trasladados por la liquidación',
    },
    {
        clave: 'retenciones_cuadradas',
        tipo: 'impuestos',
        titulo: 'Retenciones emitidas del mes: cuadrículas del libro = retenciones de las compras',
    },
    { clave: 'incobrables', tipo: 'anual', titulo: 'Estimación de incobrables (1.1.12) dentro del tope' },
    {
        clave: 'resultados_cero',
        tipo: 'anual',
        titulo: 'Ingresos, gastos, 3.3.03 y 3.3.02 en cero al 31-dic (ejercicio cerrado)',
    },
    {
        clave: 'comprobacion_cuadra',
        tipo: 'anual',
        titulo: 'Balance de comprobación del año cuadrado antes y después del cierre',
    },
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
) => Promise<CheckCalculado | null>

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

    async resultados_cero(c, empresaId, inicio, fin) {
        const { rows } = (await c.rawQuery(
            `SELECT cu.codigo, sum(m.debe - m.haber)::text AS saldo
               FROM ledger.movimientos m
               JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
              WHERE a.empresa_id = ?
                AND ((cu.reinicia_anual AND a.fecha BETWEEN ?::date AND ?::date)
                     OR (cu.codigo IN (?, ?) AND a.fecha <= ?::date))
              GROUP BY cu.codigo
             HAVING sum(m.debe - m.haber) <> 0
              ORDER BY cu.codigo`,
            [empresaId, inicio, fin, CUENTAS_GT.PERDIDAS_GANANCIAS, CUENTAS_GT.RESULTADO_EJERCICIO, fin],
        )) as { rows: Array<{ codigo: string; saldo: string }> }
        return {
            clave: 'resultados_cero',
            esperado: '0',
            obtenido: String(rows.length),
            resultado: rows.length === 0 ? 'ok' : 'anomalia',
            detalle:
                rows.length > 0
                    ? {
                          cuentas: rows
                              .slice(0, 20)
                              .map((r) => ({ codigo: r.codigo, saldo: aTexto(r.saldo) })),
                      }
                    : null,
        }
    },

    async comprobacion_cuadra(c, empresaId, inicio, fin) {
        const antes = await balanceComprobacion(
            { desde: inicio, hasta: fin, sin_cierre_anual: true },
            [empresaId],
            c,
        )
        const despues = await balanceComprobacion({ desde: inicio, hasta: fin }, [empresaId], c)
        const cuadra = (r: typeof antes) => r.empresas.every((e) => e.totales.cuadra)
        const descuadres = [...(cuadra(antes) ? [] : ['antes']), ...(cuadra(despues) ? [] : ['despues'])]
        return {
            clave: 'comprobacion_cuadra',
            esperado: 'cuadra',
            obtenido: descuadres.length === 0 ? 'cuadra' : `descuadra ${descuadres.join(' y ')}`,
            resultado: descuadres.length === 0 ? 'ok' : 'anomalia',
            detalle:
                descuadres.length > 0 ? { antes: antes.total.totales, despues: despues.total.totales } : null,
        }
    },

    async incobrables(c, empresaId, _p, fin) {
        let r: Awaited<ReturnType<typeof reservaIncobrables>>
        try {
            r = await reservaIncobrables(c, empresaId, fin)
        } catch (error) {
            if (!(error instanceof LocalizacionNoInstalada)) throw error
            const { base, estimacion } = await baseYEstimacion(c, empresaId, fin)
            // sin localización no hay tope: solo pasa si no hay estimación que medir
            return {
                clave: 'incobrables',
                esperado: '0.00 (sin localización fiscal instalada)',
                obtenido: aTexto(estimacion),
                resultado: estimacion.isZero() ? 'ok' : 'anomalia',
                detalle: { base: aTexto(base), sin_localizacion: true },
            }
        }
        return {
            clave: 'incobrables',
            esperado: `<= ${aTexto(r.tope)}`,
            obtenido: aTexto(r.estimacion),
            resultado: r.estimacion.lte(r.tope) ? 'ok' : 'anomalia',
            detalle: {
                base: aTexto(r.base),
                porcentaje: r.porcentaje.toString(),
                tope: aTexto(r.tope),
            },
        }
    },
}

/*
|--------------------------------------------------------------------------
| Impuestos (fase 7 PR B)
|--------------------------------------------------------------------------
*/

const resumen = (pares: Array<[string, string]>) => pares.map(([k, v]) => `${k} ${v}`).join(' · ')

CALCULOS.iva_cuadrado = async (c, empresaId, periodo) => {
    const d = await import('#fiscal/declaraciones')
    const impuesto = await d.impuestoDelMes(c, empresaId, periodo)
    if (!impuesto) {
        return {
            clave: 'iva_cuadrado',
            esperado: 'sin obligación',
            obtenido: 'sin obligación',
            resultado: 'ok',
            detalle: null,
        }
    }
    const libros = await d.calcularDatos(c, empresaId, impuesto, periodo)
    const etiquetas = await d.cuadriculasDelMes(c, empresaId, periodo)
    const borrador = await d.ultimaVersion(c, empresaId, impuesto, periodo)
    const t = libros.totales
    const esperado =
        impuesto === 'iva_mensual'
            ? resumen([
                  ['V_IVA', t.debito!],
                  ['C_IVA', t.credito!],
                  ['RET_IVA_REC', t.retenciones!],
              ])
            : resumen([
                  ['ventas', t.ventas!],
                  ['RET_IVA_REC', t.retenciones!],
              ])
    const obtenido =
        impuesto === 'iva_mensual'
            ? resumen([
                  ['V_IVA', aTexto(etiquetas.V_IVA)],
                  ['C_IVA', aTexto(etiquetas.C_IVA)],
                  ['RET_IVA_REC', aTexto(etiquetas.RET_IVA_REC)],
              ])
            : resumen([
                  ['ventas', t.ventas!],
                  ['RET_IVA_REC', aTexto(etiquetas.RET_IVA_REC)],
              ])
    // un libro emitido con folio del mismo mes guarda su IVA: debe ser el del borrador
    const librosDistintos = libros.detalle.libros.filter(
        (l) =>
            l.mismo_periodo &&
            l.iva !== null &&
            l.iva !== (l.libro === 'ventas' ? (t.debito ?? t.iva_en_ventas) : (t.credito ?? l.iva)),
    )
    const borradorAlDia = borrador !== null && borrador.datos_hash === libros.datos_hash
    return {
        clave: 'iva_cuadrado',
        esperado,
        obtenido: borradorAlDia
            ? obtenido
            : `${obtenido} · ${borrador ? 'borrador desactualizado' : 'sin borrador'}`,
        resultado: esperado === obtenido && borradorAlDia && librosDistintos.length === 0 ? 'ok' : 'anomalia',
        detalle: {
            impuesto,
            declaracion_id: borrador?.id ?? null,
            version: borrador?.version ?? null,
            borrador_al_dia: borradorAlDia,
            v_iva_sin_etiqueta: aTexto(etiquetas.V_IVA_sin_etiqueta),
            libros_distintos: librosDistintos.map((l) => l.emision_id),
        },
    }
}

CALCULOS.iva_liquidado = async (c, empresaId, periodo) => {
    const d = await import('#fiscal/declaraciones')
    const impuesto = await d.impuestoDelMes(c, empresaId, periodo)
    if (!impuesto) {
        return {
            clave: 'iva_liquidado',
            esperado: 'sin obligación',
            obtenido: 'sin obligación',
            resultado: 'ok',
            detalle: null,
        }
    }
    const revisada = (await c
        .from('fiscal.declaraciones')
        .where({ empresa_id: empresaId, impuesto, periodo_desde: periodo })
        .whereNotNull('revisada_en')
        .orderBy('version', 'desc')
        .select('id', 'version', 'totales')
        .first()) as { id: number; version: number; totales: Record<string, string> } | null
    if (!revisada) {
        return {
            clave: 'iva_liquidado',
            esperado: 'liquidada',
            obtenido: 'sin liquidar',
            resultado: 'anomalia',
            detalle: { impuesto },
        }
    }
    const liquidado = await d.liquidadoDelPeriodo(c, empresaId, impuesto, periodo)
    const t = revisada.totales
    let esperado: string
    let obtenido: string
    if (impuesto === 'iva_mensual') {
        const debitoMes = await d.movimientoDelMes(c, empresaId, periodo, CUENTAS.IVA_DEBITO)
        const creditoMes = await d.movimientoDelMes(c, empresaId, periodo, CUENTAS_GT.IVA_CREDITO)
        const debito = debitoMes.plus(liquidado.get(CUENTAS.IVA_DEBITO) ?? CERO)
        const credito = creditoMes.plus(liquidado.get(CUENTAS_GT.IVA_CREDITO) ?? CERO)
        const remanente = dec(t.remanente_credito ?? '0').minus(dec(t.remanente_credito_anterior ?? '0'))
        esperado = resumen([
            ['2.1.02', '0.00'],
            ['1.1.04', aTexto(remanente)],
        ])
        obtenido = resumen([
            ['2.1.02', aTexto(debito)],
            ['1.1.04', aTexto(credito)],
        ])
    } else {
        esperado = resumen([['2.1.09', aTexto(CERO.minus(dec(t.a_pagar ?? '0')))]])
        obtenido = resumen([['2.1.09', aTexto(liquidado.get(CUENTAS_GT.PC_POR_PAGAR) ?? CERO)]])
    }
    return {
        clave: 'iva_liquidado',
        esperado,
        obtenido,
        resultado: igual(esperado, obtenido),
        detalle: { impuesto, declaracion_id: Number(revisada.id), version: Number(revisada.version) },
    }
}

CALCULOS.retenciones_cuadradas = async (c, empresaId, periodo) => {
    const d = await import('#fiscal/declaraciones')
    const impuestos = await d.retencionesDelCalendario(c, empresaId, periodo)
    // sin obligación de retenciones en el mes no deja fila (no aplica, como un check que no existe)
    if (impuestos.length === 0) return null
    const etiquetas = await d.cuadriculasDelMes(c, empresaId, periodo)
    const esperado: Array<[string, string]> = []
    const obtenido: Array<[string, string]> = []
    const borradores: Array<{ impuesto: string; declaracion_id: number | null; al_dia: boolean }> = []
    for (const impuesto of impuestos) {
        const cuadricula = impuesto === 'retenciones_iva' ? 'RET_IVA_EMI' : 'RET_ISR_EMI'
        const libros = await d.calcularDatos(c, empresaId, impuesto, periodo)
        const borrador = await d.ultimaVersion(c, empresaId, impuesto, periodo)
        const alDia = borrador !== null && borrador.datos_hash === libros.datos_hash
        // el borrador al día lo exige la revisión de cada una (datos_hash): aquí solo se informa, para que
        // revisar las retenciones de IVA no espere el borrador de las de ISR
        esperado.push([cuadricula, libros.totales.retenido ?? '0.00'])
        obtenido.push([cuadricula, aTexto(etiquetas[cuadricula])])
        borradores.push({ impuesto, declaracion_id: borrador?.id ?? null, al_dia: alDia })
    }
    const e = resumen(esperado)
    const o = resumen(obtenido)
    return {
        clave: 'retenciones_cuadradas',
        esperado: e,
        obtenido: o,
        resultado: igual(e, o),
        detalle: { borradores },
    }
}

async function baseYEstimacion(c: QueryClientContract, empresaId: number, fin: string) {
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
    return { base: dec(base.rows[0]!.base), estimacion: saldoEstimacion.negated() }
}

/**
 * Reserva de incobrables al corte (LAT art. 21.20; la de `cartera.provisionar`, el check `incobrables` y
 * el tablero): base = Σ saldos deudores de los clientes en `1.1.03`, tope = base × `reserva_incobrables_max`
 * y estimación = saldo acreedor de `1.1.12`.
 */
export async function reservaIncobrables(c: QueryClientContract, empresaId: number, fin: string) {
    const { base, estimacion } = await baseYEstimacion(c, empresaId, fin)
    const valor = await valorParametro<string>(empresaId, 'reserva_incobrables_max', fin, c)
    const porcentaje = dec(String(valor))
    const tope = redondear(base.times(porcentaje).div(100))
    return { base, porcentaje, tope, estimacion }
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
        const calculado = calculo ? await calculo(c, empresaId, periodo, fin) : null
        if (calculado) salida.push(calculado)
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
    claves?: readonly string[],
): Promise<void> {
    const vigentes = await checksVigentes(c, empresaId, tipo, periodo)
    const errores: ErrorCampo[] = []
    for (const def of checksDelTipo(tipo)) {
        if (!CALCULOS[def.clave]) continue
        if (claves && !claves.includes(def.clave)) continue
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
