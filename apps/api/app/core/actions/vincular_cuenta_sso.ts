import { DomainAction, type Transaccion } from '#shared/domain_action'
import IniciarSesion, { type SalidaIniciarSesion } from '#core/actions/iniciar_sesion'
import { conectorVigente, type TicketSso } from '#core/actions/canjear_ticket_sso'
import { VinculacionInvalida, hashSecretoSso, rutaDestino } from '#core/sso'

export interface EntradaVincularCuentaSso {
    /** el token de `vinculacion_requerida` del canje (se audita como `***`) */
    token_vinculacion: string
    email: string
    password: string
}

export interface SalidaVincularCuentaSso {
    resultado: 'sesion'
    ruta: string
    conector: string
    vinculacion_id: number
    sesion: SalidaIniciarSesion
}

/**
 * Paso 3 del autologin sin vinculación (contrato Horus §1.5): el usuario hace el login normal de
 * Argos (mismas credenciales y límite de intentos que `POST /auth/sesion`) y, si entra, se guarda la
 * vinculación `(conector, id_externo) → usuario` y se continúa al destino.
 *
 * - 410 `vinculacion_invalida`: token de vinculación desconocido, vencido (10 min) o usado, o el
 *   conector ya no está conectado. 401 con credenciales malas (no consume el token).
 * - Si el `id_externo` ya tenía otra vinculación vigente (otro usuario local), se revoca: gana
 *   quien acaba de demostrar su contraseña.
 */
export default class VincularCuentaSso extends DomainAction<
    EntradaVincularCuentaSso,
    SalidaVincularCuentaSso
> {
    readonly nombre = 'auth.sso_vincular'

    protected async handle(
        input: EntradaVincularCuentaSso,
        t: Transaccion,
    ): Promise<SalidaVincularCuentaSso> {
        const ticket = (await t.trx
            .from('core.sso_tickets')
            .where('vinculacion_hash', hashSecretoSso(input.token_vinculacion))
            .forUpdate()
            .first()) as TicketSso | null
        if (!ticket) throw new VinculacionInvalida('El token de vinculación no existe')
        t.fijarEntidad('sso_ticket', ticket.id)
        if (ticket.vinculacion_usada_en) throw new VinculacionInvalida('El token de vinculación ya se usó')
        if (!ticket.vinculacion_expira_en || new Date(ticket.vinculacion_expira_en).getTime() <= Date.now()) {
            throw new VinculacionInvalida(
                'El token de vinculación venció; vuelve a abrir el enlace desde Horus',
            )
        }
        if (!(await conectorVigente(t, ticket))) {
            throw new VinculacionInvalida('El conector que emitió el ticket ya no está conectado')
        }

        const sesion = await new IniciarSesion().execute(
            { email: input.email, password: input.password, modo: 'cookie' },
            t.ctx,
            { trx: t.trx },
        )
        const usuarioId = sesion.usuario.id
        t.identificarActor({ tipo: 'usuario', id: usuarioId })

        await t.trx
            .from('core.vinculaciones_externas')
            .where({ conector: ticket.conector, id_externo: ticket.usuario_id_externo })
            .whereNull('revocada_en')
            .update({
                revocada_en: t.trx.knexRawQuery('now()'),
                revocada_por: usuarioId,
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.vinculaciones_externas')
            .insert({
                conector: ticket.conector,
                id_externo: ticket.usuario_id_externo,
                usuario_id: usuarioId,
                correo_externo: ticket.usuario_correo,
                nombre_externo: ticket.usuario_nombre,
                creada_por_ticket_id: ticket.id,
            })
            .returning('id')) as Array<{ id: number }>
        await t.trx
            .from('core.sso_tickets')
            .where('id', ticket.id)
            .update({ vinculacion_usada_en: t.trx.knexRawQuery('now()') })
        await t.registrarCambios({ tipo: 'vinculacion_externa', id: fila!.id }, null, {
            conector: ticket.conector,
            id_externo: ticket.usuario_id_externo,
            usuario_id: usuarioId,
        })

        return {
            resultado: 'sesion',
            ruta: rutaDestino(ticket.destino_tipo, ticket.destino_id_externo),
            conector: ticket.conector,
            vinculacion_id: fila!.id,
            sesion,
        }
    }
}
