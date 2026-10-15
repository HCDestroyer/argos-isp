import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verToken, type TokenApiVista } from '#core/consultas/acl'

export interface EntradaRevocarTokenApi {
    id: number
}

/** Revoca un token de API. Repetirla no cambia la fecha de revocación. */
export default class RevocarTokenApi extends DomainAction<EntradaRevocarTokenApi, TokenApiVista> {
    readonly nombre = 'tokens.revocar'

    protected async handle(input: EntradaRevocarTokenApi, t: Transaccion): Promise<TokenApiVista> {
        t.fijarEntidad('token_api', input.id)
        const antes = await verToken(input.id, t.trx)
        if (antes.revocado_en) return antes

        await t.trx
            .from('core.tokens_api')
            .where('id', input.id)
            .update({ revocado_en: t.trx.knexRawQuery('now()'), updated_at: t.trx.knexRawQuery('now()') })
        const despues = await verToken(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'token_api', id: input.id },
            { revocado_en: antes.revocado_en },
            { revocado_en: despues.revocado_en },
        )
        return despues
    }
}
