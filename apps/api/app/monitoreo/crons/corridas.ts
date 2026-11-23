import { hostname } from 'node:os'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { enmascararTexto } from '#monitoreo/texto'
import { buscarCron, cronDeJob, type CronCatalogo } from '#monitoreo/crons/catalogo'
import { desenvolver, resumir, type Resumen } from '#monitoreo/crons/resumen'
import { estadoLock } from '#monitoreo/crons/locks'

/**
 * Registro de corridas de los crons del catálogo en `core.cron_corridas` (ver la migración: por qué no
 * en `audit.*`). Los workers de cada módulo envuelven su job con `correrJobCron`; nada más cambia en
 * ellos. El registro nunca rompe el cron: si la base falla al anotar, se registra en el log y el cron
 * corre igual.
 *
 * - Al empezar: fila `en_curso` con la instancia (`ARGOSISP_INSTANCIA` o `host:pid`) y, si la pidió una
 *   persona («Ejecutar ahora»), su usuario y request id.
 * - Al terminar: `ok`, `sin_cambios` o `error` según el resumen (`resumen.ts`), u `omitido` si otra
 *   instancia tenía el lock. Un error lanzado queda con su mensaje (sin secretos) y se vuelve a lanzar.
 * - Corridas programadas seguidas sin cambios se agrupan en la fila anterior (`repeticiones`,
 *   `ultimo_inicio`, `fin`): el cron de cada minuto no deja 1 440 filas iguales al día.
 * - Una fila `en_curso` de una instancia que murió se marca `error` («se interrumpió») cuando otra
 *   corrida del mismo cron empieza y nadie tiene su lock.
 * - Se conservan `RETENCION_DIAS` días.
 */

export const RETENCION_DIAS = 90
/** Sin lock que consultar, una corrida `en_curso` más vieja que esto se da por interrumpida. */
export const EN_CURSO_SIN_LOCK_MAX_MS = 6 * 3600_000
/** Margen entre el INSERT `en_curso` y la toma del lock dentro del cron. */
export const MARGEN_LOCK_MS = 2 * 60_000

export type OrigenCorrida = 'programado' | 'manual'

export interface DatosCorrida {
    origen?: OrigenCorrida
    usuario_id?: number | null
    request_id?: string | null
}

export function instanciaActual(): string {
    return env.get('ARGOSISP_INSTANCIA') || `${hostname()}:${process.pid}`
}

export const MENSAJE_INTERRUMPIDA = 'La corrida se interrumpió: la instancia se detuvo antes de terminar'

/**
 * ¿Sigue viva una corrida `en_curso`? Con lock: viva si alguien lo tiene, o si empezó hace menos de
 * `MARGEN_LOCK_MS` (aún no lo toma). Sin lock: viva si empezó hace menos de 6 h.
 */
export function corridaViva(inicio: Date, tomado: boolean | null, ahora = Date.now()): boolean {
    const edad = ahora - inicio.getTime()
    if (tomado === null) return edad < EN_CURSO_SIN_LOCK_MAX_MS
    return tomado || edad < MARGEN_LOCK_MS
}

async function lockTomado(cron: CronCatalogo): Promise<boolean | null> {
    if (!cron.lock) return null
    try {
        const lock = await estadoLock(cron)
        return lock?.tomado ?? null
    } catch {
        return null
    }
}

/** Marca `error` las filas `en_curso` de `clave` que ya no tienen quién las corra. */
export async function cerrarInterrumpidas(cron: CronCatalogo, exceptoId?: number): Promise<number> {
    const abiertas = (await db
        .from('core.cron_corridas')
        .where('clave', cron.clave)
        .where('estado', 'en_curso')
        .if(exceptoId !== undefined, (q) => q.whereNot('id', exceptoId!))
        .select('id', 'ultimo_inicio')) as Array<{ id: number; ultimo_inicio: Date }>
    if (abiertas.length === 0) return 0
    const tomado = await lockTomado(cron)
    // nuestra propia corrida aún no toma el lock: si está tomado, es de otra instancia viva
    const muertas = abiertas.filter((f) => !corridaViva(f.ultimo_inicio, tomado))
    for (const fila of muertas) {
        await db
            .from('core.cron_corridas')
            .where('id', fila.id)
            .where('estado', 'en_curso')
            .update({ estado: 'error', error: MENSAJE_INTERRUMPIDA, fin: new Date() })
    }
    return muertas.length
}

