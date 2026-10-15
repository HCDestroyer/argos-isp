import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { columnasPlan, type DatosPlan } from '#network/actions/crear_plan'
import { verPlan, type PlanVista } from '#network/consultas/planes'

export interface EntradaEditarPlan extends DatosPlan {
    id: number
    version: number
}

/**
 * Edita un plan (control optimista por `version`). El precio nuevo aplica a las facturas que se
 * generen después (A3 toma `precio` al facturar). Los servicios del plan toman la velocidad nueva
 * en su próxima autorización RADIUS (la invalidación de `aaa:user:*` llega con la tarea 9).
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
        await actualizarConVersion(t.trx, 'network.planes', id, version, columnasPlan(datos))
        const despues = await verPlan(id, t.trx)
        await t.registrarCambios({ tipo: 'plan', id }, antes, despues)
        return despues
    }
}
