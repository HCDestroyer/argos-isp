import { timingSafeEqual } from 'node:crypto'
import { Queue } from 'bullmq'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { redis } from '#shared/redis'
import { nombreStream } from '#shared/eventos_bus'
import { conexionRedis, prefijoColas } from '#notify/cola'
import { Exposicion, type Muestra } from '#monitoreo/prometheus'

/**
 * Métricas de la API para Prometheus (`GET /metrics`, tarea 10). Todo se lee en el momento del
 * scrape (sin contadores en memoria: con varias réplicas de la API cada una diría lo mismo):
 *
 * | Métrica | Fuente |
 * | --- | --- |
 * | `argosisp_cola_trabajos{cola,estado}` | `getJobCounts` de cada cola BullMQ |
 * | `argosisp_eventos_pendientes{grupo}`, `argosisp_eventos_lag{grupo}`, `argosisp_eventos_stream_longitud` | `XINFO GROUPS` / `XLEN` de `argos:eventos` |
 * | `argosisp_outbox_sin_publicar` | `audit.outbox` con `publicado_en` nulo (relay detenido) |
 * | `argosisp_cron_ultima_ejecucion_timestamp_seconds{cron}` | última corrida correcta por cron en `audit.acciones` |
 * | `argosisp_incidentes_abiertos{tipo}` | `notify.incidentes` abiertos (alertas internas) |
 * | `argosisp_routeros_colas_simples{router_id,router}` | sección `routeros` que registra A2 (`registrarSeccionMetricas`) |
 * | `argosisp_metricas_error{seccion}` | 1 si una sección no se pudo leer en este scrape |
 * | `process_*`, `nodejs_heap_*` | proceso de la API |
 */

/**
 * Colas BullMQ conocidas (dueño): notify (A6), billing (A3), accounting de aaa y RouterOS (A2:
 * crons del reconciliador y prefijo delegado de `radius_pool`, `node ace routeros:worker`).
 */
export const COLAS = [
    'notify-envios',
    'notify-cron',
    'billing-cron',
    'aaa-accounting',
    'routeros-cron',
    'routeros-prefijos',
] as const
const ESTADOS = ['waiting', 'active', 'delayed', 'failed', 'prioritized', 'waiting-children'] as const

/** Acciones de los crons (las audita la acción con canal `cron`). */
export const CRONS = [
    'facturas.generar',
    'facturas.vencer_pendientes',
    'servicios.corte',
    'lealtad.otorgar_antiguedad',
    'lealtad.vencer',
    'notificaciones.recordatorios',
    'notificaciones.vigilar_crons',
    'auditoria.crear_particiones',
] as const

let colas: Map<string, Queue> | undefined

function colasAbiertas(): Map<string, Queue> {
    if (!colas) {
        colas = new Map(
            COLAS.map((nombre) => [
                nombre,
                new Queue(nombre, { connection: conexionRedis(), prefix: prefijoColas() }),
            ]),
        )
        app.terminating(async () => {
            const abiertas = [...(colas?.values() ?? [])]
            colas = undefined
            await Promise.all(abiertas.map((c) => c.close()))
        })
    }
    return colas
}

async function metricasColas(): Promise<Muestra[]> {
    const muestras: Muestra[] = []
    for (const [nombre, cola] of colasAbiertas()) {
        const conteos = await cola.getJobCounts(...ESTADOS)
        for (const estado of ESTADOS) {
            muestras.push({ etiquetas: { cola: nombre, estado }, valor: conteos[estado] ?? 0 })
        }
    }
    return muestras
}

/** Máximo de entradas que se cuentan a mano cuando Redis no conoce el lag. */
const TOPE_LAG = 10_000

interface GrupoStream {
    grupo: string
    pendientes: number
    lag: number | null
}

