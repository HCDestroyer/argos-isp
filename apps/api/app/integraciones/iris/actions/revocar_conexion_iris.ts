import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { usuarioIris } from '#core/integraciones_iris'
import { bloquearConectorIris } from '#integraciones/iris/configuracion'
import {
    descartarPendienteIris,
    desconectarConectorIris,
    revocarTokenIrisSiVigente,
} from '#integraciones/iris/desconexion'

export interface EntradaRevocarConexionIris {
    /** id (`core.tokens_api.id`) del token que hizo la petición; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number | null
}

export interface SalidaRevocarConexionIris {
    /** true si era el `atk_` del conector y el conector quedó desconectado */
    desconectado: boolean
}

/**
 * `iris.revocar_conexion` (`POST /integraciones/iris/conexion/revocar`, contrato Iris 0.6.3): Iris
 * revoca su propio `atk_`, por ejemplo al rechazar la respuesta de un canje (`422 webhook_invalido`)
 * o cuando el canje no terminó bien de su lado por cualquier motivo.
 *
 * - **Solo el token `atk_` del usuario técnico Iris**, y se revoca ese mismo token (403 con
 *   cualquier otra credencial). Un token ya revocado no pasa la autenticación: 401.
 * - Si es el `atk_` de una **reconexión pendiente** (canje nuevo sobre un conector en uso): la
 *   descarta y el conector sigue igual, con su `atk_` y sus secretos (`desconectado: false`).
 * - Si es el `atk_` del conector (`token_argos_id`): además lo desconecta (`desconectarConectorIris`:
 *   apagado, sin secretos, `desconectado_en` y `motivo_desconexion = revocado_por_iris`) sin borrar
 *   el historial. Otro token vigente del usuario técnico (uno creado a mano en el panel) solo se
 *   revoca; el conector no cambia.
 * - Sin evento: nadie consume el estado del conector por evento; Argos lo lee de la base en cada
 *   envío (regla 5) y, apagado, no envía webhooks.
 */
export default class RevocarConexionIris extends DomainAction<
    EntradaRevocarConexionIris,
    SalidaRevocarConexionIris
> {
    readonly nombre = 'iris.revocar_conexion'

    protected async handle(
        input: EntradaRevocarConexionIris,
        t: Transaccion,
    ): Promise<SalidaRevocarConexionIris> {
        t.fijarEmpresa(null)
        const tecnico = await usuarioIris(t.trx)
        const token =
            input.atk_id === null
                ? null
                : ((await t.trx
                      .from('core.tokens_api')
                      .where('id', input.atk_id)
                      .select('usuario_id')
                      .first()) as { usuario_id: number } | null)
        if (tecnico === null || !token || Number(token.usuario_id) !== tecnico) {
            throw new Prohibido('Solo el token de la integración Iris puede revocar su conexión')
        }
        const antes = await bloquearConectorIris(t)
        if (antes && Number(antes.pendiente_token_argos_id) === Number(input.atk_id)) {
            // reconexión pendiente: se descarta; el conector en uso no cambia
            t.fijarEntidad('conector_iris', 1)
            await descartarPendienteIris(t, antes, 'revocado_por_iris')
            return { desconectado: false }
        }
        if (antes && Number(antes.token_argos_id) === Number(input.atk_id) && !antes.desconectado_en) {
            await desconectarConectorIris(t, antes, 'revocado_por_iris')
            return { desconectado: true }
        }
        t.fijarEntidad('token_api', Number(input.atk_id))
        await revocarTokenIrisSiVigente(t, Number(input.atk_id))
        return { desconectado: false }
    }
}
