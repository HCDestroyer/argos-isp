import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { configHorus } from '#integraciones/horus/configuracion'
import { ErrorHorus, llamarHorus } from '#integraciones/horus/cliente'
import { anotarError, guardarDato, leerDato, leerDatos, type DatoGuardado } from '#integraciones/horus/datos'

/**
 * Lecturas de Horus para el panel y la ficha del servicio (`contratos/horus.md` §3). Son
 * consultas, no acciones: no cambian nada de Argos (solo guardan el último dato conocido).
 *
 * Cada respuesta dice si el conector está activo y trae `stale` y `actualizado_en`:
 *
 * - Horus respondió → dato fresco (`stale: false`), se guarda como último dato conocido.
 * - Horus no respondió (caído, timeout, 5xx, en pausa por la espera exponencial) → el último dato
 *   conocido con `stale: true` y `error`; sin dato previo, `datos: null`.
 * - Conector apagado → `conector: 'apagado'` y nada más; no hay llamada.
 */

export const ZONA = 'America/Guatemala'

export type EstadoConector = 'activo' | 'apagado'

export interface Lectura<T> {
    conector: EstadoConector
    /** el dato no viene de esta consulta: es el último conocido */
    stale: boolean
    /** cuándo se obtuvo de Horus el dato mostrado (ISO); null sin dato */
    actualizado_en: string | null
    /** por qué no hay dato fresco (null si lo hay) */
    error: string | null
    datos: T | null
}

function iso(valor: Date | string | null | undefined): string | null {
    if (!valor) return null
    return (valor instanceof Date ? valor : new Date(valor)).toISOString()
}

function desdeGuardado<T>(guardado: DatoGuardado<T> | null, error: string): Lectura<T> {
    return {
        conector: 'activo',
        stale: guardado !== null,
        actualizado_en: iso(guardado?.actualizado_en),
        error,
        datos: guardado?.datos ?? null,
    }
}

// ── IP actual del servicio ───────────────────────────────────────────────────────────────────

/** IPv4 de la sesión abierta más reciente o, si no hay, la asignación vigente. */
export async function ipActualServicio(servicioId: number): Promise<string | null> {
    const sesion = (await db
        .from('network.sesiones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .whereNotNull('ipv4')
        .orderBy('inicio', 'desc')
        .select(db.raw('host(ipv4) AS ip'))
        .first()) as { ip: string } | null
    if (sesion?.ip) return sesion.ip
    const asignada = (await db
        .from('network.ipv4_asignaciones')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .orderBy('inicio', 'desc')
        .select(db.raw('host(ip) AS ip'))
        .first()) as { ip: string } | null
    return asignada?.ip ?? null
}

// ── §3.1 Consulta 360 ────────────────────────────────────────────────────────────────────────

export interface EventoRecienteHorus {
    id: number
    evento: string
    evento_interno: string | null
    ocurrido_en: string | null
    recibido_en: string
    resumen: string | null
}

export interface Lectura360 extends Lectura<Record<string, unknown>> {
    servicio_id: number
    /** cómo se le preguntó a Horus: por servicio (1.2.0) o por la IP actual (compatibilidad) */
    consulta: 'external_service_id' | 'address' | null
    /** IP actual del servicio en Argos (la que se usa si Horus no acepta `external_service_id`) */
    ip: string | null
    /** últimos webhooks de Horus sobre este servicio (línea de tiempo) */
    eventos_recientes: EventoRecienteHorus[]
}

/** Errores de Horus que significan "no conozco ese servicio por id" o "no acepto ese campo". */
function aceptaReintentoPorIp(error: unknown): boolean {
    return error instanceof ErrorHorus && error.tipo === 'http' && [400, 404, 422].includes(error.status ?? 0)
}

export async function servicio360(servicioId: number): Promise<Lectura360> {
    const ip = await ipActualServicio(servicioId)
    const eventos = await eventosRecientes(servicioId)
    const base = { servicio_id: servicioId, ip, eventos_recientes: eventos }
    const config = await configHorus()
    if (!config.activo) {
        return {
            ...base,
            conector: 'apagado',
            stale: false,
            actualizado_en: null,
            error: null,
            datos: null,
            consulta: null,
        }
    }

    const clave = `servicio:${servicioId}`
    const include = ['consumption', 'health', 'security']
    let consulta: Lectura360['consulta'] = 'external_service_id'
    try {
        let respuesta
        try {
            respuesta = await llamarHorus<Record<string, unknown>>(
                config,
                'POST',
                '/api/v1/integrations/ip-lookup',
                {
                    external_service_id: servicioId,
                    include,
                },
            )
        } catch (error) {
            // Horus 1.1.0 no conoce `external_service_id` (422) o el servicio aún no tiene identidad (404):
            // se pregunta por la IP actual.
            if (!aceptaReintentoPorIp(error) || !ip) throw error
            consulta = 'address'
            respuesta = await llamarHorus<Record<string, unknown>>(
                config,
                'POST',
                '/api/v1/integrations/ip-lookup',
                {
                    address: ip,
                    include,
                },
            )
        }
        const actualizado = await guardarDato('servicio_360', clave, servicioId, respuesta.datos)
        return {
            ...base,
            consulta,
            conector: 'activo',
            stale: false,
            actualizado_en: iso(actualizado),
            error: null,
            datos: respuesta.datos,
        }
    } catch (error) {
        if (error instanceof ErrorHorus && error.tipo === 'http' && error.status === 404) {
            // Horus funciona pero no conoce este servicio ni su IP: no hay dato que mostrar.
            return {
                ...base,
                consulta,
                conector: 'activo',
                stale: false,
                actualizado_en: null,
                error: 'Horus no tiene datos de este servicio (404)',
                datos: null,
            }
        }
        const mensaje = mensajeDe(error)
        await anotarError('servicio_360', clave, mensaje)
        return { ...base, consulta, ...desdeGuardado(await leerDato('servicio_360', clave), mensaje) }
    }
}

async function eventosRecientes(servicioId: number): Promise<EventoRecienteHorus[]> {
    const filas = (await db
        .from('integraciones.horus_recibidos')
        .where('servicio_id', servicioId)
        .orderBy('id', 'desc')
        .limit(10)
        .select('id', 'evento', 'evento_interno', 'ocurrido_en', 'created_at', 'cuerpo')) as Array<{
        id: number
        evento: string
        evento_interno: string | null
        ocurrido_en: Date | null
        created_at: Date
        cuerpo: { data?: Record<string, any> }
    }>
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        evento_interno: f.evento_interno,
        ocurrido_en: iso(f.ocurrido_en),
        recibido_en: iso(f.created_at)!,
        resumen: resumenEvento(f.evento, f.cuerpo?.data ?? {}),
    }))
}

