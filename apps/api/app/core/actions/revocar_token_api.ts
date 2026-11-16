import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verToken, type TokenApiVista } from '#core/consultas/acl'
import { exigirCoberturaToken } from '#core/cobertura_token'
import { usuarioDelActor } from '#shared/contexto'

export interface EntradaRevocarTokenApi {
    id: number
}

/**
 * Revoca un token de API. Repetirla no cambia la fecha de revocación. Los tokens del propio usuario
 * se revocan siempre; los de otro, solo si el actor cubre lo que tiene el token (403
 * `token_excede_permisos`, como al crearlo): quien no puede crear ese token tampoco lo corta.
 */
export default class RevocarTokenApi extends DomainAction<EntradaRevocarTokenApi, TokenApiVista> {
    readonly nombre = 'tokens.revocar'

    protected async handle(input: EntradaRevocarTokenApi, t: Transaccion): Promise<TokenApiVista> {
        t.fijarEntidad('token_api', input.id)
        const antes = await verToken(input.id, t.trx)
        if (antes.revocado_en) return antes
        if (usuarioDelActor(t.ctx.actor) !== Number(antes.usuario_id)) {
            await exigirCoberturaToken(t.trx, t.ctx, Number(antes.usuario_id), antes.alcances, {
                verbo: 'revocar',
            })
        }

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
