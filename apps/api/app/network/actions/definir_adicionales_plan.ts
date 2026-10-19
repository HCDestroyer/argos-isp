import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { adicionalesDelPlan, type AdicionalPlanVista } from '#core/adicionales'

export interface EntradaDefinirAdicionalesPlan {
    plan_id: number
    /** `version` del plan: la lista es parte del plan (409 si otra sesión lo cambió) */
    version: number
    adicionales: Array<{ adicional_id: number; cantidad: number }>
}

/**
 * Reemplaza la lista de adicionales que trae un plan (`planes.editar`, como la implementación por
 * router). Los planes son de todas las empresas: la lista puede tener adicionales de varias, y a
 * cada servicio se le asignan solo los de su empresa (`reconciliarIncluidos`).
 *
 * - Sube la `version` del plan y deja el diff en `audit.cambios` (campo `adicionales`).
 * - Un adicional repetido en la lista: 422. Uno nuevo debe existir y estar activo (422); uno que ya
 *   estaba puede quedarse aunque se haya desactivado.
 * - Agregar o quitar un adicional exige acceso a su empresa (403 `empresa_no_permitida`).
 * - No toca los servicios existentes: la lista nueva se aplica al crear un servicio o al cambiar de
 *   plan (`contratos/adicionales.md`).
 */
export default class DefinirAdicionalesPlan extends DomainAction<
    EntradaDefinirAdicionalesPlan,
    AdicionalPlanVista[]
> {
    readonly nombre = 'planes.editar'

    protected async handle(
        input: EntradaDefinirAdicionalesPlan,
        t: Transaccion,
    ): Promise<AdicionalPlanVista[]> {
        t.fijarEntidad('plan', input.plan_id)
        const antes = await adicionalesDelPlan(input.plan_id, t.trx)
        const previos = new Map(antes.map((a) => [a.adicional_id, a]))
        const vistos = new Set<number>()
        for (const [indice, item] of input.adicionales.entries()) {
            if (vistos.has(item.adicional_id)) {
                throw new ValidacionFallida([
                    {
                        field: `adicionales.${indice}.adicional_id`,
                        message: 'Adicional repetido: usa la cantidad',
                        rule: 'distinct',
                    },
                ])
            }
            vistos.add(item.adicional_id)
            if (previos.has(item.adicional_id)) {
                const previo = previos.get(item.adicional_id)!
                if (previo.cantidad !== item.cantidad) exigirAccesoEmpresa(t.ctx, previo.empresa_id)
                continue
            }
            const adicional = (await t.trx
                .from('core.adicionales')
                .where('id', item.adicional_id)
                .select('empresa_id', 'activo')
                .first()) as { empresa_id: number; activo: boolean } | null
            if (!adicional || !adicional.activo) {
                throw new ValidacionFallida([
                    {
                        field: `adicionales.${indice}.adicional_id`,
                        message: adicional ? 'El adicional está desactivado' : 'El adicional no existe',
                        rule: adicional ? 'activo' : 'exists',
                    },
                ])
            }
            exigirAccesoEmpresa(t.ctx, Number(adicional.empresa_id))
        }
        for (const previo of antes) {
            if (!vistos.has(previo.adicional_id)) exigirAccesoEmpresa(t.ctx, previo.empresa_id)
        }

        // sube la versión del plan aunque no cambie ninguna columna suya
        await actualizarConVersion(t.trx, 'network.planes', input.plan_id, input.version, {})
        await t.trx.from('network.planes_adicionales').where('plan_id', input.plan_id).delete()
        if (input.adicionales.length > 0) {
            await t.trx
                .insertQuery()
                .table('network.planes_adicionales')
                .multiInsert(
                    input.adicionales.map((item) => ({
                        plan_id: input.plan_id,
                        adicional_id: item.adicional_id,
                        cantidad: item.cantidad,
                    })),
                )
        }
        const despues = await adicionalesDelPlan(input.plan_id, t.trx)
        const resumen = (lista: AdicionalPlanVista[]) =>
            lista
                .map((a) => ({ adicional_id: a.adicional_id, cantidad: a.cantidad }))
                .sort((a, b) => a.adicional_id - b.adicional_id)
        await t.registrarCambios(
            { tipo: 'plan', id: input.plan_id },
            { adicionales: resumen(antes) },
            { adicionales: resumen(despues) },
        )
        return despues
    }
}
