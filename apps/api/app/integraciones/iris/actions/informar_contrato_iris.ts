import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { usuarioIris } from '#core/integraciones_iris'
import {
    bloquearConectorIris,
    guardarConectorIris,
    versionesIris,
    type EstadoConectorIris,
} from '#integraciones/iris/configuracion'

export interface EntradaInformarContratoIris {
    /** versión del contrato que habla Iris (semver; el validador ya la comprobó) */
    contrato: string
    /** id (`core.tokens_api.id`) del token que hizo la petición; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number | null
}

/** `contrato_iris`: el que quedó guardado; `contrato` y `version_argos`: los de Argos, como en el canje. */
export type SalidaInformarContratoIris = { contrato_iris: string } & Omit<EstadoConectorIris, 'activo'>

/**
 * `iris.informar_contrato` (`PUT /integraciones/iris/contrato`, contrato Iris 0.5.0, «Versión y
 * compatibilidad»): Iris informa la versión del contrato que habla, por ejemplo al actualizarse sin
 * volver a conectar. Se guarda en el conector (`contrato`, diff en `audit.cambios`) y decide qué
 * webhooks recibe (`conectorAdmite`).
 *
 * - **Solo el token `atk_` del usuario técnico Iris** (403 con cualquier otra credencial, aunque
 *   tenga el permiso de la ruta por ser admin). Si el conector se preparó con un enlace, solo el
 *   `atk_` de ese canje, como el autologin. Funciona con el conector apagado: no envía nada.
 * - Permiso de la ruta: `sso.emitir`, el mínimo que el token de Iris ya tiene (§1.1); un permiso
 *   nuevo obligaría a reconectar cada Iris para que su token lo incluya.
 * - Responde `contrato_iris` (el guardado) y, como el canje, `version_argos` y `contrato` (el de Argos).
 */
export default class InformarContratoIris extends DomainAction<
    EntradaInformarContratoIris,
    SalidaInformarContratoIris
> {
    readonly nombre = 'iris.informar_contrato'

    protected async handle(
        input: EntradaInformarContratoIris,
        t: Transaccion,
    ): Promise<SalidaInformarContratoIris> {
        t.fijarEmpresa(null)
        const tecnico = await usuarioIris(t.trx)
        const token =
            input.atk_id === null
                ? null
                : ((await t.trx
                      .from('core.tokens_api')
                      .where('id', input.atk_id)
                      .whereNull('revocado_en')
                      .select('usuario_id')
                      .first()) as { usuario_id: number } | null)
        if (tecnico === null || !token || Number(token.usuario_id) !== tecnico) {
            throw new Prohibido('Solo el token de la integración Iris puede informar su contrato')
        }
        const antes = await bloquearConectorIris(t)
        if (antes?.conectado_por_enlace_en && Number(antes.token_argos_id) !== Number(input.atk_id)) {
            throw new Prohibido('El conector se preparó con un enlace: solo vale el token de ese canje')
        }
        const despues =
            antes?.contrato === input.contrato
                ? antes
                : await guardarConectorIris(t, antes, { contrato: input.contrato })
        t.fijarEntidad('conector_iris', 1)
        return { contrato_iris: despues.contrato ?? input.contrato, ...(await versionesIris()) }
    }
}
