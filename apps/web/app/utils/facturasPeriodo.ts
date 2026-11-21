import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { PresentacionEstadoUi } from './estados'

type Periodo = PeriodoFacturable
type Tramo = NonNullable<PeriodosFacturables['tramo_inicial']>

/** Qué hacer con los días entre el inicio del ciclo y la instalación. */
export type ModoTramo = 'ninguno' | 'primera_factura' | 'cargo_unico'

/** Cómo se cobró el tramo, en llano. */
export const COBRO_TRAMO: Record<NonNullable<Tramo['cobrado_como']>, string> = {
    primera_factura: 'en la primera factura',
    cargo_unico: 'como cargo único',
}

/**
 * Estados de un periodo en «Emitir facturas de periodos». Color por urgencia, icono por identidad y
 * texto siempre (`docs/identidad.md`): lo emitido como la factura (info), lo que falta y el cron ya
 * debió emitir en ámbar, lo futuro y lo anterior al inicio del cobro en gris.
 */
export const ESTADOS_PERIODO: Record<EstadoPeriodoFacturable, PresentacionEstadoUi> = {
    emitida: { etiqueta: 'Emitida', color: 'info', icono: 'i-lucide-file-text' },
    bonificada: { etiqueta: 'Bonificada', color: 'success', icono: 'i-lucide-gift' },
    pendiente: { etiqueta: 'Sin emitir', color: 'warning', icono: 'i-lucide-file-clock' },
    futuro: { etiqueta: 'Futuro', color: 'neutral', icono: 'i-lucide-calendar-plus' },
    antes_de_facturar_desde: { etiqueta: 'Antes del inicio del cobro', color: 'neutral', icono: 'i-lucide-history' },
    antes_del_inicio: { etiqueta: 'Antes del inicio del servicio', color: 'neutral', icono: 'i-lucide-calendar-minus' },
}

/** Periodo pasado a mano: anterior al inicio del servicio o del cobro (permiso aparte y motivo). */
export function esPeriodoAnterior(periodo: Pick<Periodo, 'estado'>): boolean {
    return periodo.estado === 'antes_de_facturar_desde' || periodo.estado === 'antes_del_inicio'
}

/** Por qué no se le pueden emitir periodos al servicio, en llano. */
export const MOTIVOS_NO_EMITIBLE: Record<MotivoNoEmitible, string> = {
    servicio_retirado: 'Este servicio está retirado: ya no se le emiten facturas.',
    servicio_pendiente_instalacion: 'Este servicio todavía no está instalado. Su facturación empieza cuando se activa la instalación.',
    sin_plantilla: 'Este servicio no tiene plantilla de facturación, así que no se sabe cuándo ni cuánto cobrarle. Asígnale una plantilla con «Editar» en la ficha del servicio.',
}

/** Errores 422 de la emisión (`errors[0].rule`), en llano. */
const REGLAS_EMISION: Record<string, string> = {
    antes_de_facturar_desde: 'Para emitir un periodo anterior al inicio del cobro hace falta el permiso «Emitir periodo anterior».',
    antes_del_inicio: 'Para emitir un periodo anterior al inicio del servicio hace falta el permiso «Emitir periodo anterior».',
    motivo_requerido: 'Escribe el motivo: es obligatorio al emitir un periodo anterior o al cambiar un monto.',
    maximo_periodos_futuros: 'Solo se pueden adelantar hasta 12 periodos futuros.',
    maximo_periodos_anteriores: 'Solo se pueden emitir hasta 24 periodos antes del inicio del servicio.',
    editar_monto_sin_permiso: 'Para cambiar el monto de una factura hace falta el permiso «Editar monto de periodo».',
    monto_positivo: 'El monto debe ser mayor que cero, con hasta 2 decimales.',
    monto_editado_invalido: 'El monto es tan bajo que la rebaja pasa del precio del servicio. Sube el monto o emítela con el calculado.',
    tramo_inicial_sin_permiso: 'Para cobrar los días antes del primer periodo hace falta el permiso «Emitir periodo anterior».',
    tramo_ya_cobrado: 'Esos días ya se cobraron. Recarga la pantalla para ver en qué factura.',
    tramo_sin_primer_periodo: 'Para incluir esos días en la primera factura, marca el primer periodo del servicio (y que no esté emitido).',
    sin_tramo_inicial: 'Este servicio empieza justo al inicio de su ciclo: no hay días antes del primer periodo.',
    periodo_invalido: 'Uno de los periodos ya no coincide con el servicio. Recarga la lista y vuelve a elegir.',
    periodos_o_hasta: 'Elige al menos un periodo.',
    ...MOTIVOS_NO_EMITIBLE,
}

/** Motivo de un periodo pedido que no se emitió (ya estaba ocupado). */
export const MOTIVOS_OMITIDA: Record<FacturasPeriodoEmitidas['omitidas'][number]['motivo'], string> = {
    ya_emitida: 'Ya tenía factura',
    bonificada: 'Ya estaba bonificado',
}

