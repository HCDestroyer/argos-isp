import os from 'node:os'
import { readdir, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { directorioComprobantes } from '#billing/comprobantes_archivos'
import { sqlContactoRouter } from '#network/contacto_router'
import { COLAS, colasAbiertas, ultimaCorrida } from '#monitoreo/metricas'
import { versionInstalada } from '#monitoreo/version'

/**
 * Salud del sistema (`GET /api/v1/sistema/salud`, contrato `.claude/integration/contratos/salud.md`).
 * No es una acción: solo lee, no audita ni emite eventos. Se calcula al pedirla (sin caché, regla 5).
 *
 * Cada chequeo corre en paralelo con un timeout de 1 s; uno que falla o no contesta deja su
 * componente `caido` (o `desconocido`) y nunca tumba la respuesta.
 */

export type EstadoComponente = 'ok' | 'degradado' | 'caido' | 'desconocido'
export type EstadoGeneral = 'ok' | 'degradado' | 'caido'
export type GrupoComponente = 'nucleo' | 'colas' | 'eventos' | 'red' | 'procesos' | 'host'

export interface Componente {
    id: string
    grupo: GrupoComponente
    nombre: string
    estado: EstadoComponente
    detalle: string
    latencia_ms: number | null
    desde: string | null
    metricas: Record<string, number | string | null>
}

export interface SaludSistema {
    estado_general: EstadoGeneral
    generado_en: string
    duracion_ms: number
    componentes: Componente[]
}

export const TIMEOUT_CHEQUEO_MS = 1000

/** Umbrales del contrato §2.2. */
export const UMBRALES = {
    postgresLentoMs: 500,
    postgresConexionesPct: 0.8,
    redisLentoMs: 200,
    colaFallidosDegradado: 1,
    colaFallidosCaido: 50,
    colaEsperandoDegradado: 500,
    colaEsperandoCaido: 5000,
    outboxDegradadoS: 60,
    outboxCaidoS: 600,
    coaVentanaMin: 15,
    cronDegradadoH: 26,
    respaldoDegradadoH: 26,
    respaldoCaidoH: 72,
    cpuDegradado: 1.5,
    cpuCaido: 3,
    memoriaDegradado: 0.9,
    memoriaCaido: 0.97,
    /** porcentaje USADO del volumen (pedido del PM: 80 % degradado, 95 % caído) */
    discoDegradado: 0.8,
    discoCaido: 0.95,
} as const

/*
|--------------------------------------------------------------------------
| Fuentes reemplazables (pruebas)
|--------------------------------------------------------------------------
*/

/** Lo mínimo de una cola BullMQ que se lee aquí y en el registro del sistema. */
export interface ColaLegible {
    getJobCounts(...tipos: string[]): Promise<Record<string, number>>
    getFailed(inicio?: number, fin?: number): Promise<
        Array<{ id?: string; name: string; failedReason?: string; finishedOn?: number; timestamp: number }>
    >
}

interface Fuentes {
    ping: () => Promise<unknown>
    colas: () => Map<string, ColaLegible>
}

const reales: Fuentes = {
    ping: () => redis().ping(),
    colas: () => colasAbiertas() as unknown as Map<string, ColaLegible>,
}
let fuentes: Fuentes = reales

/**
 * Solo pruebas: reemplaza el `PING` de Redis o las colas (p. ej. con promesas que nunca resuelven para
 * simular Redis caído). Sin argumento vuelve a las reales.
 */
export function fijarFuentesSalud(otras?: Partial<Fuentes>) {
    fuentes = { ...reales, ...otras }
}

export function colasLegibles(): Map<string, ColaLegible> {
    return fuentes.colas()
}

/*
|--------------------------------------------------------------------------
| Utilidades
|--------------------------------------------------------------------------
*/

class TiempoAgotado extends Error {}

export function conTimeout<T>(promesa: Promise<T>, ms = TIMEOUT_CHEQUEO_MS): Promise<T> {
    let temporizador: NodeJS.Timeout | undefined
    const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new TiempoAgotado(`no respondió en ${ms} ms`)), ms)
    })
    return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador))
}

