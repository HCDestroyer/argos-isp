import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { errorDeSintaxis } from '#notify/plantillas'

export interface EntradaEditarPlantilla {
    id: number
    version: number
    asunto?: string | null
    cuerpo?: string
    activa?: boolean
}

export type FilaPlantilla = Record<string, unknown> & { id: number }

/**
 * Edita asunto, cuerpo o `activa` de una plantilla de notificación. Valida la sintaxis
 * Mustache (422), exige `version` (409) y registra el diff en `audit.cambios`.
 */
export default class EditarPlantillaNotificacion extends DomainAction<EntradaEditarPlantilla, FilaPlantilla> {
    readonly nombre = 'notificaciones.editar'

    protected async handle(input: EntradaEditarPlantilla, t: Transaccion): Promise<FilaPlantilla> {
        t.fijarEntidad('plantilla_notificacion', input.id)

        const errores: ErrorCampo[] = []
        for (const campo of ['asunto', 'cuerpo'] as const) {
            const valor = input[campo]
            if (typeof valor !== 'string') continue
            const error = errorDeSintaxis(valor)
            if (error) {
                errores.push({
                    field: campo,
                    message: `Plantilla Mustache inválida: ${error}`,
                    rule: 'mustache',
                })
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const antes = (await t.trx
            .from('notify.plantillas')
            .where('id', input.id)
            .first()) as FilaPlantilla | null
        if (!antes) throw new NoEncontrado(`notify.plantillas ${input.id} no existe`)

        const cambios: Record<string, unknown> = {}
        if (input.asunto !== undefined) cambios.asunto = input.asunto
        if (input.cuerpo !== undefined) cambios.cuerpo = input.cuerpo
        if (input.activa !== undefined) cambios.activa = input.activa

        const despues = await actualizarConVersion<FilaPlantilla>(
            t.trx,
            'notify.plantillas',
            input.id,
            input.version,
            cambios,
        )
        await t.registrarCambios({ tipo: 'plantilla_notificacion', id: input.id }, antes, despues)
        return despues
    }
}