/** La regla de un 422 de la emisión (`errors[0].rule`), o null. */
export function reglaEmision(problema: Problem): string | null {
    return problema.errors?.[0]?.rule ?? null
}

/** El error de la emisión con un título y una explicación en llano cuando se conoce la regla. */
export function problemaEmision(problema: Problem): Problem {
    const regla = reglaEmision(problema)
    const llano = regla ? REGLAS_EMISION[regla] : undefined
    return llano ? { ...problema, title: 'No se emitieron las facturas', detail: llano } : problema
}

/** Se puede marcar: pendiente o futuro (y los anteriores solo con su permiso), con monto calculado. */
export function periodoElegible(periodo: Periodo, conAnteriores: boolean): boolean {
    if (periodo.monto === null) {
        return false
    }
    if (periodo.estado === 'pendiente' || periodo.estado === 'futuro') {
        return true
    }
    return esPeriodoAnterior(periodo) && conAnteriores
}

/** Montos escritos a mano por periodo (texto tal como se escribió). */
export type MontosEditados = Record<string, string>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/**
 * El monto que se cobrará de un periodo si se escribió uno válido y distinto del calculado; null si
 * no se editó (vacío o igual). Siempre con `Decimal`, nunca con `number`.
 */
export function montoEditado(periodo: Pick<Periodo, 'periodo' | 'monto'>, montos: MontosEditados): string | null {
    const texto = montos[periodo.periodo]?.trim()
    if (!texto || !MONTO.test(texto) || periodo.monto === null) {
        return null
    }
    const valor = new Decimal(texto)
    return valor.equals(periodo.monto) ? null : valor.toFixed(2)
}

/** Inicios de los próximos `cantidad` periodos futuros que se pueden elegir, en orden. */
export function proximosFuturos(periodos: readonly Periodo[], cantidad: number): string[] {
    return periodos
        .filter(p => p.estado === 'futuro' && p.monto !== null)
        .slice(0, Math.max(0, cantidad))
        .map(p => p.periodo)
}

/**
 * «Adelantar N meses»: marca los próximos N futuros y desmarca los demás futuros; lo pendiente o
 * anterior que ya estaba marcado se queda.
 */
export function adelantar(periodos: readonly Periodo[], elegidos: readonly string[], cantidad: number): string[] {
    const futuros = new Set(periodos.filter(p => p.estado === 'futuro').map(p => p.periodo))
    const otros = elegidos.filter(p => !futuros.has(p))
    return [...otros, ...proximosFuturos(periodos, cantidad)].sort()
}

export interface ResumenEmision {
    cantidad: number
    total: Decimal
    /** lo que cubre el saldo a favor (de la más antigua a la más nueva) */
    cubre: Decimal
    porCobrar: Decimal
}

/**
 * Total de lo elegido, lo que cubre el saldo a favor y lo que queda por cobrar. Null si algún
 * elegido no tiene monto: nunca un total calculado sobre datos que faltan.
 */
export function resumenEmision(periodos: readonly Periodo[], elegidos: readonly string[], saldoAFavor: string, montos: MontosEditados = {}, cargoTramo: string | null = null): ResumenEmision | null {
    const filas = periodos.filter(p => elegidos.includes(p.periodo))
    if (filas.some(p => p.monto === null)) {
        return null
    }
    const cargo = cargoTramo && MONTO.test(cargoTramo.trim()) ? new Decimal(cargoTramo.trim()) : null
    const total = filas.reduce((suma, p) => suma.plus(montoEditado(p, montos) ?? p.monto ?? '0'), cargo ?? new Decimal(0))
    const cubre = Decimal.min(Decimal.max(new Decimal(saldoAFavor), 0), total)
    return { cantidad: filas.length + (cargo ? 1 : 0), total, cubre, porCobrar: total.minus(cubre) }
}

/** El monto es mayor que cero (nunca con `number`). */
export function montoPositivo(monto: string | null | undefined): boolean {
    return Boolean(monto) && new Decimal(monto ?? '0').gt(0)
}

/** Lo que cubre el saldo a favor de un periodo no emitido (`pagado` de la vista previa), o null. */
export function cubiertoPorSaldo(periodo: Periodo): string | null {
    if (periodo.factura_id !== null || periodo.bonificacion_id !== null || periodo.pagado === null) {
        return null
    }
    return montoPositivo(periodo.pagado) ? periodo.pagado : null
}

/**
 * Espejo de `emitirFacturasPeriodoValidator` (A3): de 1 a 60 periodos, montos editados mayores que
 * cero con hasta 2 decimales, y `motivo` de 3 a 500 caracteres, obligatorio si se eligió un periodo
 * anterior o se cambió un monto. `periodos` (la vista previa) da el monto calculado de cada uno.
 */
