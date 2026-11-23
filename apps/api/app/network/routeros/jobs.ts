import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema, type Actor } from '#shared/contexto'
import ReconciliarRouterOS, { type ResultadoReconciliar } from '#network/routeros/actions/reconciliar_router'
import {
    routerDispatcher,
    routersConServiciosSinPppoe,
    routersConSesionesPpp,
} from '#network/routeros/consultas'
import SondearSesionesPpp, { type ResultadoSondearPpp } from '#network/sesiones/actions/sondear_sesiones_ppp'
import {
    fabricaPorDefecto,
    routersPendientes,
    type ErrorOperacion,
    type OpcionesDispatcher,
} from '#network/routeros/dispatcher'
import { ejecutarCambioControl, type EntradaCambioControl } from '#network/routeros/cambio_control'
import SondearRouters, { type ResultadoSondear } from '#network/routeros/actions/sondear_routers'
import { correrJobCron } from '#monitoreo/crons/corridas'

/**
 * Crons del reconciliador (`node ace routeros:worker`), cola `routeros-cron`:
 *
 * | Job | Cada | Qué hace |
 * | --- | --- | --- |
 * | `recuperar` | 30 s (`ROUTEROS_RECUPERAR_CADA_MS`) | Sondea (`/system/resource`) los routers que fallaron; al responder, los reconcilia |
 * | `reconciliar` | 15 min (`ROUTEROS_RECONCILIAR_CADA_MS`) | Reconcilia todos los routers con servicios sin PPPoE (red de seguridad) |
 * | `sondear` | 5 min (`ROUTEROS_SONDEO_CADA_MS`, por defecto `AAA_INTERIM_SEGUNDOS`; 0 = apagado) | `GET /system/resource` a los routers con API sin contacto reciente (`Router.en_linea`) |
 * | `sesiones_ppp` | 1 min (`ROUTEROS_SESIONES_PPP_CADA_MS`; 0 = apagado) | Routers sin RADIUS: `/ppp/active` → abre y cierra `network.sesiones` (`origen = sondeo`, `contratos/pppoe-local.md` §6) |
 * | `cambiar_control` | por evento (`router.control_cambiado`) | Cambio de modo de control por lotes (`cambio_control.ts`); `jobId` = el evento |
 * | `reconciliar_router` | a pedido (`POST /routers/:id/reconciliar`) | Reconcilia un router (`motivo: manual`); `jobId` = `reconciliar-<router_id>`: mientras uno espera, otro pedido no encola otro. Su resultado queda un día (`GET /routers/:id/reconciliaciones/:job_id`) |
 *
 * Lock: concurrencia 1 y un advisory lock de Postgres por job (si otra instancia lo tiene, el
 * disparo se omite); cada router además se serializa con el lock de las acciones. Los jobs solo
 * llaman acciones (regla 1).
 */

export const NOMBRE_COLA_ROUTEROS = 'routeros-cron'

/** ms entre sondeos de contacto: un Interim-Update (300 s) por defecto; 0 lo apaga. */
export function sondeoCadaMs(): number {
    return env.get('ROUTEROS_SONDEO_CADA_MS') ?? (env.get('AAA_INTERIM_SEGUNDOS') ?? 300) * 1000
}

/** ms entre sondeos de `/ppp/active` de los routers sin RADIUS (60 s por defecto); 0 lo apaga. */
export function sesionesPppCadaMs(): number {
    return env.get('ROUTEROS_SESIONES_PPP_CADA_MS') ?? 60_000
}

export function cronsRouterOS(): Record<string, number> {
    const crons: Record<string, number> = {
        recuperar: env.get('ROUTEROS_RECUPERAR_CADA_MS') ?? 30_000,
        reconciliar: env.get('ROUTEROS_RECONCILIAR_CADA_MS') ?? 15 * 60_000,
    }
    if (sondeoCadaMs() > 0) crons.sondear = sondeoCadaMs()
    if (sesionesPppCadaMs() > 0) crons.sesiones_ppp = sesionesPppCadaMs()
    return crons
}

function conexion(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        // requerido por BullMQ para las conexiones bloqueantes de los workers
        maxRetriesPerRequest: null,
    }
}

