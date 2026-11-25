import type { Problem, Schema, paths } from '@argosisp/contracts'
import { z } from 'zod'

type Promocion = Schema<'PromocionVelocidad'>
type Asignacion = Schema<'PromocionServicio'>
type Vigencia = Promocion['vigencia']
type DatosCrearPromocion = paths['/api/v1/promociones-velocidad']['post']['requestBody']['content']['application/json']

/**
 * Textos y reglas de las promociones de velocidad (decisiones del PM 18 y 34; tableros
 * PendPromociones, PendPromocionForm, PendPromocionesMovil y la pestaña Promociones de
 * OperServicioFicha). Las horas son de Guatemala; la API compara `inicio` y `fin` en UTC.
 */

export const VIGENCIAS_PROMOCION: readonly Vigencia[] = ['vigente', 'programada', 'terminada', 'cancelada']

export const PESTANAS_PROMOCION: Record<Vigencia, { etiqueta: string, icono: string }> = {
    vigente: { etiqueta: 'Vigentes', icono: 'i-lucide-zap' },
    programada: { etiqueta: 'Programadas', icono: 'i-lucide-calendar' },
    terminada: { etiqueta: 'Terminadas', icono: 'i-lucide-check' },
    cancelada: { etiqueta: 'Canceladas', icono: 'i-lucide-circle-x' },
}

export function esVigenciaPromocion(valor: unknown): valor is Vigencia {
    return typeof valor === 'string' && (VIGENCIAS_PROMOCION as readonly string[]).includes(valor)
}

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
/** Letras de los botones de días (1 = lunes … 7 = domingo). */
export const LETRAS_DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
export const NOMBRES_DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** `[1,2,3,4,5]` → `lun a vie`; `[6,7]` → `sáb a dom`; `[1,3,5]` → `lun, mié, vie`; `null` o los 7 → `null` (todos los días). */
export function textoDiasSemana(dias: readonly number[] | null | undefined): string | null {
    if (!dias?.length || dias.length === 7) {
        return null
    }
    const orden = [...new Set(dias)].sort((a, b) => a - b)
    const seguidos = orden.length > 2 && orden.every((d, i) => i === 0 || d === orden[i - 1]! + 1)
    if (seguidos) {
        return `${DIAS_CORTOS[orden[0]! - 1]} a ${DIAS_CORTOS[orden[orden.length - 1]! - 1]}`
    }
    return orden.map(d => DIAS_CORTOS[d - 1]).join(', ')
}

/** «x2» o el nombre del plan destino (columna Velocidad). */
export function velocidadCortaPromocion(p: Pick<Promocion, 'tipo_velocidad' | 'multiplicador' | 'plan_destino_nombre'>): string {
    if (p.tipo_velocidad === 'plan_destino') {
        return p.plan_destino_nombre ?? 'Otro plan'
    }
    return `x${multiplicadorCorto(p.multiplicador)}`
}

/** `"2.00"` → `2`; `"1.50"` → `1.5`. */
export function multiplicadorCorto(valor: string | number | null | undefined): string {
    const numero = Number(valor ?? 0)
    return Number.isFinite(numero) ? String(Math.round(numero * 100) / 100) : '—'
}

/** «El doble de su plan» / «Pasa a Pyme 200». */
export function velocidadLargaPromocion(p: Pick<Promocion, 'tipo_velocidad' | 'multiplicador' | 'plan_destino_nombre'>): string {
    if (p.tipo_velocidad === 'plan_destino') {
        return `Pasa a ${p.plan_destino_nombre ?? 'otro plan'}`
    }
    const m = Number(p.multiplicador ?? 0)
    if (m === 2) {
        return 'El doble de su plan'
    }
    if (m === 3) {
        return 'El triple de su plan'
    }
    if (m === 1.5) {
        return 'Una vez y media su plan'
    }
    return `${multiplicadorCorto(p.multiplicador)} veces su plan`
}

/** «Franja diaria» o «Días completos». */
export function cuandoPromocion(p: Pick<Promocion, 'modo'>): string {
    return p.modo === 'franja' ? 'Franja diaria' : 'Días completos'
}