async function abrir(cron: CronCatalogo, datos: DatosCorrida, jobId: string | null): Promise<number | null> {
    try {
        const [fila] = (await db
            .table('core.cron_corridas')
            .insert({
                clave: cron.clave,
                origen: datos.origen ?? 'programado',
                instancia: instanciaActual(),
                job_id: jobId,
                usuario_id: datos.usuario_id ?? null,
                request_id: datos.request_id ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        await cerrarInterrumpidas(cron, id)
        return id
    } catch (error) {
        logger.warn({ err: error, cron: cron.clave }, 'No se pudo anotar el inicio de la corrida')
        return null
    }
}

function textoError(error: unknown): string {
    const mensaje = error instanceof Error ? error.message : String(error)
    return (enmascararTexto(mensaje) ?? 'Error desconocido').slice(0, 1000)
}

async function cerrar(
    cron: CronCatalogo,
    id: number,
    origen: OrigenCorrida,
    final: {
        estado: Resumen['estado'] | 'omitido'
        resumen: string
        error: string | null
        detalle?: unknown
    },
): Promise<void> {
    try {
        await db.transaction(async (trx) => {
            const actual = (await trx
                .from('core.cron_corridas')
                .where('id', id)
                .forUpdate()
                .select('ultimo_inicio')
                .first()) as { ultimo_inicio: Date } | null
            if (!actual) return
            const duracion = Math.max(0, Date.now() - new Date(actual.ultimo_inicio).getTime())
            if (final.estado === 'sin_cambios' && origen === 'programado') {
                const previa = (await trx
                    .from('core.cron_corridas')
                    .where('clave', cron.clave)
                    .where('id', '<', id)
                    .whereNot('estado', 'en_curso')
                    .orderBy('id', 'desc')
                    .forUpdate()
                    .select('id', 'estado', 'origen')
                    .first()) as { id: number; estado: string; origen: string } | null
                if (previa && previa.estado === 'sin_cambios' && previa.origen === 'programado') {
                    await trx
                        .from('core.cron_corridas')
                        .where('id', previa.id)
                        .update({
                            repeticiones: trx.knexRawQuery('repeticiones + 1'),
                            ultimo_inicio: actual.ultimo_inicio,
                            fin: new Date(),
                            duracion_ms: duracion,
                            instancia: instanciaActual(),
                            resumen: final.resumen,
                        })
                    await trx.from('core.cron_corridas').where('id', id).delete()
                    return
                }
            }
            await trx
                .from('core.cron_corridas')
                .where('id', id)
                .update({
                    estado: final.estado,
                    fin: new Date(),
                    duracion_ms: duracion,
                    resumen: final.resumen,
                    error: final.error,
                    detalle: final.detalle === undefined ? null : JSON.stringify(final.detalle),
                })
        })
        await db
            .from('core.cron_corridas')
            .where('clave', cron.clave)
            .where('fin', '<', new Date(Date.now() - RETENCION_DIAS * 86_400_000))
            .delete()
    } catch (error) {
        logger.warn({ err: error, cron: cron.clave }, 'No se pudo anotar el fin de la corrida')
    }
}

/**
 * Corre `trabajo` como una corrida del cron `clave` y la anota. Devuelve (o lanza) lo mismo que
 * `trabajo`.
 */
export async function conCorrida<T>(
    clave: string,
    datos: DatosCorrida & { job_id?: string | null },
    trabajo: () => Promise<T>,
): Promise<T> {
    const cron = buscarCron(clave)
    if (!cron) return trabajo()
    const origen = datos.origen ?? 'programado'
    const id = await abrir(cron, datos, datos.job_id ?? null)
    let salida: T
    try {
        salida = await trabajo()
    } catch (error) {
        if (id !== null) {
            await cerrar(cron, id, origen, { estado: 'error', resumen: 'Falló', error: textoError(error) })
        }
        throw error
    }
    if (id !== null) {
        const { omitido, resultado } = desenvolver(salida)
        if (omitido) {
            await cerrar(cron, id, origen, {
                estado: 'omitido',
                resumen: 'No corrió: otra instancia la estaba corriendo o no aplica',
                error: null,
            })
        } else {
            const r = resumir(resultado, cron)
            await cerrar(cron, id, origen, { ...r })
        }
    }
    return salida
}

/**
 * Envoltura para el procesador de un worker de BullMQ: si `job` es un cron del catálogo, la corrida
 * queda anotada (con quién la pidió si vino de «Ejecutar ahora»); si no (jobs a pedido como
 * `cambiar_control`), solo corre `trabajo`.
 */
export function correrJobCron<T>(
    cola: string,
    job: { name: string; id?: string | null; data?: unknown },
    trabajo: () => Promise<T>,
): Promise<T> {
    const cron = cronDeJob(cola, job.name)
    if (!cron) return trabajo()
    const datos = (job.data ?? {}) as DatosCorrida
    return conCorrida(
        cron.clave,
        {
            origen: datos.origen === 'manual' ? 'manual' : 'programado',
            usuario_id: datos.usuario_id ?? null,
            request_id: datos.request_id ?? null,
            job_id: job.id ?? null,
        },
        trabajo,
    )
}
