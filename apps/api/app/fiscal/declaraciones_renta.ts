import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, Problema } from '#shared/errores'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import type { DatosFiscales } from '#fiscal/parametros'
import { resolverImpuesto } from '#fiscal/impuestos'
import { ParametroSinConfirmar } from '#fiscal/errores'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    max0,
    min,
    parametroUsado,
    retencionesDelMes,
    textoDePeriodo,
    ventasDelRango,
    type ImpuestoDeclarable,
    type ParametroUsado,
    type RenglonDeclaracion,
} from '#fiscal/declaraciones'

/**
 * ISR, ISO y retenciones (fase 7 PR C; contrato de localización fiscal §9.3, §10.6 y §21). Borradores
 * desde los documentos y el libro, con los parámetros vigentes al fin del periodo; nunca se envían.
 *
 * - **ISR opcional mensual** (`isr_opcional_mensual`, SAT-1311): base = ventas sin IVA del libro de
 *   ventas del mes (gravadas y exentas). El borrador trae los dos cálculos: escala del art. 44
 *   (`isr_opcional_tramos`) y art. 46 (retenciones de los clientes + `isr_opcional_directo` sobre lo no
 *   retenido; la base retenida = retenciones / `RET_ISR_OPC`). `isr_opcional_no_retenido` elige.
 *   Liquidación `5.5.01 / 1.1.06 + 2.1.07`.
 * - **ISR trimestral** (`isr_trimestral`, SAT-1361): `renta_presunta` = `isr_trimestral_presunta` de
 *   las ventas gravadas del trimestre; `cierre_parcial` = ingresos − gastos del libro + no deducibles +
 *   ajustes fiscales del trimestre. ISR = renta × `isr_utilidades_tasa`, menos el ISO acreditable
 *   (`iso_a_isr`). Liquidación `1.1.07 / 2.1.07` (+ `1.1.08` haber por el ISO acreditado).
 * - **ISO trimestral** (`iso_trimestral`, SAT-1608): base = la mayor entre ¼ del activo neto al 31-dic
 *   del año anterior y ¼ de sus ingresos brutos (`iso_base_periodo` = `anio_anterior`), × `iso_tasa`;
 *   no se paga si el margen bruto no pasa de `iso_umbral_margen`. Liquidación `1.1.08 / 2.1.08` y una
 *   fila `origen` en `fiscal.iso_acreditamientos`, acreditable del 1-ene siguiente al 31-dic del tercer
 *   año.
 * - **ISR anual** (`isr_anual`, SAT-1411): renta del año (ingresos − gastos + no deducibles + ajustes
 *   anuales) × tasa; menos los pagos trimestrales revisados del año y el ISO acreditable. Sin asiento:
 *   el cierre anual toma de ella el ISR y lo acreditado (§9.1).
 * - **Retenciones** (`retenciones_iva`, SAT-2340; `retenciones_isr`): las retenidas en las compras
 *   del mes (en el mes del asiento de la compra; su anulación resta en el del reverso). Sin asiento
 *   (ya están en `2.1.04`/`2.1.05`): bloqueo de impuestos y check `retenciones_cuadradas`.
 */

export interface DatosRenta {
    parametros: ParametroUsado[]
    renglones: RenglonDeclaracion[]
    totales: Record<string, string>
    notas: string[]
    /** enlazar los libros de ventas y compras emitidos que cubren el periodo */
    conLibros: boolean
}

interface Lector {
    leer: <T = unknown>(clave: string) => T
    opcional: <T = unknown>(clave: string) => T | null
    parametros: ParametroUsado[]
}

function lector(datos: DatosFiscales, fecha: string): Lector {
    const parametros: ParametroUsado[] = []
    const opcional = <T>(clave: string): T | null => {
        const p = parametroUsado(datos.filas, clave, fecha)
        if (!p) return null
        parametros.push(p)
        return p.valor as T
    }
    return {
        parametros,
        opcional,
        leer: <T>(clave: string): T => {
            const v = opcional<T>(clave)
            if (v === null || v === undefined) throw new ParametroSinConfirmar(clave, fecha)
            return v
        },
    }
}

const pct = (base: Dec, porcentaje: string | Dec) => redondear(base.times(dec(porcentaje)).dividedBy(100))
const texto = (valores: Record<string, Dec>) =>
    Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, aTexto(v)]))

function noSoportada(clave: string, valor: unknown, detalle: string): Problema {
    return new Problema(422, 'regla_no_soportada', 'Regla fiscal no soportada', detalle, [
        { field: clave, message: `Valor ${JSON.stringify(valor)}`, rule: 'regla_no_soportada' },
    ])
}

