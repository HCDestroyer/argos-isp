import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { ESTADOS_SIN_RED, serviciosVigentesDeRouter } from '#network/routeros/consultas'
import { solicitarVelocidad } from '#network/sesiones/velocidad'

export interface EntradaSincronizarPlan {
    plan_id: number
    /** Solo ese router; sin él, todos los routers con servicios del plan */
    router_id?: number | null
    /** `plan.velocidad_cambiada` que la disparó (sincronización automática) */
    evento_id?: string | null
}

export interface SincronizacionRouter {
    router_id: number
    nombre: string
    /** Servicios vigentes del plan en el router */
    servicios: number
    /** Sesiones PPPoE abiertas a las que se pidió CoA con la velocidad nueva (sin desconectar) */
    sesiones_actualizadas: number
    /** Sesiones abiertas que no reciben CoA (PCQ del plan, suspendidas o entraron con otra estrategia) */
    sesiones_sin_coa: number
    /** Objetos que el reconciliador creó, corrigió o borró en el router (colas, padres, perfiles, PCQ) */
    colas_cambiadas: number
    /** El router se reconcilió por su API (false: sin credenciales ni servicios sin PPPoE) */
    reconciliado: boolean
    errores: string[]
}

export interface SincronizacionPlan {
    plan_id: number
    /** Servicios PPPoE del plan cuyo `aaa:user:*` se reescribe */
    aaa_reescritos: number
    routers: SincronizacionRouter[]
}

/**
 * `planes.sincronizar` (`contratos/control-velocidad.md` §5): lleva a la red la velocidad vigente del
 * plan sin desconectar a nadie. En su transacción:
 *
 * 1. pide CoA de velocidad (`sesion.velocidad_solicitada`) a cada sesión PPPoE viva del plan que lo
 *    admite (`radius_rate_limit` o `perfil_ppp`, activa o limitada);
 * 2. agenda la reescritura de `aaa:user:*` de sus servicios después del COMMIT.
 *
 * La reconciliación de cada router (colas, padres, perfiles, PCQ) la hace después `sincronizarPlan`
 * (`app/network/routeros/sincronizar.ts`) con `routeros.reconciliar`, una acción auditada por router.
 * También la dispara `plan.velocidad_cambiada` (actor sistema) al editar el plan o su excepción.
 */
export default class SincronizarPlan extends DomainAction<EntradaSincronizarPlan, SincronizacionPlan> {
    readonly nombre = 'planes.sincronizar'

    protected async handle(input: EntradaSincronizarPlan, t: Transaccion): Promise<SincronizacionPlan> {
        t.fijarEntidad('plan', input.plan_id)
        const plan = await t.trx.from('network.planes').where('id', input.plan_id).select('id').first()
        if (!plan) throw new NoEncontrado(`El plan ${input.plan_id} no existe`)
        const routerId = input.router_id ?? null
        if (routerId !== null) {
            const router = await t.trx.from('network.routers').where('id', routerId).select('id').first()
            if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
        }
        const filas = (await t.trx
            .from('core.servicios as s')
            .join('network.routers as r', 'r.id', 's.router_id')
            .where('s.plan_id', input.plan_id)
            .whereNotIn('s.estado', [...ESTADOS_SIN_RED])
            .if(routerId !== null, (q) => q.where('s.router_id', routerId!))
            .distinct('s.router_id', 'r.nombre')
            .orderBy('s.router_id')) as Array<{ router_id: number; nombre: string }>
        const ids = new Set(filas.map((f) => Number(f.router_id)))
        if (routerId !== null && !ids.has(routerId)) {
            const r = await t.trx.from('network.routers').where('id', routerId).select('nombre').first()
            filas.push({ router_id: routerId, nombre: r.nombre })
        }

        const salida: SincronizacionPlan = { plan_id: input.plan_id, aaa_reescritos: 0, routers: [] }
        const motivo = input.evento_id
            ? `plan ${input.plan_id} cambió de velocidad`
            : `sincronizar plan ${input.plan_id}`
        for (const fila of filas) {
            const id = Number(fila.router_id)
            const vigentes = await serviciosVigentesDeRouter(id, t.trx)
            const servicios = vigentes.filter((s) => s.plan_id === input.plan_id)
            const resumen: SincronizacionRouter = {
                router_id: id,
                nombre: fila.nombre,
                servicios: servicios.length,
                sesiones_actualizadas: 0,
                sesiones_sin_coa: 0,
                colas_cambiadas: 0,
                reconciliado: false,
                errores: [],
            }
            for (const s of servicios) {
                if (s.tipo_conexion === 'pppoe') salida.aaa_reescritos++
                const r = await solicitarVelocidad(t, s, motivo)
                resumen.sesiones_actualizadas += r.coa
                resumen.sesiones_sin_coa += r.abiertas - r.coa
            }
            salida.routers.push(resumen)
        }
        refrescarAaaAlConfirmar(t, { planId: input.plan_id, ...(routerId !== null ? { routerId } : {}) })
        return salida
    }
}
