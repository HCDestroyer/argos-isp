import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Firma de webhooks en los dos sentidos (`contratos/horus.md` §1.3):
 *
 * ```
 * X-Webhook-Id: <id estable del evento>
 * X-Webhook-Timestamp: <unix segundos>
 * X-Webhook-Signature: v1=<hex(HMAC-SHA256(secreto, timestamp + "." + cuerpo))>
 * ```
 *
 * El receptor rechaza firmas inválidas y timestamps con más de 5 min de desfase. El secreto lo
 * genera el receptor.
 */

export const DESFASE_MAXIMO_S = 300

export function firmar(secreto: string, timestamp: number | string, cuerpo: string): string {
    return `v1=${createHmac('sha256', secreto).update(`${timestamp}.${cuerpo}`).digest('hex')}`
}

export function cabecerasFirmadas(
    secreto: string,
    id: string,
    cuerpo: string,
    ahora: Date = new Date(),
): Record<string, string> {
    const timestamp = Math.floor(ahora.getTime() / 1000)
    return {
        'content-type': 'application/json',
        'x-webhook-id': id,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-signature': firmar(secreto, timestamp, cuerpo),
    }
}

export type ResultadoFirma =
    { ok: true } | { ok: false; motivo: 'firma_invalida' | 'timestamp_fuera_de_ventana' }

/**
 * Verifica la firma de un webhook recibido. Acepta varias firmas separadas por coma o espacio
 * (`v1=…,v1=…`, rotación de secreto del emisor). Compara en tiempo constante.
 */
export function verificarFirma(opciones: {
    secreto: string
    cuerpo: string
    timestamp: string | null | undefined
    firma: string | null | undefined
    ahora?: Date
}): ResultadoFirma {
    const { secreto, cuerpo, timestamp, firma } = opciones
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !firma) return { ok: false, motivo: 'firma_invalida' }
    const esperada = Buffer.from(firmar(secreto, timestamp, cuerpo))
    const coincide = firma
        .split(/[\s,]+/)
        .filter(Boolean)
        .some((candidata) => {
            const valor = Buffer.from(candidata.trim())
            return valor.length === esperada.length && timingSafeEqual(valor, esperada)
        })
    if (!coincide) return { ok: false, motivo: 'firma_invalida' }
    const ahora = Math.floor((opciones.ahora ?? new Date()).getTime() / 1000)
    if (Math.abs(ahora - Number(timestamp)) > DESFASE_MAXIMO_S) {
        return { ok: false, motivo: 'timestamp_fuera_de_ventana' }
    }
    return { ok: true }
}

/** Secreto nuevo para el receptor de Argos: 32 bytes en base64url (43 caracteres), prefijo `whsec_`. */
export function generarSecretoWebhook(): string {
    return `whsec_${randomBytes(32).toString('base64url')}`
}
