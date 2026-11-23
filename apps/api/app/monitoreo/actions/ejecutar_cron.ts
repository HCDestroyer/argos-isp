import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { buscarCron } from '#monitoreo/crons/catalogo'
import { colaCron, estadoLock } from '#monitoreo/crons/locks'
import { corridaViva } from '#monitoreo/crons/corridas'

export interface EntradaEjecutarCron {
    clave: string
}

export interface SalidaEjecutarCron {
    clave: string
    job_id: string
    estado: 'encolada'
    encolada_en: string
}

/** jobId de la ejecución manual de un cron (uno a la vez por cron). */
export function idJobManual(clave: string): string {
    return `manual-${clave.replace(/[^a-z0-9_-]/gi, '_')}`
}

/**
 * `sistema.ejecutar_cron` («Ejecutar ahora» en Tareas programadas): encola el job del cron en su propia
 * cola de BullMQ, con `origen: manual` y quién lo pidió. Lo corre el worker de su módulo, con el mismo
 * lock que la corrida programada (crecimiento horizontal: cualquier instancia del worker lo toma, una
 * sola lo corre). La API no corre el cron: responde en cuanto queda encolado (202) y la corrida
 * aparece en `GET /sistema/crons/:clave/corridas`.
 *
 * - 404 si la clave no existe; 422 `no_manual` si el cron no se ejecuta a mano (procesos continuos);
 *   422 `cron_apagado` si está apagado por configuración.
 * - 409 `en_curso` si alguien tiene su lock, hay una corrida viva o ya hay una ejecución manual
 *   esperando.
 * - La ruta acepta `Idempotency-Key`: repetir el mismo pedido devuelve la misma respuesta.
 * - Los permisos propios del cron (`permisos` del catálogo) los revisa la ruta antes de llamar.
 */
export default class EjecutarCron extends DomainAction<EntradaEjecutarCron, SalidaEjecutarCron> {
    readonly nombre = 'sistema.ejecutar_cron'

    protected async handle(input: EntradaEjecutarCron, t: Transaccion): Promise<SalidaEjecutarCron> {
        const cron = buscarCron(input.clave)
        if (!cron) throw new NoEncontrado('No existe esa tarea programada')
        t.anotarAuditoria({ clave: cron.clave })
        if (!cron.manual || !cron.bullmq) {
            throw new ReglaNegocio('Esta tarea corre todo el tiempo y no se ejecuta a mano', 'no_manual')
        }
        if (!cron.horario()) {
            throw new ReglaNegocio('Esta tarea está apagada por configuración', 'cron_apagado')
        }

        const enCurso = () =>
            new Conflicto(
                'Esta tarea ya se está ejecutando; espera a que termine y vuelve a consultar',
                'en_curso',
                'Ya se está ejecutando',
            )
        const lock = await estadoLock(cron)
        if (lock?.tomado) throw enCurso()
        const viva = (await t.trx
            .from('core.cron_corridas')
            .where('clave', cron.clave)
            .where('estado', 'en_curso')
            .orderBy('id', 'desc')
            .select('ultimo_inicio')
            .first()) as { ultimo_inicio: Date } | null
        if (viva && corridaViva(new Date(viva.ultimo_inicio), lock ? lock.tomado : null)) throw enCurso()

        const cola = colaCron(cron.bullmq.cola)
        const jobId = idJobManual(cron.clave)
        const existente = await cola.getJob(jobId)
        if (existente) {
            const estado = await existente.getState()
            if (estado !== 'completed' && estado !== 'failed' && estado !== 'unknown') throw enCurso()
            await existente.remove()
        }
        const job = await cola.add(
            cron.bullmq.job,
            {
                origen: 'manual',
                usuario_id: t.ctx.actor.id,
                request_id: t.ctx.requestId,
            },
            { jobId, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
        )
        return {
            clave: cron.clave,
            job_id: job.id ?? jobId,
            estado: 'encolada',
            encolada_en: new Date(job.timestamp).toISOString(),
        }
    }
}
