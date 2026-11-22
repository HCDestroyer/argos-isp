import nodemailer, { type Transporter } from 'nodemailer'
import { configPara } from '#notify/configuracion'

/**
 * Correo de los reportes programados (`contratos/reportes.md` §5). Usa el mismo SMTP que configura
 * notify (`configPara(empresa_id)`: el de la empresa, el global o el del entorno; solo lectura), pero
 * con adjunto: el canal de notify (`Canal.enviar`) solo manda texto. Si notify suma adjuntos a su
 * canal, esto se reemplaza por él (pedido en `.claude/integration/a3.md`).
 *
 * Las pruebas cambian el transporte con `sustituirTransporteReportes` (como `sustituirCanal` de notify).
 */

export interface MensajeReporte {
    para: string
    asunto: string
    texto: string
    remitenteNombre?: string | null
    adjunto: { nombre: string; contenido: Buffer; tipo: string }
}

export interface TransporteReportes {
    enviar(mensaje: MensajeReporte): Promise<string>
}

export class SinCorreo extends Error {}

let sustituto: TransporteReportes | null = null

export function sustituirTransporteReportes(transporte: TransporteReportes | null) {
    sustituto = transporte
}

const transportes = new Map<string, Transporter>()

/** El transporte para los reportes de la empresa (null = el del consolidado: la configuración global). */
export async function transporteReportes(empresaId: number | null): Promise<TransporteReportes> {
    if (sustituto) return sustituto
    const config = await configPara(empresaId)
    const c = config.correo
    if (!c.activo) throw new SinCorreo('El correo está apagado en la configuración de notificaciones')
    if (!c.host) throw new SinCorreo('Falta el servidor SMTP en la configuración de notificaciones')
    const datos = {
        host: c.host,
        port: c.puerto ?? (c.tls === 'tls' ? 465 : 587),
        secure: c.tls === 'tls',
        requireTLS: c.tls === 'starttls',
        ignoreTLS: c.tls === 'ninguno',
        auth: c.usuario ? { user: c.usuario, pass: c.password ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    }
    const huella = JSON.stringify(datos)
    let transporte = transportes.get(huella)
    if (!transporte) {
        transporte = nodemailer.createTransport(datos)
        transportes.set(huella, transporte)
    }
    const remitente = c.remitente ?? 'no-responder@argosisp.local'
    const t = transporte
    return {
        async enviar(m) {
            const visible = (m.remitenteNombre ?? c.nombre ?? '').replace(/[\r\n"<>]/g, ' ').trim()
            const info = (await t.sendMail({
                from: visible ? { name: visible, address: remitente } : remitente,
                to: m.para,
                subject: m.asunto,
                text: m.texto,
                attachments: [
                    { filename: m.adjunto.nombre, content: m.adjunto.contenido, contentType: m.adjunto.tipo },
                ],
            })) as { messageId?: string }
            return info.messageId ?? ''
        },
    }
}
