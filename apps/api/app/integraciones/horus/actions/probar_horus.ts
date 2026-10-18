import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { desdeFila, TABLA_CONECTOR, type FilaConector } from '#integraciones/horus/configuracion'
import { ErrorHorus, llamarHorus } from '#integraciones/horus/cliente'
import { cabecerasFirmadas } from '#integraciones/horus/firma'
import { TIMEOUT_ENVIO_MS } from '#integraciones/horus/envios'

export interface ResultadoPruebaHorus {
    ok: boolean
    probado_en: string
    /** lectura autenticada `GET /api/v1/routers/status` con el `hf_pat_` (§3.3) */
    api: { ok: boolean; status: number | null; latencia_ms: number | null; error: string | null }
    /** `ping` firmado al receptor de Horus; null si no está configurado */
    webhook: { ok: boolean; status: number | null; error: string | null } | null
}

/**
 * `horus.probar`: "Probar conexión" del panel. Usa la configuración **guardada**,
 * esté encendido o no el conector, sin respetar la pausa de la espera exponencial.
 *
 * - Pide `GET /api/v1/routers/status` con `Authorization: Bearer hf_pat_…` y mide la latencia.
 * - Si hay receptor de Horus, le manda un webhook `ping` firmado (Horus ignora eventos que no
 *   conoce, §4).
 * - No lanza si Horus falla: devuelve el error real (`ECONNREFUSED`, `Horus respondió 401: …`).
 * - Guarda el resultado en el conector (`ultima_prueba_*`, sin tocar su `version`).
 */
export default class ProbarHorus extends DomainAction<Record<string, never>, ResultadoPruebaHorus> {
    readonly nombre = 'horus.probar'

    protected async handle(_input: Record<string, never>, t: Transaccion): Promise<ResultadoPruebaHorus> {
        t.fijarEmpresa(null)
        t.fijarEntidad('conector_horus', 1)
        const fila = (await t.trx.from(TABLA_CONECTOR).where('id', 1).first()) as FilaConector | null
        const config = desdeFila(fila)
        const ahora = new Date()

        const api: ResultadoPruebaHorus['api'] = { ok: false, status: null, latencia_ms: null, error: null }
        const inicio = Date.now()
        try {
            const respuesta = await llamarHorus(config, 'GET', '/api/v1/routers/status', undefined, {
                ignorarPausa: true,
            })
            api.ok = true
            api.status = respuesta.status
        } catch (error) {
            api.error = error instanceof Error ? error.message : String(error)
            api.status = error instanceof ErrorHorus ? error.status : null
        }
        api.latencia_ms = Date.now() - inicio

        let webhook: ResultadoPruebaHorus['webhook'] = null
        if (config.webhookSalidaUrl && config.webhookSalidaSecreto) {
            const id = `argos-ping-${randomUUID()}`
            const cuerpo = JSON.stringify({
                id,
                evento: 'ping',
                ocurrido_en: ahora.toISOString(),
                payload: {},
            })
            try {
                const respuesta = await fetch(config.webhookSalidaUrl, {
                    method: 'POST',
                    headers: cabecerasFirmadas(config.webhookSalidaSecreto, id, cuerpo),
                    body: cuerpo,
                    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
                    redirect: 'error',
                })
                const textoRespuesta = respuesta.ok ? '' : await respuesta.text().catch(() => '')
                const detalle = textoRespuesta.slice(0, 300)
                webhook = {
                    ok: respuesta.ok,
                    status: respuesta.status,
                    error: respuesta.ok ? null : `HTTP ${respuesta.status}${detalle ? `: ${detalle}` : ''}`,
                }
            } catch (error) {
                const causa = (error as { cause?: { code?: string } }).cause?.code
                webhook = {
                    ok: false,
                    status: null,
                    error: `Sin conexión: ${causa ?? (error as Error).message}`,
                }
            }
        }

        const ok = api.ok && (webhook?.ok ?? true)
        const error = [api.error, webhook?.error ? `webhook: ${webhook.error}` : null]
            .filter(Boolean)
            .join(' · ')
        if (fila) {
            await t.trx
                .from(TABLA_CONECTOR)
                .where('id', 1)
                .update({ ultima_prueba_en: ahora, ultima_prueba_ok: ok, ultima_prueba_error: error || null })
        }
        return { ok, probado_en: ahora.toISOString(), api, webhook }
    }
}
