import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verImplementacion, verPlan, type PlanRouterVista } from '#network/consultas/planes'

export interface EntradaImplementarPlan {
    plan_id: number
    router_id: number
    /** obligatoria si la implementación ya existe */
    version?: number
    profile_ppp?: string | null
    pool_ipv4?: string | null
    pool_ipv6_enlace?: string | null
    pool_ipv6_delegacion?: string | null
    local_address?: string | null
    no_crear_reglas?: boolean
    rate_limit_override?: string | null
}

/**
 * Crea o edita la implementación de un plan en un router (`network.planes_routers`): perfil PPP,
 * pools, local-address y rate-limit propio del router. Para un plan no global, es lo que lo hace
 * disponible en ese router.
 */
export default class ImplementarPlan extends DomainAction<EntradaImplementarPlan, PlanRouterVista> {
    readonly nombre = 'planes.editar'

    protected async handle(input: EntradaImplementarPlan, t: Transaccion): Promise<PlanRouterVista> {
        const { plan_id: planId, router_id: routerId, version, ...datos } = input
        await verPlan(planId, t.trx)
        const router = await t.trx.from('network.routers').where('id', routerId).select('id').first()
        if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)

        const columnas = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined))
        const antes = await verImplementacion(planId, routerId, t.trx)
        let id: number
        if (antes) {
            if (version === undefined) {
                throw new ValidacionFallida([
                    {
                        field: 'version',
                        message: 'La implementación ya existe: envía la version que leíste',
                        rule: 'required',
                    },
                ])
            }
            id = antes.id
            await actualizarConVersion(t.trx, 'network.planes_routers', id, version, columnas)
        } else {
            const [fila] = (await t.trx
                .insertQuery()
                .table('network.planes_routers')
                .insert({ ...columnas, plan_id: planId, router_id: routerId })
                .returning('id')) as Array<{ id: number }>
            id = fila!.id
        }
        t.fijarEntidad('plan_router', id)
        const despues = (await verImplementacion(planId, routerId, t.trx))!
        await t.registrarCambios({ tipo: 'plan_router', id }, antes, despues)
        return despues
    }
}
