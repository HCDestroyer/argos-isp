import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { usuarioHorus } from '#core/integraciones_horus'
import {
    VIGENCIA_TICKET_S,
    generarSecretoSso,
    urlPanel,
    type ConectorSso,
    type TipoDestinoSso,
} from '#core/sso'

export interface EntradaEmitirTicketSso {
    usuario: { id_externo: string; correo?: string | null; nombre?: string | null }
    destino: { tipo: TipoDestinoSso; id_externo: string }
    /** id (`core.tokens_api.id`) del token de integración que hizo la petición; el ticket queda ligado a él. No se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number
}

export interface SalidaEmitirTicketSso {
    /** `https://<panel>/sso/entrar#<ticket>`: el ticket va en el fragmento */
    url: string
    expira_en: string
}

/**
 * Paso 1 del autologin (contrato Horus §1.5): el servidor de Horus, con su token `atk_` y el
 * permiso `sso.emitir`, pide un ticket para que uno de sus usuarios abra un recurso de Argos.
 *
 * - Solo un token del usuario técnico Horus puede pedirlo (403 para cualquier otro token o sesión,
 *   aunque tenga `sso.emitir` por ser admin): el ticket queda ligado a ese token (el conector).
 * - Se guarda solo el sha256; vence a los 60 s y sirve una vez. El valor nunca llega a la auditoría
 *   (que registra quién lo pidió, para qué usuario externo y qué recurso).
 * - No da privilegios: el canje abre la sesión del usuario local vinculado, con sus permisos.
 */
export default class EmitirTicketSso extends DomainAction<EntradaEmitirTicketSso, SalidaEmitirTicketSso> {
    readonly nombre = 'sso.emitir'

    protected async handle(input: EntradaEmitirTicketSso, t: Transaccion): Promise<SalidaEmitirTicketSso> {
        const conector: ConectorSso = 'horus'
        const horus = await usuarioHorus(t.trx)
        const token = (await t.trx
            .from('core.tokens_api')
            .where('id', input.atk_id)
            .whereNull('revocado_en')
            .select('usuario_id')
            .first()) as { usuario_id: number } | null
        if (horus === null || !token || Number(token.usuario_id) !== horus) {
            throw new Prohibido('Solo el token de la integración Horus puede pedir tickets de autologin')
        }

        const base = urlPanel()
        const { valor, hash } = generarSecretoSso()
        const expiraEn = new Date(Date.now() + VIGENCIA_TICKET_S * 1000)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.sso_tickets')
            .insert({
                hash,
                conector,
                token_api_id: input.atk_id,
                usuario_id_externo: input.usuario.id_externo,
                usuario_correo: input.usuario.correo ?? null,
                usuario_nombre: input.usuario.nombre ?? null,
                destino_tipo: input.destino.tipo,
                destino_id_externo: input.destino.id_externo,
                expira_en: expiraEn,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('sso_ticket', fila!.id)
        return { url: `${base}/sso/entrar#${valor}`, expira_en: expiraEn.toISOString() }
    }
}