function prefijo(p?: string) {
    return p ?? env.get('COLAS_PREFIJO') ?? 'argosisp'
}

export async function programarCronsRouterOS(opciones: { prefijo?: string } = {}): Promise<Queue> {
    const cola = new Queue(NOMBRE_COLA_ROUTEROS, {
        connection: conexion(),
        prefix: prefijo(opciones.prefijo),
    })
    // Un cron apagado (sondeo en 0) no debe quedar programado de una versión anterior.
    if (!('sondear' in cronsRouterOS())) await cola.removeJobScheduler('sondear')
    if (!('sesiones_ppp' in cronsRouterOS())) await cola.removeJobScheduler('sesiones_ppp')
    for (const [nombre, cada] of Object.entries(cronsRouterOS())) {
        await cola.upsertJobScheduler(
            nombre,
            { every: cada },
            {
                name: nombre,
                data: {},
                opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
            },
        )
    }
    return cola
}

const LOCK_CRON_ROUTEROS = 4103

async function conLock<T>(
    nombre: string,
    trabajo: () => Promise<T>,
): Promise<{ omitido: boolean; resultado?: T }> {
    return db.transaction(async (trx) => {
        const { rows } = (await trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, hashtext(?)) AS ok', [
            LOCK_CRON_ROUTEROS,
            nombre,
        ])) as { rows: Array<{ ok: boolean }> }
        if (!rows[0]?.ok) return { omitido: true }
        return { omitido: false, resultado: await trabajo() }
    })
}

/**
 * Ejecuta un cron por nombre (el worker y las pruebas). `clientes` reemplaza la fábrica de
 * clientes REST (pruebas).
 */
export async function ejecutarCronRouterOS(
    nombre: string,
    opciones: OpcionesDispatcher & { ahora?: Date } = {},
): Promise<{
    omitido: boolean
    resultado?: ResultadoReconciliar[] | ResultadoSondear[] | ResultadoSondearPpp[]
}> {
    const ahora = opciones.ahora ?? new Date()
    const ctx = contextoSistema('cron', `routeros-${nombre}-${ahora.toISOString()}`)
    const fabrica = opciones.clientes ?? fabricaPorDefecto
    const reconciliar = (routerId: number, motivo: 'periodico' | 'recuperado') =>
        new ReconciliarRouterOS({ clientes: fabrica, red: opciones.red }).execute(
            { router_id: routerId, motivo },
            ctx,
        )

    switch (nombre) {
        case 'reconciliar':
            return conLock(nombre, async () => {
                const salidas: ResultadoReconciliar[] = []
                for (const id of await routersConServiciosSinPppoe()) {
                    salidas.push(await reconciliar(id, 'periodico'))
                }
                return salidas
            })
        case 'recuperar':
            return conLock(nombre, async () => {
                const salidas: ResultadoReconciliar[] = []
                for (const id of await routersPendientes()) {
                    const router = await routerDispatcher(id, undefined, opciones.red)
                    if (!router) {
                        salidas.push(await reconciliar(id, 'recuperado'))
                        continue
                    }
                    // Sondeo barato antes de reconciliar: un router que sigue caído no genera
                    // otro `routeros.fallido` cada 30 s.
                    let cliente
                    try {
                        cliente = fabrica(router.api)
                        await cliente.probar()
                    } catch {
                        continue
                    } finally {
                        cliente?.cerrar()
                    }
                    salidas.push(await reconciliar(id, 'recuperado'))
                }
                return salidas
            })
        case 'sondear':
            return conLock(nombre, async () => {
                // Sin contacto en el último intervalo de sondeo (accounting o API lo cubren si hubo).
                const salida = await new SondearRouters({ clientes: fabrica }).execute(
                    { sin_contacto_desde_s: Math.max(1, (sondeoCadaMs() || 300_000) / 1000) },
                    ctx,
                )
                return [salida]
            })
        case 'sesiones_ppp':
            return conLock(nombre, async () => {
                // Cada router en su transacción (un router lento no retiene a los demás).
                const salidas: ResultadoSondearPpp[] = []
                for (const id of await routersConSesionesPpp()) {
                    salidas.push(
                        await new SondearSesionesPpp({ clientes: fabrica, red: opciones.red }).execute(
                            { router_id: id, ahora: ahora.toISOString() },
                            ctx,
                        ),
                    )
                }
                return salidas
            })
        default:
            throw new Error(`Cron de routeros desconocido: ${nombre}`)
    }
}

