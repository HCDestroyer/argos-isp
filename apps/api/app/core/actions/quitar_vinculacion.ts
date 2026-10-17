import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { verVinculacion, type VinculacionVista } from '#core/sso'

export interface EntradaQuitarVinculacion {
    id: number
}

/**
 * El usuario quita una de **sus** vinculaciones de autologin (`POST /me/vinculaciones/:id/quitar`).
 * El siguiente ticket de ese usuario externo vuelve a pedir el login. 404 si no es suya o ya no
 * está vigente.
 */
export default class QuitarVinculacion extends DomainAction<EntradaQuitarVinculacion, VinculacionVista> {
    readonly nombre = 'vinculaciones.quitar'

    protected async handle(input: EntradaQuitarVinculacion, t: Transaccion): Promise<VinculacionVista> {
        t.fijarEntidad('vinculacion_externa', input.id)
        const usuarioId = usuarioDelActor(t.ctx.actor)
        const actual = await verVinculacion(input.id, t.trx)
        if (!actual || actual.usuario_id !== usuarioId || actual.revocada_en) {
            throw new NoEncontrado(`No tienes la vinculación ${input.id}`)
        }
        await t.trx
            .from('core.vinculaciones_externas')
            .where('id', input.id)
            .update({
                revocada_en: t.trx.knexRawQuery('now()'),
                revocada_por: usuarioId,
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const despues = (await verVinculacion(input.id, t.trx))!
        await t.registrarCambios(
            { tipo: 'vinculacion_externa', id: input.id },
            { revocada_en: null },
            { revocada_en: despues.revocada_en },
        )
        return despues
    }
}