/** ISR y ISO solo con el ISO acreditable al ISR (`iso_a_isr`); `isr_a_iso` no está implementado. */
function exigirIsoAIsr(l: Lector) {
    const modo = l.leer<string>('iso_acreditamiento')
    if (modo !== 'iso_a_isr') {
        throw noSoportada(
            'iso_acreditamiento',
            modo,
            'Solo se calcula el ISO acreditable al ISR (iso_a_isr): acreditar los pagos trimestrales del ISR al ISO (isr_a_iso) no está implementado; confírmelo con el contador',
        )
    }
}

export async function calcularRenta(
    c: QueryClientContract,
    empresaId: number,
    impuesto: ImpuestoDeclarable,
    desde: string,
    hasta: string,
    datos: DatosFiscales,
): Promise<DatosRenta> {
    const l = lector(datos, hasta)
    let r: Omit<DatosRenta, 'parametros'>
    switch (impuesto) {
        case 'isr_opcional_mensual':
            r = await isrOpcional(c, empresaId, desde, hasta, datos, l)
            break
        case 'isr_trimestral':
            r = await isrTrimestral(c, empresaId, desde, hasta, l)
            break
        case 'iso_trimestral':
            r = await isoTrimestral(c, empresaId, desde, l)
            break
        case 'isr_anual':
            r = await isrAnual(c, empresaId, desde, hasta, l)
            break
        case 'retenciones_iva':
        case 'retenciones_isr':
            r = await retencionesEmitidas(
                c,
                empresaId,
                impuesto === 'retenciones_iva' ? 'iva' : 'isr',
                desde,
                hasta,
            )
            break
        default:
            throw new Error(`calcularRenta: ${impuesto} no es de renta`)
    }
    return { ...r, parametros: l.parametros }
}

/*
|--------------------------------------------------------------------------
| ISR opcional mensual
|--------------------------------------------------------------------------
*/

export interface Tramo {
    desde: string
    hasta: string | null
    fijo: string
    porcentaje: string
    sobre_excedente_de: string
}

/** Escala del art. 44 sobre la renta imponible del mes. */
export function escalaOpcional(base: Dec, tramos: Tramo[]): Dec {
    if (base.lte(0)) return CERO
    const tramo = tramos.find((t) => base.gte(dec(t.desde)) && (t.hasta === null || base.lte(dec(t.hasta))))
    if (!tramo) return CERO
    return redondear(
        dec(tramo.fijo).plus(
            base.minus(dec(tramo.sobre_excedente_de)).times(dec(tramo.porcentaje)).dividedBy(100),
        ),
    )
}

async function isrOpcional(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
    datos: DatosFiscales,
    l: Lector,
) {
    const tramos = l.leer<{ tramos: Tramo[] }>('isr_opcional_tramos').tramos
    const directo = l.leer<string>('isr_opcional_directo')
    const metodo = l.leer<string>('isr_opcional_no_retenido')
    const ret = resolverImpuesto(datos.impuestos, 'RET_ISR_OPC', hasta)
    if (!ret) throw new ParametroSinConfirmar('impuesto:RET_ISR_OPC', hasta)
    l.parametros.push({
        clave: 'impuesto:RET_ISR_OPC',
        valor: ret.tasa,
        vigente_desde: ret.vigente_desde,
        nivel: ret.nivel,
    })

    const ventas = await ventasDelRango(c, empresaId, desde, hasta)
    const retenciones = await retencionesDelMes(c, empresaId, desde, hasta, 'isr')
    const base = max0(ventas.gravado.plus(ventas.exento))
    const R = retenciones.reduce((s, x) => s.plus(dec(x.iva)), CERO)
    const tasaRet = dec(ret.tasa)
    const baseRetenida = tasaRet.gt(0) ? min(base, redondear(max0(R).times(100).dividedBy(tasaRet))) : CERO
    const noRetenida = base.minus(baseRetenida)
    const isr44 = escalaOpcional(base, tramos)
    const isr46 = max0(R).plus(pct(noRetenida, directo))
    const isr = metodo === 'art44_escala' ? isr44 : isr46
    const usadas = min(max0(R), isr)
    return {
        renglones: [...ventas.renglones, ...retenciones],
        totales: texto({
            base,
            retenciones: R,
            base_retenida: baseRetenida,
            base_no_retenida: noRetenida,
            isr_art44: isr44,
            isr_art46: isr46,
            isr,
            retenciones_usadas: usadas,
            a_pagar: isr.minus(usadas),
        }),
        notas: [
            `Método: ${metodo} (isr_opcional_no_retenido); el borrador muestra los dos cálculos (art. 44 y art. 46). Confirmar con contador (§15 #14)`,
            'Base: ventas sin IVA del libro de ventas del mes, gravadas y exentas; base retenida = retenciones recibidas / RET_ISR_OPC (§15)',
        ],
        conLibros: true,
    }
}

/*
|--------------------------------------------------------------------------
| Resultados del libro y ajustes fiscales (cierre parcial y anual)
|--------------------------------------------------------------------------
*/