/** «18:00 a 23:00 · lun a vie», «10:00 a 22:00» o «Todo el día». */
export function horarioPromocion(p: Pick<Promocion, 'modo' | 'franja_inicio' | 'franja_fin' | 'dias_semana'>): string {
    if (p.modo !== 'franja' || !p.franja_inicio || !p.franja_fin) {
        return 'Todo el día'
    }
    const dias = textoDiasSemana(p.dias_semana)
    return `${p.franja_inicio} a ${p.franja_fin}${dias ? ` · ${dias}` : ''}`
}

/** «1 dic – 31 dic 2026» (mismo año) o «1 dic 2026 – 31 ene 2027», en hora de Guatemala. */
export function periodoPromocion(p: Pick<Promocion, 'inicio' | 'fin'>): string {
    const anio = (iso: string) => new Intl.DateTimeFormat('es-GT', { timeZone: ZONA_HORARIA, year: 'numeric' }).format(new Date(iso))
    // El fin es un instante exclusivo: medianoche del 1 de enero se lee como «31 dic».
    const finMostrado = new Date(new Date(p.fin).getTime() - 1).toISOString()
    const referencia = new Date(Date.UTC(1900, 0, 1))
    const desde = formatearFechaCorta(p.inicio, referencia)
    const hasta = formatearFechaCorta(finMostrado, referencia)
    if (anio(p.inicio) === anio(finMostrado)) {
        return `${desde.replace(/ \d{4}$/, '')} – ${hasta}`
    }
    return `${desde} – ${hasta}`
}

/** «Gratis» o «Q 900.00 /mes». */
export function precioPromocion(p: Pick<Promocion, 'precio'>): string {
    return p.precio === null ? 'Gratis' : `${formatearQuetzales(p.precio)} /mes`
}

/** «No cambia la factura» o «Se cobra la diferencia, proporcional». */
export function precioAyudaPromocion(p: Pick<Promocion, 'precio'>): string {
    return p.precio === null ? 'No cambia la factura' : 'Se cobra la diferencia, proporcional'
}

export type ColorEstadoPromocion = 'success' | 'warning' | 'info' | 'neutral' | 'error'

export interface EstadoPromocion {
    etiqueta: string
    icono: string
    color: ColorEstadoPromocion
    /** Frase de «ahora» del detalle: «18:00 a 23:00 · se quita sola a las 23:00». */
    ahora: string
}

/** El estado con ícono, texto y color (columna Estado y cabecera del detalle). */
export function estadoPromocion(p: Promocion, hoy: Date = new Date()): EstadoPromocion {
    switch (p.vigencia) {
        case 'vigente':
            if (p.tramo_actual) {
                const fin = p.tramo_actual.fin
                const finTexto = new Date(fin).getTime() >= new Date(p.fin).getTime() - 60_000
                    ? `hasta el ${formatearFechaCorta(new Date(new Date(p.fin).getTime() - 1).toISOString(), hoy)}`
                    : `se quita sola a las ${formatearHora(fin)}`
                return {
                    etiqueta: 'Aplicada ahora',
                    icono: 'i-lucide-zap',
                    color: 'success',
                    ahora: p.modo === 'franja' ? `${horarioPromocion(p)} · ${finTexto}` : `Todo el día ${finTexto}`,
                }
            }
            return {
                etiqueta: 'Fuera de su horario',
                icono: 'i-lucide-clock',
                color: 'warning',
                ahora: p.proximo_tramo ? `Vuelve ${cuandoVuelve(p.proximo_tramo.inicio, hoy)}` : 'No le quedan horas dentro del periodo',
            }
        case 'programada':
            return { etiqueta: `Empieza el ${formatearFechaCorta(p.inicio, hoy)}`, icono: 'i-lucide-calendar', color: 'info', ahora: 'Todavía no empieza' }
        case 'terminada':
            return {
                etiqueta: 'Terminada',
                icono: 'i-lucide-check',
                color: 'neutral',
                ahora: `Terminó el ${formatearFechaCorta(new Date(new Date(p.fin).getTime() - 1).toISOString(), hoy)}`,
            }
        default:
            return {
                etiqueta: 'Cancelada',
                icono: 'i-lucide-circle-x',
                color: 'error',
                ahora: `Cancelada el ${formatearFechaCorta(p.cancelada_en ?? p.updated_at, hoy)}${p.motivo_cancelacion ? `: «${p.motivo_cancelacion}»` : ''}`,
            }
    }
}

