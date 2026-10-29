import type { Problem, Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Bloqueos del libro (A3, fase 6 PR A, contrato fiscal §11). Por empresa hay un `hasta` vigente de cada
 * tipo: nada se registra con fecha ≤ hasta bajo un bloqueo que le aplique (422 `periodo_bloqueado`),
 * salvo con una excepción vigente; bajo el **duro**, nada, ni con excepción (409 `bloqueo_duro`).
 * Los bloqueos solo avanzan; global, ventas y compras retroceden con «desbloquear» (con motivo),
 * impuestos y el duro nunca.
 */

export type BloqueoLibro = Schema<'BloqueoLibro'>
export type BloqueosEmpresa = Schema<'BloqueosEmpresa'>
export type ExcepcionBloqueo = Schema<'ExcepcionBloqueo'>
export type TipoBloqueo = BloqueoLibro['tipo']
export type TipoBloqueoNormal = Exclude<TipoBloqueo, 'duro'>
type Color = NonNullable<BadgeProps['color']>

export const TIPOS_BLOQUEO: Record<TipoBloqueo, { etiqueta: string, descripcion: string, icono: string }> = {
    global: { etiqueta: 'Global', descripcion: 'Todo el libro de la empresa.', icono: 'i-lucide-lock' },
    ventas: { etiqueta: 'Ventas', descripcion: 'El diario de ventas: facturas, notas de crédito y moras.', icono: 'i-lucide-receipt-text' },
    compras: { etiqueta: 'Compras', descripcion: 'El diario de compras y los pagos a proveedores.', icono: 'i-lucide-shopping-cart' },
    impuestos: { etiqueta: 'Impuestos', descripcion: 'Los asientos que tocan una cuenta de impuesto. No retrocede: se usa una excepción.', icono: 'i-lucide-landmark' },
    duro: { etiqueta: 'Bloqueo duro', descripcion: 'Nada con fecha hasta ese día, ni con excepción, y ningún mes se reabre. Nunca retrocede.', icono: 'i-lucide-shield-alert' },
}

export const TIPOS_NORMALES: readonly TipoBloqueoNormal[] = ['global', 'ventas', 'compras', 'impuestos']
/** Los que retroceden con «desbloquear» (impuestos y el duro no). */
export const TIPOS_DESBLOQUEABLES: readonly TipoBloqueoNormal[] = ['global', 'ventas', 'compras']

export const ESTADOS_EXCEPCION: Record<ExcepcionBloqueo['estado'], { etiqueta: string, color: Color }> = {
    vigente: { etiqueta: 'Vigente', color: 'warning' },
    vencida: { etiqueta: 'Vencida', color: 'neutral' },
    revocada: { etiqueta: 'Revocada', color: 'neutral' },
}

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** El texto exacto que pide el bloqueo duro (`confirmacion`). */
export function confirmacionDuro(hasta: string): string {
    return `BLOQUEO DURO hasta ${hasta}`
}

/** El bloqueo más alto que aplica a ventas, compras o impuestos: el propio, el global o el duro. */
export function bloqueoEfectivo(vigentes: BloqueosEmpresa['vigentes'], tipo: TipoBloqueoNormal): string | null {
    const fechas = [vigentes[tipo], tipo === 'global' ? null : vigentes.global, vigentes.duro].filter((f): f is string => !!f)
    return fechas.length ? fechas.sort().at(-1) ?? null : null
}

const motivo = z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Hasta 500 caracteres')
const fecha = z.string().trim().regex(FECHA, 'Elige una fecha válida (AAAA-MM-DD)')

/** Bloquear o avanzar un tipo (`POST /libro/bloqueos`): solo avanza, no futuro, nunca antes del duro. */
export function esquemaBloquear(vigentes: BloqueosEmpresa['vigentes'], hoy: string) {
    return z.object({
        tipo: z.enum(['global', 'ventas', 'compras', 'impuestos']),
        hasta: fecha,
        motivo,
    }).superRefine((d, ctx) => {
        if (!FECHA.test(d.hasta)) {
            return
        }
        const actual = vigentes[d.tipo]
        if (d.hasta > hoy) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'No se bloquea el futuro: hasta hoy como máximo' })
        }
        else if (actual && d.hasta <= actual) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: `Solo avanza: el vigente es ${actual}. Para retroceder use «Desbloquear»` })
        }
        else if (vigentes.duro && d.hasta < vigentes.duro) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: `No puede quedar antes del bloqueo duro (${vigentes.duro})` })
        }
    })
}

/** Retroceder un tipo (`POST /libro/bloqueos/desbloquear`): a una fecha anterior o sin bloqueo. */
export function esquemaDesbloquear(vigentes: BloqueosEmpresa['vigentes']) {
    return z.object({
        tipo: z.enum(['global', 'ventas', 'compras']),
        sin_bloqueo: z.boolean(),
        hasta: z.string().trim(),
        motivo,
    }).superRefine((d, ctx) => {
        if (d.sin_bloqueo) {
            return
        }
        const actual = vigentes[d.tipo]
        if (!FECHA.test(d.hasta)) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Elige una fecha válida (AAAA-MM-DD)' })
        }
        else if (actual && d.hasta >= actual) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: `Debe ser anterior al vigente (${actual})` })
        }
        else if (vigentes.duro && d.hasta < vigentes.duro) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: `No puede quedar antes del bloqueo duro (${vigentes.duro})` })
        }
    })
}

