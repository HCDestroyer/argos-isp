import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, detalleAvance, siCumplida, type FilaPromesa } from '#billing/cierre_promesa'

/**
 * `promesas.incumplir`: ver `cierre_promesa.ts`. La llama el cron `incumplirPromesas`.
 *
 * Una reconexión temporal (contrato Iris 0.6.0 §7.3) que llega a su `hasta` con el comprobante aún
 * `pendiente` se **cancela** (`promesa.cancelada`, `motivo = vencida_sin_revisar`) y el servicio se
 * re-evalúa: la demora fue de caja, no cuenta como incumplida en el historial del cliente. Con el
 * comprobante ya aprobado y el pago sin saldar lo vencido, se incumple como cualquier promesa.
 */
export default class IncumplirPromesa extends ResolverPromesa {
    readonly nombre = 'promesas.incumplir'

    protected async decidir(t: Transaccion, promesa: FilaPromesa, ahora: Date) {
        if (new Date(promesa.vence_en) > ahora) return null
        if (promesa.estado === 'pendiente_aprobacion') {
            return {
                estado: 'cancelada' as const,
                detalle: { motivo: 'venció sin aprobación' },
                cancelacion: { motivo: 'vencida_sin_aprobacion' as const, detalle: null },
            }
        }
        if (promesa.estado !== 'activa') return null
        const { avance, decision } = await siCumplida(t, promesa)
        if (decision) return decision
        if (promesa.tipo === 'reconexion_temporal' && promesa.comprobante_id !== null) {
            const comprobante = (await t.trx
                .from('billing.comprobantes')
                .where('id', promesa.comprobante_id)
                .select('estado')
                .first()) as { estado: string } | null
            if (comprobante?.estado === 'pendiente') {
                return {
                    estado: 'cancelada' as const,
                    detalle: {
                        motivo: 'la reconexión temporal venció con el comprobante sin revisar',
                        ...detalleAvance(avance),
                    },
                    cancelacion: { motivo: 'vencida_sin_revisar' as const, detalle: null },
                }
            }
        }
        return {
            estado: 'incumplida' as const,
            detalle: detalleAvance(avance),
        }
    }
}
