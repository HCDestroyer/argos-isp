import type { Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { usuarioIris } from '#core/integraciones_iris'
import { bloquearConectorIris, type FilaConectorIris } from '#integraciones/iris/configuracion'

/**
 * Rutas que solo puede llamar Iris con su `atk_` (`PUT /integraciones/iris/contrato` y
 * `PUT /integraciones/iris/sincronizacion`): 403 con cualquier otra credencial, aunque tenga el
 * permiso de la ruta (`sso.emitir`) por ser admin. Si el conector se preparó con un enlace, solo
 * vale el `atk_` de ese canje, como el autologin. Devuelve la fila del conector bloqueada (o null
 * si no existe). Funciona con el conector apagado.
 */
export async function exigirTokenIris(
    t: Transaccion,
    atkId: number | null,
    que: string,
): Promise<FilaConectorIris | null> {
    const tecnico = await usuarioIris(t.trx)
    const token =
        atkId === null
            ? null
            : ((await t.trx
                  .from('core.tokens_api')
                  .where('id', atkId)
                  .whereNull('revocado_en')
                  .select('usuario_id')
                  .first()) as { usuario_id: number } | null)
    if (tecnico === null || !token || Number(token.usuario_id) !== tecnico) {
        throw new Prohibido(`Solo el token de la integración Iris puede ${que}`)
    }
    const antes = await bloquearConectorIris(t)
    if (antes?.conectado_por_enlace_en && Number(antes.token_argos_id) !== Number(atkId)) {
        throw new Prohibido('El conector se preparó con un enlace: solo vale el token de ese canje')
    }
    return antes
}
