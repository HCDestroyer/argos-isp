import { Decimal } from 'decimal.js'
import { OBLIGACIONES_GT } from '#fiscal/l10n/gt/obligaciones'
import { fechaCalendario, fechaCorta, mesAnio, quetzales } from '#notify/formato'

/**
 * Variables de los avisos del calendario fiscal (fase 7 PR A; contrato de localización fiscal
 * §14 y §21): `fiscal.vencimiento_proximo` y `fiscal.limite_pc`, que emite A3 desde el cron
 * `fiscal:calendario`. Solo arman texto: fechas en `America/Guatemala` y montos con decimal.js.
 */

function texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor)
}

function decimal(valor: unknown): Decimal | null {
    try {
        const d = new Decimal(texto(valor))
        return d.isFinite() ? d : null
    } catch {
        return null
    }
}

/** "IVA mensual (régimen general)"; el código si el catálogo no lo conoce. */
export function nombreImpuesto(impuesto: unknown): string {
    const codigo = texto(impuesto)
    return OBLIGACIONES_GT.find((o) => o.impuesto === codigo)?.nombre ?? (codigo || 'Obligación fiscal')
}

/** Fecha corta en Guatemala (`dd/MM/yyyy`) de un `YYYY-MM-DD`; '' si no es válida. */
function fechaLocal(valor: unknown): string {
    const t = texto(valor)
    if (!t) return ''
    const fecha = fechaCalendario(t)
    return fecha.isValid ? fechaCorta(fecha) : t
}

/**
 * Periodo legible: un mes completo → "octubre 2026"; un año completo → "año 2026"; un trimestre
 * → "3.er trimestre 2026"; si no, "01/07/2026 al 30/09/2026".
 */
export function periodoLegible(desde: unknown, hasta: unknown): string {
    const d = fechaCalendario(texto(desde))
    const h = fechaCalendario(texto(hasta))
    if (!d.isValid || !h.isValid) return [texto(desde), texto(hasta)].filter(Boolean).join(' al ')
    const completo = d.day === 1 && h.hasSame(h.endOf('month'), 'day') && d.year === h.year
    if (completo && d.month === h.month) return mesAnio(d)
    if (completo && d.month === 1 && h.month === 12) return `año ${d.year}`
    if (completo && h.month - d.month === 2 && (d.month - 1) % 3 === 0) {
        const trimestre = (d.month - 1) / 3 + 1
        const ordinal = ['1.er', '2.º', '3.er', '4.º'][trimestre - 1]
        return `${ordinal} trimestre ${d.year}`
    }
    return `${fechaCorta(d)} al ${fechaCorta(h)}`
}

/** "vence hoy", "vence mañana", "vence en 3 días". */
export function cuandoVence(dias: number): string {
    if (dias <= 0) return 'vence hoy'
    if (dias === 1) return 'vence mañana'
    return `vence en ${dias} días`
}

/** Variables `alerta.*` de `alerta.fiscal.vencimiento_proximo`. */
export function variablesVencimiento(p: Record<string, unknown>): Record<string, unknown> {
    const dias = Number.isFinite(Number(p.dias)) ? Math.trunc(Number(p.dias)) : Number(p.umbral) || 0
    return {
        obligacion_id: texto(p.obligacion_id),
        impuesto: nombreImpuesto(p.impuesto),
        impuesto_codigo: texto(p.impuesto),
        periodo: periodoLegible(p.periodo_desde, p.periodo_hasta),
        formulario: texto(p.formulario),
        vence: fechaLocal(p.vence_en),
        dias,
        cuando: cuandoVence(dias),
        hoy: dias <= 0,
        umbral: texto(p.umbral),
    }
}

/** "80 %", "100 %", "92.5 %". */
function porcentaje(valor: Decimal): string {
    return `${valor.toDecimalPlaces(2).toString()} %`
}

/**
 * Variables `alerta.*` de `alerta.fiscal.limite_pc`. `supera` (umbral ≥ 100 %) cambia el texto:
 * la empresa debe pasar al régimen general (inv. A.3); el sistema nunca cambia el régimen solo.
 */
export function variablesLimitePc(p: Record<string, unknown>): Record<string, unknown> & { umbral: string } {
    const umbral = decimal(p.umbral_pct) ?? new Decimal(0)
    const acumulado = decimal(p.acumulado) ?? new Decimal(0)
    const limite = decimal(p.limite)
    const real = limite && limite.gt(0) ? acumulado.div(limite).times(100) : null
    return {
        umbral: umbral.toFixed(2),
        umbral_texto: porcentaje(umbral),
        porcentaje: real ? porcentaje(real) : '',
        acumulado_q: quetzales(acumulado),
        limite_q: limite ? quetzales(limite) : '',
        disponible_q: limite && limite.gt(acumulado) ? quetzales(limite.minus(acumulado)) : '',
        anio: texto(p.anio),
        supera: umbral.gte(100),
    }
}