/** «mañana a las 08:00», «hoy a las 18:00» o «el 3 dic a las 08:00». */
export function cuandoVuelve(instante: string, hoy: Date = new Date()): string {
    const dia = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date(d))
    const manana = new Date(hoy.getTime() + 86_400_000)
    const hora = formatearHora(instante)
    if (dia(instante) === dia(hoy)) {
        return `hoy a las ${hora}`
    }
    if (dia(instante) === dia(manana)) {
        return `mañana a las ${hora}`
    }
    return `el ${formatearFechaCorta(instante, hoy)} a las ${hora}`
}

/**
 * Estado de un servicio dentro de la promoción (lista de servicios del detalle y pestaña del
 * servicio): quitada, aplicada ahora (`tramo_abierto`), fuera de su horario, o lo que diga la
 * promoción (programada, terminada, cancelada). «Sin sesión ahora» del tablero no va: la API no
 * dice si el servicio tiene sesión (pedido en `.claude/integration/a4.md`).
 */
export function estadoAsignacion(a: Asignacion, promocion: Pick<Promocion, 'vigencia'> | null, hoy: Date = new Date()): { etiqueta: string, icono: string, color: ColorEstadoPromocion } {
    if (a.estado === 'quitada') {
        const fecha = a.quitada_en ? ` el ${formatearFechaCorta(a.quitada_en, hoy)}` : ''
        return { etiqueta: `Quitada${fecha}${a.motivo ? ` · «${a.motivo}»` : ''}`, icono: 'i-lucide-circle-x', color: 'neutral' }
    }
    if (a.tramo_abierto) {
        return { etiqueta: 'Aplicada ahora', icono: 'i-lucide-zap', color: 'success' }
    }
    switch (promocion?.vigencia) {
        case 'programada':
            return { etiqueta: 'Todavía no empieza', icono: 'i-lucide-calendar', color: 'info' }
        case 'terminada':
            return { etiqueta: 'Terminó', icono: 'i-lucide-check', color: 'neutral' }
        case 'cancelada':
            return { etiqueta: 'Cancelada', icono: 'i-lucide-circle-x', color: 'neutral' }
        default:
            return { etiqueta: 'Fuera de su horario', icono: 'i-lucide-clock', color: 'warning' }
    }
}

/** La promoción acepta servicios, quitarlos o cancelarse: activa y sin terminar. */
export function promocionAbierta(p: Pick<Promocion, 'estado' | 'vigencia'>): boolean {
    return p.estado === 'activa' && p.vigencia !== 'terminada' && p.vigencia !== 'cancelada'
}

/* ---------- 422 al crear o asignar (todo o nada) ---------- */