/** Texto corto para la línea de tiempo. */
export function resumenEvento(evento: string, data: Record<string, any>): string | null {
    switch (evento) {
        case 'finding.opened':
        case 'finding.resolved':
            return (
                [data.finding?.kind, data.finding?.severity, data.finding?.summary]
                    .filter(Boolean)
                    .join(' · ') || null
            )
        case 'customer.security_state_changed':
            return `${data.previous_state ?? '?'} → ${data.state ?? '?'}`
        default:
            return null
    }
}

// ── §3.2 Consumo ─────────────────────────────────────────────────────────────────────────────

export type Granularidad = 'day' | 'total'

export interface PeriodoConsumo {
    desde: string
    hasta: string
    granularidad: Granularidad
}

/** `2026-10` → del 1 de octubre al 1 de noviembre, hora de Guatemala, en UTC. */
export function periodoDeMes(mes: string): { desde: string; hasta: string } {
    const inicio = DateTime.fromFormat(mes, 'yyyy-MM', { zone: ZONA })
    return { desde: inicio.toUTC().toISO()!, hasta: inicio.plus({ months: 1 }).toUTC().toISO()! }
}

export interface ConsumoServicio {
    servicio_id: number
    stale: boolean
    actualizado_en: string | null
    error: string | null
    subida_bytes: number | null
    bajada_bytes: number | null
    series: Array<{ dia: string; subida_bytes: number; bajada_bytes: number }>
    /** IPs que Horus sumó para el servicio en el periodo */
    direcciones: string[]
}

export interface LecturaConsumo {
    conector: EstadoConector
    stale: boolean
    actualizado_en: string | null
    error: string | null
    desde: string
    hasta: string
    granularidad: Granularidad
    items: ConsumoServicio[]
}

interface ItemConsumoHorus {
    external_service_id?: number
    up_bytes?: number
    down_bytes?: number
    series?: Array<{ day: string; up_bytes: number; down_bytes: number }>
    addresses?: string[]
    error?: string
}

function claveConsumo(servicioId: number, periodo: PeriodoConsumo): string {
    return `servicio:${servicioId}:${periodo.desde}:${periodo.hasta}:${periodo.granularidad}`
}

function consumoDeItem(
    servicioId: number,
    item: ItemConsumoHorus,
): Omit<ConsumoServicio, 'stale' | 'actualizado_en' | 'error'> {
    return {
        servicio_id: servicioId,
        subida_bytes: item.up_bytes ?? null,
        bajada_bytes: item.down_bytes ?? null,
        series: (item.series ?? []).map((s) => ({
            dia: s.day,
            subida_bytes: s.up_bytes,
            bajada_bytes: s.down_bytes,
        })),
        direcciones: item.addresses ?? [],
    }
}

