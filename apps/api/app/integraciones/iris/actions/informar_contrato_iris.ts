import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { cifrar, descifrar } from '#shared/cifrado'
import { exigirTokenIris } from '#integraciones/iris/token_iris'
import {
    FORMATO_TOKEN_IRIS,
    compararSemver,
    contratoAdmite,
    contratoArgos,
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
    /** 0.14.0 §6.6 (N-1): cierre de la carga inicial de vínculos de técnicos; ausente, sin cambio */
    vinculos_cargados?: number | null
    /** id (`core.tokens_api.id`) del token que hizo la petición; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number | null
}

/** `contrato_iris`: el que quedó guardado; `contrato` y `version_argos`: los de Argos, como en el canje. */
export type SalidaInformarContratoIris = {
    contrato_iris: string
    /** 0.14.0: el informado era menor que el aceptado; no se guardó (la ruta responde 409) */
    regresivo?: boolean
} & VersionesIris

/** Versión desde la que no se baja con este PUT ni se aceptan versiones desconocidas (§3.3, §4.5). */
export const CONTRATO_SIN_RETROCESO = '0.14.0'

/** 422 `contrato_no_soportado`: Iris informa una versión mayor que la que habla Argos (N-6). */
export class ContratoNoSoportado extends Problema {
    constructor(informado: string, argos: string) {
        super(
            422,
            'contrato_no_soportado',
            'Contrato no soportado',
            `Iris informó el contrato ${informado}, mayor que el ${argos} que habla este Argos: no se registra`,
            [
                {
                    field: 'contrato',
                    message: `Este Argos habla hasta ${argos}`,
                    rule: 'contrato_no_soportado',
                },
            ],
        )
    }
}

/** 409 `contrato_regresivo`: una versión menor que la última aceptada (T-1). */
export class ContratoRegresivo extends Problema {
    constructor(aceptado: string, informado: string) {
        super(
            409,
            'contrato_regresivo',
            'Contrato regresivo',
            `Iris informó el contrato ${informado}, menor que el ${aceptado} ya aceptado. Para bajar de versión hace falta un canje nuevo aprobado en el panel de Argos`,
        )
    }
}

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
 * - **0.14.0 (§3.3, §4.5, T-1, N-6).** Una versión mayor que la que habla Argos (`contratoArgos()`): 422
 *   `contrato_no_soportado`, sin registrar nada. Una menor que la última aceptada, cuando esa ya es
 *   ≥ 0.14.0 (antes Iris podía bajar): no se guarda, se avisa al
 *   admin (`iris.contrato_regresivo`, en el registro del sistema) y la ruta responde 409
 *   `contrato_regresivo`; bajar exige un canje nuevo. Al pasar de < 0.14.0 a ≥ 0.14.0 se abre la carga
 *   inicial de vínculos de técnicos (`vinculos_cargados_en` null: 409 `vinculos_en_carga` en las peticiones
 *   con `tecnico`) y `vinculos_cargados` la cierra (N-1).
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
        const argos = contratoArgos()
        if ((compararSemver(input.contrato, argos) ?? 0) > 0) {
            throw new ContratoNoSoportado(input.contrato, argos)
        }
        const antes = await exigirTokenIris(t, input.atk_id, 'informar su contrato')
        t.fijarEntidad('conector_iris', 1)
        // sin retroceso desde que Iris habló 0.14.0 (antes, Iris podía informar una versión menor)
        if (
            antes?.contrato &&
            contratoAdmite(antes.contrato, CONTRATO_SIN_RETROCESO) &&
            (compararSemver(input.contrato, antes.contrato) ?? 0) < 0
        ) {
            await t.emit('iris.contrato_regresivo', {
                empresa_id: null,
                aceptado: antes.contrato,
                informado: input.contrato,
            })
            return { contrato_iris: antes.contrato, regresivo: true, ...(await versionesIris()) }
        }
        const cambios: Record<string, unknown> = {}
        // la carga inicial de vínculos la abre `guardarConectorIris` al pasar a ≥ 0.14.0
        const vinculos = contratoAdmite(input.contrato, CONTRATO_SIN_RETROCESO)
        if (vinculos && input.vinculos_cargados !== undefined && input.vinculos_cargados !== null) {
            if (antes?.vinculos_cargados !== input.vinculos_cargados || !antes?.vinculos_cargados_en) {
                cambios.vinculos_cargados = input.vinculos_cargados
                cambios.vinculos_cargados_en = new Date()
            }
        }
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
