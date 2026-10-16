import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { bloquearCliente } from '#billing/cobros'
import { verPromesa } from '#billing/promesas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import type { ResultadoCrearPromesa } from '#billing/actions/crear_promesa_pago'

/**
 * `promesas.aprobar` (`POST /promesas/:id/aprobar`): un supervisor aprueba una promesa
 * `pendiente_aprobacion` (canal con `requiere_aprobacion`). Queda `activa` con `aprobada_por`,
 * se agrega `aprobacion` a `resultado_evaluacion`, se emite `promesa.creada` y
 * `evaluarEstadoServicio` reactiva en la misma transacción.
 *
 * 409 si la promesa no está pendiente u otra promesa del servicio ya está activa; 422 si ya
 * venció (el cron la cancela).
 */

export interface EntradaAprobarPromesa {
    promesa_id: number
    nota?: string | null
    ahora?: Date
}

export default class AprobarPromesa extends DomainAction<EntradaAprobarPromesa, ResultadoCrearPromesa> {
    readonly nombre = 'promesas.aprobar'

    protected async handle(input: EntradaAprobarPromesa, t: Transaccion): Promise<ResultadoCrearPromesa> {
        const ahora = input.ahora ?? new Date()
        t.fijarEntidad('promesa', input.promesa_id)
        const previa = await t.trx
            .from('billing.promesas')
            .where('id', input.promesa_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La promesa ${input.promesa_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)

        const promesa = (await t.trx
            .from('billing.promesas')
            .where('id', input.promesa_id)
            .forUpdate()
            .select('id', 'servicio_id', 'estado', 'vence_en', 'monto', 'aprobada_por')
            .firstOrFail()) as {
            id: number
            servicio_id: number
            estado: string
            vence_en: Date
            monto: string
            aprobada_por: number | null
        }
        if (promesa.estado !== 'pendiente_aprobacion') {
            throw new Conflicto(
                `La promesa ${promesa.id} está ${promesa.estado}; solo se aprueban las pendientes`,
                'promesa_no_pendiente',
                'Promesa no pendiente',
            )
        }
        if (new Date(promesa.vence_en) <= ahora) {
            throw new ReglaNegocio(`La promesa ${promesa.id} ya venció`, 'promesa_vencida')
        }
        const activa = await t.trx
            .from('billing.promesas')
            .where('servicio_id', promesa.servicio_id)
            .where('estado', 'activa')
            .select('id')
            .first()
        if (activa) {
            throw new Conflicto(
                `El servicio ${promesa.servicio_id} ya tiene la promesa ${activa.id} activa`,
                'promesa_abierta',
                'Promesa abierta',
            )
        }

        const aprobacion = {
            aprobacion: { por: t.ctx.actor.id, en: ahora.toISOString(), nota: input.nota?.trim() || null },
        }
        await t.trx
            .from('billing.promesas')
            .where('id', promesa.id)
            .update({
                estado: 'activa',
                aprobada_por: t.ctx.actor.id,
                resultado_evaluacion: t.trx.knexRawQuery(
                    `coalesce(resultado_evaluacion, '{}'::jsonb) || ?::jsonb`,
                    [JSON.stringify(aprobacion)],
                ),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'promesa', id: promesa.id },
            { estado: promesa.estado, aprobada_por: promesa.aprobada_por },
            { estado: 'activa', aprobada_por: t.ctx.actor.id },
        )

        await t.emit('promesa.creada', {
            promesa_id: promesa.id,
            servicio_id: promesa.servicio_id,
            vence: new Date(promesa.vence_en).toISOString(),
            monto: promesa.monto,
        })
        const r = await new EvaluarEstadoServicio().execute(
            { servicio_id: promesa.servicio_id, ahora },
            t.ctx,
            { trx: t.trx },
        )
        return {
            ...(await verPromesa(promesa.id, t.trx)),
            servicio: {
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            },
        }
    }
}
