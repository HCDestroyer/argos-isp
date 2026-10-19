import { Queue, Worker, type Job, type RedisOptions } from 'bullmq'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import GenerarFacturas from '#billing/actions/generar_facturas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import ConciliarPasarela from '#billing/actions/conciliar_pasarela'
import { proveedorConfigurado } from '#billing/pasarelas/pasarela'
import SellarAsientos from '#ledger/actions/sellar_asientos'
import VerificarIntegridad from '#ledger/actions/verificar_integridad'
import { pendientesDeSellar } from '#ledger/sellos'
import { cronAntiguedad, cronVencer } from '#lealtad/jobs'

/**
 * Crons de facturación con BullMQ (`node ace billing:worker`).
 *
 * Cola `billing-cron` con cuatro job schedulers (`upsertJobScheduler`, idempotente al arrancar):
 *
 * | Job | Cada | Acción |
 * | --- | --- | --- |
 * | `generar` | 1 h | `GenerarFacturas` (todo lo pendiente hasta hoy) |
 * | `vencer` | 1 h | `VencerFacturas` (vencimiento y mora) |
 * | `corte` | 1 min | `EjecutarCorte` (las horas de corte que ya llegaron y no se procesaron) |
 * | `promesas` | 1 min | `IncumplirPromesas` (`incumplirPromesas`: las vencidas sin pagar → incumplida) |
 * | `conciliar` | 06:30 Guatemala | `ConciliarPasarela` (cobros en línea de ayer contra el proveedor) |
 * | `sellar` | 1 min | `SellarAsientos` (`ledger:sellar`: cadena de hash del libro, §10.10); sin asientos pendientes no llama la acción |
 * | `integridad` | 02:15 Guatemala | `VerificarIntegridad` (recalcula la cadena; `libro.integridad_rota` si no verifica) |
 * | `lealtad:antiguedad` | 03:05 Guatemala | `OtorgarAntiguedad` (aniversarios pendientes hasta hoy, por empresa y lotes de 500) |
 * | `lealtad:vencer` | 03:20 Guatemala | `VencerPuntos` (lotes vencidos hasta hoy y avisos de puntos por vencer) |
 *
 * Lock: el worker tiene concurrencia 1 y además cada job toma un advisory lock de Postgres
 * (`pg_try_advisory_xact_lock`) mientras corre; si otra instancia ya lo tiene, el disparo se
 * omite. Los crons son idempotentes, así que un disparo omitido se recupera en el siguiente.
 * Los jobs no hacen nada por su cuenta: solo llaman acciones (regla 1).
 */

export const NOMBRE_COLA_BILLING = 'billing-cron'

export const CRONS = {
    generar: 60 * 60_000,
    vencer: 60 * 60_000,
    corte: 60_000,
    promesas: 60_000,
    sellar: 60_000,
} as const
/** Crons a hora fija (patrón cron y zona horaria). */
export const CRONS_DIARIOS = {
    conciliar: { pattern: '30 6 * * *', tz: 'America/Guatemala' },
    integridad: { pattern: '15 2 * * *', tz: 'America/Guatemala' },
    'lealtad:antiguedad': { pattern: '5 3 * * *', tz: 'America/Guatemala' },
    'lealtad:vencer': { pattern: '20 3 * * *', tz: 'America/Guatemala' },
} as const
export type NombreCron = keyof typeof CRONS | keyof typeof CRONS_DIARIOS

export interface OpcionesColaBilling {
    conexion?: RedisOptions
    /** prefijo de claves en Redis; las pruebas usan uno propio */
    prefijo?: string
}

