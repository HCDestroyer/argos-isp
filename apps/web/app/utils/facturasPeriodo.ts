import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { PresentacionEstadoUi } from './estados'

type Periodo = PeriodoFacturable

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
    motivo_requerido: 'Escribe el motivo: es obligatorio al emitir un periodo anterior al inicio del cobro.',
    maximo_periodos_futuros: 'Solo se pueden adelantar hasta 12 periodos futuros.',
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

/** Se puede marcar: pendiente o futuro (y anterior solo con su permiso), con monto calculado. */
export function periodoElegible(periodo: Periodo, conAnteriores: boolean): boolean {
    if (periodo.monto === null) {
        return false
    }
    if (periodo.estado === 'pendiente' || periodo.estado === 'futuro') {
        return true
    }
    return periodo.estado === 'antes_de_facturar_desde' && conAnteriores
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
export function resumenEmision(periodos: readonly Periodo[], elegidos: readonly string[], saldoAFavor: string): ResumenEmision | null {
    const filas = periodos.filter(p => elegidos.includes(p.periodo))
    if (filas.some(p => p.monto === null)) {
        return null
    }
    const total = filas.reduce((suma, p) => suma.plus(p.monto ?? '0'), new Decimal(0))
    const cubre = Decimal.min(Decimal.max(new Decimal(saldoAFavor), 0), total)
    return { cantidad: filas.length, total, cubre, porCobrar: total.minus(cubre) }
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
 * Espejo de `emitirFacturasPeriodoValidator` (A3): de 1 a 60 periodos y `motivo` de 3 a 500
 * caracteres, obligatorio si se eligió un periodo anterior al inicio del cobro.
 */
export function esquemaFacturasPeriodo(conAnterior: boolean) {
    return z.object({
        periodos: z.array(z.string()).min(1, 'Elige al menos un periodo').max(60, 'Hasta 60 periodos a la vez'),
        motivo: z.string().trim().max(500, 'Hasta 500 caracteres'),
    }).superRefine((datos, ctx) => {
        if (conAnterior && datos.motivo.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Obligatorio: emites un periodo anterior al inicio del cobro' })
        }
        else if (datos.motivo.length > 0 && datos.motivo.length < 3) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Al menos 3 caracteres' })
        }
    })
}

export type DatosFacturasPeriodo = z.output<ReturnType<typeof esquemaFacturasPeriodo>>

/** Cuerpo del POST: los inicios en orden y el motivo solo si se escribió. */
export function cuerpoFacturasPeriodo(datos: DatosFacturasPeriodo): CuerpoFacturasPeriodo {
    const cuerpo: CuerpoFacturasPeriodo = { periodos: [...datos.periodos].sort() }
    if (datos.motivo) {
        cuerpo.motivo = datos.motivo
    }
    return cuerpo
}

/** «3 facturas emitidas, 1 ya existía». */
export function avisoEmision(resultado: FacturasPeriodoEmitidas): string {
    const creadas = resultado.creadas.length
    const partes = [`${creadas} ${creadas === 1 ? 'factura emitida' : 'facturas emitidas'}`]
    if (resultado.bonificadas.length) {
        partes.push(`${resultado.bonificadas.length} ${resultado.bonificadas.length === 1 ? 'bonificada' : 'bonificadas'}`)
    }
    if (resultado.omitidas.length) {
        partes.push(`${resultado.omitidas.length} ya ${resultado.omitidas.length === 1 ? 'existía' : 'existían'}`)
    }
    return partes.join(', ')
}
