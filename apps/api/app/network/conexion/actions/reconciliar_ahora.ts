import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verRouter } from '#network/consultas/routers'
import { encolarReconciliacion } from '#network/routeros/jobs'

export interface ResultadoReconciliarAhora {
    router_id: number
    job_id: string
    /** false: ya había una reconciliación de este router esperando o en curso */
    encolado: boolean
}

/**
 * `routers.reconciliar`: encola ya la reconciliación de RouterOS de un router (`routeros.reconciliar`
 * con `motivo: manual`) en el worker de routeros, con lock (un job por router a la vez). El resultado
 * queda en `audit.red` y, si corrigió algo o falló, en `audit.acciones` de `routeros.reconciliar`.
 */
export default class ReconciliarAhora extends DomainAction<{ router_id: number }, ResultadoReconciliarAhora> {
    readonly nombre = 'routers.reconciliar'

    protected async handle(input: { router_id: number }, t: Transaccion): Promise<ResultadoReconciliarAhora> {
        t.fijarEntidad('router', input.router_id)
        const router = await verRouter(input.router_id, t.trx)
        t.fijarEmpresa(router.empresa_sugerida_id)
        const job = await encolarReconciliacion({
            router_id: input.router_id,
            actor: t.ctx.actor,
            request_id: t.ctx.requestId,
        })
        return { router_id: input.router_id, ...job }
    }
}
