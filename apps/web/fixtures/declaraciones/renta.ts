import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * ISR, ISO y retenciones de los fixtures (A3, fase 7 PR C; `#fiscal/declaraciones_renta`). Mismos
 * totales, renglones de cálculo (`detalle.calculo[]`) y notas que la API con los parámetros del paquete:
 *
 * - ISR trimestral por **renta presunta** (`isr_trimestral_metodo` del paquete): 8 % de las ventas
 *   gravadas del trimestre × 25 %; sin ISO acreditable en los fixtures.
 * - ISO trimestral: `iso_base_periodo` no tiene valor en el paquete (confirmar con contador), así que
 *   calcularlo responde 422 `parametro_sin_confirmar`, como la API recién instalada.
 * - ISR anual: resultado del libro del año (cuentas de `RESULTADOS`) ± ajustes fiscales anuales, menos
 *   los pagos trimestrales revisados o presentados del año. Sin asiento: lo provisiona el cierre anual.
 * - Retenciones de IVA e ISR: las hechas en las compras del mes (`DatosMes.emitidas`).
 */

type Renglon = Schema<'RenglonDeclaracion'>
type Calculo = Schema<'RenglonCalculo'>
type Ajuste = Schema<'AjusteFiscal'>

const CERO = new Decimal(0)
const texto = (valor: Decimal) => valor.toFixed(2)
const max0 = (valor: Decimal) => Decimal.max(valor, CERO)
const pct = (base: Decimal, tasa: string) => base.times(tasa).dividedBy(100).toDecimalPlaces(2)

export const TASA_ISR = '25.00'
export const RENTA_PRESUNTA = '8.00'

export interface CuentaResultado {
    codigo: string
    nombre: string
    tipo: 'ingreso' | 'gasto' | 'no_deducible'
    monto: string
}

/** Resultado del libro por empresa y año (sin el cierre anual): ingresos, gastos y no deducibles. */
export const RESULTADOS: Record<string, CuentaResultado[]> = {
    '1-2025': [
        { codigo: '4.1.01', nombre: 'Servicios de internet', tipo: 'ingreso', monto: '158000.00' },
        { codigo: '4.2.01', nombre: 'Otros ingresos', tipo: 'ingreso', monto: '2000.00' },
        { codigo: '5.1.01', nombre: 'Gastos de operación', tipo: 'gasto', monto: '96000.00' },
        { codigo: '5.2.01', nombre: 'Gastos de administración', tipo: 'gasto', monto: '16000.00' },
        { codigo: '5.3.05', nombre: 'Multas y recargos', tipo: 'no_deducible', monto: '2000.00' },
    ],
    '1-2026': [
        { codigo: '4.1.01', nombre: 'Servicios de internet', tipo: 'ingreso', monto: '121400.00' },
        { codigo: '5.1.01', nombre: 'Gastos de operación', tipo: 'gasto', monto: '74300.00' },
        { codigo: '5.2.01', nombre: 'Gastos de administración', tipo: 'gasto', monto: '12900.00' },
        { codigo: '5.3.05', nombre: 'Multas y recargos', tipo: 'no_deducible', monto: '860.66' },
    ],
}

export interface ResultadoRenta {
    totales: Record<string, string>
    calculo: Calculo[]
    notas: string[]
}

/** `isr_trimestral` por renta presunta: las ventas del trimestre van en `renglones` (sección ventas). */
export function isrTrimestral(ventas: readonly Renglon[]): ResultadoRenta {
    const ingresos = ventas.filter(v => v.tipo !== 'NCRE').reduce((s, v) => s.plus(v.base), CERO)
    const renta = pct(max0(ingresos), RENTA_PRESUNTA)
    const isr = pct(max0(renta), TASA_ISR)
    return {
        totales: {
            ingresos: texto(ingresos),
            gastos: '0.00',
            no_deducibles: '0.00',
            ajustes_suma: '0.00',
            ajustes_resta: '0.00',
            renta_imponible: texto(renta),
            isr: texto(isr),
            iso_disponible: '0.00',
            iso_acreditado: '0.00',
            a_pagar: texto(isr),
        },
        calculo: [],
        notas: [
            `Renta presunta: ${RENTA_PRESUNTA} % de las ventas gravadas del libro de ventas del trimestre (sin exentas); otros ingresos no facturados no entran (§15)`,
            'ISO acreditable: el de los tres años anteriores, del que vence primero (iso_a_isr, §15)',
        ],
    }
}

export interface TrimestralPagado {
    declaracion_id: number
    periodo_desde: string
    isr: string
}

