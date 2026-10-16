import { DomainAction, type Transaccion } from '#shared/domain_action'
import CumplirPromesa from '#billing/actions/cumplir_promesa'
import type { ResultadoResolverPromesa } from '#billing/cierre_promesa'

/**
 * `promesas.revisar_cliente`: tras un `pago.registrado` (consumidor del grupo `billing`) revisa
 * cada promesa activa de los servicios del cliente con `CumplirPromesa` anidada. Idempotente: un
 * evento repetido no cambia nada (la promesa ya está cumplida).
 */

export interface EntradaRevisarPromesas {
    cliente_id: number
}

export default class RevisarPromesasCliente extends DomainAction<
    EntradaRevisarPromesas,
    ResultadoResolverPromesa[]
> {
    readonly nombre = 'promesas.revisar_cliente'

    protected async handle(
        input: EntradaRevisarPromesas,
        t: Transaccion,
    ): Promise<ResultadoResolverPromesa[]> {
        t.fijarEntidad('cliente', input.cliente_id)
        const activas = (await t.trx
            .from('billing.promesas')
            .where('cliente_id', input.cliente_id)
            .where('estado', 'activa')
            .orderBy('id', 'asc')
            .select('id')) as Array<{ id: number }>
        const resultados: ResultadoResolverPromesa[] = []
        for (const { id } of activas) {
            resultados.push(await new CumplirPromesa().execute({ promesa_id: id }, t.ctx, { trx: t.trx }))
        }
        return resultados
    }
}