export function conexionRedisBilling(): RedisOptions {
    return {
        host: env.get('REDIS_HOST') ?? '127.0.0.1',
        port: env.get('REDIS_PORT') ?? 6379,
        password: env.get('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: null,
    }
}

function prefijo(opciones: OpcionesColaBilling) {
    return opciones.prefijo ?? env.get('COLAS_PREFIJO') ?? 'argosisp'
}

/** Registra (o actualiza) los job schedulers. Devuelve la cola para cerrarla al salir. */
export async function programarCronsBilling(opciones: OpcionesColaBilling = {}): Promise<Queue> {
    const cola = new Queue(NOMBRE_COLA_BILLING, {
        connection: opciones.conexion ?? conexionRedisBilling(),
        prefix: prefijo(opciones),
    })
    for (const [nombre, cada] of Object.entries(CRONS)) {
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
    for (const [nombre, repeticion] of Object.entries(CRONS_DIARIOS)) {
        await cola.upsertJobScheduler(nombre, repeticion, {
            name: nombre,
            data: {},
            opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
        })
    }
    return cola
}

/** Espacio de los advisory locks de los crons de billing. */
const LOCK_CRON = 4004

/**
 * Corre `trabajo` solo si nadie más tiene el lock `nombre`. El lock vive en una transacción
 * abierta mientras dura el trabajo (que usa sus propias conexiones) y se suelta al terminar,
 * aunque el proceso muera.
 */
export async function conLock<T>(
    nombre: string,
    trabajo: () => Promise<T>,
): Promise<{ omitido: boolean; resultado?: T }> {
    return db.transaction(async (trx) => {
        const { rows } = (await trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, hashtext(?)) AS ok', [
            LOCK_CRON,
            nombre,
        ])) as { rows: Array<{ ok: boolean }> }
        if (!rows[0]?.ok) return { omitido: true }
        return { omitido: false, resultado: await trabajo() }
    })
}

/** Ejecuta un cron por nombre (lo usa el worker; las pruebas lo llaman directo). */
export async function ejecutarCron(nombre: string, ahora: Date = new Date()) {
    const ctx = contextoSistema('cron', `billing-${nombre}-${ahora.toISOString()}`)
    switch (nombre) {
        case 'generar':
            return conLock(nombre, () => new GenerarFacturas().execute({}, ctx))
        case 'vencer':
            return conLock(nombre, () => new VencerFacturas().execute({}, ctx))
        case 'corte':
            return conLock(nombre, () => new EjecutarCorte().execute({ ahora }, ctx))
        case 'promesas':
            return conLock(nombre, () => new IncumplirPromesas().execute({ ahora }, ctx))
        case 'conciliar':
            // sin pasarela configurada (producción sin credenciales) no hay nada que conciliar
            if (!proveedorConfigurado()) return { omitido: true }
            return conLock(nombre, () => new ConciliarPasarela().execute({}, ctx))
        case 'sellar':
            return conLock(nombre, async () => {
                let sellados = 0
                // todo lo pendiente hasta ahora, por lotes de 500 por empresa
                while ((await pendientesDeSellar().then((r) => r.length)) > 0) {
                    const salida = await new SellarAsientos().execute({ limite: 500 }, ctx)
                    const lote = salida.empresas.reduce((n, e) => n + e.sellados, 0)
                    sellados += lote
                    if (lote === 0) break
                }
                return { sellados }
            })
        case 'integridad':
            return conLock(nombre, () => new VerificarIntegridad().execute({}, ctx))
        case 'lealtad:antiguedad':
            return conLock(nombre, () => cronAntiguedad(ctx, ahora))
        case 'lealtad:vencer':
            return conLock(nombre, () => cronVencer(ctx, ahora))
        default:
            throw new Error(`Cron de billing desconocido: ${nombre}`)
    }
}

export function crearWorkerBilling(opciones: OpcionesColaBilling = {}) {
    const worker = new Worker(NOMBRE_COLA_BILLING, (job: Job) => ejecutarCron(job.name), {
        connection: opciones.conexion ?? conexionRedisBilling(),
        prefix: prefijo(opciones),
        concurrency: 1,
    })
    worker.on('completed', (job, salida) => {
        logger.debug({ cron: job.name, salida }, 'Cron de billing terminado')
    })
    worker.on('failed', (job, error) =>
        logger.error({ cron: job?.name, err: error }, 'Cron de billing falló'),
    )
    worker.on('error', (error) => logger.error({ err: error }, 'Worker de billing'))
    return worker
}