/** `isr_anual`: resultado del año ± ajustes anuales vigentes, ISR y lo acreditado de las trimestrales. */
export function isrAnual(anio: number, cuentas: readonly CuentaResultado[], ajustes: readonly Ajuste[], trimestrales: readonly TrimestralPagado[]): ResultadoRenta {
    const fin = `${anio}-12-31`
    const total = (tipo: CuentaResultado['tipo']) => cuentas.filter(c => c.tipo === tipo).reduce((s, c) => s.plus(c.monto), CERO)
    const ingresos = total('ingreso')
    const gastos = total('gasto')
    const noDeducibles = total('no_deducible')
    const vigentes = ajustes.filter(a => a.anula_a === null && a.anulado_por_ajuste === null)
    const suma = vigentes.filter(a => a.efecto === 'suma').reduce((s, a) => s.plus(a.monto), CERO)
    const resta = vigentes.filter(a => a.efecto === 'resta').reduce((s, a) => s.plus(a.monto), CERO)
    const renta = ingresos.minus(gastos).plus(noDeducibles).plus(suma).minus(resta)
    const isr = pct(max0(renta), TASA_ISR)
    const pagos = trimestrales.reduce((s, t) => s.plus(t.isr), CERO)
    const acreditado = Decimal.min(pagos, isr)
    const calculo: Calculo[] = [
        ...cuentas.map((c): Calculo => ({ seccion: 'resultados', origen: 'cuenta', documento: `${c.codigo} ${c.nombre}`, fecha: fin, tipo: c.tipo, nit: null, base: c.monto, iva: '0.00', total: c.tipo === 'ingreso' ? c.monto : c.tipo === 'gasto' ? `-${c.monto}` : c.monto, estado: null })),
        ...vigentes.map((a): Calculo => ({ seccion: 'ajustes', origen: 'ajuste_fiscal', documento: `Ajuste ${a.id} · ${a.concepto}`, fecha: a.created_at.slice(0, 10), tipo: a.efecto, nit: null, base: a.monto, iva: '0.00', total: a.efecto === 'resta' ? `-${a.monto}` : a.monto, estado: null })),
        ...trimestrales.map((t): Calculo => ({ seccion: 'declaraciones', origen: 'declaracion', documento: `ISR trimestral ${t.periodo_desde.slice(0, 7)} (declaración ${t.declaracion_id})`, fecha: t.periodo_desde, tipo: 'isr_trimestral', nit: null, base: '0.00', iva: t.isr, total: t.isr, estado: null })),
    ]
    return {
        totales: {
            ingresos: texto(ingresos),
            gastos: texto(gastos),
            no_deducibles: texto(noDeducibles),
            ajustes_suma: texto(suma),
            ajustes_resta: texto(resta),
            renta_imponible: texto(renta),
            isr: texto(isr),
            iso_disponible: '0.00',
            iso_acreditado: '0.00',
            pagos_trimestrales: texto(pagos),
            trimestral_acreditado: texto(acreditado),
            saldo_a_favor: texto(max0(pagos.minus(isr))),
            iso_por_vencer: '0.00',
            a_pagar: texto(isr.minus(acreditado)),
        },
        calculo,
        notas: [
            'Renta imponible: resultado del libro del año (sin el cierre anual) + gastos no deducibles (categoria_fiscal) + ajustes fiscales anuales (§15)',
            'Pagos trimestrales: el ISR de las versiones revisadas o presentadas del año; el excedente sobre el ISR queda en 1.1.07 como saldo a favor (§15)',
            'ISO por vencer: lo que vence este año y no se acredita pasa a 5.3.03 en el cierre anual; si es deducible en esta declaración: contador (§15)',
            'Sin asiento: el cierre anual provisiona el ISR con estos montos (§9.1)',
        ],
    }
}

/** Retenciones de IVA o ISR hechas en las compras del mes (las anulaciones restan). */
export function retenciones(impuesto: 'iva' | 'isr', renglones: readonly Renglon[]): ResultadoRenta {
    const base = renglones.reduce((s, r) => s.plus(r.base), CERO)
    const retenido = renglones.reduce((s, r) => s.plus(r.iva), CERO)
    return {
        totales: { base: texto(base), retenido: texto(retenido), a_pagar: texto(max0(retenido)) },
        calculo: [],
        notas: [
            `Retenciones de ${impuesto.toUpperCase()} hechas en las compras del mes (en el mes del asiento de la compra; una anulación resta en el mes de su reverso). Sin asiento: ya están en ${impuesto === 'iva' ? '2.1.04' : '2.1.05'}`,
            ...(retenido.isNegative() ? ['Las anulaciones superan lo retenido en el mes: a pagar 0.00 (el saldo a favor: contador, §15)'] : []),
        ],
    }
}

/** Una retención hecha en una compra (sección `retenciones`, origen `compra`). */
export function retencionEmitida(compraId: number, documento: string, fecha: string, codigo: 'RET_IVA_EMI' | 'RET_ISR_EMI', base: string, retenido: string, nit: string): Renglon {
    return { seccion: 'retenciones', origen: 'compra', documento: `Compra ${compraId} · ${documento}`, fecha, tipo: codigo, nit, base, iva: retenido, total: retenido, estado: 'registro' }
}
