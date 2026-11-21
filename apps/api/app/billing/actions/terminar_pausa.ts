import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { verPausa, type FinPausa, type PausaVista } from '#billing/pausas'
import ReactivarServicio from '#core/actions/reactivar_servicio'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * `servicios.terminar_pausa` (`POST /servicios/:id/terminar-pausa`, decisión del PM 16): termina la
 * pausa sin cobro activa del servicio. La usa el operador (antes de tiempo, `manual`) y, anidada, el
 * cron `pausas` (`vencida`, `reactivado`, `retirado`).
 *
 * - Si el servicio sigue suspendido a mano por la pausa: `ReactivarServicio` de A1 anidada (quita la
 *   marca y pasa a `activo`) y luego `evaluarEstadoServicio` (si debe, lo vuelve a limitar o cortar
 *   según su plantilla y la hora de corte). Retirado: solo cierra la pausa.
 * - Si alguien ya lo reactivó por otro camino: solo cierra la pausa (`reactivado`).
 * - 422 `sin_pausa` si no hay pausa activa.
 *
 * Evento `servicio.pausa_terminada`.
 */

export interface EntradaTerminarPausa {
    servicio_id: number
    fin_motivo?: FinPausa
    motivo?: string | null
}

export default class TerminarPausa extends DomainAction<EntradaTerminarPausa, PausaVista> {
    readonly nombre = 'servicios.terminar_pausa'

    protected async handle(input: EntradaTerminarPausa, t: Transaccion): Promise<PausaVista> {
        t.fijarEntidad('servicio', input.servicio_id)
        const pausa = (await t.trx
            .from('billing.pausas_servicio')
            .where('servicio_id', input.servicio_id)
            .where('estado', 'activa')
            .forUpdate()
            .select('id', 'empresa_id')
            .first()) as { id: number; empresa_id: number } | null
        if (!pausa) {
            const existe = await t.trx
                .from('core.servicios')
                .where('id', input.servicio_id)
                .select('id')
                .first()
            if (!existe) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
            throw new ReglaNegocio(`El servicio ${input.servicio_id} no tiene una pausa activa`, 'sin_pausa')
        }
        const empresaId = Number(pausa.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('estado', 'suspension_manual')
            .first()) as { estado: string; suspension_manual: boolean }
        let fin: FinPausa = input.fin_motivo ?? 'manual'
        if (servicio.estado === 'retirado') {
            fin = 'retirado'
        } else if (!servicio.suspension_manual) {
            fin = 'reactivado'
        } else {
            const motivo = input.motivo?.trim()
            await new ReactivarServicio().execute(
                {
                    id: input.servicio_id,
                    motivo:
                        fin === 'vencida'
                            ? 'Terminó la pausa sin cobro'
                            : `Pausa sin cobro terminada antes de tiempo${motivo ? `: ${motivo}` : ''}`,
                },
                t.ctx,
                { trx: t.trx },
            )
            await new EvaluarEstadoServicio().execute({ servicio_id: input.servicio_id }, t.ctx, {
                trx: t.trx,
            })
            t.fijarEntidad('servicio', input.servicio_id)
            t.fijarEmpresa(empresaId)
        }

        const usuario = usuarioDelActor(t.ctx.actor)
        await t.trx
            .from('billing.pausas_servicio')
            .where('id', pausa.id)
            .update({
                estado: 'terminada',
                terminada_en: t.trx.knexRawQuery('now()'),
                fin_motivo: fin,
                terminada_por: usuario,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'pausa_servicio', id: Number(pausa.id) },
            { estado: 'activa', fin_motivo: null },
            { estado: 'terminada', fin_motivo: fin },
        )
        const vista = await verPausa(Number(pausa.id), t.trx)
        await t.emit('servicio.pausa_terminada', {
            pausa_id: vista.id,
            servicio_id: vista.servicio_id,
            empresa_id: empresaId,
            cliente_id: vista.cliente_id,
            fin_motivo: fin,
        })
        return vista
    }
}
