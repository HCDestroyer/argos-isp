import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { columnasPlan, exigirVelocidadValida, type DatosPlan } from '#network/actions/crear_plan'
import { velocidadDePlan } from '#network/actions/obtener_implementacion_plan'
import { columnasPlanRouter, verPlan, type PlanRouterVista, type PlanVista } from '#network/consultas/planes'
import { CAMPOS_VELOCIDAD } from '#network/velocidad'
import { refrescarAaaAlConfirmar } from '#core/aaa'

export interface EntradaEditarPlan extends DatosPlan {
    id: number
    version: number
}

/** Campos de velocidad que difieren entre dos lecturas del plan o de su implementación. */
export function camposVelocidadCambiados(
    antes: Record<string, unknown> | null,
    despues: Record<string, unknown>,
    campos: readonly string[] = CAMPOS_VELOCIDAD,
): string[] {
    return campos.filter((campo) => (antes?.[campo] ?? null) !== (despues[campo] ?? null))
}

/**
 * Edita un plan (control optimista por `version`). El precio nuevo aplica a las facturas que se
 * generen después (A3 toma `precio` al facturar). Los servicios del plan toman la velocidad nueva
 * en su próxima autorización RADIUS: después del COMMIT se reescribe `aaa:user:*` de cada
 * servicio no retirado del plan.
 *
 * Velocidad (`contratos/velocidad.md`): valida la coherencia del plan y la de cada excepción por
 * router con los valores nuevos (422; la de un router lleva su id en el detalle). Si cambió un
 * campo de velocidad, emite `plan.velocidad_cambiada` con `router_id: null` (A2 recalcula padres
 * y perfiles en todos los routers).
 */
export default class EditarPlan extends DomainAction<EntradaEditarPlan, PlanVista> {
    readonly nombre = 'planes.editar'

    protected async handle(input: EntradaEditarPlan, t: Transaccion): Promise<PlanVista> {
        const { id, version, ...datos } = input
        t.fijarEntidad('plan', id)
        const antes = await verPlan(id, t.trx)
        if (datos.nombre !== undefined) {
            const repetido = await t.trx
                .from('network.planes')
                .where('nombre', datos.nombre)
                .whereNot('id', id)
                .first()
            if (repetido) throw new Conflicto(`Ya existe el plan ${datos.nombre}`, 'plan_duplicado')
        }
        // se valida antes del UPDATE: los CHECK de la base responderían 500 en vez de 422
        const propuesto = { ...antes, ...columnasPlan(datos) } as PlanVista
        if (camposVelocidadCambiados(antes as never, propuesto as never).length > 0) {
            exigirVelocidadValida(velocidadDePlan(propuesto, null))
            const implementaciones = (await t.trx
                .from('network.planes_routers')
                .where('plan_id', id)
                .select(columnasPlanRouter())) as PlanRouterVista[]
            for (const implementacion of implementaciones) {
                exigirVelocidadValida(
                    velocidadDePlan(propuesto, implementacion),
                    `Con la excepción del router ${implementacion.router_id}`,
                )
            }
        }
        await actualizarConVersion(t.trx, 'network.planes', id, version, columnasPlan(datos))
        const despues = await verPlan(id, t.trx)
        const campos = camposVelocidadCambiados(antes as never, despues as never)

        await t.registrarCambios({ tipo: 'plan', id }, antes, despues)
        if (campos.length > 0) {
            await t.emit('plan.velocidad_cambiada', { plan_id: id, router_id: null, campos })
        }
        refrescarAaaAlConfirmar(t, { planId: id })
        return despues
    }
}
