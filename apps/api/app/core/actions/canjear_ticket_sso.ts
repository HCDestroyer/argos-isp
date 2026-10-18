import { DomainAction, type Transaccion } from '#shared/domain_action'
import { CredencialesInvalidas } from '#shared/errores'
import Usuario from '#core/models/usuario'
import { emitirSesion, type SalidaIniciarSesion } from '#core/actions/iniciar_sesion'
import {
    CONECTORES_SSO,
    TicketInvalido,
    VIGENCIA_VINCULACION_S,
    generarSecretoSso,
    hashSecretoSso,
    rutaDestino,
    type TipoDestinoSso,
} from '#core/sso'

export interface EntradaCanjearTicketSso {
    ticket: string
}

export interface UsuarioExternoSso {
    id_externo: string
    correo: string | null
    nombre: string | null
}

export type SalidaCanjearTicketSso =
    | { resultado: 'sesion'; ruta: string; conector: string; sesion: SalidaIniciarSesion }
    | {
          resultado: 'vinculacion_requerida'
          ruta: string
          conector: string
          vinculacion: { token: string; expira_en: string; usuario_externo: UsuarioExternoSso }
      }

/** Fila de `core.sso_tickets` que lee el canje. */
export interface TicketSso {
    id: number
    conector: string
    token_api_id: number
    usuario_id_externo: string
    usuario_correo: string | null
    usuario_nombre: string | null
    destino_tipo: TipoDestinoSso
    destino_id_externo: string
    expira_en: Date
    usado_en: Date | null
    vinculacion_expira_en: Date | null
    vinculacion_usada_en: Date | null
}

/** El conector del ticket sigue conectado: conocido y con su token de integración vigente. */
export async function conectorVigente(t: Transaccion, ticket: TicketSso): Promise<boolean> {
    if (!(CONECTORES_SSO as readonly string[]).includes(ticket.conector)) return false
    const token = await t.trx
        .from('core.tokens_api')
        .where('id', ticket.token_api_id)
        .whereNull('revocado_en')
        .select('id')
        .first()
    return Boolean(token)
}

/**
 * Paso 2 del autologin (contrato Horus §1.5): el panel canjea el ticket del fragmento de
 * `/sso/entrar#<ticket>` (`POST /auth/sso/canjear`).
 *
 * - 410 `ticket_invalido`: desconocido, vencido (60 s), ya usado, o de un conector que ya no está
 *   conectado (su token revocado o un conector desconocido).
 * - Con vinculación vigente `(conector, usuario.id_externo) → usuario local` activo: sesión normal
 *   de ese usuario (cookie del panel, sus permisos y alcance, mismos límites de inactividad y
 *   72 h) y la ruta local del destino. Si no tiene permiso para el recurso, el panel recibe el 403
 *   de siempre al abrirlo.
 * - Sin vinculación: `vinculacion_requerida` con un token de vinculación (10 min, un uso) para el
 *   login normal (`POST /auth/sso/vincular`). Nunca se crea un usuario ni se vincula por correo.
 */
export default class CanjearTicketSso extends DomainAction<EntradaCanjearTicketSso, SalidaCanjearTicketSso> {
    readonly nombre = 'auth.sso_canjear'

    protected async handle(input: EntradaCanjearTicketSso, t: Transaccion): Promise<SalidaCanjearTicketSso> {
        const ticket = (await t.trx
            .from('core.sso_tickets')
            .where('hash', hashSecretoSso(input.ticket))
            .forUpdate()
            .first()) as TicketSso | null
        if (!ticket) throw new TicketInvalido('El ticket no existe')
        t.fijarEntidad('sso_ticket', ticket.id)
        if (ticket.usado_en) throw new TicketInvalido('El ticket ya se usó')
        if (new Date(ticket.expira_en).getTime() <= Date.now()) throw new TicketInvalido('El ticket venció')
        if (!(await conectorVigente(t, ticket))) {
            throw new TicketInvalido('El conector que emitió el ticket ya no está conectado')
        }

        const ruta = rutaDestino(ticket.destino_tipo, ticket.destino_id_externo)
        const vinculo = (await t.trx
            .from('core.vinculaciones_externas')
            .where({ conector: ticket.conector, id_externo: ticket.usuario_id_externo })
            .whereNull('revocada_en')
            .select('usuario_id')
            .first()) as { usuario_id: number } | null

        if (vinculo) {
            const usuario = await Usuario.find(vinculo.usuario_id, { client: t.trx })
            if (!usuario || !usuario.activo) throw new CredencialesInvalidas()
            await t.trx
                .from('core.sso_tickets')
                .where('id', ticket.id)
                .update({ usado_en: t.trx.knexRawQuery('now()') })
            t.identificarActor({ tipo: 'usuario', id: usuario.id })
            const sesion = await emitirSesion(usuario, 'cookie', 'panel')
            return { resultado: 'sesion', ruta, conector: ticket.conector, sesion }
        }

        const { valor, hash } = generarSecretoSso()
        const expiraEn = new Date(Date.now() + VIGENCIA_VINCULACION_S * 1000)
        await t.trx
            .from('core.sso_tickets')
            .where('id', ticket.id)
            .update({
                usado_en: t.trx.knexRawQuery('now()'),
                vinculacion_hash: hash,
                vinculacion_expira_en: expiraEn,
            })
        return {
            resultado: 'vinculacion_requerida',
            ruta,
            conector: ticket.conector,
            vinculacion: {
                token: valor,
                expira_en: expiraEn.toISOString(),
                usuario_externo: {
                    id_externo: ticket.usuario_id_externo,
                    correo: ticket.usuario_correo,
                    nombre: ticket.usuario_nombre,
                },
            },
        }
    }
}
