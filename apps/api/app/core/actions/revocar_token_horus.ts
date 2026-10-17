import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import RevocarTokenApi from '#core/actions/revocar_token_api'
import type { TokenApiVista } from '#core/consultas/acl'
import { usuarioHorus } from '#core/integraciones_horus'

export interface EntradaRevocarTokenHorus {
    id: number
}

/**
 * Revoca un token de la integración Horus. 404 si el token no es del usuario técnico Horus (los
 * demás tokens se revocan con `tokens.revocar`). Repetirla no cambia la fecha de revocación.
 */
export default class RevocarTokenHorus extends DomainAction<EntradaRevocarTokenHorus, TokenApiVista> {
    readonly nombre = 'integraciones.revocar_token'

    protected async handle(input: EntradaRevocarTokenHorus, t: Transaccion): Promise<TokenApiVista> {
        t.fijarEntidad('token_api', input.id)
        const usuarioId = await usuarioHorus(t.trx)
        const token = (await t.trx
            .from('core.tokens_api')
            .where('id', input.id)
            .select('usuario_id')
            .first()) as {
            usuario_id: number
        } | null
        if (usuarioId === null || !token || Number(token.usuario_id) !== usuarioId) {
            throw new NoEncontrado(`El token ${input.id} no es de la integración Horus`)
        }
        return new RevocarTokenApi().execute({ id: input.id }, t.ctx, { trx: t.trx })
    }
}
