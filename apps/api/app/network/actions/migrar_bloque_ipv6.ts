import { DomainAction, simularEnTransaccion, type Transaccion } from '#shared/domain_action'
import type { ContextoAccion } from '#shared/contexto'
import { migrarPools, type ResultadoMigracion } from '#network/migrar_pools'

export interface EntradaMigrarBloqueIpv6 {
    id: number
    version: number
    router_id: number
    mover_servicios?: boolean
    /** redes IPv4 del mismo router que se mudan en la misma operación */
    redes_ipv4?: number[]
}

/**
 * Pasa un bloque IPv6 con todos sus pools (y, si se piden, redes IPv4 del mismo router) a otro
 * router (`contratos/pools.md` §3). Un pool no se muda solo: vive dentro de su bloque, y el bloque
 * es del router.
 */
export default class MigrarBloqueIpv6 extends DomainAction<EntradaMigrarBloqueIpv6, ResultadoMigracion> {
    readonly nombre = 'ipv6.migrar'

    protected handle(input: EntradaMigrarBloqueIpv6, t: Transaccion): Promise<ResultadoMigracion> {
        return migrarPools(t, entrada(input))
    }

    /** Lo mismo sin guardar nada: qué servicios se moverían y con qué direcciones. */
    static async simular(input: EntradaMigrarBloqueIpv6, ctx: ContextoAccion): Promise<ResultadoMigracion> {
        const resultado = await simularEnTransaccion(ctx, (t) => migrarPools(t, entrada(input)))
        return { ...resultado, simulado: true }
    }
}

function entrada(input: EntradaMigrarBloqueIpv6) {
    return {
        principal: { tipo: 'ipv6_bloque' as const, id: input.id, version: input.version },
        redes_ipv4: input.redes_ipv4 ?? [],
        bloques_ipv6: [],
        router_id: input.router_id,
        mover_servicios: input.mover_servicios ?? false,
    }
}
