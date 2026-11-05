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
    requiere_reconectar: false,
    motivo_reconectar: null,
    estado_canje: null,
    canje_vence_en: null,
    desconectado_en: null,
    motivo_desconexion: null,
    version: 0,
}

/** Motivo que responde la API (`MOTIVO_RECONECTAR_RECEPTOR` en `configuracion.ts` de A1). */
export const MOTIVO_RECONECTAR_RECEPTOR_FIXTURE
    = 'Iris informó que no tiene guardado el receptor de webhooks de Argos (conector canjeado antes de '
        + 'B1): vuelve a conectar Iris con un enlace o con «Conectar con Argos» para que Iris reciba la URL '
        + 'y el secreto del receptor'

/**
 * Contrato Iris 0.6.2: un conector canjeado antes de B1, encendido, al que Iris informó después
 * `receptor_argos: false` con `PUT /integraciones/iris/contrato`. `GET /integraciones/iris` responde
 * `requiere_reconectar: true` con su motivo.
 */
export const conectorIrisPorReconectar: Schema<'ConectorIris'> = {
    activo: true,
    url_base: 'https://iris.argosnet.gt',
    token: '***',
    webhook_salida_url: 'https://iris.argosnet.gt/api/v1/integraciones/argosisp/webhook/cnx_7f3a',
    webhook_salida_secreto: '***',
    webhook_entrada_url: null,
    webhook_entrada_secreto: null,
    conector_id: 'cnx_7f3a',
    conectado_por_enlace_en: '2026-10-20T15:30:00.000Z',
    token_argos_id: 1,
    contrato: '0.6.2',
    requiere_reconectar: true,
    motivo_reconectar: MOTIVO_RECONECTAR_RECEPTOR_FIXTURE,
    // Iris ya usó el `atk_` del canje (el PUT del contrato): canje confirmado
    estado_canje: 'confirmado',
    canje_vence_en: null,
    desconectado_en: null,
    motivo_desconexion: null,
    version: 4,
}

/** Contrato Iris 0.6.3: el plazo para que Iris use el `atk_` del canje (`PLAZO_CONFIRMAR_CANJE_IRIS_MS`). */
export const PLAZO_CONFIRMAR_CANJE_IRIS_FIXTURE_MS = 24 * 60 * 60_000

/**
 * Conector recién canjeado con un enlace, como lo deja `CanjearEnlaceIris`: Iris ya tiene su
 * `iris_pat_` puesto en Argos pero aún no usó el `atk_`. `canje_vence_en` = canje + 24 h.
 */
export function conectorIrisCanjePendiente(canjeadoEn: Date = new Date()): Schema<'ConectorIris'> {
    return {
        activo: true,
        url_base: 'https://iris.argosnet.gt',
        token: '***',
        webhook_salida_url: 'https://iris.argosnet.gt/api/v1/integraciones/argosisp/webhook/cnx_9b21',
        webhook_salida_secreto: '***',
        webhook_entrada_url: null,
        webhook_entrada_secreto: null,
        conector_id: 'cnx_9b21',
        conectado_por_enlace_en: canjeadoEn.toISOString(),
        token_argos_id: 2,
        contrato: '0.6.3',
        requiere_reconectar: false,
        motivo_reconectar: null,
        estado_canje: 'pendiente',
        canje_vence_en: new Date(canjeadoEn.getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_FIXTURE_MS).toISOString(),
        desconectado_en: null,
        motivo_desconexion: null,
        version: 1,
    }
}

/** El canje confirmado: Iris ya usó el `atk_` (nada nuevo en la pantalla). */
export function conectorIrisCanjeConfirmado(canjeadoEn: Date = new Date()): Schema<'ConectorIris'> {
    return { ...conectorIrisCanjePendiente(canjeadoEn), estado_canje: 'confirmado', canje_vence_en: null, version: 2 }
}

/**
 * Conector desconectado (`desconexion.ts` de A1): apagado, sin `iris_pat_` ni secretos de
 * webhooks; conserva URL, receptor, `conector_id`, `token_argos_id` y contrato.
 */
export function conectorIrisDesconectado(
    motivo: NonNullable<Schema<'ConectorIris'>['motivo_desconexion']>,
    desconectadoEn: Date = new Date(),
): Schema<'ConectorIris'> {
    return {
        ...conectorIrisCanjePendiente(new Date(desconectadoEn.getTime() - (motivo === 'canje_sin_uso' ? PLAZO_CONFIRMAR_CANJE_IRIS_FIXTURE_MS : 5 * 60_000))),
        activo: false,
        token: null,
        webhook_salida_secreto: null,
        webhook_entrada_secreto: null,
        estado_canje: 'desconectado',
        canje_vence_en: null,
        desconectado_en: desconectadoEn.toISOString(),
        motivo_desconexion: motivo,
        version: 2,
    }
}

/**
 * Lo que responde una API anterior a 0.6.3: sin `estado_canje`, `canje_vence_en`,
 * `desconectado_en` ni `motivo_desconexion` (opcionales en el OpenAPI).
 */
export function conectorIrisAnterior063(): Schema<'ConectorIris'> {
    const { estado_canje: _estado, canje_vence_en: _vence, desconectado_en: _desconectado, motivo_desconexion: _motivo, ...resto } = conectorIrisCanjePendiente()
    return { ...resto, contrato: '0.6.2' }
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
