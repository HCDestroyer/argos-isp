import type { Schema } from '@argosisp/contracts'

/**
 * Calendario fiscal (A3, fase 7 PR A; contrato §21). Las filas son las de `fiscal.obligaciones`: la
 * vista agrega al leer `nombre`, `periodicidad`, `dias_restantes` y `vencida` (como `vistaObligacion`).
 * El fixture no corre el generador: guarda un calendario ya generado de julio a octubre de 2026 y solo
 * recalcula `vence_en` al agregar o retirar un feriado, con la misma regla que `calcularVencimiento`.
 *
 * ArgosNet (1, sobre utilidades, agente de retención de IVA desde agosto): IVA de julio y agosto
 * presentado; retenciones de ISR de agosto y septiembre vencidas (la de septiembre caía el sábado
 * 10/10 y corrió al lunes 12/10); retenciones de IVA de septiembre al 15.º día hábil de octubre (21/10;
 * con el feriado del 20/10 corre al 22/10); sin aplicar las retenciones de julio (IVA: aún no era
 * agente; ISR: no retuvo). Las retenciones de ISR no tienen formulario confirmado (`formulario: null`).
 * Fibra del Sur (2, pequeño contribuyente): SAT-2046 mensual. `feriados` arranca vacía, como la tabla.
 * Las presentadas enlazan su declaración (`declaracion_id`, `fixtures/declaraciones/datos.ts`); el ISR
 * anual de 2025 (20) va presentado.
 */

export type ObligacionFila = Omit<Schema<'ObligacionFiscal'>, 'nombre' | 'periodicidad' | 'dias_restantes' | 'vencida'>
type Impuesto = ObligacionFila['impuesto']

/** `nombre` y `periodicidad` del catálogo `l10n/gt/obligaciones.ts`. */
export const CATALOGO_OBLIGACIONES: Record<Impuesto, { nombre: string, periodicidad: Schema<'ObligacionFiscal'>['periodicidad'], parametro: string }> = {
    iva_mensual: { nombre: 'IVA mensual (régimen general)', periodicidad: 'mensual', parametro: 'iva_declaracion' },
    pc_mensual: { nombre: 'Pequeño contribuyente mensual (aunque no haya ventas)', periodicidad: 'mensual', parametro: 'pc_declaracion' },
    isr_opcional_mensual: { nombre: 'ISR régimen opcional simplificado mensual', periodicidad: 'mensual', parametro: 'isr_opcional_plazo' },
    isr_trimestral: { nombre: 'ISR pago trimestral (régimen sobre utilidades)', periodicidad: 'trimestral', parametro: 'isr_trimestral_plazo' },
    iso_trimestral: { nombre: 'Impuesto de Solidaridad trimestral', periodicidad: 'trimestral', parametro: 'iso_plazo' },
    isr_anual: { nombre: 'ISR anual (régimen sobre utilidades)', periodicidad: 'anual', parametro: 'isr_anual_plazo' },
    retenciones_iva: { nombre: 'Retenciones de IVA (agente de retención)', periodicidad: 'mensual', parametro: 'ret_iva_plazo' },
    retenciones_isr: { nombre: 'Retenciones de ISR (quien retenga)', periodicidad: 'mensual', parametro: 'isr_retenciones_plazo' },
}

/** Valor del parámetro de plazo del paquete `gt-2026.1` (`l10n/gt/parametros.ts`). */
export interface ReglaPlazo {
    plazo?: 'mes_siguiente'
    dias?: number
    dias_habiles?: boolean
    vence?: string
    cuarto_trimestre?: string
    periodo?: string
    formulario: string | null
}

export const PLAZOS: Record<Impuesto, ReglaPlazo> = {
    iva_mensual: { periodo: 'mensual', plazo: 'mes_siguiente', formulario: 'SAT-2237' },
    pc_mensual: { periodo: 'mensual', plazo: 'mes_siguiente', formulario: 'SAT-2046' },
    isr_opcional_mensual: { dias: 10, dias_habiles: true, formulario: 'SAT-1311' },
    isr_trimestral: { plazo: 'mes_siguiente', cuarto_trimestre: 'con_la_anual', formulario: 'SAT-1361' },
    iso_trimestral: { plazo: 'mes_siguiente', formulario: 'SAT-1608' },
    isr_anual: { vence: '03-31', formulario: 'SAT-1411' },
    retenciones_iva: { dias: 15, dias_habiles: true, formulario: 'SAT-2340' },
    retenciones_isr: { dias: 10, formulario: null },
}

const DIA_MS = 86_400_000

function utc(fecha: string): Date {
    return new Date(`${fecha}T00:00:00.000Z`)
}

function iso(fecha: Date): string {
    return fecha.toISOString().slice(0, 10)
}

function sumarDias(fecha: string, dias: number): string {
    return iso(new Date(utc(fecha).getTime() + dias * DIA_MS))
}

/** Sábado, domingo o feriado vigente. */
function inhabil(fecha: string, feriados: ReadonlySet<string>): boolean {
    const dia = utc(fecha).getUTCDay()
    return dia === 0 || dia === 6 || feriados.has(fecha)
}

function siguienteHabil(fecha: string, feriados: ReadonlySet<string>): string {
    let actual = fecha
    while (inhabil(actual, feriados)) {
        actual = sumarDias(actual, 1)
    }
    return actual
}

/** Primer día del mes siguiente al que termina `periodoHasta`. */
function inicioMesSiguiente(periodoHasta: string): string {
    const fecha = utc(periodoHasta)
    return iso(new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 1)))
}

