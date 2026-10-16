import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import { bloquearCliente } from '#billing/cobros'
import { avanceDePromesa, type EstadoPromesa } from '#billing/promesas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * Cierre de una promesa: `cumplida`, `incumplida` o `cancelada`. Dos acciones con la misma pieza:
 *
 * - `promesas.cumplir` (`CumplirPromesa`): la llama el consumidor de `pago.registrado` (grupo
 *   `billing`) por cada promesa activa del cliente. Si lo pagado a las facturas del servicio desde
 *   la promesa llega a su monto, o el servicio ya no tiene deuda vencida → `cumplida`,
 *   `promesa.cumplida` y re-evaluación (una promesa parcial cumplida puede volver a limitar o
 *   cortar si quedan vencidas, respetando la hora de corte). Si no, no cambia nada.
 * - `promesas.incumplir` (`IncumplirPromesa`): la llama el cron `incumplirPromesas` con las que
 *   ya vencieron. Una activa se revisa primero como cumplida (el evento del pago pudo no haber
 *   llegado); si no alcanzó → `incumplida`, `promesa.incumplida` y re-evaluación (corta). Una
 *   `pendiente_aprobacion` vencida sin aprobar → `cancelada` (sin evento).
 *
 * Idempotentes: sobre una promesa ya cerrada no hacen nada.
 */

export interface EntradaResolverPromesa {
    promesa_id: number
    ahora?: Date
}

export interface ResultadoResolverPromesa {
    promesa_id: number
    de: EstadoPromesa
    estado: EstadoPromesa
    cambiado: boolean
}

export interface FilaPromesa {
    id: number
    servicio_id: number
    cliente_id: number
    estado: EstadoPromesa
    vence_en: Date
    monto: string
    created_at: Date
}

export abstract class ResolverPromesa extends DomainAction<EntradaResolverPromesa, ResultadoResolverPromesa> {
    protected abstract decidir(
        t: Transaccion,
        promesa: FilaPromesa,
        ahora: Date,
    ): Promise<{ estado: EstadoPromesa; detalle: Record<string, unknown> } | null>

    protected async handle(input: EntradaResolverPromesa, t: Transaccion): Promise<ResultadoResolverPromesa> {
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
            .select('id', 'servicio_id', 'cliente_id', 'estado', 'vence_en', 'monto', 'created_at')
            .firstOrFail()) as FilaPromesa

        const sinCambio = {
            promesa_id: promesa.id,
            de: promesa.estado,
            estado: promesa.estado,
            cambiado: false,
        }
        const decision = await this.decidir(t, promesa, ahora)
        if (!decision) return sinCambio

        await t.trx
            .from('billing.promesas')
            .where('id', promesa.id)
            .update({
                estado: decision.estado,
                resultado_evaluacion: t.trx.knexRawQuery(
                    `coalesce(resultado_evaluacion, '{}'::jsonb) || ?::jsonb`,
                    [
                        JSON.stringify({
                            cierre: { estado: decision.estado, en: ahora.toISOString(), ...decision.detalle },
                        }),
                    ],
                ),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'promesa', id: promesa.id },
            { estado: promesa.estado },
            { estado: decision.estado },
        )

        if (decision.estado === 'cumplida' || decision.estado === 'incumplida') {
            await t.emit(decision.estado === 'cumplida' ? 'promesa.cumplida' : 'promesa.incumplida', {
                promesa_id: promesa.id,
                servicio_id: promesa.servicio_id,
                vence: new Date(promesa.vence_en).toISOString(),
                monto: promesa.monto,
            })
            await new EvaluarEstadoServicio().execute({ servicio_id: promesa.servicio_id, ahora }, t.ctx, {
                trx: t.trx,
            })
        }
        return { ...sinCambio, estado: decision.estado, cambiado: true }
    }
}

export async function siCumplida(t: Transaccion, promesa: FilaPromesa) {
    const avance = await avanceDePromesa(t.trx, promesa)
    if (!avance.cumplida) return { avance, decision: null }
    return {
        avance,
        decision: {
            estado: 'cumplida' as const,
            detalle: { pagado: aTexto(avance.pagado), deuda_vencida: aTexto(avance.vencida) },
        },
    }
}
