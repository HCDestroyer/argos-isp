import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'

export interface EntradaEditarRecordatorio {
    id: number
    version: number
    /** días respecto al vencimiento: negativo antes, positivo después */
    dias?: number
    /** HH:MM hora de Guatemala */
    hora?: string
    activo?: boolean
}

export type FilaRecordatorio = Record<string, unknown> & { id: number }

/**
 * Configura uno de los tres recordatorios de pago (días respecto al vencimiento, hora, activo).
 * Exige `version` (409) y registra el diff en `audit.cambios`. Los recordatorios ya enviados no
 * se repiten al cambiar la configuración (el origen es `recordatorio:<orden>:factura:<id>`).
 */
export default class EditarRecordatorio extends DomainAction<EntradaEditarRecordatorio, FilaRecordatorio> {
    readonly nombre = 'notificaciones.editar'

    protected async handle(input: EntradaEditarRecordatorio, t: Transaccion): Promise<FilaRecordatorio> {
        t.fijarEntidad('recordatorio', input.id)
        const antes = (await t.trx
            .from('notify.recordatorios')
            .where('id', input.id)
            .first()) as FilaRecordatorio | null
        if (!antes) throw new NoEncontrado(`notify.recordatorios ${input.id} no existe`)

        const cambios: Record<string, unknown> = {}
        if (input.dias !== undefined) cambios.dias = input.dias
        if (input.hora !== undefined) cambios.hora = input.hora
        if (input.activo !== undefined) cambios.activo = input.activo

        const despues = await actualizarConVersion<FilaRecordatorio>(
            t.trx,
            'notify.recordatorios',
            input.id,
            input.version,
            cambios,
        )
        await t.registrarCambios({ tipo: 'recordatorio', id: input.id }, antes, despues)
        return despues
    }
}
