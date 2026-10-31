/**
 * Conector con Iris en modo fixtures, con los mismos valores por defecto que la API de A1 y A6:
 * el conector nace apagado y sin guardar (`version: 0`, secretos `null`, sin `API_PUBLIC_URL`),
 * sin tokens del usuario técnico Iris y sin webhooks enviados.
 */
import type { Schema } from '@argosisp/contracts'

/** `vistaConectorIris(null)`: lo que responde `GET /integraciones/iris` en una instalación nueva. */
export const conectorIrisInicial: Schema<'ConectorIris'> = {
    activo: false,
    url_base: null,
    token: null,
    webhook_salida_url: null,
    webhook_salida_secreto: null,
    webhook_entrada_url: null,
    webhook_entrada_secreto: null,
    conector_id: null,
    conectado_por_enlace_en: null,
    token_argos_id: null,
    contrato: null,
    version: 0,
}

export interface IrisFixtures {
    conector: Schema<'ConectorIris'>
    tokens: Schema<'TokenApi'>[]
    /** Webhooks Argos → Iris, en orden de creación (la lista los devuelve como la API, por id). */
    envios: Schema<'EnvioIris'>[]
    /**
     * Alcance del usuario técnico Iris para la vista previa de «Conectar con un botón». `null`: aún
     * no existe y nacerá global (todas las empresas activas), como `vistaPreviaAutorizacionIris`.
     */
    alcanceUsuario: Schema<'ResumenEnviosIris'>['alcance']
}

/**
 * Orígenes de Iris aceptados sin confirmar el dominio, como `ARGOSISP_IRIS_ORIGENES` en la API
 * (vacía por defecto). El otro origen conocido es el de la URL del conector.
 */
export const ORIGENES_IRIS_FIXTURES: string[] = ['https://iris.argosnet.gt']

export function irisInicial(): IrisFixtures {
    return {
        conector: structuredClone(conectorIrisInicial),
        tokens: [],
        envios: [],
        alcanceUsuario: null,
    }
}

const minutosAtras = (minutos: number): string => new Date(Date.now() - minutos * 60_000).toISOString()

/**
 * Envíos de ejemplo para las pruebas: uno entregado, uno reintentándose tras un 503 y uno que agotó
 * los cinco reintentos. Con la forma exacta de `EnvioIris`.
 */
export function enviosIrisEjemplo(): Schema<'EnvioIris'>[] {
    return [
        { id: 1, evento_id: 'argos-evt-101', evento: 'servicio.creado', empresa_id: 1, estado: 'enviado', intentos: 1, proximo_intento_en: null, ultimo_status: 200, ultimo_error: null, enviado_en: minutosAtras(90), created_at: minutosAtras(90), updated_at: minutosAtras(90) },
        { id: 2, evento_id: 'argos-evt-102', evento: 'cliente.actualizado', empresa_id: 1, estado: 'fallido', intentos: 6, proximo_intento_en: null, ultimo_status: 404, ultimo_error: 'Iris respondió 404: conector desconocido', enviado_en: null, created_at: minutosAtras(60 * 15), updated_at: minutosAtras(30) },
        { id: 3, evento_id: 'argos-evt-103', evento: 'servicio.estado_cambiado', empresa_id: 1, estado: 'pendiente', intentos: 2, proximo_intento_en: new Date(Date.now() + 25 * 60_000).toISOString(), ultimo_status: 503, ultimo_error: 'Iris respondió 503: mantenimiento', enviado_en: null, created_at: minutosAtras(7), updated_at: minutosAtras(5) },
    ]
}
