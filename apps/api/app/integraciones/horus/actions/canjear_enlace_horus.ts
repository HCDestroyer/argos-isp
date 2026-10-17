import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { errorUrl } from '#integraciones/horus/configuracion'
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
 * `integraciones.horus.canjear_enlace`: Horus canjea, de servidor a servidor, el enlace que generó
 * Argos (§1.4). Lo autentica el código (un solo uso, 15 min; 410 si venció, se usó o no existe).
 *
 * - Guarda cifrados el `hf_pat_`, la URL base y el receptor de Horus con su secreto.
 * - Emite el token `atk_` del usuario técnico Horus (revoca el de un canje anterior) y genera el
 *   secreto del receptor de Argos.
 * - El conector queda **apagado** hasta que un administrador lo encienda. Todo en una transacción
 *   y auditado (secretos como `***`).
 */
export default class CanjearEnlaceHorus extends DomainAction<EntradaCanjearEnlace, SalidaCanjearEnlace> {
    readonly nombre = 'integraciones.horus.canjear_enlace'

    protected async handle(input: EntradaCanjearEnlace, t: Transaccion): Promise<SalidaCanjearEnlace> {
        t.fijarEmpresa(null)
        const enlace = (await t.trx
            .from('integraciones.horus_enlaces')
            .where('codigo_sha256', input.codigo_sha256)
            .forUpdate()
            .select('id', 'base_url', 'vence_en', 'usado_en')
            .first()) as { id: number; base_url: string; vence_en: Date; usado_en: Date | null } | null
        if (!enlace || enlace.usado_en || new Date(enlace.vence_en).getTime() <= Date.now()) {
            throw new EnlaceVencido()
        }

        const errores = validarDatosDeHorus(input)
        if (errores.length > 0) throw new ValidacionFallida(errores)

        await t.trx
            .from('integraciones.horus_enlaces')
            .where('id', enlace.id)
            .update({ usado_en: t.trx.knexRawQuery('now()') })

        const antes = await bloquearConector(t)
        const emisor = emisorTokenHorus()
        if (antes?.token_argos_id) await emisor.revocar(t.trx, t.ctx, Number(antes.token_argos_id))
        const emitido = await emisor.emitir(t.trx, t.ctx)
        const secretoEntrada = generarSecretoWebhook()

        const despues = await guardarConector(t, antes, {
            activo: false,
            url_base: input.base_url.replace(/\/+$/, ''),
            token_cifrado: cifrar(input.token),
            webhook_salida_url: input.webhook.url,
            webhook_salida_secreto_cifrado: cifrar(input.webhook.secreto),
            webhook_entrada_secreto_cifrado: cifrar(secretoEntrada),
            token_argos_id: emitido.token_id,
            conectado_por_enlace_en: t.trx.knexRawQuery('now()'),
        })
        return {
            token: emitido.token,
            webhook: { url: `${enlace.base_url}${RUTA_RECEPTOR}`, secreto: secretoEntrada },
            conector_id: despues.conector_id,
        }
    }
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
        const error = errorUrl(input.base_url)
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