/** Título de cada regla de la API (`crear_promocion_velocidad` y `asignar_promocion_velocidad`, A1). */
export const REGLAS_PROMOCION: Record<string, { titulo: string, ayuda: string }> = {
    promocion_supera_capacidad: { titulo: 'Supera la capacidad del router', ayuda: 'Quítalo de la lista o usa una promoción más baja.' },
    promocion_solapada: { titulo: 'Se encima con otra promoción', ayuda: 'Un servicio no puede tener dos promociones con fechas que se crucen.' },
    promocion_requiere_plan_destino: { titulo: 'Este router necesita un plan destino', ayuda: 'En routers que controlan la velocidad por plan (PCQ o árbol) no se puede multiplicar: usa «Pasar a otro plan».' },
    promocion_plan_incompatible: { titulo: 'El plan destino no es compatible', ayuda: 'Debe estar en el router del servicio y tener la misma IPv6.' },
    promocion_con_plan_temporal: { titulo: 'El servicio tiene un plan temporal', ayuda: 'La promoción y el plan temporal no pueden cambiar el plan a la vez.' },
    promocion_estrategia_incompatible: { titulo: 'Su router no controla la velocidad por servicio', ayuda: 'Un router PPPoE sin RADIUS cortaría la sesión: la promoción no se le puede dar.' },
    servicio_de_otra_empresa: { titulo: 'El servicio es de otra empresa', ayuda: 'La promoción y sus servicios son de la misma empresa.' },
    servicio_retirado: { titulo: 'El servicio está retirado', ayuda: 'Quítalo de la lista.' },
    servicio_inexistente: { titulo: 'El servicio no existe', ayuda: 'Quítalo de la lista.' },
    plan_inactivo: { titulo: 'El plan destino no está en venta', ayuda: 'Elige un plan activo.' },
    promocion_cerrada: { titulo: 'La promoción ya terminó o está cancelada', ayuda: 'Ya no acepta servicios.' },
}

export interface FallaPromocion {
    titulo: string
    detalle: string
    ayuda: string
    /** El servicio que impidió guardar, si la API lo dice. */
    servicioId: number | null
}

/**
 * Lee un 422 de regla de la API. El servicio sale de `errors[].message` («Servicio 731») o, si no
 * viene ahí (capacidad, estrategia), del `detail` («…el servicio 731…»). `null` si el problema no
 * es una regla de promociones (los 422 por campo van junto a cada campo).
 */
export function fallaPromocion(problema: Problem): FallaPromocion | null {
    const codigo = codigoProblema(problema)
    if (problema.status !== 422 || !codigo || !(codigo in REGLAS_PROMOCION)) {
        return null
    }
    const regla = REGLAS_PROMOCION[codigo]!
    const textos = [...(problema.errors ?? []).map(e => e.message), problema.detail ?? '']
    let servicioId: number | null = null
    for (const t of textos) {
        const m = /servicio (\d+)/i.exec(t)
        if (m) {
            servicioId = Number(m[1])
            break
        }
    }
    return { titulo: regla.titulo, detalle: problema.detail ?? '', ayuda: regla.ayuda, servicioId }
}

/* ---------- Formulario (espejo de `crearPromocionVelocidadValidator`) ---------- */

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function esquemaPromocion() {
    return z.object({
        nombre: z.string().trim().min(3, 'Al menos 3 caracteres').max(120, 'Máximo 120 caracteres'),
        descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
        tipo_velocidad: z.enum(['multiplicador', 'plan_destino']),
        multiplicador: z.number().nullable(),
        plan_destino_id: z.number().int().positive().nullable(),
        modo: z.enum(['dias', 'franja']),
        inicio: z.string().refine(v => instanteGuatemala(v) !== null, 'Elige la fecha y la hora'),
        fin: z.string().refine(v => instanteGuatemala(v) !== null, 'Elige la fecha y la hora'),
        franja_inicio: z.string(),
        franja_fin: z.string(),
        dias_semana: z.array(z.number().int().min(1).max(7)),
        cobrar: z.boolean(),
        precio: z.string(),
    }).superRefine((d, ctx) => {
        if (d.tipo_velocidad === 'multiplicador') {
            if (d.multiplicador === null || d.multiplicador < 1.01 || d.multiplicador > 10) {
                ctx.addIssue({ code: 'custom', path: ['multiplicador'], message: 'De x1.01 a x10' })
            }
            else if (Math.round(d.multiplicador * 100) !== d.multiplicador * 100) {
                ctx.addIssue({ code: 'custom', path: ['multiplicador'], message: 'Hasta dos decimales' })
            }
        }
        if (d.tipo_velocidad === 'plan_destino' && d.plan_destino_id === null) {
            ctx.addIssue({ code: 'custom', path: ['plan_destino_id'], message: 'Elige el plan destino' })
        }
        const inicio = instanteGuatemala(d.inicio)
        const fin = instanteGuatemala(d.fin)
        if (inicio && fin && fin <= inicio) {
            ctx.addIssue({ code: 'custom', path: ['fin'], message: 'Debe terminar después de empezar' })
        }
        if (d.modo === 'franja') {
            if (!HORA.test(d.franja_inicio)) {
                ctx.addIssue({ code: 'custom', path: ['franja_inicio'], message: 'Hora HH:MM' })
            }
            if (!HORA.test(d.franja_fin)) {
                ctx.addIssue({ code: 'custom', path: ['franja_fin'], message: 'Hora HH:MM' })
            }
        }
        if (d.cobrar && !/^\d{1,12}(\.\d{1,2})?$/.test(d.precio.trim())) {
            ctx.addIssue({ code: 'custom', path: ['precio'], message: 'Monto en quetzales, hasta dos decimales' })
        }
    })
}