let colaCambios: Queue | null = null

/**
 * Encola el cambio de modo de un router (lo consume este mismo worker, concurrencia 1: no se cruza
 * con la reconciliación). `jobId` = el evento: una entrega repetida no lo encola dos veces.
 */
export async function encolarCambioControl(entrada: EntradaCambioControl): Promise<void> {
    colaCambios ??= new Queue(NOMBRE_COLA_ROUTEROS, { connection: conexion(), prefix: prefijo() })
    await colaCambios.add('cambiar_control', entrada, {
        jobId: `control-${entrada.router_id}-${entrada.evento_id ?? Date.now()}`,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
    })
}

export interface DatosReconciliarManual {
    router_id: number
    actor: Actor
    request_id: string
}

export function idJobReconciliar(routerId: number): string {
    return `reconciliar-${routerId}`
}

/**
 * Encola la reconciliación manual de un router (`routers.reconciliar`). Mismo worker (concurrencia
 * 1) y mismo lock por router que la periódica. Si ya hay una esperando o en curso, no se encola
 * otra: devuelve la existente (`encolado: false`). El job terminado queda un día para consultar su
 * estado (`estadoReconciliacion`); el siguiente pedido lo reemplaza.
 */
export async function encolarReconciliacion(
    datos: DatosReconciliarManual,
): Promise<{ job_id: string; encolado: boolean }> {
    colaCambios ??= new Queue(NOMBRE_COLA_ROUTEROS, { connection: conexion(), prefix: prefijo() })
    const jobId = idJobReconciliar(datos.router_id)
    const existente = await colaCambios.getJob(jobId)
    if (existente && !(await existente.isCompleted()) && !(await existente.isFailed())) {
        return { job_id: jobId, encolado: false }
    }
    if (existente) await existente.remove()
    // El job terminado se guarda un día (su estado lo lee `GET /routers/:id/reconciliaciones/:job_id`); el
    // siguiente pedido del mismo router lo reemplaza (arriba). No es una caché: es el registro del job.
    await colaCambios.add('reconciliar_router', datos, {
        jobId,
        removeOnComplete: { age: GUARDAR_RECONCILIACION_S },
        removeOnFail: { age: GUARDAR_RECONCILIACION_S },
    })
    return { job_id: jobId, encolado: true }
}

/** Segundos que se guarda una reconciliación manual terminada para consultar su estado. */
const GUARDAR_RECONCILIACION_S = 24 * 3600

export interface EstadoReconciliacion {
    router_id: number
    job_id: string
    estado: 'en_espera' | 'en_curso' | 'completada' | 'fallida' | 'desconocida'
    encolado_en: string | null
    iniciado_en: string | null
    terminado_en: string | null
    /** Comandos que escribió en el router; null si no terminó */
    cambios: number | null
    errores: ErrorOperacion[]
    error: string | null
}

const instante = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : null)

/**
 * Todos los problemas parciales de una reconciliación en una lista: los pasos rechazados (`errores`) y
 * los que la acción ya informaba aparte (reglas de oro de velocidad, portal sin IPv4, secrets).
 */
export function erroresDeReconciliacion(r: Partial<ResultadoReconciliar>): ErrorOperacion[] {
    return [
        ...(r.errores ?? []),
        ...(r.errores_velocidad ?? []).map((mensaje) => ({ operacion: 'velocidad', mensaje })),
        ...(r.error_portal ? [{ operacion: 'resolver portal', mensaje: r.error_portal }] : []),
        ...(r.errores_secrets ?? []).map((mensaje) => ({ operacion: 'secrets ppp', mensaje })),
    ]
}

