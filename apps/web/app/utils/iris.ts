import type { Schema } from '@argosisp/contracts'
import type { PresentacionEstadoUi } from './estados'
import { formatearFechaHora } from './formato'

/**
 * Presentación del conector con Iris (`contratos/iris.md` §1 y §2.3; API de A1 y A6). Réplica
 * del conector Horus con sus diferencias: el enlace de conexión va solo de Argos a Iris, el
 * token de Iris es `iris_pat_` y los webhooks Argos → Iris tienen su propio registro de envíos.
 */

export type ConectorIris = Schema<'ConectorIris'>
export type EnlaceConexionIris = Schema<'EnlaceConexionIris'>
export type TokenIrisCreado = Schema<'TokenIrisCreado'>
export type EnvioIris = Schema<'EnvioIris'>
export type ResumenEnviosIris = Schema<'ResumenEnviosIris'>
export type EstadoEnvioIris = EnvioIris['estado']

/** Texto que acompaña al enlace de conexión (lo pide el PM tal cual). */
export const INSTRUCCION_ENLACE_IRIS = 'Pégalo en Iris → Administración → Integraciones → Conectar. Vence en 15 minutos y sirve una sola vez.'

/** Siempre icono + texto + color: el color nunca va solo. */
export const ESTADOS_ENVIO_IRIS: Record<EstadoEnvioIris, PresentacionEstadoUi> = {
    pendiente: { etiqueta: 'Pendiente', color: 'warning', icono: 'i-lucide-clock' },
    enviado: { etiqueta: 'Enviado', color: 'success', icono: 'i-lucide-circle-check' },
    fallido: { etiqueta: 'Fallido', color: 'error', icono: 'i-lucide-circle-x' },
    descartado: { etiqueta: 'Descartado', color: 'neutral', icono: 'i-lucide-ban' },
}

/** Estado del conector: «Sin conectar» si nunca se guardó (`version: 0`). */
export function presentacionConectorIris(conector: ConectorIris): PresentacionEstadoUi {
    if (conector.activo) {
        return { etiqueta: 'Activa', color: 'success', icono: 'i-lucide-plug-zap' }
    }
    return conector.version === 0
        ? { etiqueta: 'Sin conectar', color: 'neutral', icono: 'i-lucide-unplug' }
        : { etiqueta: 'Apagada', color: 'neutral', icono: 'i-lucide-power-off' }
}

/**
 * Contrato Iris 0.6.2: Iris informó `receptor_argos: false` (conector canjeado antes de B1, sin la
 * URL ni el secreto del receptor de Argos). Solo `requiere_reconectar: true` pide el aviso; si la
 * API no trae motivo se usa uno genérico, nunca se infiere nada de otros campos.
 */
export interface AvisoReconectarIris {
    titulo: string
    motivo: string
}

export const MOTIVO_RECONECTAR_IRIS_GENERICO = 'Iris informó que no tiene guardado el receptor de webhooks de ArgosIsp. Vuelve a conectarlo para que reciba la URL y el secreto del receptor.'

/** Instrucción del flujo de reconexión: el enlace desde aquí o «Conectar con Argos» en Iris. */
export const INSTRUCCION_RECONECTAR_IRIS = 'Genera un enlace de conexión y pégalo en Iris, o pulsa «Conectar con Argos» en Iris → Administración → Integraciones. La configuración del conector se conserva.'

/** Marca discreta junto al estado del conector («Activa», «Apagada»…). */
export const MARCA_RECONECTAR_IRIS: PresentacionEstadoUi = { etiqueta: 'Volver a conectar', color: 'warning', icono: 'i-lucide-triangle-alert' }

export function avisoReconectarIris(conector: ConectorIris): AvisoReconectarIris | null {
    if (!conector.requiere_reconectar) {
        return null
    }
    const motivo = conector.motivo_reconectar?.trim()
    return { titulo: 'Hay que volver a conectar Iris', motivo: motivo || MOTIVO_RECONECTAR_IRIS_GENERICO }
}