export interface ResultadosRango {
    ingresos: Dec
    gastos: Dec
    no_deducibles: Dec
    /** gastos del grupo `5.6 Costo de ventas` (inventario, fase C: equipo vendido, mermas y faltantes) */
    costo_ventas: Dec
    renglones: RenglonDeclaracion[]
}

/** ¿La cuenta es del grupo `5.6 Costo de ventas` (`contratos/inventario.md` §3, §15 #79)? */
export function esCostoDeVentas(codigo: string): boolean {
    return codigo === CUENTAS_GT.COSTO_VENTAS || codigo.startsWith(`${CUENTAS_GT.COSTO_VENTAS}.`)
}

/** Ingresos y gastos del rango sin el cierre anual; los no deducibles por `categoria_fiscal`. */
export async function resultadosDelRango(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
): Promise<ResultadosRango> {
    const { rows } = (await c.rawQuery(
        `SELECT cu.codigo, cu.nombre, cu.tipo, cu.categoria_fiscal, sum(m.debe - m.haber)::text AS neto
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha BETWEEN ? AND ? AND a.origen_tipo <> 'cierre_anual'
            AND cu.tipo IN ('ingreso', 'gasto')
          GROUP BY 1, 2, 3, 4
         HAVING sum(m.debe - m.haber) <> 0
          ORDER BY 1`,
        [empresaId, desde, hasta],
    )) as {
        rows: Array<{
            codigo: string
            nombre: string
            tipo: string
            categoria_fiscal: string | null
            neto: string
        }>
    }
    let ingresos = CERO
    let gastos = CERO
    let noDeducibles = CERO
    let costoVentas = CERO
    const renglones: RenglonDeclaracion[] = []
    for (const f of rows) {
        const neto = dec(f.neto)
        const monto = f.tipo === 'ingreso' ? neto.negated() : neto
        if (f.tipo === 'ingreso') ingresos = ingresos.plus(monto)
        else gastos = gastos.plus(monto)
        if (f.tipo === 'gasto' && esCostoDeVentas(f.codigo)) costoVentas = costoVentas.plus(monto)
        if (f.tipo === 'gasto' && f.categoria_fiscal === 'no_deducible') {
            noDeducibles = noDeducibles.plus(monto)
        }
        renglones.push({
            seccion: 'resultados',
            origen: 'cuenta',
            documento: `${f.codigo} ${f.nombre}`,
            fecha: hasta,
            tipo: f.tipo === 'gasto' && f.categoria_fiscal === 'no_deducible' ? 'no_deducible' : f.tipo,
            nit: null,
            base: aTexto(monto),
            iva: '0.00',
            total: aTexto(monto),
            estado: null,
        })
    }
    return { ingresos, gastos, no_deducibles: noDeducibles, costo_ventas: costoVentas, renglones }
}

export interface AjusteFiscal {
    id: number
    empresa_id: number
    anio: number
    trimestre: number | null
    efecto: 'suma' | 'resta'
    concepto: string
    monto: string
    anula_a: number | null
    anulado_por_ajuste: number | null
    registrado_por: number | null
    created_at: Date
}

/** Ajustes fiscales vigentes (sin anular) de un trimestre o del año (`trimestre` null). */
export async function ajustesVigentes(
    c: QueryClientContract,
    empresaId: number,
    anio: number,
    trimestre: number | null,
) {
    const filas = (await c
        .from('fiscal.ajustes_fiscales as a')
        .where('a.empresa_id', empresaId)
        .where('a.anio', anio)
        .if(trimestre === null, (q) => q.whereNull('a.trimestre'))
        .if(trimestre !== null, (q) => q.where('a.trimestre', trimestre!))
        .whereNull('a.anula_a')
        .whereNotExists((q) => q.from('fiscal.ajustes_fiscales as x').whereRaw('x.anula_a = a.id'))
        .orderBy('a.id', 'asc')
        .select('a.id', 'a.efecto', 'a.concepto', c.raw('a.monto::text as monto'), 'a.created_at')) as Array<{
        id: number
        efecto: 'suma' | 'resta'
        concepto: string
        monto: string
    }>
    let suma = CERO
    let resta = CERO
    const renglones: RenglonDeclaracion[] = filas.map((f) => {
        if (f.efecto === 'suma') suma = suma.plus(dec(f.monto))
        else resta = resta.plus(dec(f.monto))
        return {
            seccion: 'ajustes',
            origen: 'ajuste_fiscal',
            documento: `Ajuste ${f.id}: ${f.concepto}`,
            fecha: `${anio}-12-31`,
            tipo: f.efecto,
            nit: null,
            base: aTexto(f.monto),
            iva: '0.00',
            total: aTexto(f.efecto === 'suma' ? f.monto : dec(f.monto).negated()),
            estado: null,
        }
    })
    return { suma, resta, renglones }
}

