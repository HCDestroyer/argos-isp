import type { Problem, Schema } from '@argosisp/contracts'

/**
 * Calendario fiscal (A3, fase 7 PR A; contrato de localización fiscal §21): etiquetas de impuestos,
 * estados y motivos, el periodo y la regla del vencimiento en texto, y la cuadrícula del mes. Nada se
 * calcula aquí: vencimiento, días restantes y «vencida» vienen de la API.
 */

type Obligacion = Schema<'ObligacionFiscal'>
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type ImpuestoObligacion = Obligacion['impuesto']
export type EstadoObligacion = Obligacion['estado']

export const IMPUESTOS_OBLIGACION: Record<ImpuestoObligacion, { etiqueta: string, icono: string }> = {
    iva_mensual: { etiqueta: 'IVA', icono: 'i-lucide-percent' },
    pc_mensual: { etiqueta: 'Pequeño contribuyente', icono: 'i-lucide-store' },
    isr_opcional_mensual: { etiqueta: 'ISR opcional', icono: 'i-lucide-landmark' },
    isr_trimestral: { etiqueta: 'ISR trimestral', icono: 'i-lucide-landmark' },
    iso_trimestral: { etiqueta: 'ISO', icono: 'i-lucide-hand-heart' },
    isr_anual: { etiqueta: 'ISR anual', icono: 'i-lucide-calendar-range' },
    retenciones_iva: { etiqueta: 'Retenciones de IVA', icono: 'i-lucide-scissors' },
    retenciones_isr: { etiqueta: 'Retenciones de ISR', icono: 'i-lucide-scissors' },
}

export const IMPUESTOS_ORDEN = Object.keys(IMPUESTOS_OBLIGACION) as ImpuestoObligacion[]