export function esquemaFacturasPeriodo(conAnterior: boolean, periodos: readonly Periodo[] = [], tramo: Tramo | null = null) {
    return z.object({
        periodos: z.array(z.string()).max(60, 'Hasta 60 periodos a la vez'),
        montos: z.record(z.string(), z.string()),
        motivo: z.string().trim().max(500, 'Hasta 500 caracteres'),
        tramo: z.enum(['ninguno', 'primera_factura', 'cargo_unico']).default('ninguno'),
        monto_tramo: z.string().default(''),
    }).superRefine((datos, ctx) => {
        // el tramo como cargo único puede ir solo, sin periodos (como la API)
        if (datos.periodos.length === 0 && datos.tramo !== 'cargo_unico') {
            ctx.addIssue({ code: 'custom', path: ['periodos'], message: 'Elige al menos un periodo' })
        }
        if (datos.tramo === 'primera_factura' && tramo && !datos.periodos.includes(tramo.primer_periodo)) {
            ctx.addIssue({ code: 'custom', path: ['tramo'], message: 'Marca el primer periodo del servicio para incluir esos días' })
        }
        if (datos.tramo === 'cargo_unico') {
            const texto = datos.monto_tramo.trim()
            if (!MONTO.test(texto) || !new Decimal(texto).gt(0)) {
                ctx.addIssue({ code: 'custom', path: ['monto_tramo'], message: 'Mayor que cero, con hasta 2 decimales' })
            }
        }
        const conTramo = datos.tramo !== 'ninguno'
        let editado = false
        for (const inicio of datos.periodos) {
            const texto = datos.montos[inicio]?.trim()
            if (!texto) {
                continue
            }
            if (!MONTO.test(texto) || !new Decimal(texto).gt(0)) {
                ctx.addIssue({ code: 'custom', path: ['montos', inicio], message: 'Mayor que cero, con hasta 2 decimales' })
                continue
            }
            const periodo = periodos.find(p => p.periodo === inicio)
            editado ||= periodo ? montoEditado(periodo, datos.montos) !== null : false
        }
        if ((conAnterior || conTramo || editado) && datos.motivo.length === 0) {
            const porque = conAnterior ? 'emites un periodo anterior al inicio' : conTramo ? 'cobras días antes del primer periodo' : 'cambiaste un monto'
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: `Obligatorio: ${porque}` })
        }
        else if (datos.motivo.length > 0 && datos.motivo.length < 3) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Al menos 3 caracteres' })
        }
    })
}

export type DatosFacturasPeriodo = z.output<ReturnType<typeof esquemaFacturasPeriodo>>

/**
 * Cuerpo del POST: los inicios en orden, los montos que cambiaron, el tramo inicial (con su monto
 * solo si difiere del sugerido) y el motivo solo si se escribió. Un cargo del tramo sin periodos va solo.
 */
export function cuerpoFacturasPeriodo(datos: DatosFacturasPeriodo, periodos: readonly Periodo[] = [], tramo: Tramo | null = null): CuerpoFacturasPeriodo {
    const elegidos = [...datos.periodos].sort()
    const cuerpo: CuerpoFacturasPeriodo = elegidos.length ? { periodos: elegidos } : {}
    if (datos.tramo !== 'ninguno' && tramo) {
        const monto = datos.tramo === 'cargo_unico' ? new Decimal(datos.monto_tramo.trim() || tramo.monto_proporcional) : null
        cuerpo.tramo_inicial = monto && !monto.equals(tramo.monto_proporcional)
            ? { modo: datos.tramo, monto: monto.toFixed(2) }
            : { modo: datos.tramo }
    }
    const montos = elegidos.flatMap((inicio) => {
        const periodo = periodos.find(p => p.periodo === inicio)
        const monto = periodo ? montoEditado(periodo, datos.montos) : null
        return monto ? [{ periodo: inicio, monto }] : []
    })
    if (montos.length) {
        cuerpo.montos = montos
    }
    if (datos.motivo) {
        cuerpo.motivo = datos.motivo
    }
    return cuerpo
}

/** «3 facturas emitidas, 1 ya existía». */
export function avisoEmision(resultado: FacturasPeriodoEmitidas): string {
    const creadas = resultado.creadas.length
    const cargo = resultado.tramo_inicial?.modo === 'cargo_unico'
    const partes = creadas || !cargo ? [`${creadas} ${creadas === 1 ? 'factura emitida' : 'facturas emitidas'}`] : []
    if (cargo) {
        partes.push('1 cargo único por los días antes del primer periodo')
    }
    if (resultado.bonificadas.length) {
        partes.push(`${resultado.bonificadas.length} ${resultado.bonificadas.length === 1 ? 'bonificada' : 'bonificadas'}`)
    }
    if (resultado.omitidas.length) {
        partes.push(`${resultado.omitidas.length} ya ${resultado.omitidas.length === 1 ? 'existía' : 'existían'}`)
    }
    return partes.join(', ')
}