/*
|--------------------------------------------------------------------------
| ISO por acreditar (`fiscal.iso_acreditamientos`)
|--------------------------------------------------------------------------
*/

/** Filas vigentes: de una declaración revisada o presentada, o de un cierre anual sin reabrir. */
const VIGENTES = `
    SELECT ia.id, ia.tipo, ia.iso_periodo, ia.monto, ia.acreditable_desde, ia.vence_en, ia.declaracion_id,
           ia.cierre_id, d.impuesto AS d_impuesto, d.periodo_desde AS d_desde, d.periodo_hasta AS d_hasta,
           ca.anio AS c_anio
      FROM fiscal.iso_acreditamientos ia
      LEFT JOIN fiscal.declaraciones d ON d.id = ia.declaracion_id
      LEFT JOIN ledger.cierres_anuales ca ON ca.id = ia.cierre_id
     WHERE ia.empresa_id = :empresa
       AND ((ia.declaracion_id IS NOT NULL AND d.estado IN ('revisada', 'presentada'))
            OR (ia.cierre_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_anuales r WHERE r.cierre_id = ia.cierre_id)))`

export interface SaldoIso {
    iso_periodo: string
    acreditable_desde: string
    vence_en: string
    origen: Dec
    usado: Dec
    saldo: Dec
}

/**
 * ISO que puede acreditar una declaración de ISR del periodo (`desde`–`hasta`): orígenes vigentes cuya
 * ventana lo cubre, menos lo acreditado por declaraciones anteriores (no la misma ni las posteriores:
 * así el hash de una revisada no cambia cuando la siguiente acredita) y lo vencido en cierres de años
 * anteriores. Del que vence primero al último.
 */
export async function isoDisponible(
    c: QueryClientContract,
    empresaId: number,
    consumidor: { impuesto: string; desde: string; hasta: string },
): Promise<SaldoIso[]> {
    const { rows } = (await c.rawQuery(
        `WITH vig AS (${VIGENTES})
         SELECT to_char(o.iso_periodo, 'YYYY-MM-DD') AS iso_periodo,
                to_char(o.acreditable_desde, 'YYYY-MM-DD') AS acreditable_desde,
                to_char(o.vence_en, 'YYYY-MM-DD') AS vence_en, o.monto::text AS origen,
                coalesce((SELECT sum(u.monto) FROM vig u
                           WHERE u.iso_periodo = o.iso_periodo
                             AND ((u.tipo = 'acreditado'
                                   AND NOT (u.d_impuesto = :impuesto AND u.d_desde = CAST(:desde AS date))
                                   AND (u.d_hasta < CAST(:hasta AS date)
                                        OR (u.d_hasta = CAST(:hasta AS date) AND :impuesto = 'isr_anual'
                                            AND u.d_impuesto = 'isr_trimestral')))
                                  OR (u.tipo = 'vencido' AND u.c_anio < :anio))), 0)::text AS usado
           FROM vig o
          WHERE o.tipo = 'origen' AND o.acreditable_desde <= CAST(:hasta AS date) AND o.vence_en >= CAST(:desde AS date)
          ORDER BY o.vence_en, o.iso_periodo`,
        {
            empresa: empresaId,
            impuesto: consumidor.impuesto,
            desde: consumidor.desde,
            hasta: consumidor.hasta,
            anio: Number(consumidor.hasta.slice(0, 4)),
        },
    )) as {
        rows: Array<{
            iso_periodo: string
            acreditable_desde: string
            vence_en: string
            origen: string
            usado: string
        }>
    }
    return rows
        .map((r) => {
            const origen = dec(r.origen)
            const usado = dec(r.usado)
            return { ...r, origen, usado, saldo: origen.minus(usado) }
        })
        .filter((r) => r.saldo.gt(0))
}

/** Reparto FIFO (vence primero) de `monto` entre los saldos. */
export function asignarIso(saldos: SaldoIso[], monto: Dec): Array<SaldoIso & { asignado: Dec }> {
    let resto = max0(monto)
    return saldos.map((s) => {
        const asignado = min(resto, s.saldo)
        resto = resto.minus(asignado)
        return { ...s, asignado }
    })
}

function renglonesIso(asignacion: Array<SaldoIso & { asignado: Dec }>): RenglonDeclaracion[] {
    return asignacion.map((a) => ({
        seccion: 'iso',
        origen: 'iso',
        documento: `ISO ${textoDePeriodo('iso_trimestral', a.iso_periodo)} · acreditable del ${a.acreditable_desde} al ${a.vence_en}`,
        fecha: a.vence_en,
        tipo: 'ISO',
        nit: null,
        base: aTexto(a.saldo),
        iva: aTexto(a.asignado),
        total: aTexto(a.saldo.minus(a.asignado)),
        estado: a.iso_periodo,
    }))
}