/** Bloqueo duro (`POST /libro/bloqueos/duro`): la confirmación debe ser el texto exacto con la misma fecha. */
export function esquemaDuro(vigentes: BloqueosEmpresa['vigentes'], hoy: string) {
    return z.object({
        hasta: fecha,
        motivo,
        confirmacion: z.string(),
    }).superRefine((d, ctx) => {
        if (!FECHA.test(d.hasta)) {
            return
        }
        if (d.hasta > hoy) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'No se bloquea el futuro: hasta hoy como máximo' })
        }
        else if (vigentes.duro && d.hasta <= vigentes.duro) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: `Solo avanza: el duro vigente es ${vigentes.duro}` })
        }
        if (d.confirmacion !== confirmacionDuro(d.hasta)) {
            ctx.addIssue({ code: 'custom', path: ['confirmacion'], message: `Escriba exactamente «${confirmacionDuro(d.hasta)}»` })
        }
    })
}

/** Excepción (`POST /libro/bloqueos/excepciones`): siempre con fin futuro; nunca para el duro. */
export function esquemaExcepcion(ahora: number) {
    return z.object({
        tipo: z.enum(['global', 'ventas', 'compras', 'impuestos']),
        usuario_id: z.number().int().positive().nullable(),
        motivo,
        hasta_en: z.string().trim().regex(LOCAL, 'Fecha y hora de fin'),
    }).superRefine((d, ctx) => {
        const fin = LOCAL.test(d.hasta_en) ? instanteGuatemala(d.hasta_en) : null
        if (fin && Date.parse(fin) <= ahora) {
            ctx.addIssue({ code: 'custom', path: ['hasta_en'], message: 'El fin debe ser futuro' })
        }
    })
}

/** Requisitos del duro que la API no ve cumplidos (422 `bloqueo_duro_requisitos`, `errors[].rule`). */
const REQUISITOS_DURO: Record<string, string> = {
    meses_abiertos: 'Meses sin cerrar',
    dte_pendientes: 'DTE sin certificar',
    extractos_sin_conciliar: 'Líneas de extracto sin conciliar',
}

/** El error de la API con un título que se entiende (los mensajes de `errors[]` quedan en el detalle). */
export function problemaBloqueoLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    if (codigo === 'bloqueo_duro_requisitos') {
        const faltan = (problema.errors ?? []).map((e) => {
            const etiqueta = REQUISITOS_DURO[e.rule ?? ''] ?? e.rule ?? ''
            return e.message.toLowerCase().startsWith(etiqueta.toLowerCase()) ? e.message : `${etiqueta}: ${e.message}`
        })
        return { ...problema, title: 'Faltan requisitos para el bloqueo duro', detail: faltan.length ? faltan.join(' · ') : problema.detail }
    }
    if (codigo === 'checks_pendientes') {
        return problemaCheckLegible(problema)
    }
    if (codigo === 'periodo_bloqueado') {
        const tipo = problema.errors?.[0]?.rule
        const visual = tipo && Object.hasOwn(TIPOS_BLOQUEO, tipo) ? TIPOS_BLOQUEO[tipo as TipoBloqueo] : null
        return { ...problema, title: visual ? `Periodo bloqueado (${visual.etiqueta.toLowerCase()})` : 'Periodo bloqueado' }
    }
    const titulos: Record<string, string> = {
        bloqueo_duro: 'Bajo el bloqueo duro no entra nada',
        bloqueo_regresivo: 'Los bloqueos solo avanzan',
        bloqueo_futuro: 'No se bloquea el futuro',
        bloqueo_bajo_duro: 'No puede quedar antes del bloqueo duro',
        confirmacion_invalida: 'La confirmación no coincide',
        excepcion_sin_fin: 'La excepción necesita una fecha de fin',
        excepcion_revocada: 'La excepción ya estaba revocada',
        sin_bloqueo: 'Ese tipo no tiene bloqueo',
    }
    return codigo && Object.hasOwn(titulos, codigo) ? { ...problema, title: titulos[codigo] ?? problema.title } : problema
}

/*
 * Procesos pendientes por un bloqueo: una corrida de facturar (`POST /facturas/generar`) o de vencer
 * (`POST /facturas/vencer`) no contabiliza lo que cae bajo un bloqueo; lo cuenta en `bloqueados` y lo
 * detalla en `bloqueos[]`, y la siguiente corrida lo reintenta.
 */
export type BloqueoDeProceso = NonNullable<Schema<'ResultadoGeneracion'>['bloqueos']>[number]
export type ProcesoConBloqueo = 'facturar' | 'vencer'

export const PROCESOS_CON_BLOQUEO: Record<ProcesoConBloqueo, { etiqueta: string, descripcion: string, icono: string }> = {
    facturar: { etiqueta: 'Facturación pendiente', descripcion: 'Genera las facturas de todo lo pendiente hasta hoy.', icono: 'i-lucide-receipt-text' },
    vencer: { etiqueta: 'Vencimiento y moras', descripcion: 'Vence lo que ya venció y crea los recargos por mora.', icono: 'i-lucide-calendar-x' },
}
