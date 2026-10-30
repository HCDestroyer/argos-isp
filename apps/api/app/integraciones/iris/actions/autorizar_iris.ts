import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { MASCARA } from '#shared/enmascarar'
import { errorUrlIris } from '#integraciones/iris/configuracion'
import {
    CodeChallengeInvalido,
    IrisOrigenInvalido,
    IrisOrigenNoConfirmado,
    RUTA_VUELTA_IRIS,
    codeChallengeValido,
    crearCodigoIris,
    esOrigenIrisConocido,
    normalizarOrigenIris,
    origenConfirmado,
} from '#integraciones/iris/autorizacion'

export interface EntradaAutorizarIris {
    /** dirección de Iris que pide conectarse (`IRIS_BASE_URL`); se normaliza a su origen */
    iris: string
    /** valor opaco de Iris (16 a 256 caracteres URL-seguros); vuelve tal cual en el fragmento */
    state: string
    /** `base64url(SHA-256(code_verifier))` */
    code_challenge: string
    code_challenge_method: 'S256'
    /** dominio de Iris escrito por el admin; obligatorio si el origen no es conocido */
    confirmar_origen?: string | null
    /** URL pública de la API de Argos (Iris canjea ahí); la pone la ruta */
    base_url: string
}

export interface SalidaAutorizarIris {
    /** `<iris>/administracion/integraciones/argos/vuelta#codigo=…&api=…&state=…` */
    redirigir_a: string
}

/**
 * `iris.autorizar` (permiso `iris.configurar`): «Conectar con un botón» (contrato Iris 0.4.0, §1.4
 * paso 4). El admin aprueba en el panel de Argos la conexión que abrió desde su Iris.
 *
 * - Normaliza `iris` a `https://host[:puerto]` (`http` solo con `IRIS_PERMITIR_HTTP`); 422
 *   `iris_origen_invalido` si no sirve.
 * - 422 `code_challenge_invalido` si no es base64url de 43 caracteres.
 * - El origen se acepta si coincide con la URL del conector Iris o con `ARGOSISP_IRIS_ORIGENES`; si
 *   no, exige `confirmar_origen` igual a su host (422 `iris_origen_no_confirmado`).
 * - Crea el mismo código de conexión de §1.3 (`crearCodigoIris`: 15 min, un uso, anula los
 *   anteriores sin usar, solo su SHA-256), ligado al `code_challenge` y al origen.
 * - Responde la URL de vuelta a Iris con el código, la API y el `state` en el fragmento (nunca en
 *   la query). El código no queda en la auditoría (`codigo: ***`). No emite evento (como el enlace).
 */
export default class AutorizarIris extends DomainAction<EntradaAutorizarIris, SalidaAutorizarIris> {
    readonly nombre = 'iris.autorizar'

    protected async handle(input: EntradaAutorizarIris, t: Transaccion): Promise<SalidaAutorizarIris> {
        t.fijarEmpresa(null)
        const normalizado = normalizarOrigenIris(input.iris)
        if (normalizado.error !== null) throw new IrisOrigenInvalido(normalizado.error)
        if (input.code_challenge_method !== 'S256' || !codeChallengeValido(input.code_challenge)) {
            throw new CodeChallengeInvalido()
        }
        const base = input.base_url.replace(/\/+$/, '')
        const errorBase = errorUrlIris(base)
        if (errorBase) {
            throw new ValidacionFallida([
                { field: 'base_url', message: `URL pública de Argos: ${errorBase}`, rule: 'url' },
            ])
        }
        const conocido = await esOrigenIrisConocido(normalizado.origen, t.trx)
        if (!conocido && !origenConfirmado(normalizado.host, input.confirmar_origen)) {
            throw new IrisOrigenNoConfirmado(normalizado.host)
        }
        const { codigo } = await crearCodigoIris(t, {
            base_url: base,
            code_challenge: input.code_challenge,
            origen_iris: normalizado.origen,
        })
        t.anotarAuditoria({
            codigo: MASCARA,
            origen_iris: normalizado.origen,
            origen_conocido: conocido,
        })
        const fragmento = [
            `codigo=${encodeURIComponent(codigo)}`,
            `api=${encodeURIComponent(base)}`,
            `state=${encodeURIComponent(input.state)}`,
        ].join('&')
        return { redirigir_a: `${normalizado.origen}${RUTA_VUELTA_IRIS}#${fragmento}` }
    }
}