/**
 * Lo que la versión `d` (ISR trimestral o anual) acredita de cada trimestre de ISO, recalculado con los
 * datos de hoy (la revisión ya comprobó el `datos_hash`).
 */
export async function usoIsoDe(
    c: QueryClientContract,
    d: {
        empresa_id: number
        impuesto: string
        periodo_desde: string
        periodo_hasta: string
        totales: Record<string, string>
    },
) {
    const saldos = await isoDisponible(c, d.empresa_id, {
        impuesto: d.impuesto,
        desde: d.periodo_desde,
        hasta: d.periodo_hasta,
    })
    return asignarIso(saldos, dec(d.totales.iso_acreditado ?? '0')).filter((a) => a.asignado.gt(0))
}

/** Ventana de acreditamiento del ISO de un trimestre: del 1-ene siguiente al 31-dic del tercer año (§15). */
export function ventanaIso(isoPeriodo: string) {
    const anio = Number(isoPeriodo.slice(0, 4))
    return { acreditable_desde: `${anio + 1}-01-01`, vence_en: `${anio + 3}-12-31` }
}

/** 409 `iso_sin_saldo` si en algún trimestre de ISO lo acreditado y vencido supera su origen. */
export async function exigirSaldoIso(c: QueryClientContract, empresaId: number, periodos: string[]) {
    if (periodos.length === 0) return
    const { rows } = (await c.rawQuery(
        `WITH vig AS (${VIGENTES})
         SELECT to_char(iso_periodo, 'YYYY-MM-DD') AS iso_periodo,
                sum(CASE WHEN tipo = 'origen' THEN monto ELSE -monto END)::text AS saldo
           FROM vig WHERE iso_periodo = ANY (CAST(string_to_array(:periodos, ',') AS date[]))
          GROUP BY 1 HAVING sum(CASE WHEN tipo = 'origen' THEN monto ELSE -monto END) < 0`,
        { empresa: empresaId, periodos: periodos.join(',') },
    )) as { rows: Array<{ iso_periodo: string; saldo: string }> }
    if (rows.length > 0) {
        throw new Conflicto(
            `El ISO de ${rows.map((r) => textoDePeriodo('iso_trimestral', r.iso_periodo)).join(', ')} ya se acreditó por más de lo que queda (saldo ${rows.map((r) => r.saldo).join(', ')}): corrija primero las declaraciones de ISR que lo usaron`,
            'iso_sin_saldo',
            'ISO sin saldo',
        )
    }
}

/** Saldo de ISO que vence a más tardar el 31-dic de `anio` y sigue sin acreditar (lo usa el cierre). */
export async function isoPorVencer(c: QueryClientContract, empresaId: number, anio: number) {
    const { rows } = (await c.rawQuery(
        `WITH vig AS (${VIGENTES})
         SELECT to_char(o.iso_periodo, 'YYYY-MM-DD') AS iso_periodo,
                to_char(o.acreditable_desde, 'YYYY-MM-DD') AS acreditable_desde,
                to_char(o.vence_en, 'YYYY-MM-DD') AS vence_en,
                (o.monto - coalesce((SELECT sum(u.monto) FROM vig u
                                      WHERE u.iso_periodo = o.iso_periodo AND u.tipo <> 'origen'), 0))::text AS saldo
           FROM vig o
          WHERE o.tipo = 'origen' AND o.vence_en <= make_date(:anio, 12, 31)
          ORDER BY o.vence_en, o.iso_periodo`,
        { empresa: empresaId, anio },
    )) as { rows: Array<{ iso_periodo: string; acreditable_desde: string; vence_en: string; saldo: string }> }
    return rows.map((r) => ({ ...r, saldo: dec(r.saldo) })).filter((r) => r.saldo.gt(0))
}

/*
|--------------------------------------------------------------------------
| ISR trimestral
|--------------------------------------------------------------------------
*/

