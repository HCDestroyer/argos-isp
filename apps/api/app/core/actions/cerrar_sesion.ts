import { DomainAction, type Transaccion } from '#shared/domain_action'
import Usuario from '#core/models/usuario'

export interface EntradaCerrarSesion {
    usuarioId: number
    tokenId: string | number
}

/** Revoca el token de sesión con el que se hizo la petición. */
export default class CerrarSesion extends DomainAction<EntradaCerrarSesion, void> {
    readonly nombre = 'auth.logout'

    protected async handle(input: EntradaCerrarSesion, t: Transaccion): Promise<void> {
        t.fijarEntidad('usuario', input.usuarioId)
        const usuario = await Usuario.findOrFail(input.usuarioId, { client: t.trx })
        await Usuario.accessTokens.delete(usuario, input.tokenId)
    }
}
