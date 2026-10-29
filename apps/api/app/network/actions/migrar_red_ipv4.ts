import { DomainAction, simularEnTransaccion, type Transaccion } from '#shared/domain_action'
import type { ContextoAccion } from '#shared/contexto'
import { migrarPools, type ResultadoMigracion } from '#network/migrar_pools'

export interface EntradaMigrarRedIpv4 {
    id: number
    version: number
    router_id: number
    mover_servicios?: boolean
    /** bloques IPv6 del mismo router que se mudan en la misma operación */
    bloques_ipv6?: number[]
}

/**
 * Pasa una red IPv4 (y, si se piden, bloques IPv6 del mismo router) a otro router
 * (`contratos/pools.md` §3; la lógica está en `#network/migrar_pools`).
 */
export default class MigrarRedIpv4 extends DomainAction<EntradaMigrarRedIpv4, ResultadoMigracion> {
    readonly nombre = 'redes.migrar'

    protected handle(input: EntradaMigrarRedIpv4, t: Transaccion): Promise<ResultadoMigracion> {
        return migrarPools(t, entrada(input))
    }

    /** Lo mismo sin guardar nada: qué servicios se moverían y con qué direcciones. */
    static async simular(input: EntradaMigrarRedIpv4, ctx: ContextoAccion): Promise<ResultadoMigracion> {
        const resultado = await simularEnTransaccion(ctx, (t) => migrarPools(t, entrada(input)))
        return { ...resultado, simulado: true }
    }
}

function entrada(input: EntradaMigrarRedIpv4) {
    return {
        principal: { tipo: 'red_ipv4' as const, id: input.id, version: input.version },
        redes_ipv4: [],
        bloques_ipv6: input.bloques_ipv6 ?? [],
        router_id: input.router_id,
        mover_servicios: input.mover_servicios ?? false,
    }
}
