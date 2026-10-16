import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verImplementacion, verPlan, type PlanRouterVista } from '#network/consultas/planes'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { exigirVelocidadValida } from '#network/actions/crear_plan'
import { camposVelocidadCambiados } from '#network/actions/editar_plan'
import { velocidadDePlan } from '#network/actions/obtener_implementacion_plan'
import { CAMPOS_EXCEPCION_VELOCIDAD } from '#network/velocidad'

/** Campos de `planes_routers` que cambian las colas: emiten `plan.velocidad_cambiada`. */
const CAMPOS_COLA = ['rate_limit_override', 'profile_ppp', ...CAMPOS_EXCEPCION_VELOCIDAD] as const

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
    /** excepciones de velocidad (null = hereda del plan) */
    reuso?: number | null
    garantizado_pct?: number | null
    rafaga_bajada_kbps?: number | null
    rafaga_subida_kbps?: number | null
    rafaga_umbral_pct?: number | null
    rafaga_segundos?: number | null
    prioridad?: number | null
}

/**
 * Crea o edita la implementación de un plan en un router (`network.planes_routers`): perfil PPP,
 * pools, local-address y rate-limit propio del router. Para un plan no global, es lo que lo hace
 * disponible en ese router. Después del COMMIT reescribe `aaa:user:*` de los servicios del plan
 * en ese router (perfil, pools y rate-limit van en el registro de RADIUS).
 *
 * Excepciones de velocidad (`contratos/velocidad.md`): se valida la velocidad efectiva (plan +
 * excepción) con 422 por campo; si cambió un campo de cola (velocidad, `rate_limit_override` o
 * `profile_ppp`) emite `plan.velocidad_cambiada` con el `router_id`.
 */
export default class ImplementarPlan extends DomainAction<EntradaImplementarPlan, PlanRouterVista> {
    readonly nombre = 'planes.editar'

    protected async handle(input: EntradaImplementarPlan, t: Transaccion): Promise<PlanRouterVista> {
        const { plan_id: planId, router_id: routerId, version, ...datos } = input
        const plan = await verPlan(planId, t.trx)
        const router = await t.trx.from('network.routers').where('id', routerId).select('id').first()
        if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)

        const columnas = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined))
        const antes = await verImplementacion(planId, routerId, t.trx)
        exigirVelocidadValida(velocidadDePlan(plan, { ...(antes ?? {}), ...columnas } as PlanRouterVista))
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
        const campos = camposVelocidadCambiados(
            antes as unknown as Record<string, unknown> | null,
            despues as unknown as Record<string, unknown>,
            CAMPOS_COLA,
        )
        if (campos.length > 0) {
            await t.emit('plan.velocidad_cambiada', { plan_id: planId, router_id: routerId, campos })
        }
        refrescarAaaAlConfirmar(t, { planId, routerId })
        return despues
    }
}
