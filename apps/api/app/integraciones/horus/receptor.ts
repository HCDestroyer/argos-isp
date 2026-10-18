import { Problema, SolicitudInvalida } from '#shared/errores'
import { configHorus } from '#integraciones/horus/configuracion'
import { verificarFirma } from '#integraciones/horus/firma'
import type { EntradaRecibirWebhook } from '#integraciones/horus/actions/recibir_webhook_horus'

/**
 * Autenticación del receptor `POST /integraciones/horus/webhook` (§1.3): conector activo, firma
 * HMAC-SHA256 con el secreto que generó Argos y timestamp dentro de ±5 min. Devuelve la entrada
 * de `RecibirWebhookHorus`.
 */

export class HorusApagado extends Problema {
    constructor() {
        super(503, 'horus_apagado', 'Conector Horus apagado', 'El conector con Horus está apagado en Argos')
    }
}

export class FirmaInvalida extends Problema {
    constructor(motivo: 'firma_invalida' | 'timestamp_fuera_de_ventana') {
        super(
            401,
            motivo,
            motivo === 'firma_invalida' ? 'Firma inválida' : 'Timestamp fuera de ventana',
            motivo === 'firma_invalida'
                ? 'X-Webhook-Signature no coincide con el cuerpo y el secreto del receptor'
                : 'X-Webhook-Timestamp tiene más de 5 minutos de desfase',
        )
    }
}

export async function autenticarWebhook(
    cuerpo: string,
    cabeceras: { id?: string; timestamp?: string; firma?: string },
): Promise<EntradaRecibirWebhook> {
    const config = await configHorus()
    if (!config.activo) throw new HorusApagado()
    if (!config.webhookEntradaSecreto) throw new FirmaInvalida('firma_invalida')
    const verificacion = verificarFirma({
        secreto: config.webhookEntradaSecreto,
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
    const id = typeof datos.id === 'string' && datos.id ? datos.id : cabeceras.id
    const evento = typeof datos.event === 'string' ? datos.event : null
    if (!id || id.length > 200) throw new SolicitudInvalida('Falta el id del webhook')
    if (!evento) throw new SolicitudInvalida('Falta event')
    const data = datos.data && typeof datos.data === 'object' && !Array.isArray(datos.data) ? datos.data : {}
    return {
        webhook_id: id,
        evento: evento.slice(0, 100),
        ocurrido_en: typeof datos.occurred_at === 'string' ? datos.occurred_at : null,
        data: data as Record<string, any>,
        cuerpo: datos,
    }
}