function bytesLegibles(n: number): string {
    const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let v = n
    while (v >= 1024 && i < unidades.length - 1) {
        v /= 1024
        i++
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${unidades[i]}`
}

function duracionLegible(segundos: number): string {
    if (segundos < 60) return `${Math.round(segundos)} s`
    if (segundos < 3600) return `${Math.round(segundos / 60)} min`
    if (segundos < 86_400 * 2) return `${Math.round(segundos / 3600)} h`
    return `${Math.round(segundos / 86_400)} días`
}

function hace(fecha: Date): string {
    return `hace ${duracionLegible((Date.now() - fecha.getTime()) / 1000)}`
}

function peor(...estados: EstadoComponente[]): EstadoComponente {
    for (const e of ['caido', 'degradado', 'ok'] as const) if (estados.includes(e)) return e
    return 'desconocido'
}

type Base = Omit<Componente, 'estado' | 'detalle' | 'latencia_ms' | 'desde' | 'metricas'>
type Resultado = Pick<Componente, 'estado' | 'detalle'> & Partial<Pick<Componente, 'latencia_ms' | 'desde' | 'metricas'>>

/**
 * Corre un chequeo con timeout. Si lanza o no responde, el componente sale `caido` (o el estado que
 * se indique: `desconocido` cuando no se puede medir) con el motivo en `detalle`.
 */
async function chequear(
    base: Base,
    fn: () => Promise<Resultado>,
    alFallar: EstadoComponente = 'caido',
): Promise<Componente> {
    const inicio = performance.now()
    try {
        const r = await conTimeout(fn())
        return { latencia_ms: null, desde: null, metricas: {}, ...base, ...r }
    } catch (error) {
        const motivo =
            error instanceof TiempoAgotado
                ? `No respondió en ${TIMEOUT_CHEQUEO_MS / 1000} s`
                : 'No se pudo consultar'
        return {
            ...base,
            estado: alFallar,
            detalle: motivo,
            latencia_ms: error instanceof TiempoAgotado ? Math.round(performance.now() - inicio) : null,
            desde: null,
            metricas: {},
        }
    }
}

/*
|--------------------------------------------------------------------------
| Chequeos
|--------------------------------------------------------------------------
*/

async function chequeoApi(): Promise<Componente> {
    return chequear({ id: 'api', grupo: 'nucleo', nombre: 'API' }, async () => {
        const version = await versionInstalada()
        const uptime = Math.round(process.uptime())
        return {
            estado: 'ok',
            detalle: `Versión ${version.version} · en marcha hace ${duracionLegible(uptime)}`,
            desde: new Date(Date.now() - uptime * 1000).toISOString(),
            metricas: {
                version: version.version,
                commit: version.commit,
                uptime_s: uptime,
                node: process.version,
                memoria_rss_bytes: process.memoryUsage().rss,
            },
        }
    })
}

async function chequeoPostgres(): Promise<Componente> {
    return chequear({ id: 'postgres', grupo: 'nucleo', nombre: 'Base de datos (PostgreSQL)' }, async () => {
        const inicio = performance.now()
        await db.rawQuery('SELECT 1')
        const latencia = Math.round(performance.now() - inicio)
        const { rows } = (await db.rawQuery(
            `SELECT (SELECT count(*) FROM pg_stat_activity)::int AS conexiones,
                    current_setting('max_connections')::int AS maximo`,
        )) as { rows: Array<{ conexiones: number; maximo: number }> }
        const { conexiones, maximo } = rows[0]!
        const lleno = maximo > 0 && conexiones / maximo >= UMBRALES.postgresConexionesPct
        const lento = latencia >= UMBRALES.postgresLentoMs
        return {
            estado: lleno || lento ? 'degradado' : 'ok',
            detalle: `Responde en ${latencia} ms · ${conexiones} conexiones de ${maximo}`,
            latencia_ms: latencia,
            metricas: { conexiones, conexiones_max: maximo },
        }
    })
}

async function chequeoRedis(): Promise<Componente> {
    return chequear({ id: 'redis', grupo: 'nucleo', nombre: 'Redis (colas y caché)' }, async () => {
        const inicio = performance.now()
        await fuentes.ping()
        const latencia = Math.round(performance.now() - inicio)
        return {
            estado: latencia >= UMBRALES.redisLentoMs ? 'degradado' : 'ok',
            detalle: `Responde en ${latencia} ms`,
            latencia_ms: latencia,
        }
    })
}

async function chequeoCola(nombre: string, cola: ColaLegible | undefined): Promise<Componente> {
    return chequear(
        { id: `cola.${nombre}`, grupo: 'colas', nombre: `Cola ${nombre}` },
        async () => {
            if (!cola) throw new Error('cola desconocida')
            const [conteos, fallidos] = await Promise.all([
                cola.getJobCounts('waiting', 'active', 'delayed', 'failed', 'prioritized'),
                cola.getFailed(0, 199),
            ])
            const haceUnaHora = Date.now() - 3_600_000
            const fallidos1h = fallidos.filter((j) => (j.finishedOn ?? j.timestamp) >= haceUnaHora).length
            const esperando = (conteos.waiting ?? 0) + (conteos.prioritized ?? 0)
            let estado: EstadoComponente = 'ok'
            if (fallidos1h >= UMBRALES.colaFallidosCaido || esperando >= UMBRALES.colaEsperandoCaido) {
                estado = 'caido'
            } else if (
                fallidos1h >= UMBRALES.colaFallidosDegradado ||
                esperando >= UMBRALES.colaEsperandoDegradado
            ) {
                estado = 'degradado'
            }
            return {
                estado,
                detalle: `${esperando} esperando · ${conteos.active ?? 0} activos · ${fallidos1h} fallidos en la última hora`,
                metricas: {
                    esperando,
                    activos: conteos.active ?? 0,
                    retrasados: conteos.delayed ?? 0,
                    fallidos: conteos.failed ?? 0,
                    fallidos_1h: fallidos1h,
                },
            }
        },
        // sin Redis no se sabe nada de las colas: el caído es `redis`
        'desconocido',
    )
}

async function chequeoOutbox(): Promise<Componente> {
    return chequear({ id: 'outbox', grupo: 'eventos', nombre: 'Publicación de eventos (outbox)' }, async () => {
        const fila = (await db
            .from('audit.outbox')
            .whereNull('publicado_en')
            .count('* as n')
            .min('created_at as viejo')
            .first()) as { n: string | number; viejo: Date | null }
        const pendientes = Number(fila.n)
        if (pendientes === 0 || !fila.viejo) {
            return { estado: 'ok', detalle: 'Sin eventos pendientes', metricas: { sin_publicar: 0, antiguedad_s: 0 } }
        }
        const viejo = new Date(fila.viejo)
        const antiguedad = Math.max(0, Math.round((Date.now() - viejo.getTime()) / 1000))
        const estado: EstadoComponente =
            antiguedad >= UMBRALES.outboxCaidoS
                ? 'caido'
                : antiguedad >= UMBRALES.outboxDegradadoS
                  ? 'degradado'
                  : 'ok'
        return {
            estado,
            detalle: `${pendientes} eventos sin publicar · el más viejo de ${hace(viejo)}`,
            desde: estado === 'ok' ? null : viejo.toISOString(),
            metricas: { sin_publicar: pendientes, antiguedad_s: antiguedad },
        }
    })
}

async function chequeoAaa(): Promise<Componente> {
    return chequear(
        { id: 'aaa', grupo: 'red', nombre: 'RADIUS (aaa)' },
        async () => {
            const { rows } = (await db.rawQuery(
                `SELECT DISTINCT ON (payload->>'nodo') payload->>'nodo' AS nodo, evento, payload, created_at
                   FROM audit.outbox
                  WHERE evento IN ('aaa.caido', 'aaa.recuperado')
                  ORDER BY payload->>'nodo', id DESC`,
            )) as {
                rows: Array<{ nodo: string; evento: string; payload: { desde?: string }; created_at: Date }>
            }
            if (rows.length === 0) {
                return {
                    estado: 'desconocido',
                    detalle: 'El vigía de RADIUS no ha reportado ninguna caída',
                    metricas: { nodos: 0, nodos_caidos: 0, caidos: null },
                }
            }
            const caidos = rows.filter((r) => r.evento === 'aaa.caido')
            const desde = caidos
                .map((r) => r.payload.desde ?? new Date(r.created_at).toISOString())
                .sort()[0]
            const estado: EstadoComponente =
                caidos.length === 0 ? 'ok' : caidos.length === rows.length ? 'caido' : 'degradado'
            const nombres = caidos.map((r) => r.nodo).join(', ')
            return {
                estado,
                detalle:
                    caidos.length === 0
                        ? `${rows.length === 1 ? 'El nodo responde' : `Los ${rows.length} nodos responden`}`
                        : `Sin respuesta: ${nombres}`,
                desde: desde ?? null,
                metricas: { nodos: rows.length, nodos_caidos: caidos.length, caidos: nombres || null },
            }
        },
        'desconocido',
    )
}

async function chequeoCoa(): Promise<Componente> {
    return chequear({ id: 'coa', grupo: 'red', nombre: 'CoA y Disconnect (coa)' }, async () => {
        const fila = (await db
            .from('audit.outbox')
            .where('evento', 'coa.fallido')
            .where('created_at', '>', db.raw(`now() - interval '24 hours'`))
            .select(
                db.raw(`count(*) FILTER (WHERE created_at > now() - make_interval(mins => ?))::int AS recientes`, [
                    UMBRALES.coaVentanaMin,
                ]),
                db.raw('count(*)::int AS dia'),
                db.raw('max(created_at) AS ultimo'),
            )
            .first()) as { recientes: number; dia: number; ultimo: Date | null }
        const ultimo = fila.ultimo ? new Date(fila.ultimo) : null
        const estado: EstadoComponente = fila.recientes > 0 ? 'degradado' : 'ok'
        return {
            estado,
            detalle:
                fila.dia === 0
                    ? 'Sin fallos en las últimas 24 h'
                    : `${fila.recientes} fallos en ${UMBRALES.coaVentanaMin} min · ${fila.dia} en 24 h · el último ${hace(ultimo!)}`,
            desde: estado === 'ok' ? null : (ultimo?.toISOString() ?? null),
            metricas: {
                fallidos_15m: fila.recientes,
                fallidos_24h: fila.dia,
                ultimo_fallo: ultimo?.toISOString() ?? null,
            },
        }
    })
}

async function chequeoRouters(): Promise<Componente> {
    return chequear(
        { id: 'routers', grupo: 'red', nombre: 'Routers' },
        async () => {
            const contacto = sqlContactoRouter()
            const { rows } = (await db.rawQuery(
                `SELECT count(*)::int AS total,
                        count(*) FILTER (WHERE en_linea IS TRUE)::int AS en_linea,
                        count(*) FILTER (WHERE en_linea IS FALSE)::int AS sin_respuesta
                   FROM (SELECT ${contacto.enLinea} AS en_linea FROM network.routers WHERE activo) r`,
            )) as { rows: Array<{ total: number; en_linea: number; sin_respuesta: number }> }
            const { total, en_linea: enLinea, sin_respuesta: sinRespuesta } = rows[0]!
            const medidos = enLinea + sinRespuesta
            const metricas = { total, en_linea: enLinea, sin_respuesta: sinRespuesta, sin_medicion: total - medidos }
            if (medidos === 0) {
                return {
                    estado: 'desconocido',
                    detalle: total === 0 ? 'No hay routers activos' : 'Ningún router se está midiendo',
                    metricas,
                }
            }
            const estado: EstadoComponente = sinRespuesta === 0 ? 'ok' : enLinea === 0 ? 'caido' : 'degradado'
            return {
                estado,
                detalle:
                    sinRespuesta === 0
                        ? `${enLinea} de ${total} responden`
                        : `${sinRespuesta} de ${medidos} medidos no responden`,
                metricas,
            }
        },
        'desconocido',
    )
}

const CRONS_SALUD = [
    { id: 'cron.facturacion', accion: 'facturas.generar', nombre: 'Facturación automática' },
    { id: 'cron.vencimiento', accion: 'facturas.vencer_pendientes', nombre: 'Vencimiento de facturas' },
    { id: 'cron.corte', accion: 'servicios.corte', nombre: 'Corte automático' },
] as const

async function chequeoCron(def: (typeof CRONS_SALUD)[number]): Promise<Componente> {
    return chequear(
        { id: def.id, grupo: 'procesos', nombre: def.nombre },
        async () => {
            const ts = await ultimaCorrida(def.accion)
            if (ts === null) {
                return {
                    estado: 'desconocido',
                    detalle: 'Sin corridas en los últimos 40 días',
                    metricas: { ultima_corrida: null },
                }
            }
            const fecha = new Date(ts * 1000)
            const atrasado = Date.now() - fecha.getTime() > UMBRALES.cronDegradadoH * 3_600_000
            return {
                estado: atrasado ? 'degradado' : 'ok',
                detalle: `Última corrida ${hace(fecha)}`,
                desde: fecha.toISOString(),
                metricas: { ultima_corrida: fecha.toISOString() },
            }
        },
        'desconocido',
    )
}

/** Carpeta de respaldos (`BACKUP_DIR`, la misma variable de `infra/backups/respaldar.sh`). */
function directorioRespaldos(): string | null {
    return process.env.BACKUP_DIR?.trim() || null
}

async function chequeoRespaldos(): Promise<Componente> {
    return chequear(
        { id: 'respaldos', grupo: 'procesos', nombre: 'Respaldos de la base' },
        async () => {
            const dir = directorioRespaldos()
            if (!dir) {
                return {
                    estado: 'desconocido',
                    detalle: 'La API no ve la carpeta de respaldos (BACKUP_DIR)',
                    metricas: { ultimo: null, archivo: null, tamano_bytes: null },
                }
            }
            const nombres = (await readdir(dir)).filter((n) => /\.dump(\.age)?$/.test(n))
            let ultimo: { nombre: string; mtime: Date; tamano: number } | null = null
            for (const nombre of nombres) {
                const info = await stat(join(dir, nombre))
                if (!ultimo || info.mtime > ultimo.mtime) ultimo = { nombre, mtime: info.mtime, tamano: info.size }
            }
            if (!ultimo) {
                return {
                    estado: 'caido',
                    detalle: 'No hay ningún respaldo en la carpeta',
                    metricas: { ultimo: null, archivo: null, tamano_bytes: null },
                }
            }
            const horas = (Date.now() - ultimo.mtime.getTime()) / 3_600_000
            const estado: EstadoComponente =
                horas >= UMBRALES.respaldoCaidoH ? 'caido' : horas >= UMBRALES.respaldoDegradadoH ? 'degradado' : 'ok'
            return {
                estado,
                detalle: `Último respaldo ${hace(ultimo.mtime)} (${bytesLegibles(ultimo.tamano)})`,
                desde: ultimo.mtime.toISOString(),
                metricas: { ultimo: ultimo.mtime.toISOString(), archivo: ultimo.nombre, tamano_bytes: ultimo.tamano },
            }
        },
        'desconocido',
    )
}

async function chequeoCpu(): Promise<Componente> {
    return chequear(
        { id: 'host.cpu', grupo: 'host', nombre: 'Procesador del servidor' },
        async () => {
            const [c1, c5, c15] = os.loadavg()
            const nucleos = Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
            const relativa = c5! / nucleos
            return {
                estado:
                    relativa >= UMBRALES.cpuCaido ? 'caido' : relativa >= UMBRALES.cpuDegradado ? 'degradado' : 'ok',
                detalle: `Carga ${c1!.toFixed(2)} / ${c5!.toFixed(2)} / ${c15!.toFixed(2)} con ${nucleos} núcleos`,
                metricas: {
                    carga_1: Number(c1!.toFixed(2)),
                    carga_5: Number(c5!.toFixed(2)),
                    carga_15: Number(c15!.toFixed(2)),
                    nucleos,
                },
            }
        },
        'desconocido',
    )
}

async function chequeoMemoria(): Promise<Componente> {
    return chequear(
        { id: 'host.memoria', grupo: 'host', nombre: 'Memoria del servidor' },
        async () => {
            const total = os.totalmem()
            const usada = total - os.freemem()
            const pct = total > 0 ? usada / total : 0
            return {
                estado:
                    pct >= UMBRALES.memoriaCaido ? 'caido' : pct >= UMBRALES.memoriaDegradado ? 'degradado' : 'ok',
                detalle: `${bytesLegibles(usada)} usados de ${bytesLegibles(total)} (${Math.round(pct * 100)} %)`,
                metricas: { usada_bytes: usada, total_bytes: total, porcentaje: Math.round(pct * 1000) / 10 },
            }
        },
        'desconocido',
    )
}

/** Fracción usada de un volumen (0–1). */
export function usoDisco(total: number, libre: number): number {
    return total > 0 ? (total - libre) / total : 0
}

/** Umbrales del disco (pedido del PM): ≥ 80 % usado degradado, ≥ 95 % caído. */
export function estadoDisco(total: number, libre: number): EstadoComponente {
    const uso = usoDisco(total, libre)
    return uso >= UMBRALES.discoCaido ? 'caido' : uso >= UMBRALES.discoDegradado ? 'degradado' : 'ok'
}

/** Espacio del volumen que contiene `ruta` (si no existe, el del directorio de trabajo). */
export async function espacioVolumen(ruta: string): Promise<{ total: number; libre: number }> {
    let info
    try {
        info = await statfs(ruta)
    } catch {
        info = await statfs(process.cwd())
    }
    return { total: info.blocks * info.bsize, libre: info.bavail * info.bsize }
}

/** Solo pruebas: reemplaza la lectura del volumen de datos (simular un disco lleno). */
let espacioFijado: ((ruta: string) => Promise<{ total: number; libre: number }>) | undefined
export function fijarEspacioVolumen(fn?: (ruta: string) => Promise<{ total: number; libre: number }>) {
    espacioFijado = fn
}
export function leerEspacioVolumen(ruta: string) {
    return (espacioFijado ?? espacioVolumen)(ruta)
}

async function chequeoDisco(): Promise<Componente> {
    return chequear(
        { id: 'host.disco', grupo: 'host', nombre: 'Disco de datos' },
        async () => {
            const ruta = directorioComprobantes()
            // si la carpeta aún no existe (instalación nueva), el volumen es el de la API
            const { total, libre } = await leerEspacioVolumen(ruta)
            return {
                estado: estadoDisco(total, libre),
                detalle: `${bytesLegibles(total - libre)} usados de ${bytesLegibles(total)} (${Math.round(usoDisco(total, libre) * 100)} %) · ${bytesLegibles(libre)} libres`,
                metricas: {
                    libre_bytes: libre,
                    usado_bytes: total - libre,
                    total_bytes: total,
                    porcentaje_usado: Math.round(usoDisco(total, libre) * 1000) / 10,
                    ruta,
                },
            }
        },
        'desconocido',
    )
}

/** Estado general (contrato §2.1). */
export function estadoGeneral(componentes: Componente[]): EstadoGeneral {
    const nucleo = componentes.filter((c) => ['api', 'postgres', 'redis'].includes(c.id))
    if (nucleo.some((c) => c.estado === 'caido')) return 'caido'
    const resto = peor(...componentes.map((c) => c.estado))
    return resto === 'caido' || resto === 'degradado' ? 'degradado' : 'ok'
}

export async function saludSistema(): Promise<SaludSistema> {
    const inicio = performance.now()
    let colas: Map<string, ColaLegible>
    try {
        colas = fuentes.colas()
    } catch {
        colas = new Map()
    }
    const componentes = await Promise.all([
        chequeoApi(),
        chequeoPostgres(),
        chequeoRedis(),
        ...COLAS.map((nombre) => chequeoCola(nombre, colas.get(nombre))),
        chequeoOutbox(),
        chequeoAaa(),
        chequeoCoa(),
        chequeoRouters(),
        ...CRONS_SALUD.map(chequeoCron),
        chequeoRespaldos(),
        chequeoCpu(),
        chequeoMemoria(),
        chequeoDisco(),
    ])
    return {
        estado_general: estadoGeneral(componentes),
        generado_en: new Date().toISOString(),
        duracion_ms: Math.round(performance.now() - inicio),
        componentes,
    }
}