function finDeMes(primero: string): string {
    const fecha = utc(primero)
    return iso(new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)))
}

/** `calcularVencimiento` de `app/fiscal/calendario.ts`: la fecha de la regla y la corrida al hábil. */
export function calcularVencimiento(periodoHasta: string, regla: ReglaPlazo, feriados: ReadonlySet<string>): { base: string, vence_en: string } {
    const mes = inicioMesSiguiente(periodoHasta)
    let base: string
    if (regla.vence) {
        base = `${Number(periodoHasta.slice(0, 4)) + 1}-${regla.vence}`
    }
    else if (regla.plazo === 'mes_siguiente') {
        base = finDeMes(mes)
    }
    else {
        const n = regla.dias ?? 1
        if (regla.dias_habiles) {
            let dia = mes
            let cuenta = inhabil(dia, feriados) ? 0 : 1
            while (cuenta < n) {
                dia = sumarDias(dia, 1)
                cuenta += inhabil(dia, feriados) ? 0 : 1
            }
            base = dia
        }
        else {
            const enesimo = sumarDias(mes, n - 1)
            const fin = finDeMes(mes)
            base = enesimo < fin ? enesimo : fin
        }
    }
    return { base, vence_en: siguienteHabil(base, feriados) }
}

/** `regla` como la guarda `generar_calendario`: parámetro, valor, vigencia, nivel y el vencimiento base. */
export function reglaDe(impuesto: Impuesto, periodoHasta: string, feriados: ReadonlySet<string>): Pick<ObligacionFila, 'vence_en' | 'regla'> {
    const valor = PLAZOS[impuesto]
    const { base, vence_en } = calcularVencimiento(periodoHasta, valor, feriados)
    return {
        vence_en,
        regla: {
            parametro: CATALOGO_OBLIGACIONES[impuesto].parametro,
            valor: { ...valor },
            vigente_desde: '2013-01-01',
            nivel: 'paquete',
            vence_base: base,
            corrido_a_habil: base !== vence_en,
        },
    }
}

const GENERADO_EN = '2026-10-01T06:00:00.000Z'

function obligacion(id: number, empresaId: number, impuesto: Impuesto, desde: string, hasta: string, extra: Partial<ObligacionFila> = {}): ObligacionFila {
    return {
        id,
        empresa_id: empresaId,
        impuesto,
        periodo_desde: desde,
        periodo_hasta: hasta,
        formulario: PLAZOS[impuesto].formulario,
        ...reglaDe(impuesto, hasta, new Set()),
        estado: 'pendiente',
        motivo_estado: null,
        declaracion_id: null,
        version: 1,
        created_at: GENERADO_EN,
        updated_at: GENERADO_EN,
        ...extra,
    }
}

const CAMBIO = { version: 2, updated_at: '2026-10-05T06:00:00.000Z' }

export function obligacionesIniciales(): ObligacionFila[] {
    return [
        obligacion(1, 1, 'iva_mensual', '2026-07-01', '2026-07-31', { estado: 'presentada', declaracion_id: 1, ...CAMBIO }),
        obligacion(2, 1, 'retenciones_isr', '2026-07-01', '2026-07-31', { estado: 'no_aplica', motivo_estado: 'sin_retenciones_isr', ...CAMBIO }),
        obligacion(3, 1, 'retenciones_iva', '2026-07-01', '2026-07-31', { estado: 'no_aplica', motivo_estado: 'no_es_agente_retencion_iva', ...CAMBIO }),
        obligacion(4, 1, 'iva_mensual', '2026-08-01', '2026-08-31', { estado: 'presentada', declaracion_id: 3, ...CAMBIO }),
        obligacion(5, 1, 'retenciones_isr', '2026-08-01', '2026-08-31'),
        obligacion(6, 1, 'retenciones_iva', '2026-08-01', '2026-08-31', { estado: 'presentada', declaracion_id: 6, ...CAMBIO }),
        obligacion(7, 1, 'iva_mensual', '2026-09-01', '2026-09-30'),
        obligacion(8, 1, 'retenciones_isr', '2026-09-01', '2026-09-30'),
        obligacion(9, 1, 'retenciones_iva', '2026-09-01', '2026-09-30'),
        obligacion(10, 1, 'isr_trimestral', '2026-07-01', '2026-09-30'),
        obligacion(11, 1, 'iso_trimestral', '2026-07-01', '2026-09-30'),
        obligacion(12, 1, 'iva_mensual', '2026-10-01', '2026-10-31'),
        obligacion(13, 1, 'retenciones_isr', '2026-10-01', '2026-10-31'),
        obligacion(14, 1, 'retenciones_iva', '2026-10-01', '2026-10-31'),
        obligacion(15, 1, 'iso_trimestral', '2026-10-01', '2026-12-31'),
        obligacion(16, 1, 'isr_anual', '2026-01-01', '2026-12-31'),
        obligacion(17, 2, 'pc_mensual', '2026-08-01', '2026-08-31', { estado: 'presentada', declaracion_id: 4, ...CAMBIO }),
        obligacion(18, 2, 'pc_mensual', '2026-09-01', '2026-09-30'),
        obligacion(19, 2, 'pc_mensual', '2026-10-01', '2026-10-31'),
        obligacion(20, 1, 'isr_anual', '2025-01-01', '2025-12-31', { estado: 'presentada', declaracion_id: 5, ...CAMBIO }),
    ]
}