export const ESTADOS_OBLIGACION: Record<EstadoObligacion, { etiqueta: string, color: BadgeColor, icono: string }> = {
    pendiente: { etiqueta: 'Pendiente', color: 'warning', icono: 'i-lucide-clock' },
    borrador: { etiqueta: 'Borrador', color: 'info', icono: 'i-lucide-file-pen-line' },
    presentada: { etiqueta: 'Presentada', color: 'success', icono: 'i-lucide-circle-check' },
    no_aplica: { etiqueta: 'No aplica', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export const ESTADOS_ORDEN = Object.keys(ESTADOS_OBLIGACION) as EstadoObligacion[]

/** La obligación volvió a borrador porque la cascada de remanentes rectificó su declaración presentada (H34). */
export function esRectificativa(obligacion: Pick<Obligacion, 'motivo_estado'>): boolean {
    return obligacion.motivo_estado === 'rectificativa'
}

/** Estado para mostrar: una pendiente o un borrador vencidos son «Vencida» en rojo. */
export function estadoVisible(obligacion: Pick<Obligacion, 'estado' | 'vencida'>): { etiqueta: string, color: BadgeColor, icono: string } {
    if (obligacion.vencida) {
        return { etiqueta: 'Vencida', color: 'error', icono: 'i-lucide-alarm-clock-off' }
    }
    return ESTADOS_OBLIGACION[obligacion.estado]
}

const MOTIVOS: Record<string, string> = {
    no_es_agente_retencion_iva: 'La empresa no era agente de retención de IVA en ese periodo',
    sin_retenciones_isr: 'No hubo retenciones de ISR en el mes (según el libro)',
    cuarto_trimestre_con_la_anual: 'El cuarto trimestre se paga con la declaración anual',
    antes_de_inicio_libros: 'El periodo es anterior al inicio de los libros en ArgosIsp',
    rectificativa: 'Rectificativa: una sustitutiva de un mes anterior cambió su remanente; hay que presentarla de nuevo',
}

/** Por qué una obligación no aplica (`motivo_estado`), en texto; `null` sin motivo. */
export function motivoObligacion(motivo: string | null): string | null {
    if (!motivo) {
        return null
    }
    if (motivo.startsWith('regimen_')) {
        return `No corresponde al régimen de la empresa en ese periodo (${etiquetaRegimen(motivo.slice('regimen_'.length))})`
    }
    return MOTIVOS[motivo] ?? motivo.replace(/_/g, ' ')
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const ORDINALES_TRIMESTRE = ['1.er', '2.º', '3.er', '4.º']

/** `septiembre 2026`, `3.er trimestre 2026` o `año 2026`. */
export function periodoObligacion(obligacion: Pick<Obligacion, 'periodicidad' | 'periodo_desde'>): string {
    const anio = obligacion.periodo_desde.slice(0, 4)
    const mes = Number(obligacion.periodo_desde.slice(5, 7)) - 1
    if (obligacion.periodicidad === 'anual') {
        return `año ${anio}`
    }
    if (obligacion.periodicidad === 'trimestral') {
        return `${ORDINALES_TRIMESTRE[Math.floor(mes / 3)]} trimestre ${anio}`
    }
    return `${MESES[mes]} ${anio}`
}

/** Plazo restante en texto; `null` cuando ya no corre (presentada o no aplica). */
export function textoDiasRestantes(obligacion: Pick<Obligacion, 'estado' | 'dias_restantes'>): string | null {
    if (obligacion.estado === 'presentada' || obligacion.estado === 'no_aplica') {
        return null
    }
    const dias = obligacion.dias_restantes
    if (dias === 0) {
        return 'Vence hoy'
    }
    if (dias === 1) {
        return 'Vence mañana'
    }
    if (dias > 1) {
        return `Faltan ${dias} días`
    }
    return dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`
}

/** Color del plazo: rojo vencida, ámbar a 7 días o menos (los umbrales de alerta), neutro el resto. */
export function colorDiasRestantes(obligacion: Pick<Obligacion, 'vencida' | 'dias_restantes'>): BadgeColor {
    if (obligacion.vencida) {
        return 'error'
    }
    return obligacion.dias_restantes <= 7 ? 'warning' : 'neutral'
}

export interface ReglaVencimiento {
    plazo: string
    parametro: string | null
    nivel: string | null
    vigenteDesde: string | null
    venceBase: string | null
    corrido: boolean
}

function registro(valor: unknown): Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? valor as Record<string, unknown> : {}
}

/** El plazo del parámetro en texto (`mes_siguiente`, n-ésimo día hábil, día n o una fecha fija). */
export function textoPlazo(valor: unknown): string {
    const regla = registro(valor)
    const vence = typeof regla.vence === 'string' ? regla.vence : null
    if (vence && /^\d{2}-\d{2}$/.test(vence)) {
        return `El ${Number(vence.slice(3))} de ${MESES[Number(vence.slice(0, 2)) - 1]} del año siguiente`
    }
    if (regla.plazo === 'mes_siguiente') {
        return 'Último día del mes siguiente al periodo'
    }
    if (typeof regla.dias === 'number') {
        return regla.dias_habiles === true ? `${regla.dias}.º día hábil del mes siguiente` : `Día ${regla.dias} del mes siguiente`
    }
    return 'Plazo sin forma conocida'
}

/** Cómo se calculó el vencimiento (`regla` de la API: parámetro, valor, vigencia, nivel, base y corrimiento). */
export function reglaVencimiento(obligacion: Pick<Obligacion, 'regla' | 'vence_en'>): ReglaVencimiento {
    const { regla } = obligacion
    const base = regla.vence_base ?? null
    return {
        plazo: textoPlazo(regla.valor),
        parametro: regla.parametro ?? null,
        nivel: regla.nivel ?? null,
        vigenteDesde: regla.vigente_desde ?? null,
        venceBase: base,
        corrido: regla.corrido_a_habil === true || (base !== null && base !== obligacion.vence_en),
    }
}

/** `YYYY-MM` de una fecha `YYYY-MM-DD`. */
export function mesDe(fecha: string): string {
    return fecha.slice(0, 7)
}

/** Mes `YYYY-MM` desplazado `delta` meses. */
export function moverMes(mes: string, delta: number): string {
    const fecha = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + delta, 1))
    return fecha.toISOString().slice(0, 7)
}

/** Primer y último día del mes. */
export function rangoMes(mes: string): { desde: string, hasta: string } {
    const fin = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0))
    return { desde: `${mes}-01`, hasta: fin.toISOString().slice(0, 10) }
}

/** `Octubre 2026`. */
export function etiquetaMes(mes: string): string {
    const nombre = MESES[Number(mes.slice(5, 7)) - 1] ?? ''
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${mes.slice(0, 4)}`
}

export const DIAS_SEMANA = [
    { corto: 'L', largo: 'Lunes' },
    { corto: 'M', largo: 'Martes' },
    { corto: 'M', largo: 'Miércoles' },
    { corto: 'J', largo: 'Jueves' },
    { corto: 'V', largo: 'Viernes' },
    { corto: 'S', largo: 'Sábado' },
    { corto: 'D', largo: 'Domingo' },
]

export interface DiaCuadricula {
    fecha: string
    dia: number
    delMes: boolean
    finDeSemana: boolean
}

/** Semanas (de lunes a domingo) que cubren el mes, con los días de los meses vecinos marcados. */
export function semanasDelMes(mes: string): DiaCuadricula[][] {
    const DIA = 86_400_000
    const { desde, hasta } = rangoMes(mes)
    const primero = new Date(`${desde}T00:00:00Z`)
    const ultimo = new Date(`${hasta}T00:00:00Z`)
    const inicio = primero.getTime() - ((primero.getUTCDay() + 6) % 7) * DIA
    const fin = ultimo.getTime() + ((7 - ultimo.getUTCDay()) % 7) * DIA
    const semanas: DiaCuadricula[][] = []
    for (let instante = inicio; instante <= fin; instante += DIA) {
        const dia = new Date(instante)
        const fecha = dia.toISOString().slice(0, 10)
        if ((semanas.at(-1)?.length ?? 7) === 7) {
            semanas.push([])
        }
        semanas.at(-1)?.push({ fecha, dia: dia.getUTCDate(), delMes: fecha.startsWith(mes), finDeSemana: [0, 6].includes(dia.getUTCDay()) })
    }
    return semanas
}

/** Nombre del día de la semana de una fecha `YYYY-MM-DD` (`jueves`). */
export function diaSemana(fecha: string): string {
    return (DIAS_SEMANA[(new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7]?.largo ?? '').toLowerCase()
}

const TITULOS_CALENDARIO: Record<string, string> = {
    feriado_duplicado: 'Esa fecha ya es feriado',
    feriado_inexistente: 'Esa fecha no es feriado',
}

/** Problemas del calendario y los feriados con título legible (los fiscales comunes, de `problemaFiscalLegible`). */
export function problemaCalendarioLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    const titulo = codigo ? TITULOS_CALENDARIO[codigo] : undefined
    if (titulo) {
        return { ...problema, title: titulo }
    }
    const fiscal = problemaFiscalLegible(problema)
    if (codigo === 'alcance_global_requerido') {
        return { ...fiscal, detail: 'Los feriados valen para todas las empresas: solo un usuario con alcance global puede agregarlos o retirarlos.' }
    }
    return fiscal
}

export const PERIODICIDADES_OBLIGACION: Record<Obligacion['periodicidad'], string> = {
    mensual: 'Mensual',
    trimestral: 'Trimestral',
    anual: 'Anual',
}
