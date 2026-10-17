import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { errorUrl } from '#integraciones/horus/configuracion'
import { generarSecretoWebhook } from '#integraciones/horus/firma'
import { bloquearConector, guardarConector } from '#integraciones/horus/escritura'
import { vistaDeFila, type VistaConector } from '#integraciones/horus/panel'

export interface EntradaConfigurarHorus {
    /** `version` leída; 0 si nunca se guardó */
    version: number
    activo?: boolean
    /** `https://horus.isp.example` (sin `/api/v1`) */
    url_base?: string | null
    /** código de conexión `hf_pat_…`. Omitido: se conserva; null: se borra; texto: se reemplaza */
    token?: string | null
    /** URL completa del receptor de Horus (la muestra Horus con su secreto) */
    webhook_salida_url?: string | null
    /** secreto del receptor de Horus. Omitido: se conserva; null: se borra */
    webhook_salida_secreto?: string | null
    /** genera otro secreto para el receptor de Argos (el anterior deja de valer) */
    regenerar_secreto_entrada?: boolean
}

export interface SalidaConfigurarHorus extends VistaConector {
    /**
     * Secreto del receptor de Argos en claro, **solo** cuando se acaba de generar (primer guardado
     * o `regenerar_secreto_entrada`). Se copia a Horus; después solo se ve `***`.
     */
    webhook_entrada_secreto_nuevo: string | null
}

function limpio(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const texto = valor?.trim() ?? ''
    return texto === '' ? null : texto
}

/**
 * `horus.configurar`: guarda el conector Horus (una fila por instalación).
 *
 * - Control optimista por `version` (409); sin fila, `version: 0` la crea (apagada por defecto).
 * - URL base y receptor de Horus solo `https://` (salvo `HORUS_PERMITIR_HTTP`, laboratorio).
 * - `hf_pat_` y secretos cifrados con `app/shared/cifrado.ts`; en la respuesta y la auditoría
 *   salen como `***`. El secreto del receptor de Argos se genera aquí y se muestra una sola vez.
 * - Encender exige URL base y código de conexión.
 * - Emite `horus.config_cambiada` (los procesos releen sin TTL).
 */
export default class ConfigurarHorus extends DomainAction<EntradaConfigurarHorus, SalidaConfigurarHorus> {
    readonly nombre = 'horus.configurar'

    protected async handle(input: EntradaConfigurarHorus, t: Transaccion): Promise<SalidaConfigurarHorus> {
        const antes = await bloquearConector(t)
        const errores: ErrorCampo[] = []
        const cambios: Record<string, unknown> = {}

        const url = limpio(input.url_base)
        if (url !== undefined) {
            const error = url === null ? null : errorUrl(url)
            if (error) errores.push({ field: 'url_base', message: error, rule: 'url' })
            cambios.url_base = url === null ? null : url.replace(/\/+$/, '')
        }
        const token = limpio(input.token)
        if (token !== undefined) {
            if (token !== null && !/^hf_pat_[A-Za-z0-9]{16,}$/.test(token)) {
                errores.push({
                    field: 'token',
                    message: 'El código de conexión de Horus empieza con hf_pat_',
                    rule: 'formato',
                })
            }
            cambios.token_cifrado = token === null ? null : cifrar(token)
        }
        const receptor = limpio(input.webhook_salida_url)
        if (receptor !== undefined) {
            const error = receptor === null ? null : errorUrl(receptor)
            if (error) errores.push({ field: 'webhook_salida_url', message: error, rule: 'url' })
            cambios.webhook_salida_url = receptor
        }
        const secretoSalida = limpio(input.webhook_salida_secreto)
        if (secretoSalida !== undefined) {
            if (secretoSalida !== null && secretoSalida.length < 16) {
                errores.push({
                    field: 'webhook_salida_secreto',
                    message: 'El secreto del receptor de Horus tiene al menos 16 caracteres',
                    rule: 'minLength',
                })
            }
            cambios.webhook_salida_secreto_cifrado = secretoSalida === null ? null : cifrar(secretoSalida)
        }
        if (input.activo !== undefined) cambios.activo = input.activo

        const activo = input.activo ?? antes?.activo ?? false
        const urlFinal = 'url_base' in cambios ? cambios.url_base : (antes?.url_base ?? null)
        const tokenFinal = 'token_cifrado' in cambios ? cambios.token_cifrado : (antes?.token_cifrado ?? null)
        if (activo && (!urlFinal || !tokenFinal)) {
            errores.push({
                field: 'activo',
                message: 'Para encender el conector hacen falta la URL de Horus y el código de conexión',
                rule: 'requerido',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        let secretoNuevo: string | null = null
        if (input.regenerar_secreto_entrada || !antes?.webhook_entrada_secreto_cifrado) {
            secretoNuevo = generarSecretoWebhook()
            cambios.webhook_entrada_secreto_cifrado = cifrar(secretoNuevo)
        }

        const despues = await guardarConector(t, antes, cambios, { version: input.version })
        return { ...(await vistaDeFila(despues)), webhook_entrada_secreto_nuevo: secretoNuevo }
    }
}
