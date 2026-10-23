import { Decimal } from 'decimal.js'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { fechaCalendario, fechaCorta, quetzales } from '#notify/formato'
import { nombreImpuesto, periodoLegible } from '#notify/calendario_fiscal'

/**
 * Variables de los avisos de declaraciones (fase 7 PR C; contrato de localización fiscal §14 y
 * §21): `declaracion.revisada` con `motivo: 'cascada'`, `declaracion.pagada` y
 * `declaracion.pago_anulado`, que emite A3. Leen de `fiscal.declaraciones`,
 * `fiscal.declaraciones_pagos` y `fiscal.declaraciones_pagos_anulaciones` solo para el texto
 * (filas inmutables en lo que se lee: periodo, presentación y pago). Fechas en `America/Guatemala`,
 * montos con decimal.js.
 */

function texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor)
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

function fechaLocal(valor: unknown): string {
    if (valor instanceof Date) return fechaCorta(fechaCalendario(valor))
    const t = texto(valor)
    if (!t) return ''
    const fecha = fechaCalendario(t)
    return fecha.isValid ? fechaCorta(fecha) : t
}

function aIso(valor: unknown): string {
    if (valor instanceof Date) return fechaCalendario(valor).toISODate() ?? ''
    return texto(valor).slice(0, 10)
}

/** Datos comunes: impuesto, periodo, versión y vencimiento. */
function base(p: Record<string, unknown>) {
    return {
        declaracion_id: texto(p.declaracion_id),
        impuesto: nombreImpuesto(p.impuesto),
        impuesto_codigo: texto(p.impuesto),
        periodo: periodoLegible(p.periodo_desde, p.periodo_hasta),
        version: texto(p.version),
        vence: fechaLocal(p.vence_en),
    }
}

interface FilaDeclaracion {
    id: number
    impuesto: string
    periodo_desde: Date | string
    periodo_hasta: Date | string
    version: number
    sustituye_a: number | null
    numero_formulario: string | null
    fecha_presentacion: Date | string | null
}

async function declaracion(
    trx: TransactionClientContract,
    id: number | null,
): Promise<FilaDeclaracion | null> {
    if (!id) return null
    return (await trx
        .from('fiscal.declaraciones')
        .where('id', id)
        .select(
            'id',
            'impuesto',
            'periodo_desde',
            'periodo_hasta',
            'version',
            'sustituye_a',
            'numero_formulario',
            'fecha_presentacion',
        )
        .first()) as FilaDeclaracion | null
}

/**
 * `alerta.declaracion.rectificativa`: un mes que la cascada de remanentes (H34) recalculó y revisó.
 * `presentada` = la versión sustituida ya estaba presentada (su formulario y fecha no cambian aunque
 * pase a `sustituida`): la obligación quedó como «rectificativa por presentar».
 */
export async function variablesCascada(
    trx: TransactionClientContract,
    p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const actual = await declaracion(trx, entero(p.declaracion_id))
    const sustituida = await declaracion(trx, entero(actual?.sustituye_a))
    const causa = await declaracion(trx, entero(p.cascada_de))
    return {
        ...base(p),
        a_pagar_q: quetzales(texto(p.monto) || '0'),
        presentada: Boolean(sustituida?.fecha_presentacion),
        version_anterior: sustituida ? texto(sustituida.version) : '',
        formulario_anterior: texto(sustituida?.numero_formulario),
        presentada_el: fechaLocal(sustituida?.fecha_presentacion),
        causa_id: texto(p.cascada_de),
        causa_impuesto: causa ? nombreImpuesto(causa.impuesto) : '',
        causa_periodo: causa ? periodoLegible(aIso(causa.periodo_desde), aIso(causa.periodo_hasta)) : '',
        causa_version: causa ? texto(causa.version) : '',
    }
}

interface FilaPago {
    id: number
    fecha: Date | string
    impuesto: string
    mora: string
    multa: string
    total: string
    dias_atraso: number
    boleta: string | null
}

const COLUMNAS_PAGO = [
    'p.id',
    'p.fecha',
    'p.impuesto',
    'p.mora',
    'p.multa',
    'p.total',
    'p.dias_atraso',
    'p.boleta',
]

function desglose(pago: FilaPago | null) {
    return {
        pago_id: pago ? texto(pago.id) : '',
        fecha: pago ? fechaLocal(pago.fecha) : '',
        impuesto_q: pago ? quetzales(pago.impuesto) : '',
        mora_q: pago && new Decimal(pago.mora).gt(0) ? quetzales(pago.mora) : '',
        multa_q: pago && new Decimal(pago.multa).gt(0) ? quetzales(pago.multa) : '',
        dias_atraso: pago && pago.dias_atraso > 0 ? texto(pago.dias_atraso) : '',
        boleta: texto(pago?.boleta),
    }
}

/**
 * `alerta.declaracion.pagada`. El evento no trae el pago: se toma el pago vigente (sin anulación)
 * más reciente de la versión; si ya se anuló, el más reciente con ese total.
 */
export async function variablesPagada(
    trx: TransactionClientContract,
    p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const id = entero(p.declaracion_id)
    const consulta = () =>
        trx
            .from('fiscal.declaraciones_pagos as p')
            .where('p.declaracion_id', id ?? 0)
            .orderBy('p.id', 'desc')
            .select(COLUMNAS_PAGO)
    const pago = ((await consulta()
        .whereNotExists((q) =>
            q.from('fiscal.declaraciones_pagos_anulaciones as a').whereRaw('a.pago_id = p.id'),
        )
        .first()) ??
        (await consulta()
            .where('p.total', texto(p.monto) || '0')
            .first())) as FilaPago | null
    return { ...base(p), total_q: quetzales(texto(p.monto) || '0'), ...desglose(pago) }
}

/** `alerta.declaracion.pago_anulado`. */
export async function variablesPagoAnulado(
    trx: TransactionClientContract,
    p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const pagoId = entero(p.pago_id)
    const pago = pagoId
        ? ((await trx
              .from('fiscal.declaraciones_pagos as p')
              .where('p.id', pagoId)
              .select(COLUMNAS_PAGO)
              .first()) as FilaPago | null)
        : null
    return {
        ...base(p),
        total_q: quetzales(texto(p.monto) || '0'),
        motivo: texto(p.motivo),
        asiento_id: texto(p.asiento_id),
        ...desglose(pago),
        pago_id: texto(p.pago_id),
    }
}