async function isrTrimestral(
    c: QueryClientContract,
    empresaId: number,
    desde: string,
    hasta: string,
    l: Lector,
) {
    const metodo = l.leer<string>('isr_trimestral_metodo')
    const tasa = l.leer<string>('isr_utilidades_tasa')
    exigirIsoAIsr(l)
    const notas: string[] = []
    let renglones: RenglonDeclaracion[]
    let ingresos: Dec
    let gastos = CERO
    let noDeducibles = CERO
    let suma = CERO
    let resta = CERO
    let renta: Dec
    let conLibros = false
    if (metodo === 'renta_presunta') {
        const presunta = l.leer<string>('isr_trimestral_presunta')
        const ventas = await ventasDelRango(c, empresaId, desde, hasta)
        renglones = ventas.renglones
        ingresos = ventas.gravado
        renta = pct(max0(ingresos), presunta)
        conLibros = true
        notas.push(
            `Renta presunta: ${presunta} % de las ventas gravadas del libro de ventas del trimestre (sin exentas); otros ingresos no facturados no entran (§15)`,
        )
    } else if (metodo === 'cierre_parcial') {
        const r = await resultadosDelRango(c, empresaId, desde, hasta)
        const trimestre = Math.floor((Number(desde.slice(5, 7)) - 1) / 3) + 1
        const a = await ajustesVigentes(c, empresaId, Number(desde.slice(0, 4)), trimestre)
        renglones = [...r.renglones, ...a.renglones]
        ingresos = r.ingresos
        gastos = r.gastos
        noDeducibles = r.no_deducibles
        suma = a.suma
        resta = a.resta
        renta = ingresos.minus(gastos).plus(noDeducibles).plus(suma).minus(resta)
        notas.push(
            'Cierre parcial: resultado del libro del trimestre (sin el cierre anual) + gastos no deducibles (categoria_fiscal) + ajustes fiscales del trimestre; por trimestre, no acumulado (§15)',
        )
    } else {
        throw noSoportada(
            'isr_trimestral_metodo',
            metodo,
            `Método de pago trimestral desconocido: ${String(metodo)}`,
        )
    }
    const isr = pct(max0(renta), tasa)
    const asignacion = asignarIso(
        await isoDisponible(c, empresaId, { impuesto: 'isr_trimestral', desde, hasta }),
        isr,
    )
    const iso = asignacion.reduce((s, a) => s.plus(a.asignado), CERO)
    const disponible = asignacion.reduce((s, a) => s.plus(a.saldo), CERO)
    return {
        renglones: [...renglones, ...renglonesIso(asignacion)],
        totales: texto({
            ingresos,
            gastos,
            no_deducibles: noDeducibles,
            ajustes_suma: suma,
            ajustes_resta: resta,
            renta_imponible: renta,
            isr,
            iso_disponible: disponible,
            iso_acreditado: iso,
            a_pagar: isr.minus(iso),
        }),
        notas: [
            ...notas,
            'ISO acreditable: el de los tres años anteriores, del que vence primero (iso_a_isr, §15)',
        ],
        conLibros,
    }
}

/*
|--------------------------------------------------------------------------
| ISO trimestral
|--------------------------------------------------------------------------
*/