/**
 * Contrato Iris 0.6.3: estado del último canje del enlace de conexión. Los cuatro campos son
 * opcionales en el OpenAPI: si `estado_canje` no viene, la API es anterior a 0.6.3 y no se muestra
 * nada. `confirmado` o null tampoco muestran nada. Un dato que falta (la hora de vencimiento, el
 * motivo o la fecha de la desconexión) se omite; nunca se infiere de otros campos.
 */
export type EstadoCanjeIris = NonNullable<ConectorIris['estado_canje']>
export type MotivoDesconexionIris = NonNullable<ConectorIris['motivo_desconexion']>

export const MOTIVOS_DESCONEXION_IRIS: Record<MotivoDesconexionIris, string> = {
    revocado_por_iris: 'Iris rechazó la conexión',
    canje_sin_uso: 'La conexión no se activó en 24 h',
}

/** Marca informativa mientras Iris no usa el token del canje. */
export const MARCA_CANJE_PENDIENTE_IRIS: PresentacionEstadoUi = { etiqueta: 'Esperando que Iris active la conexión', color: 'info', icono: 'i-lucide-hourglass' }

/** Marca del conector desconectado (Iris revocó el token o el canje venció sin uso). */
export const MARCA_DESCONECTADO_IRIS: PresentacionEstadoUi = { etiqueta: 'Desconectada', color: 'error', icono: 'i-lucide-unplug' }

/** Instrucción para volver a conectar tras una desconexión. */
export const INSTRUCCION_DESCONECTADO_IRIS = 'Para volver a conectarlo, genera un enlace de conexión y pégalo en Iris, o pulsa «Conectar con Argos» en Iris → Administración → Integraciones.'

export type AvisoCanjeIris
    = | { estado: 'pendiente', venceEn: string | null }
        | { estado: 'desconectado', titulo: string, motivo: string | null, desconectadoEn: string | null }

export function avisoCanjeIris(conector: ConectorIris): AvisoCanjeIris | null {
    if (conector.estado_canje === 'pendiente') {
        return { estado: 'pendiente', venceEn: conector.canje_vence_en ?? null }
    }
    if (conector.estado_canje === 'desconectado') {
        const motivo = conector.motivo_desconexion ? MOTIVOS_DESCONEXION_IRIS[conector.motivo_desconexion] : null
        return { estado: 'desconectado', titulo: 'Iris está desconectado', motivo: motivo ?? null, desconectadoEn: conector.desconectado_en ?? null }
    }
    return null
}

/** Motivo y fecha de la desconexión en una línea (tarjeta del índice); sin ninguno de los dos, `null`. */
export function textoDesconexionIris(aviso: Extract<AvisoCanjeIris, { estado: 'desconectado' }>): string | null {
    const fecha = aviso.desconectadoEn ? `${aviso.motivo ? 'desconectado' : 'Desconectado'} el ${formatearFechaHora(aviso.desconectadoEn)}` : null
    const partes = [aviso.motivo, fecha].filter((parte): parte is string => parte !== null)
    return partes.length ? partes.join(' · ') : null
}

/** `ConfigurarIris` no enciende el conector sin URL de Iris y token `iris_pat_`. */
export function irisListoParaActivar(conector: ConectorIris): boolean {
    return conector.url_base !== null && conector.token !== null
}

/** Alcance de los webhooks (`ResumenEnviosIris.alcance`) en palabras. */
export function textoAlcanceIris(alcance: ResumenEnviosIris['alcance']): string {
    if (alcance === null) {
        return 'Sin usuario técnico activo: no se envía nada'
    }
    if (alcance.global) {
        return 'Todas las empresas'
    }
    return alcance.empresas.length === 1 ? '1 empresa' : `${alcance.empresas.length} empresas`
}

/**
 * `X-Iris-Actor` (contrato Iris 0.6.0 §7.1) en palabras: `asistente_ia` → «Asistente de IA de
 * Iris»; `usuario:ana-77` → «Persona en Iris (ana-77)». Sin valor, `null`.
 */
export function textoActorIris(actor: string | null | undefined): string | null {
    if (!actor) {
        return null
    }
    if (actor === 'asistente_ia') {
        return 'Asistente de IA de Iris'
    }
    return actor.startsWith('usuario:') ? `Persona en Iris (${actor.slice('usuario:'.length)})` : actor
}