/** Consumo de uno o varios servicios (máx. 500) en un periodo, por día o total. */
export async function consumoServicios(
    servicioIds: number[],
    periodo: PeriodoConsumo,
): Promise<LecturaConsumo> {
    const ids = [...new Set(servicioIds)]
    const meta = { desde: periodo.desde, hasta: periodo.hasta, granularidad: periodo.granularidad }
    const config = await configHorus()
    if (!config.activo) {
        return { conector: 'apagado', stale: false, actualizado_en: null, error: null, ...meta, items: [] }
    }
    const claves = ids.map((id) => claveConsumo(id, periodo))
    try {
        const respuesta = await llamarHorus<{ items?: ItemConsumoHorus[] }>(
            config,
            'POST',
            '/api/v1/integrations/consumption',
            {
                from: periodo.desde,
                to: periodo.hasta,
                granularity: periodo.granularidad,
                items: ids.map((id) => ({ external_service_id: id })),
            },
        )
        const porServicio = new Map<number, ItemConsumoHorus>()
        for (const item of respuesta.datos?.items ?? []) {
            if (item.external_service_id !== undefined) {
                porServicio.set(Number(item.external_service_id), item)
            }
        }
        const items: ConsumoServicio[] = []
        let actualizado: Date | null = null
        for (const id of ids) {
            const item = porServicio.get(id)
            if (!item || item.error) {
                items.push({
                    ...consumoDeItem(id, {}),
                    stale: false,
                    actualizado_en: null,
                    error: item?.error ?? 'not_found',
                })
                continue
            }
            const dato = consumoDeItem(id, item)
            actualizado = await guardarDato('consumo', claveConsumo(id, periodo), id, dato)
            items.push({ ...dato, stale: false, actualizado_en: iso(actualizado), error: null })
        }
        return {
            conector: 'activo',
            stale: false,
            actualizado_en: iso(actualizado),
            error: null,
            ...meta,
            items,
        }
    } catch (error) {
        const mensaje = mensajeDe(error)
        const guardados = await leerDatos<ReturnType<typeof consumoDeItem>>('consumo', claves)
        const items = ids.map((id): ConsumoServicio => {
            const guardado = guardados.get(claveConsumo(id, periodo))
            if (!guardado) {
                return { ...consumoDeItem(id, {}), stale: false, actualizado_en: null, error: mensaje }
            }
            return {
                ...guardado.datos,
                stale: true,
                actualizado_en: iso(guardado.actualizado_en),
                error: mensaje,
            }
        })
        const fechas = items
            .map((i) => i.actualizado_en)
            .filter((f): f is string => f !== null)
            .sort()
        return {
            conector: 'activo',
            stale: guardados.size > 0,
            actualizado_en: fechas[0] ?? null,
            error: mensaje,
            ...meta,
            items,
        }
    }
}

// ── §3.5 Seguridad por lotes ─────────────────────────────────────────────────────────────────

export interface SeguridadServicio {
    servicio_id: number
    /** `clean`, `suspected`, `compromised` (los de Horus) o null sin dato */
    estado: string | null
    hallazgos_abiertos: number | null
    severidad_maxima: string | null
    desde: string | null
    /** de dónde sale: §3.5, la última consulta 360 o el último webhook de Horus */
    fuente: 'horus' | 'consulta_360' | 'webhook' | null
    stale: boolean
    actualizado_en: string | null
    error: string | null
}

export interface LecturaSeguridad {
    conector: EstadoConector
    stale: boolean
    actualizado_en: string | null
    error: string | null
    /** `lotes` = §3.5; `alternativa` = Horus aún no lo tiene (H9) y se usa el último dato conocido */
    modo: 'lotes' | 'alternativa' | null
    items: SeguridadServicio[]
}

interface ItemSeguridadHorus {
    external_service_id?: number
    state?: string
    open_findings?: number
    max_severity?: string
    since?: string
    error?: string
}

type DatoSeguridad = Pick<
    SeguridadServicio,
    'estado' | 'hallazgos_abiertos' | 'severidad_maxima' | 'desde' | 'fuente'
>

