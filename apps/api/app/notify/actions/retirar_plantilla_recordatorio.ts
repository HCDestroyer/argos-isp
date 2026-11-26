import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import {
    bloquearPlantilla,
    exigirNoPersonalizada,
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    type PlantillaRecordatorio,
} from '#notify/plantillas_recordatorio'

export interface EntradaRetirarPlantillaRecordatorio {
    id: number
    version: number
    motivo: string
}

/**
 * `recordatorios.retirar` (`POST /plantillas-recordatorio/:id/retirar { version, motivo }`). Retirar
 * no la quita de quien la tiene (sigue rigiendo para esos servicios y suscripciones); solo impide
 * asignarla (409 `plantilla_retirada` al asignar). La por defecto no se retira sin fijar otra antes
 * (409 `plantilla_por_defecto`); una ya retirada, 409 `plantilla_retirada`; la personalizada de un
 * servicio, 409 `plantilla_personalizada`. No vuelve atrás.
 */
export default class RetirarPlantillaRecordatorio extends DomainAction<
    EntradaRetirarPlantillaRecordatorio,
    PlantillaRecordatorio
> {
    readonly nombre = 'recordatorios.retirar'

    protected async handle(input: EntradaRetirarPlantillaRecordatorio, t: Transaccion) {
        t.fijarEntidad('plantilla_recordatorio', input.id)
        const antes = await bloquearPlantilla(t.trx, input.id)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_recordatorio', input.id)
        exigirNoPersonalizada(antes)
        if (antes.retirada_en !== null) {
            throw new Conflicto(
                `La plantilla ${antes.nombre} ya está retirada`,
                'plantilla_retirada',
                'Plantilla retirada',
            )
        }
        if (antes.por_defecto) {
            throw new Conflicto(
                `La plantilla ${antes.nombre} es la por defecto: fija otra como por defecto antes de retirarla`,
                'plantilla_por_defecto',
                'Plantilla por defecto',
            )
        }
        await t.trx
            .from('notify.plantillas_recordatorio')
            .where('id', antes.id)
            .update({
                retirada_en: t.trx.knexRawQuery('now()'),
                retirada_por: usuarioDelActor(t.ctx.actor),
                motivo_retiro: input.motivo.trim(),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const despues = await obtenerPlantillaRecordatorio(antes.id, t.trx)
        await t.registrarCambios(
            { tipo: 'plantilla_recordatorio', id: antes.id },
            paraAuditoria(antes),
            paraAuditoria(despues),
        )
        await t.emit('recordatorios.plantilla_cambiada', {
            plantilla_id: antes.id,
            empresa_id: antes.empresa_id,
            campos: ['retirada_en', 'motivo_retiro'],
            pasos: false,
        })
        return despues
    }
}