/**
 * Estado de una reconciliación manual (`routers.reconciliar`) leído de BullMQ: `getState`, `returnvalue`
 * (`ResultadoReconciliar`), `failedReason` y los instantes del job. `desconocida` si el job ya no existe
 * (purgado) o no es la reconciliación de este router: nunca 404 por eso.
 *
 * - `completada`: terminó; `errores` con los pasos que el router rechazó sin impedir lo demás.
 * - `fallida`: no pudo ni leer el router (`error` de la acción: no responde, credenciales) o el job lanzó.
 */
export async function estadoReconciliacion(routerId: number, jobId: string): Promise<EstadoReconciliacion> {
    colaCambios ??= new Queue(NOMBRE_COLA_ROUTEROS, { connection: conexion(), prefix: prefijo() })
    const salida: EstadoReconciliacion = {
        router_id: routerId,
        job_id: jobId,
        estado: 'desconocida',
        encolado_en: null,
        iniciado_en: null,
        terminado_en: null,
        cambios: null,
        errores: [],
        error: null,
    }
    if (jobId !== idJobReconciliar(routerId)) return salida
    const job = await colaCambios.getJob(jobId)
    const datos = job?.data as Partial<DatosReconciliarManual> | undefined
    if (!job || job.name !== 'reconciliar_router' || datos?.router_id !== routerId) return salida
    const estado = await job.getState()
    salida.encolado_en = instante(job.timestamp)
    salida.iniciado_en = instante(job.processedOn)
    salida.terminado_en = instante(job.finishedOn)
    if (estado === 'active') {
        salida.estado = 'en_curso'
    } else if (estado === 'completed') {
        const r = (job.returnvalue ?? {}) as Partial<ResultadoReconciliar>
        salida.cambios = r.correcciones?.length ?? 0
        salida.errores = erroresDeReconciliacion(r)
        salida.error = r.error ?? null
        salida.estado = salida.error ? 'fallida' : 'completada'
    } else if (estado === 'failed') {
        salida.estado = 'fallida'
        salida.error = job.failedReason || 'la reconciliación falló'
    } else if (estado === 'unknown') {
        salida.estado = 'desconocida'
    } else {
        // waiting, delayed, prioritized, waiting-children
        salida.estado = 'en_espera'
    }
    return salida
}

/** Corre una reconciliación manual encolada, con el actor y el request id de quien la pidió. */
export function ejecutarReconciliacionManual(
    datos: DatosReconciliarManual,
    opciones: OpcionesDispatcher = {},
): Promise<ResultadoReconciliar> {
    return new ReconciliarRouterOS({
        clientes: opciones.clientes ?? fabricaPorDefecto,
        red: opciones.red,
    }).execute(
        { router_id: datos.router_id, motivo: 'manual' },
        { actor: datos.actor, canal: 'worker', requestId: datos.request_id },
    )
}

export async function cerrarColaCambios(): Promise<void> {
    await colaCambios?.close()
    colaCambios = null
}

/**
 * Worker de la cola de routeros. `dispatcher` reemplaza la fábrica de clientes en la reconciliación manual
 * (pruebas). El `returnvalue` de `reconciliar_router` es el `ResultadoReconciliar` (cambios y errores), que
 * lee `estadoReconciliacion`.
 */
export function crearWorkerRouterOS(opciones: { prefijo?: string; dispatcher?: OpcionesDispatcher } = {}) {
    const procesar = (job: Job) =>
        job.name === 'cambiar_control'
            ? ejecutarCambioControl(job.data as EntradaCambioControl)
            : job.name === 'reconciliar_router'
              ? ejecutarReconciliacionManual(job.data as DatosReconciliarManual, opciones.dispatcher)
              : // corrida anotada en «Tareas programadas» (`core.cron_corridas`)
                correrJobCron(NOMBRE_COLA_ROUTEROS, job, () =>
                    ejecutarCronRouterOS(job.name, opciones.dispatcher),
                )
    const worker = new Worker(NOMBRE_COLA_ROUTEROS, procesar, {
        connection: conexion(),
        prefix: prefijo(opciones.prefijo),
        concurrency: 1,
    })
    worker.on('failed', (job, error) =>
        logger.error({ cron: job?.name, err: error }, 'Cron de routeros falló'),
    )
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de routeros'))
    return worker
}