/** Lo que dejó la última consulta 360 (`security`) o el último webhook, para la alternativa. */
async function seguridadConocida(ids: number[]): Promise<Map<number, { dato: DatoSeguridad; en: Date }>> {
    const salida = new Map<number, { dato: DatoSeguridad; en: Date }>()
    const claves = ids.map((id) => `servicio:${id}`)
    const de360 = await leerDatos<{ security?: Record<string, any> }>('servicio_360', claves)
    for (const id of ids) {
        const guardado = de360.get(`servicio:${id}`)
        const seguridad = guardado?.datos?.security
        if (!guardado || !seguridad) continue
        const severidades = ((seguridad.findings as Array<{ severity?: string }>) ?? []).map(
            (f) => f.severity,
        )
        salida.set(id, {
            dato: {
                estado: seguridad.state ?? null,
                hallazgos_abiertos: seguridad.open_findings ?? null,
                severidad_maxima: severidadMaxima(severidades),
                desde: null,
                fuente: 'consulta_360',
            },
            en: guardado.actualizado_en,
        })
    }
    // Los webhooks de estado de seguridad son más recientes si llegaron después.
    const deWebhook = await leerDatos<DatoSeguridad>('seguridad', claves)
    for (const id of ids) {
        const guardado = deWebhook.get(`servicio:${id}`)
        if (!guardado) continue
        const previo = salida.get(id)
        if (!previo || guardado.actualizado_en > previo.en) {
            salida.set(id, { dato: guardado.datos, en: guardado.actualizado_en })
        }
    }
    return salida
}

const ORDEN_SEVERIDAD = ['info', 'low', 'medium', 'high', 'critical']

function severidadMaxima(valores: Array<string | undefined>): string | null {
    let maxima: string | null = null
    for (const valor of valores) {
        if (!valor) continue
        if (maxima === null || ORDEN_SEVERIDAD.indexOf(valor) > ORDEN_SEVERIDAD.indexOf(maxima)) {
            maxima = valor
        }
    }
    return maxima
}

/** Errores que dicen que Horus aún no tiene §3.5 (H9). */
function sinLotes(error: unknown): boolean {
    return error instanceof ErrorHorus && error.tipo === 'http' && [404, 405, 501].includes(error.status ?? 0)
}

/**
 * Estado de seguridad de varios servicios (máx. 500) para la columna "Seguridad" de las listas.
 * Pide §3.5; si Horus todavía no lo tiene (404/405/501, pedido H9) usa la **alternativa**: el
 * último dato conocido de la consulta 360 o de los webhooks, sin llamar por servicio.
 */
export async function seguridadServicios(servicioIds: number[]): Promise<LecturaSeguridad> {
    const ids = [...new Set(servicioIds)]
    const config = await configHorus()
    if (!config.activo) {
        return { conector: 'apagado', stale: false, actualizado_en: null, error: null, modo: null, items: [] }
    }
    try {
        const respuesta = await llamarHorus<{ items?: ItemSeguridadHorus[]; meta?: { at?: string } }>(
            config,
            'POST',
            '/api/v1/integrations/security-states',
            { items: ids.map((id) => ({ external_service_id: id })) },
        )
        const porServicio = new Map<number, ItemSeguridadHorus>()
        for (const item of respuesta.datos?.items ?? []) {
            if (item.external_service_id !== undefined) {
                porServicio.set(Number(item.external_service_id), item)
            }
        }
        const ahora = new Date()
        const items: SeguridadServicio[] = []
        for (const id of ids) {
            const item = porServicio.get(id)
            if (!item || item.error || !item.state) {
                items.push(vacio(id, false, null, item?.error ?? 'not_found'))
                continue
            }
            const dato: DatoSeguridad = {
                estado: item.state,
                hallazgos_abiertos: item.open_findings ?? null,
                severidad_maxima: item.max_severity ?? null,
                desde: item.since ?? null,
                fuente: 'horus',
            }
            const en = await guardarDato('seguridad', `servicio:${id}`, id, dato)
            items.push({ servicio_id: id, ...dato, stale: false, actualizado_en: iso(en), error: null })
        }
        return {
            conector: 'activo',
            stale: false,
            actualizado_en: respuesta.datos?.meta?.at ?? ahora.toISOString(),
            error: null,
            modo: 'lotes',
            items,
        }
    } catch (error) {
        const alternativa = sinLotes(error)
        const mensaje = alternativa ? null : mensajeDe(error)
        const conocidos = await seguridadConocida(ids)
        const items = ids.map((id): SeguridadServicio => {
            const conocido = conocidos.get(id)
            if (!conocido) return vacio(id, false, null, mensaje)
            return {
                servicio_id: id,
                ...conocido.dato,
                stale: true,
                actualizado_en: iso(conocido.en),
                error: mensaje,
            }
        })
        const fechas = items
            .map((i) => i.actualizado_en)
            .filter((f): f is string => f !== null)
            .sort()
        return {
            conector: 'activo',
            stale: conocidos.size > 0,
            actualizado_en: fechas[0] ?? null,
            error: mensaje,
            modo: alternativa ? 'alternativa' : 'lotes',
            items,
        }
    }
}

function vacio(
    id: number,
    stale: boolean,
    actualizado: string | null,
    error: string | null,
): SeguridadServicio {
    return {
        servicio_id: id,
        estado: null,
        hallazgos_abiertos: null,
        severidad_maxima: null,
        desde: null,
        fuente: null,
        stale,
        actualizado_en: actualizado,
        error,
    }
}

export function mensajeDe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