/** `XINFO GROUPS`: pares campo/valor por grupo. `lag` puede ser nulo (Redis no lo sabe). */
async function gruposStream(stream: string): Promise<{ longitud: number; grupos: GrupoStream[] }> {
    const conexion = redis()
    const longitud = await conexion.xlen(stream)
    if (longitud === 0 && !(await conexion.exists(stream))) return { longitud: 0, grupos: [] }
    const crudo = (await conexion.xinfo('GROUPS', stream)) as unknown[][]
    const grupos: GrupoStream[] = []
    for (const pares of crudo) {
        const campos = new Map<string, unknown>()
        for (let i = 0; i + 1 < pares.length; i += 2) campos.set(String(pares[i]), pares[i + 1])
        const crudoLag = campos.get('lag')
        let lag = crudoLag === null || crudoLag === undefined ? null : Number(crudoLag)
        // Redis deja `lag` nulo cuando hubo borrados en el stream (XDEL/XTRIM): se cuenta lo que
        // queda después del último entregado, con tope para no recorrer un stream enorme.
        if (lag === null) {
            const ultimo = String(campos.get('last-delivered-id') ?? '0-0')
            const desde = ultimo === '0-0' ? '-' : `(${ultimo}`
            const restantes = await conexion.xrange(stream, desde, '+', 'COUNT', TOPE_LAG)
            lag = restantes.length
        }
        grupos.push({
            grupo: String(campos.get('name')),
            pendientes: Number(campos.get('pending') ?? 0),
            lag,
        })
    }
    return { longitud, grupos }
}

async function ultimaCorrida(accion: string): Promise<number | null> {
    const fila = (await db
        .from('audit.acciones')
        .where('accion', accion)
        .where('canal', 'cron')
        .where('resultado', 'ok')
        .where('created_at', '>', db.raw(`now() - interval '40 days'`))
        .orderBy('created_at', 'desc')
        .select('created_at')
        .first()) as { created_at: Date } | null
    return fila ? fila.created_at.getTime() / 1000 : null
}

/** Una métrica gauge que otro módulo agrega a `/metrics` (`registrarSeccionMetricas`). */
export interface MetricaExtra {
    nombre: string
    ayuda: string
    muestras: Muestra[]
}

const seccionesExtra = new Map<string, () => Promise<MetricaExtra[]>>()

/**
 * Agrega una sección a `GET /metrics` sin tocar este archivo. Ej.: A2 registra `routeros` con
 * `argosisp_routeros_colas_simples{router_id,router}` desde su módulo (lo que lea debe ser barato:
 * corre en cada scrape; nada de llamar al router aquí). Si `leer` falla, la sección queda en
 * `argosisp_metricas_error{seccion}` = 1 y no se escribe ninguna de sus métricas. Registrar el
 * mismo nombre otra vez la reemplaza.
 */
export function registrarSeccionMetricas(seccion: string, leer: () => Promise<MetricaExtra[]>) {
    seccionesExtra.set(seccion, leer)
}

/** Para pruebas. */
export function quitarSeccionMetricas(seccion: string) {
    seccionesExtra.delete(seccion)
}

/**
 * Para pruebas: la función registrada hoy para `seccion` (o `undefined`). Una prueba que reemplaza
 * una sección real (p. ej. `routeros`, que registra `start/routes/network.ts`) la guarda con esto y
 * la devuelve al terminar con `registrarSeccionMetricas`, para no romper otras pruebas de la corrida.
 */
export function seccionMetricas(seccion: string): (() => Promise<MetricaExtra[]>) | undefined {
    return seccionesExtra.get(seccion)
}

