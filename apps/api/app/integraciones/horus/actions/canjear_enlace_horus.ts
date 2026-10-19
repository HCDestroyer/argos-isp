import { createHash } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar, descifrar } from '#shared/cifrado'
import { errorUrl, origenHorus } from '#integraciones/horus/configuracion'
import { generarSecretoWebhook } from '#integraciones/horus/firma'
import { bloquearConector, guardarConector } from '#integraciones/horus/escritura'
import { RUTA_RECEPTOR } from '#integraciones/horus/panel'
import { EnlaceVencido } from '#integraciones/horus/errores'
import { emisorTokenHorus } from '#integraciones/horus/token_argos'

export interface EntradaCanjearEnlace {
    /** SHA-256 del código (la ruta lo calcula: el código nunca llega a la auditoría) */
    codigo_sha256: string
    sistema: string
    /** URL base de Horus */
    base_url: string
    /** `hf_pat_…` que Horus emitió para Argos */
    token: string
    webhook: { url: string; secreto: string }
}

export interface SalidaCanjearEnlace {
    /** `atk_…` para que Horus lea de Argos (§1.2) */
    token: string
    webhook: { url: string; secreto: string }
    conector_id: string
}

/**
 * `horus.canjear_enlace`: Horus canjea, de servidor a servidor, el enlace que generó
 * Argos (§1.4). Lo autentica el código (un solo uso, 15 min; 410 si venció, se usó o no existe).
 *
 * - Guarda cifrados el `hf_pat_`, la URL base y el receptor de Horus con su secreto.
 * - Emite el token `atk_` del usuario técnico Horus (revoca el de un canje anterior) y genera el
 *   secreto del receptor de Argos.
 * - El conector queda **apagado** hasta que un administrador lo encienda. Todo en una transacción
 *   y auditado (secretos como `***`).
 * - `base_url` es el origen de Horus; si llega con `/api/v1` se quita (1.5.0).
 * - Idempotencia (1.5.0): la MISMA petición repetida antes de que el enlace venza (Horus no recibió
 *   la respuesta por un corte de red) recibe la misma respuesta, guardada cifrada, sin emitir otro
 *   token. Cualquier otra petición con un código usado, vencido, anulado o desconocido → 410.
 */
export default class CanjearEnlaceHorus extends DomainAction<EntradaCanjearEnlace, SalidaCanjearEnlace> {
    readonly nombre = 'horus.canjear_enlace'

    protected async handle(input: EntradaCanjearEnlace, t: Transaccion): Promise<SalidaCanjearEnlace> {
        t.fijarEmpresa(null)
        const enlace = (await t.trx
            .from('integraciones.horus_enlaces')
            .where('codigo_sha256', input.codigo_sha256)
            .forUpdate()
            .select(
                'id',
                'base_url',
                'vence_en',
                'usado_en',
                'anulado_en',
                'peticion_sha256',
                'respuesta_cifrada',
            )
            .first()) as FilaEnlace | null
        if (!enlace || enlace.anulado_en || new Date(enlace.vence_en).getTime() <= Date.now()) {
            throw new EnlaceVencido()
        }
        t.fijarEntidad('enlace_horus', Number(enlace.id))
        const peticion = hashPeticion(input)
        if (enlace.usado_en) {
            if (enlace.peticion_sha256 !== peticion || !enlace.respuesta_cifrada) throw new EnlaceVencido()
            t.anotarAuditoria({ repeticion: true })
            return JSON.parse(descifrar(enlace.respuesta_cifrada)) as SalidaCanjearEnlace
        }

        const errores = validarDatosDeHorus(input)
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const antes = await bloquearConector(t)
        const emisor = emisorTokenHorus()
        if (antes?.token_argos_id) await emisor.revocar(t.trx, t.ctx, Number(antes.token_argos_id))
        const emitido = await emisor.emitir(t.trx, t.ctx)
        const secretoEntrada = generarSecretoWebhook()

        const despues = await guardarConector(t, antes, {
            activo: false,
            url_base: origenHorus(input.base_url).origen,
            token_cifrado: cifrar(input.token),
            webhook_salida_url: input.webhook.url,
            webhook_salida_secreto_cifrado: cifrar(input.webhook.secreto),
            webhook_entrada_secreto_cifrado: cifrar(secretoEntrada),
            token_argos_id: emitido.token_id,
            conectado_por_enlace_en: t.trx.knexRawQuery('now()'),
        })
        const salida: SalidaCanjearEnlace = {
            token: emitido.token,
            webhook: { url: `${enlace.base_url}${RUTA_RECEPTOR}`, secreto: secretoEntrada },
            conector_id: despues.conector_id,
        }
        await t.trx
            .from('integraciones.horus_enlaces')
            .where('id', enlace.id)
            .update({
                usado_en: t.trx.knexRawQuery('now()'),
                peticion_sha256: peticion,
                respuesta_cifrada: cifrar(JSON.stringify(salida)),
            })
        return salida
    }
}

interface FilaEnlace {
    id: number
    base_url: string
    vence_en: Date
    usado_en: Date | null
    anulado_en: Date | null
    peticion_sha256: string | null
    respuesta_cifrada: string | null
}

/** SHA-256 de la petición de canje (sin el código, que ya identifica el enlace): idempotencia. */
export function hashPeticion(input: EntradaCanjearEnlace): string {
    const campos = [input.sistema, input.base_url, input.token, input.webhook.url, input.webhook.secreto]
    return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex')
}

/** Validación común de lo que manda Horus (canje en los dos sentidos). */
export function validarDatosDeHorus(input: {
    sistema?: string
    base_url?: string
    token?: string
    webhook?: { url?: string; secreto?: string }
}): ErrorCampo[] {
    const errores: ErrorCampo[] = []
    if (input.sistema !== undefined && input.sistema !== 'horus') {
        errores.push({ field: 'sistema', message: 'Este enlace es para conectar Horus Flow', rule: 'in' })
    }
    if (input.base_url !== undefined) {
        const { error } = origenHorus(input.base_url)
        if (error) errores.push({ field: 'base_url', message: error, rule: 'url' })
    }
    if (!input.token || !/^hf_pat_[A-Za-z0-9]{16,}$/.test(input.token)) {
        errores.push({ field: 'token', message: 'Se espera un token hf_pat_ de Horus', rule: 'formato' })
    }
    const url = input.webhook?.url
    const errorWebhook = url ? errorUrl(url) : 'Falta la URL del receptor de Horus'
    if (errorWebhook) errores.push({ field: 'webhook.url', message: errorWebhook, rule: 'url' })
    if (!input.webhook?.secreto || input.webhook.secreto.length < 16) {
        errores.push({
            field: 'webhook.secreto',
            message: 'Secreto de al menos 16 caracteres',
            rule: 'minLength',
        })
    }
    return errores
}
