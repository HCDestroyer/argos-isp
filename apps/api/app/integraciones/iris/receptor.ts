import { Problema, SolicitudInvalida } from '#shared/errores'
import { descifrar } from '#shared/cifrado'
import { leerFilaIris } from '#integraciones/iris/configuracion'
import { verificarFirma } from '#integraciones/horus/firma'
import { FirmaInvalida } from '#integraciones/horus/receptor'
import type { EntradaRecibirWebhookIris } from '#integraciones/iris/actions/recibir_webhook_iris'

/**
 * Autenticación del receptor `POST /api/v1/integraciones/iris/webhook` (contrato Iris §1.3 y §6.6):
 * la misma firma que los webhooks de Horus y los de Argos → Iris (`X-Webhook-Id`,
 * `X-Webhook-Timestamp`, `X-Webhook-Signature: v1=<hex(HMAC-SHA256(secreto, timestamp.cuerpo))>`,
 * ±5 min), con el secreto de entrada que Argos entregó en el canje (`webhook.secreto`). Con el
 * conector apagado, 503 `iris_apagado` (Iris reintenta). Cuerpo `{ id, evento, ocurrido_en,
 * payload }` (la forma de §2.3; se aceptan también `event`/`occurred_at`/`data`, la de Horus).
 */

export class IrisApagado extends Problema {
    constructor() {
        super(503, 'iris_apagado', 'Conector Iris apagado', 'El conector con Iris está apagado en Argos')
    }
}

function secretoEntrada(cifrado: string | null): string | null {
    if (!cifrado) return null
    try {
        return descifrar(cifrado)
    } catch {
        return null
    }
}

function textoONulo(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

export async function autenticarWebhookIris(
    cuerpo: string,
    cabeceras: { id?: string; timestamp?: string; firma?: string },
): Promise<EntradaRecibirWebhookIris> {
    const fila = await leerFilaIris()
    if (!fila?.activo) throw new IrisApagado()
    const secreto = secretoEntrada(fila.webhook_entrada_secreto_cifrado)
    if (!secreto) throw new FirmaInvalida('firma_invalida')
    const verificacion = verificarFirma({
        secreto,
        cuerpo,
        timestamp: cabeceras.timestamp,
        firma: cabeceras.firma,
    })
    if (!verificacion.ok) throw new FirmaInvalida(verificacion.motivo)

    let json: unknown
    try {
        json = JSON.parse(cuerpo)
    } catch {
        throw new SolicitudInvalida('El cuerpo no es JSON')
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new SolicitudInvalida('El cuerpo debe ser un objeto JSON')
    }
    const datos = json as Record<string, unknown>
    // `X-Webhook-Id` manda: es la clave de deduplicación del contrato (§6.6)
    const id = textoONulo(cabeceras.id) ?? textoONulo(datos.id)
    const evento = textoONulo(datos.evento) ?? textoONulo(datos.event)
    if (!id || id.length > 200) throw new SolicitudInvalida('Falta el id del webhook (X-Webhook-Id)')
    if (!evento) throw new SolicitudInvalida('Falta evento')
    const payload = datos.payload ?? datos.data
    return {
        webhook_id: id,
        evento: evento.slice(0, 100),
        ocurrido_en: textoONulo(datos.ocurrido_en) ?? textoONulo(datos.occurred_at),
        payload:
            payload && typeof payload === 'object' && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : {},
        cuerpo: datos,
    }
}
