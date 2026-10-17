import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { errorUrl } from '#integraciones/horus/configuracion'
import { generarSecretoWebhook } from '#integraciones/horus/firma'
import { bloquearConector, guardarConector } from '#integraciones/horus/escritura'
import { RUTA_RECEPTOR, vistaDeFila, type VistaConector } from '#integraciones/horus/panel'
import { HorusRespondioError } from '#integraciones/horus/errores'
import { emisorTokenHorus } from '#integraciones/horus/token_argos'
import { validarDatosDeHorus } from '#integraciones/horus/actions/canjear_enlace_horus'

export const RUTA_CANJE_HORUS = '/api/v1/integrations/argosisp/conexion/canjear'
export const TIMEOUT_CANJE_MS = 10_000

export interface EntradaConectarConEnlace {
    /** origen del enlace de Horus (`https://horus.isp.example`) */
    url_horus: string
    /** el código del fragmento del enlace (`#…`); `_secreto` para que la auditoría lo guarde como `***` */
    codigo_secreto: string
    /** URL pública de Argos (la pone la ruta) */
    base_url: string
}

/** Separa `https://<horus>/conectar#<codigo>` en origen y código; null si no tiene esa forma. */
export function partirEnlace(enlace: string): { url_horus: string; codigo: string } | null {
    let url: URL
    try {
        url = new URL(enlace.trim())
    } catch {
        return null
    }
    const codigo = url.hash.replace(/^#/, '')
    if (!codigo || !/^[A-Za-z0-9_-]{16,200}$/.test(codigo)) return null
    const ruta = url.pathname.replace(/\/conectar\/?$/, '')
    return { url_horus: `${url.origin}${ruta === '/' ? '' : ruta}`, codigo }
}

/**
 * `integraciones.horus.conectar_enlace` (permiso `integraciones.horus.configurar`): "Conectar
 * con enlace de Horus" (§1.4, Argos es el sistema B). Argos emite su token `atk_` y su secreto de
 * receptor, llama a `POST <horus>/api/v1/integrations/argosisp/conexion/canjear` y guarda lo que
 * Horus devuelve (`hf_pat_`, receptor y secreto), cifrado.
 *
 * Todo en una transacción: si Horus falla o responde mal, no queda token emitido ni nada guardado.
 * El conector queda **apagado**. Solo `https` (salvo `HORUS_PERMITIR_HTTP`).
 */
export default class ConectarConEnlaceHorus extends DomainAction<EntradaConectarConEnlace, VistaConector> {
    readonly nombre = 'integraciones.horus.conectar_enlace'

    protected async handle(input: EntradaConectarConEnlace, t: Transaccion): Promise<VistaConector> {
        const urlHorus = input.url_horus.replace(/\/+$/, '')
        const base = input.base_url.replace(/\/+$/, '')
        const errores = [
            { campo: 'enlace', error: errorUrl(urlHorus) },
            { campo: 'base_url', error: errorUrl(base) },
        ]
            .filter((e) => e.error)
            .map((e) => ({ field: e.campo, message: e.error!, rule: 'url' }))
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const antes = await bloquearConector(t)
        const emisor = emisorTokenHorus()
        if (antes?.token_argos_id) await emisor.revocar(t.trx, t.ctx, Number(antes.token_argos_id))
        const emitido = await emisor.emitir(t.trx, t.ctx)
        const secretoEntrada = generarSecretoWebhook()

        let respuesta: Response
        try {
            respuesta = await fetch(`${urlHorus}${RUTA_CANJE_HORUS}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({
                    codigo: input.codigo_secreto,
                    sistema: 'argosisp',
                    base_url: base,
                    token: emitido.token,
                    webhook: { url: `${base}${RUTA_RECEPTOR}`, secreto: secretoEntrada },
                }),
                signal: AbortSignal.timeout(TIMEOUT_CANJE_MS),
                redirect: 'error',
            })
        } catch (error) {
            const causa = (error as { cause?: { code?: string } }).cause?.code
            throw new HorusRespondioError(
                `No se pudo conectar con Horus: ${causa ?? (error as Error).message}`,
            )
        }
        const texto = await respuesta.text().catch(() => '')
        if (respuesta.status === 410) {
            throw new ReglaNegocio(
                'El enlace de Horus venció o ya se usó: genera otro en Horus',
                'enlace_vencido',
            )
        }
        if (!respuesta.ok) {
            throw new HorusRespondioError(`Horus respondió ${respuesta.status}: ${texto.slice(0, 300)}`)
        }
        let datos: { token?: string; webhook?: { url?: string; secreto?: string }; conector_id?: string }
        try {
            datos = JSON.parse(texto)
        } catch {
            throw new HorusRespondioError('Horus respondió algo que no es JSON')
        }
        const invalidos = validarDatosDeHorus({ token: datos.token, webhook: datos.webhook })
        if (invalidos.length > 0) {
            throw new HorusRespondioError(
                `Respuesta de Horus incompleta: ${invalidos.map((e) => `${e.field} (${e.message})`).join(', ')}`,
            )
        }

        const despues = await guardarConector(t, antes, {
            activo: false,
            url_base: urlHorus,
            token_cifrado: cifrar(datos.token!),
            webhook_salida_url: datos.webhook!.url,
            webhook_salida_secreto_cifrado: cifrar(datos.webhook!.secreto!),
            webhook_entrada_secreto_cifrado: cifrar(secretoEntrada),
            token_argos_id: emitido.token_id,
            conectado_por_enlace_en: t.trx.knexRawQuery('now()'),
        })
        return vistaDeFila(despues)
    }
}