/** Arma el texto de exposición. Una sección que falla no tumba las demás. */
export async function recolectarMetricas(): Promise<string> {
    const exp = new Exposicion()
    const errores: Muestra[] = []
    const seccion = async <T>(nombre: string, leer: () => Promise<T>): Promise<T | null> => {
        try {
            const valor = await leer()
            errores.push({ etiquetas: { seccion: nombre }, valor: 0 })
            return valor
        } catch {
            errores.push({ etiquetas: { seccion: nombre }, valor: 1 })
            return null
        }
    }

    const colasMuestras = await seccion('colas', metricasColas)
    exp.gauge('argosisp_cola_trabajos', 'Trabajos por cola BullMQ y estado', colasMuestras ?? [])

    const stream = nombreStream()
    const info = await seccion('eventos', () => gruposStream(stream))
    exp.gauge(
        'argosisp_eventos_stream_longitud',
        `Entradas en el stream ${stream}`,
        info ? [{ valor: info.longitud }] : [],
    )
    exp.gauge(
        'argosisp_eventos_pendientes',
        'Eventos entregados a un grupo y aún sin XACK',
        (info?.grupos ?? []).map((g) => ({ etiquetas: { grupo: g.grupo }, valor: g.pendientes })),
    )
    exp.gauge(
        'argosisp_eventos_lag',
        'Eventos del stream que el grupo aún no ha leído',
        (info?.grupos ?? [])
            .filter((g) => g.lag !== null)
            .map((g) => ({ etiquetas: { grupo: g.grupo }, valor: g.lag! })),
    )

    const outbox = await seccion('outbox', async () => {
        const fila = (await db.from('audit.outbox').whereNull('publicado_en').count('* as n').first()) as {
            n: string | number
        }
        return Number(fila.n)
    })
    exp.gauge(
        'argosisp_outbox_sin_publicar',
        'Eventos en audit.outbox sin publicar',
        outbox === null ? [] : [{ valor: outbox }],
    )

    const crons = await seccion('crons', async () => {
        const muestras: Muestra[] = []
        for (const cron of CRONS) {
            const ts = await ultimaCorrida(cron)
            if (ts !== null) muestras.push({ etiquetas: { cron }, valor: ts })
        }
        return muestras
    })
    exp.gauge(
        'argosisp_cron_ultima_ejecucion_timestamp_seconds',
        'Instante (epoch) de la última corrida correcta de cada cron (audit.acciones, canal cron)',
        crons ?? [],
    )

    const incidentes = await seccion('incidentes', async () => {
        const filas = (await db
            .from('notify.incidentes')
            .where('estado', 'abierto')
            .groupBy('tipo')
            .select('tipo')
            .count('* as n')) as Array<{ tipo: string; n: string | number }>
        return filas.map((f) => ({ etiquetas: { tipo: f.tipo }, valor: Number(f.n) }))
    })
    exp.gauge('argosisp_incidentes_abiertos', 'Incidentes de alertas internas abiertos', incidentes ?? [])

    for (const [nombre, leer] of seccionesExtra) {
        const metricas = await seccion(nombre, leer)
        for (const metrica of metricas ?? []) exp.gauge(metrica.nombre, metrica.ayuda, metrica.muestras)
    }

    const memoria = process.memoryUsage()
    exp.gauge('process_resident_memory_bytes', 'Memoria residente', [{ valor: memoria.rss }])
    exp.gauge('nodejs_heap_used_bytes', 'Heap de V8 en uso', [{ valor: memoria.heapUsed }])
    exp.gauge('process_start_time_seconds', 'Inicio del proceso (epoch)', [
        { valor: Math.round(Date.now() / 1000 - process.uptime()) },
    ])
    exp.gauge('argosisp_metricas_error', 'Sección de métricas que falló en este scrape', errores)
    return exp.texto()
}

/** Token de `/metrics`; las pruebas lo reemplazan con `fijarTokenMetricas`. */
let tokenFijado: string | null | undefined

export function fijarTokenMetricas(valor: string | null | undefined) {
    tokenFijado = valor
}

function tokenMetricas(): string | null {
    if (tokenFijado !== undefined) return tokenFijado
    return env.get('METRICS_TOKEN') || null
}

/**
 * `404` si `/metrics` está apagado (sin `METRICS_TOKEN`), `401` si el Bearer no coincide,
 * `null` si se puede responder.
 */
export function autorizarScrape(cabecera: string | undefined): 401 | 404 | null {
    const token = tokenMetricas()
    if (!token) return 404
    const enviado = /^Bearer (.+)$/.exec(cabecera ?? '')?.[1] ?? ''
    const a = Buffer.from(enviado)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b) ? null : 401
}
