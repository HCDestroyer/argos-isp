import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { cifrar, descifrar } from '#shared/cifrado'
import { exigirTokenIris } from '#integraciones/iris/token_iris'
import {
    FORMATO_TOKEN_IRIS,
    contratoAdmite,
    guardarConectorIris,
    versionesIris,
    type VersionesIris,
} from '#integraciones/iris/configuracion'

export interface EntradaInformarContratoIris {
    /** versión del contrato que habla Iris (semver; el validador ya la comprobó) */
    contrato: string
    /**
     * contrato 0.6.2: si Iris tiene guardado el receptor de Argos (false = conector canjeado antes de
     * B1: el panel pide volver a conectar). Ausente: se conserva el último informado
     */
    receptor_argos?: boolean | null
    /**
     * Contrato 0.9.0 §1.2: el `token_portal` para un conector ya conectado. Solo con contrato ≥ 0.9.0
     * (con uno anterior se ignora); null lo borra; ausente, se conserva. Se audita como `***`.
     */
    token_portal?: string | null
    /** id (`core.tokens_api.id`) del token que hizo la petición; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number | null
}

/** `contrato_iris`: el que quedó guardado; `contrato` y `version_argos`: los de Argos, como en el canje. */
export type SalidaInformarContratoIris = { contrato_iris: string } & VersionesIris

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
 * - Contrato 0.6.2: `receptor_argos` opcional (true/false) se guarda en el conector; omitido, se
 *   conserva el anterior. Con false, `GET /integraciones/iris` responde `requiere_reconectar: true`.
 * - Contrato 0.9.0 §1.2: `token_portal` (opcional) se guarda cifrado en `token_portal_cifrado` solo
 *   si el contrato informado es ≥ 0.9.0; nunca se devuelve y en `audit.cambios` queda como `***`.
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
        const antes = await exigirTokenIris(t, input.atk_id, 'informar su contrato')
        const cambios: Record<string, unknown> = {}
        if (antes?.contrato !== input.contrato) cambios.contrato = input.contrato
        const receptor = input.receptor_argos
        if (receptor !== undefined && receptor !== null && antes?.receptor_argos !== receptor) {
            cambios.receptor_argos = receptor
        }
        if (input.token_portal !== undefined && contratoAdmite(input.contrato, CONTRATO_TOKEN_PORTAL)) {
            const nuevo = input.token_portal
            if (nuevo !== null && !FORMATO_TOKEN_IRIS.test(nuevo)) {
                throw new ValidacionFallida([
                    {
                        field: 'token_portal',
                        rule: 'formato',
                        message: 'Se espera un token iris_pat_ de Iris',
                    },
                ])
            }
            if (nuevo === null) {
                if (antes?.token_portal_cifrado) cambios.token_portal_cifrado = null
            } else if (
                !antes?.token_portal_cifrado ||
                descifrarSeguro(antes.token_portal_cifrado) !== nuevo
            ) {
                cambios.token_portal_cifrado = cifrar(nuevo)
            }
        }
        const despues =
            antes && Object.keys(cambios).length === 0 ? antes : await guardarConectorIris(t, antes, cambios)
        t.fijarEntidad('conector_iris', 1)
        return { contrato_iris: despues.contrato ?? input.contrato, ...(await versionesIris()) }
    }
}

/** Versión del contrato desde la que Iris entrega el `token_portal` (§1.2). */
export const CONTRATO_TOKEN_PORTAL = '0.9.0'

function descifrarSeguro(valor: string): string | null {
    try {
        return descifrar(valor)
    } catch {
        return null
    }
}
