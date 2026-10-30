import type { Schema } from '@argosisp/contracts'
import type { PresentacionEstadoUi } from './estados'

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
