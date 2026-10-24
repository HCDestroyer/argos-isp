import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { actualizarConVersion } from '#shared/version'
import { obtenerPlantilla, paraAuditoria, serializarPlantilla, type PlantillaPublica } from '#billing/plantillas'

/**
 * `plantillas.retirar` (`POST /plantillas-facturacion/:id/retirar { version, motivo }`, pedido de A4).
 *
 * - Una plantilla retirada **sigue facturando** a los servicios que ya la tienen: la generación, el
 *   vencimiento, el corte y las promesas no cambian para ellos (cada factura guarda su
 *   `reglas_snapshot`). Se puede seguir editando para esos servicios.
 * - No se asigna a servicios nuevos ni se cambia un servicio a ella: el trigger
 *   `core.servicios_plantilla_vigente` lo impide (422 `restriccion`), así vale para cualquier camino
 *   (alta, edición, importador).
 * - No se retira la plantilla por defecto (409 `plantilla_por_defecto`: marca otra primero); una ya
 *   retirada responde 409 `plantilla_retirada`. Control optimista con `version` (409). No vuelve atrás.
 * - Diff en `audit.cambios`; sin evento (no cambia el estado de ningún servicio).
 */

export interface EntradaRetirarPlantilla {
    id: number
    version: number
    motivo: string
}

export default class RetirarPlantilla extends DomainAction<EntradaRetirarPlantilla, PlantillaPublica> {
    readonly nombre = 'plantillas.retirar'

    protected async handle(input: EntradaRetirarPlantilla, t: Transaccion) {
        t.fijarEntidad('plantilla_facturacion', input.id)
        const antes = await obtenerPlantilla(input.id, t.trx)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_facturacion', input.id)
        if (antes.retirada_en !== null) {
            throw new Conflicto(`La plantilla ${antes.nombre} ya está retirada`, 'plantilla_retirada', 'Plantilla retirada')
        }
        if (antes.por_defecto) {
            throw new Conflicto(
                `La plantilla ${antes.nombre} es la de por defecto: marca otra como por defecto antes de retirarla`,
                'plantilla_por_defecto',
                'Plantilla por defecto',
            )
        }
        await actualizarConVersion(t.trx, 'billing.plantillas_facturacion', input.id, input.version, {
            retirada_en: t.trx.knexRawQuery('now()'),
            retirada_por: usuarioDelActor(t.ctx.actor),
            motivo_retiro: input.motivo.trim(),
        })
        const despues = await obtenerPlantilla(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'plantilla_facturacion', id: input.id },
            paraAuditoria(antes),
            paraAuditoria(despues),
        )
        return serializarPlantilla(despues)
    }
}
