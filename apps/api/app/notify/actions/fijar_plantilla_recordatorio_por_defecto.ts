import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion } from '#shared/errores'
import {
    bloquearPlantilla,
    exigirNoPersonalizada,
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    type PlantillaRecordatorio,
} from '#notify/plantillas_recordatorio'

export interface EntradaFijarPorDefecto {
    id: number
    version: number
}

/**
 * Quita la marca de por defecto de la plantilla actual de la empresa (salvo `salvo`), con su
 * `version + 1`, su diff y su `recordatorios.plantilla_cambiada`. La usan crear y fijar por defecto
 * antes de marcar la nueva (índice único parcial: a lo sumo una por empresa).
 */
export async function desmarcarPorDefecto(t: Transaccion, empresaId: number, salvo: number): Promise<void> {
    const anterior = (await t.trx
        .from('notify.plantillas_recordatorio')
        .where({ empresa_id: empresaId, por_defecto: true })
        .whereNot('id', salvo)
        .forUpdate()
        .select('id')
        .first()) as { id: number } | null
    if (!anterior) return
    const antes = await obtenerPlantillaRecordatorio(anterior.id, t.trx)
    await t.trx
        .from('notify.plantillas_recordatorio')
        .where('id', anterior.id)
        .update({
            por_defecto: false,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        })
    await t.registrarCambios({ tipo: 'plantilla_recordatorio', id: anterior.id }, paraAuditoria(antes), {
        ...paraAuditoria(antes),
        por_defecto: false,
    })
    await t.emit('recordatorios.plantilla_cambiada', {
        plantilla_id: anterior.id,
        empresa_id: empresaId,
        campos: ['por_defecto'],
        pasos: false,
    })
}

/**
 * `recordatorios.editar` (`POST /plantillas-recordatorio/:id/fijar-por-defecto { version }`): la
 * plantilla pasa a ser la por defecto de su empresa y la anterior deja de serlo, en la misma
 * transacción. Retirada: 409 `plantilla_retirada`; personalizada: 409 `plantilla_personalizada`;
 * `version` vieja: 409. Si ya es la por defecto no cambia nada (sin evento).
 */
export default class FijarPlantillaRecordatorioPorDefecto extends DomainAction<
    EntradaFijarPorDefecto,
    PlantillaRecordatorio
> {
    readonly nombre = 'recordatorios.editar'

    protected async handle(input: EntradaFijarPorDefecto, t: Transaccion) {
        t.fijarEntidad('plantilla_recordatorio', input.id)
        const antes = await bloquearPlantilla(t.trx, input.id)
        t.fijarEmpresa(antes.empresa_id)
        exigirAccesoEmpresa(t.ctx, antes.empresa_id)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_recordatorio', input.id)
        exigirNoPersonalizada(antes)
        if (antes.retirada_en !== null) {
            throw new Conflicto(
                `La plantilla ${antes.nombre} está retirada: no puede ser la por defecto`,
                'plantilla_retirada',
                'Plantilla retirada',
            )
        }
        if (antes.por_defecto) return antes

        await desmarcarPorDefecto(t, antes.empresa_id, antes.id)
        await t.trx
            .from('notify.plantillas_recordatorio')
            .where('id', antes.id)
            .update({
                por_defecto: true,
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
            campos: ['por_defecto'],
            pasos: false,
        })
        return despues
    }
}
