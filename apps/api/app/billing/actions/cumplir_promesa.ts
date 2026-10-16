import type { Transaccion } from '#shared/domain_action'
import { ResolverPromesa, siCumplida, type FilaPromesa } from '#billing/cierre_promesa'

/** `promesas.cumplir`: ver `cierre_promesa.ts`. La llama `revisarPromesasCliente` (evento `pago.registrado`). */
export default class CumplirPromesa extends ResolverPromesa {
    readonly nombre = 'promesas.cumplir'

    protected async decidir(t: Transaccion, promesa: FilaPromesa) {
        if (promesa.estado !== 'activa') return null
        const { decision } = await siCumplida(t, promesa)
        return decision
    }
}
