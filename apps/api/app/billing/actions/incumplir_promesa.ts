import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, siCumplida, type FilaPromesa } from '#billing/cierre_promesa'
import { aTexto } from '#ledger/dinero'

/** `promesas.incumplir`: ver `cierre_promesa.ts`. La llama el cron `incumplirPromesas`. */
export default class IncumplirPromesa extends ResolverPromesa {
    readonly nombre = 'promesas.incumplir'

    protected async decidir(t: Transaccion, promesa: FilaPromesa, ahora: Date) {
        if (new Date(promesa.vence_en) > ahora) return null
        if (promesa.estado === 'pendiente_aprobacion') {
            return { estado: 'cancelada' as const, detalle: { motivo: 'venció sin aprobación' } }
        }
        if (promesa.estado !== 'activa') return null
        const { avance, decision } = await siCumplida(t, promesa)
        if (decision) return decision
        return {
            estado: 'incumplida' as const,
            detalle: { pagado: aTexto(avance.pagado), deuda_vencida: aTexto(avance.vencida) },
        }
    }
}
