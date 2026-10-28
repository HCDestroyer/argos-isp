import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { ServicioPendienteInstalacion } from '#core/instalacion'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { obtenerImplementacionPlan } from '#network/actions/obtener_implementacion_plan'
import {
    exigirPlanCompatible,
    filaAuditable,
    planTemporalVigente,
    verPlanTemporal,
    type OrigenPlanTemporal,
    type PlanTemporalVista,
} from '#core/planes_temporales'
import IniciarPlanTemporal from '#core/actions/iniciar_plan_temporal'

export interface EntradaProgramarPlanTemporal {
    servicio_id: number
    /** plan temporal (el premio `mejora_plan` lo llama `plan_destino_id`) */
    plan_id: number
    /** por defecto, ahora */
    inicio?: Date | string
    /** o `dias` (uno de los dos) */
    fin?: Date | string
    dias?: number
    origen?: OrigenPlanTemporal
    /** el canje de lealtad; con `origen` es la clave de idempotencia */
    origen_id?: number | null
    motivo?: string | null
}

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Programa un plan temporal para un servicio (`servicios.programar_plan_temporal`): una mejora de
 * plan con fecha de inicio y fin (`contratos/lealtad.md` §5, premio `mejora_plan`). La llama
 * `lealtad.canjear` anidada (actor sistema, `origen: lealtad`, `origen_id` = canje) o el panel
 * (`origen: manual`).
 *
 * - El plan debe estar activo, disponible en el router del servicio, ser otro que el actual y
 *   compatible (mismo `dual_stack` y tamaño de prefijo delegado: no mueve IPs ni corta la sesión;
 *   422 `plan_temporal_incompatible`). Servicio retirado: 422 `servicio_retirado`; pendiente de instalación: 422
 *   `servicio_pendiente_instalacion`.
 * - Un solo plan temporal programado o activo por servicio: 409 `plan_temporal_existente`.
 * - El mismo `origen` + `origen_id` devuelve el plan temporal ya programado (idempotente).
 * - Si `inicio` ya llegó, lo inicia en la misma transacción (`servicios.iniciar_plan_temporal`);
 *   si no, lo inicia el cron.
 */
export default class ProgramarPlanTemporal extends DomainAction<
    EntradaProgramarPlanTemporal,
    PlanTemporalVista
> {
    readonly nombre = 'servicios.programar_plan_temporal'

    protected async handle(input: EntradaProgramarPlanTemporal, t: Transaccion): Promise<PlanTemporalVista> {
        const ahora = new Date()
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('plan_id', 'router_id', 'estado', 'empresa_id')
            .first()) as {
            plan_id: number
            router_id: number
            estado: EstadoServicioConPendiente
            empresa_id: number
        } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('servicio', input.servicio_id)
        exigirAccesoEmpresa(t.ctx, empresaId)

        const origen = input.origen ?? 'manual'
        if (input.origen_id !== undefined && input.origen_id !== null) {
            const previo = (await t.trx
                .from('core.servicios_planes_temporales')
                .where('origen', origen)
                .where('origen_id', input.origen_id)
                .select('id', 'servicio_id')
                .first()) as { id: number; servicio_id: number } | null
            if (previo) {
                if (Number(previo.servicio_id) !== input.servicio_id) {
                    throw new Conflicto(
                        `El ${origen} ${input.origen_id} ya programó un plan temporal en otro servicio`,
                        'plan_temporal_existente',
                        'Plan temporal existente',
                    )
                }
                t.fijarEntidad('plan_temporal', Number(previo.id))
                return verPlanTemporal(Number(previo.id), t.trx)
            }
        }

        if (servicio.estado === 'retirado') {
            throw new ReglaNegocio(
                'El servicio está retirado: no recibe planes temporales',
                'servicio_retirado',
            )
        }
        if (servicio.estado === 'pendiente_instalacion') {
            throw new ServicioPendienteInstalacion('programar un plan temporal en')
        }
        const routerId = Number(servicio.router_id)
        const planActualId = Number(servicio.plan_id)
        if (input.plan_id === planActualId) {
            throw new ReglaNegocio('El servicio ya tiene ese plan', 'plan_temporal_igual')
        }
        const plan = await obtenerImplementacionPlan(input.plan_id, routerId, t.trx)
        if (!plan.activo) throw new ReglaNegocio(`El plan ${plan.nombre} está inactivo`, 'plan_inactivo')
        const actual = await obtenerImplementacionPlan(planActualId, routerId, t.trx, {
            aunqueNoDisponible: true,
        })
        exigirPlanCompatible(actual, plan)

        const { inicio, fin } = vigencia(input, ahora)

        const vigente = await planTemporalVigente(input.servicio_id, t.trx)
        if (vigente) {
            throw new Conflicto(
                `El servicio ya tiene el plan temporal ${vigente.id} ${vigente.estado}: cancélalo antes`,
                'plan_temporal_existente',
                'Plan temporal existente',
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.servicios_planes_temporales')
            .insert({
                empresa_id: empresaId,
                servicio_id: input.servicio_id,
                plan_id: input.plan_id,
                plan_original_id: planActualId,
                inicio,
                fin,
                origen,
                origen_id: input.origen_id ?? null,
                motivo: input.motivo ?? null,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('plan_temporal', id)
        await t.registrarCambios({ tipo: 'plan_temporal', id }, null, await filaAuditable(t.trx, id))

        if (inicio <= ahora) {
            await new IniciarPlanTemporal().execute({ id, ahora }, t.ctx, { trx: t.trx })
        }
        return verPlanTemporal(id, t.trx)
    }
}

function vigencia(input: EntradaProgramarPlanTemporal, ahora: Date): { inicio: Date; fin: Date } {
    const errores: Array<{ field: string; message: string; rule: string }> = []
    if ((input.fin === undefined) === (input.dias === undefined)) {
        errores.push({ field: 'fin', message: 'Indica fin o dias (uno de los dos)', rule: 'vigencia' })
        throw new ValidacionFallida(errores, 'Indica la fecha de fin o los días del plan temporal')
    }
    const inicio = input.inicio ? new Date(input.inicio) : ahora
    const fin = input.fin ? new Date(input.fin) : new Date(inicio.getTime() + input.dias! * DIA_MS)
    if (fin <= inicio) {
        errores.push({ field: 'fin', message: 'El fin debe ser posterior al inicio', rule: 'vigencia' })
    } else if (fin <= ahora) errores.push({ field: 'fin', message: 'El fin ya pasó', rule: 'vigencia' })
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Vigencia del plan temporal inválida')
    return { inicio, fin }
}