export async function saldoActivo(c: QueryClientContract, empresaId: number, fecha: string) {
    const { rows } = (await c.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::text AS saldo
           FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha <= ? AND cu.tipo = 'activo'`,
        [empresaId, fecha],
    )) as { rows: Array<{ saldo: string }> }
    return dec(rows[0]?.saldo ?? '0')
}

async function isoTrimestral(c: QueryClientContract, empresaId: number, desde: string, l: Lector) {
    const periodoBase = l.leer<string>('iso_base_periodo')
    if (periodoBase !== 'anio_anterior') {
        throw noSoportada(
            'iso_base_periodo',
            periodoBase,
            'La base del ISO se calcula solo con el activo neto y los ingresos brutos del año anterior (iso_base_periodo = anio_anterior)',
        )
    }
    exigirIsoAIsr(l)
    const tasa = l.leer<string>('iso_tasa')
    const umbral = l.leer<string>('iso_umbral_margen')
    const regla4x = l.opcional<boolean>('iso_regla_4x')
    const exencion = l.opcional<boolean>('iso_exencion_inicio')
    if (exencion === true) {
        throw noSoportada(
            'iso_exencion_inicio',
            exencion,
            'La exención de los primeros 4 trimestres de operación necesita la fecha de inicio de operaciones, que el sistema no guarda: confírmelo con el contador',
        )
    }
    const anio = Number(desde.slice(0, 4)) - 1
    const corte = `${anio}-12-31`
    const activo = await saldoActivo(c, empresaId, corte)
    const resultados = await resultadosDelRango(c, empresaId, `${anio}-01-01`, corte)
    const ingresos = resultados.ingresos
    // fase C del inventario (§15 #79): el costo de ventas sale de 5.6 (equipo vendido, mermas y faltantes)
    const costo = resultados.costo_ventas
    const margen = ingresos.gt(0) ? redondear(ingresos.minus(costo).times(100).dividedBy(ingresos)) : CERO
    const baseActivo = redondear(max0(activo).dividedBy(4))
    const baseIngresos = redondear(max0(ingresos).dividedBy(4))
    const por4x = regla4x === true && activo.gt(ingresos.times(4))
    const base = por4x ? baseIngresos : baseActivo.gt(baseIngresos) ? baseActivo : baseIngresos
    const aplica = margen.gt(dec(umbral))
    const impuesto = aplica ? pct(base, tasa) : CERO
    const notas = [
        `Base: activo neto al ${corte} y ingresos brutos de ${anio} (iso_base_periodo = anio_anterior)`,
        `Costo de ventas ${aTexto(costo)}: gastos del grupo 5.6 de ${anio} (costo del equipo vendido, mermas y faltantes del inventario; §15 #79)`,
        regla4x === null
            ? 'iso_regla_4x sin valor: no se aplica la regla de activo neto mayor que 4 veces los ingresos (§15 #4)'
            : `iso_regla_4x = ${String(regla4x)}${por4x ? ': se usa la base de ingresos' : ''}`,
        exencion === null
            ? 'iso_exencion_inicio sin valor: no se aplica la exención de los primeros 4 trimestres (§15 #4)'
            : `iso_exencion_inicio = ${String(exencion)}`,
        ...(aplica ? [] : [`Margen bruto ${aTexto(margen)} % no pasa de ${umbral} %: sin ISO`]),
    ]
    const renglon = (documento: string, monto: Dec): RenglonDeclaracion => ({
        seccion: 'resultados',
        origen: 'cuenta',
        documento,
        fecha: corte,
        tipo: null,
        nit: null,
        base: aTexto(monto),
        iva: '0.00',
        total: aTexto(monto),
        estado: null,
    })
    return {
        renglones: [renglon(`Activo neto al ${corte}`, activo), renglon(`Ingresos brutos ${anio}`, ingresos)],
        totales: texto({
            activo_neto: activo,
            ingresos_brutos: ingresos,
            costo_ventas: costo,
            margen_bruto: margen,
            base_activo: baseActivo,
            base_ingresos: baseIngresos,
            base,
            impuesto,
            a_pagar: impuesto,
        }),
        notas,
        conLibros: false,
    }
}

/*
|--------------------------------------------------------------------------
| ISR anual
|--------------------------------------------------------------------------
*/

async function isrAnual(c: QueryClientContract, empresaId: number, desde: string, hasta: string, l: Lector) {
    const tasa = l.leer<string>('isr_utilidades_tasa')
    exigirIsoAIsr(l)
    const anio = Number(desde.slice(0, 4))
    const r = await resultadosDelRango(c, empresaId, desde, hasta)
    const a = await ajustesVigentes(c, empresaId, anio, null)
    const renta = r.ingresos.minus(r.gastos).plus(r.no_deducibles).plus(a.suma).minus(a.resta)
    const isr = pct(max0(renta), tasa)

    const trimestrales = (await c
        .from('fiscal.declaraciones')
        .where({ empresa_id: empresaId, impuesto: 'isr_trimestral' })
        .whereBetween('periodo_desde', [desde, hasta])
        .whereIn('estado', ['revisada', 'presentada'])
        .orderBy('periodo_desde', 'asc')
        .select(
            'id',
            'version',
            c.raw(`to_char(periodo_desde, 'YYYY-MM-DD') as periodo_desde`),
            'totales',
        )) as Array<{
        id: number
        version: number
        periodo_desde: string
        totales: Record<string, string>
    }>
    const pagos = trimestrales.reduce((s, t) => s.plus(dec(t.totales.isr ?? '0')), CERO)
    const trimestral = min(pagos, isr)
    const asignacion = asignarIso(
        await isoDisponible(c, empresaId, { impuesto: 'isr_anual', desde, hasta }),
        isr.minus(trimestral),
    )
    const iso = asignacion.reduce((s, x) => s.plus(x.asignado), CERO)
    const disponible = asignacion.reduce((s, x) => s.plus(x.saldo), CERO)
    const porVencer = asignacion
        .filter((x) => x.vence_en <= hasta)
        .reduce((s, x) => s.plus(x.saldo.minus(x.asignado)), CERO)
    const renglonesTrimestrales: RenglonDeclaracion[] = trimestrales.map((t) => ({
        seccion: 'declaraciones',
        origen: 'declaracion',
        documento: `ISR trimestral ${textoDePeriodo('isr_trimestral', t.periodo_desde)} (declaración ${t.id}, versión ${t.version})`,
        fecha: t.periodo_desde,
        tipo: 'isr_trimestral',
        nit: null,
        base: aTexto(t.totales.renta_imponible ?? '0'),
        iva: aTexto(t.totales.isr ?? '0'),
        total: aTexto(t.totales.isr ?? '0'),
        estado: null,
    }))
    return {
        renglones: [...r.renglones, ...a.renglones, ...renglonesTrimestrales, ...renglonesIso(asignacion)],
        totales: texto({
            ingresos: r.ingresos,
            gastos: r.gastos,
            no_deducibles: r.no_deducibles,
            ajustes_suma: a.suma,
            ajustes_resta: a.resta,
            renta_imponible: renta,
            isr,
            pagos_trimestrales: pagos,
            trimestral_acreditado: trimestral,
            saldo_a_favor: pagos.minus(trimestral),
            iso_disponible: disponible,
            iso_acreditado: iso,
            iso_por_vencer: porVencer,
            a_pagar: isr.minus(trimestral).minus(iso),
        }),
        notas: [
            'Renta imponible: resultado del libro del año (sin el cierre anual) + gastos no deducibles (categoria_fiscal) + ajustes fiscales anuales (§15)',
            'Pagos trimestrales: el ISR de las versiones revisadas o presentadas del año; el excedente sobre el ISR queda en 1.1.07 como saldo a favor (§15)',
            'ISO por vencer: lo que vence este año y no se acredita pasa a 5.3.03 en el cierre anual; si es deducible en esta declaración: contador (§15)',
            'Sin asiento: el cierre anual provisiona el ISR con estos montos (§9.1)',
        ],
        conLibros: false,
    }
}

/*
|--------------------------------------------------------------------------
| Retenciones emitidas (compras)
|--------------------------------------------------------------------------
*/

/** Retenciones de las compras del mes: + en el mes del asiento de la compra, − en el de su reverso. */
export async function retencionesEmitidas(
    c: QueryClientContract,
    empresaId: number,
    impuesto: 'iva' | 'isr',
    desde: string,
    hasta: string,
) {
    const { rows } = (await c.rawQuery(
        `WITH k AS (
             SELECT cr.id, cr.impuesto_codigo, cr.base, cr.monto, co.id AS compra_id, co.tipo_documento, co.serie,
                    co.numero, p.nit, CASE WHEN co.tipo_documento = 'NCRE' THEN -1 ELSE 1 END AS signo,
                    (SELECT min(a.id) FROM ledger.asientos a
                      WHERE a.origen_tipo = 'compra' AND a.origen_id = co.id AND a.reversa_de IS NULL) AS asiento_id
               FROM ledger.compras_retenciones cr JOIN ledger.compras co ON co.id = cr.compra_id
               JOIN ledger.proveedores p ON p.id = co.proveedor_id
              WHERE co.empresa_id = ? AND cr.impuesto = ?
         )
         SELECT k.*, (k.signo * k.base)::text AS base_s, (k.signo * k.monto)::text AS monto_s,
                to_char(a.fecha, 'YYYY-MM-DD') AS fecha, 'registro' AS movimiento
           FROM k JOIN ledger.asientos a ON a.id = k.asiento_id WHERE a.fecha BETWEEN ? AND ?
         UNION ALL
         SELECT k.*, (-k.signo * k.base)::text, (-k.signo * k.monto)::text, to_char(r.fecha, 'YYYY-MM-DD'), 'anulacion'
           FROM k JOIN ledger.asientos r ON r.reversa_de = k.asiento_id WHERE r.fecha BETWEEN ? AND ?
          ORDER BY fecha, compra_id, movimiento DESC`,
        [empresaId, impuesto, desde, hasta, desde, hasta],
    )) as {
        rows: Array<{
            compra_id: number
            impuesto_codigo: string
            tipo_documento: string
            serie: string
            numero: string
            nit: string
            base_s: string
            monto_s: string
            fecha: string
            movimiento: string
        }>
    }
    let base = CERO
    let retenido = CERO
    const renglones = rows.map((f): RenglonDeclaracion => {
        base = base.plus(dec(f.base_s))
        retenido = retenido.plus(dec(f.monto_s))
        return {
            seccion: 'retenciones',
            origen: 'compra',
            documento:
                `Compra ${f.compra_id}${f.movimiento === 'anulacion' ? ' (anulación)' : ''} · ${f.tipo_documento} ${f.serie} ${f.numero}`.replace(
                    /\s+/g,
                    ' ',
                ),
            fecha: f.fecha,
            tipo: f.impuesto_codigo,
            nit: f.nit,
            base: aTexto(f.base_s),
            iva: aTexto(f.monto_s),
            total: aTexto(f.monto_s),
            estado: f.movimiento,
        }
    })
    return {
        renglones,
        totales: texto({ base, retenido, a_pagar: max0(retenido) }),
        notas: [
            `Retenciones de ${impuesto.toUpperCase()} hechas en las compras del mes (en el mes del asiento de la compra; una anulación resta en el mes de su reverso). Sin asiento: ya están en ${impuesto === 'iva' ? '2.1.04' : '2.1.05'}`,
            ...(retenido.isNegative()
                ? [
                      'Las anulaciones superan lo retenido en el mes: a pagar 0.00 (el saldo a favor: contador, §15)',
                  ]
                : []),
        ],
        conLibros: false,
    }
}

/** El ejercicio de `anio` está cerrado (cierre vigente): su ISR anual ya no cambia. */
export async function ejercicioCerrado(c: QueryClientContract, empresaId: number, anio: number) {
    const { rows } = (await c.rawQuery(`SELECT ledger.ejercicio_cerrado(make_date(?, 1, 1), ?) AS cerrado`, [
        anio,
        empresaId,
    ])) as { rows: Array<{ cerrado: boolean }> }
    return Boolean(rows[0]?.cerrado)
}