export type EntradaPromocion = z.input<ReturnType<typeof esquemaPromocion>>

/** Estado inicial: x2, días completos desde mañana a las 00:00, gratis. */
export function promocionVacia(hoy: Date = new Date()): EntradaPromocion {
    const manana = new Date(hoy.getTime() + 86_400_000)
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(manana)
    return {
        nombre: '',
        descripcion: '',
        tipo_velocidad: 'multiplicador',
        multiplicador: 2,
        plan_destino_id: null,
        modo: 'dias',
        inicio: `${dia}T00:00`,
        fin: '',
        franja_inicio: '18:00',
        franja_fin: '23:00',
        dias_semana: [],
        cobrar: false,
        precio: '',
    }
}

/** Cuerpo de `POST /promociones-velocidad` (sin precio = gratis; sin días = todos los días). */
export function datosPromocion(e: EntradaPromocion, servicioIds: number[]): DatosCrearPromocion {
    const franja = e.modo === 'franja'
    return {
        nombre: e.nombre.trim(),
        descripcion: e.descripcion.trim() || null,
        tipo_velocidad: e.tipo_velocidad,
        multiplicador: e.tipo_velocidad === 'multiplicador' ? e.multiplicador : null,
        plan_destino_id: e.tipo_velocidad === 'plan_destino' ? e.plan_destino_id : null,
        modo: e.modo,
        inicio: instanteGuatemala(e.inicio) ?? '',
        fin: instanteGuatemala(e.fin) ?? '',
        franja_inicio: franja ? e.franja_inicio : null,
        franja_fin: franja ? e.franja_fin : null,
        dias_semana: franja && e.dias_semana.length && e.dias_semana.length < 7 ? [...e.dias_semana].sort((a, b) => a - b) : null,
        precio: e.cobrar ? Number(e.precio.trim()).toFixed(2) : null,
        servicio_ids: servicioIds,
    }
}

/**
 * Horas de cada día de la semana (0 a 24) que la promoción sube la velocidad, para la gráfica
 * «Una semana» de «Así queda». Una franja que cruza la medianoche se parte en dos tramos.
 */
export function semanaPromocion(e: Pick<EntradaPromocion, 'modo' | 'franja_inicio' | 'franja_fin' | 'dias_semana'>): { dia: number, tramos: { desde: number, hasta: number }[] }[] {
    const horas = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        return (h ?? 0) + (m ?? 0) / 60
    }
    const todos = !e.dias_semana.length
    return [1, 2, 3, 4, 5, 6, 7].map((dia) => {
        if (e.modo === 'dias') {
            return { dia, tramos: [{ desde: 0, hasta: 24 }] }
        }
        if (!todos && !e.dias_semana.includes(dia)) {
            return { dia, tramos: [] }
        }
        if (!HORA.test(e.franja_inicio) || !HORA.test(e.franja_fin)) {
            return { dia, tramos: [] }
        }
        const desde = horas(e.franja_inicio)
        const hasta = horas(e.franja_fin)
        return { dia, tramos: hasta > desde ? [{ desde, hasta }] : [{ desde, hasta: 24 }, { desde: 0, hasta }] }
    })
}
