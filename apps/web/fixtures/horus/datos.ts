/**
 * Integración con Horus en modo fixtures, con los mismos valores por defecto que la API de A6 y A1:
 * el conector nace apagado y sin guardar (`version: 0`, secretos `null`), sin tokens; el usuario
 * admin tiene una vinculación vigente con Horus.
 */
import type { Schema } from '@argosisp/contracts'

/** `verConector()` sin fila: lo que responde `GET /integraciones/horus` en una instalación nueva. */
export const conectorInicial: Schema<'ConectorHorus'> = {
    activo: false,
    url_base: null,
    token: null,
    webhook_salida_url: null,
    webhook_salida_secreto: null,
    webhook_entrada_url: 'http://localhost:3333/api/v1/integraciones/horus/webhook',
    webhook_entrada_ruta: '/api/v1/integraciones/horus/webhook',
    webhook_entrada_secreto: null,
    conector_id: null,
    conectado_por_enlace_en: null,
    ultima_prueba: { en: null, ok: null, error: null },
    salud: { fallos_seguidos: 0, pausa_hasta: null, ultimo_error: null, ultimo_error_en: null, ultimo_exito_en: null },
    errores_cifrado: [],
    version: 0,
}

export const vinculacionesIniciales: Schema<'VinculacionExterna'>[] = [
    {
        id: 1,
        conector: 'horus',
        id_externo: 'u-17',
        usuario_id: 1,
        correo_externo: 'ana@horus.isp.gt',
        nombre_externo: 'Ana López (Horus)',
        revocada_en: null,
        created_at: '2026-10-16T15:20:00.000Z',
    },
]

/** Tickets que los fixtures aceptan en `/sso/entrar#<ticket>` (un solo uso cada uno). */
export const TICKET_VINCULADO = 'tkt_fixture_vinculado_000000000001'
export const TICKET_SIN_VINCULAR = 'tkt_fixture_sin_vincular_0000000001'
export const TOKEN_VINCULACION = 'vin_fixture_000000000000000000001'

export interface HorusFixtures {
    conector: Schema<'ConectorHorus'>
    tokens: Schema<'TokenApi'>[]
    vinculaciones: Schema<'VinculacionExterna'>[]
    /** Tickets y tokens de vinculación ya usados. */
    usados: string[]
}

export function horusInicial(): HorusFixtures {
    return {
        conector: structuredClone(conectorInicial),
        tokens: [],
        vinculaciones: structuredClone(vinculacionesIniciales),
        usados: [],
    }
}

const minutosAtras = (minutos: number): string => new Date(Date.now() - minutos * 60_000).toISOString()

/**
 * Consulta 360 (§3.1) de cada servicio de los fixtures con identidad en Horus: el 1 sospechoso con
 * un hallazgo; el 2 limpio pero con Horus caído (último dato de hace 12 min). Los demás, sin
 * identidad vigente en Horus (404 de Horus → `datos: null`).
 */
export function consulta360(servicioId: number, ip: string | null): Schema<'Horus360Servicio'> {
    const base = { servicio_id: servicioId, conector: 'activo' as const, consulta: 'external_service_id' as const, ip, eventos_recientes: [], reintentar_en: null }
    if (servicioId === 1) {
        return {
            ...base,
            stale: false,
            actualizado_en: minutosAtras(0),
            error: null,
            datos: {
                customer: { id: '0192-cliente-1', address: ip, alias: 'Cliente 1', kind: 'residential', status: 'active' },
                external: { system: 'argosisp', customer_id: 1, service_id: 1, code: 'C-000001', service_state: 'activo', stale: false },
                security: {
                    state: 'suspected',
                    open_findings: 1,
                    findings: [{ id: 'f-9001', kind: 'outbound_scanning', severity: 'high', opened_at: minutosAtras(95), summary: 'Escaneo del puerto 23 hacia 1,200 destinos en 10 min' }],
                },
                meta: { at: minutosAtras(0), omitted: [] },
            },
            eventos_recientes: [
                { id: 1, evento: 'finding.opened', evento_interno: 'horus.hallazgo_abierto', ocurrido_en: minutosAtras(95), recibido_en: minutosAtras(95), resumen: 'Hallazgo abierto: escaneo saliente (alta)' },
            ],
        }
    }
    if (servicioId === 2) {
        return {
            ...base,
            stale: true,
            actualizado_en: minutosAtras(12),
            error: 'Horus respondió 503: mantenimiento',
            // En pausa por la espera exponencial (máx. 15 min), como `servicio360` de A6.
            reintentar_en: new Date(Date.now() + 4 * 60_000).toISOString(),
            datos: {
                security: { state: 'clean', open_findings: 0, findings: [] },
                meta: { at: minutosAtras(12), omitted: [] },
            },
        }
    }
    return { ...base, stale: false, actualizado_en: null, error: 'Horus no tiene identidad vigente para este servicio (404)', datos: null }
}

/** Un elemento de `SeguridadHorus.items` (modo `lotes`) con lo mismo que la consulta 360. */
export function seguridadDe(servicioId: number): Schema<'SeguridadHorus'>['items'][number] {
    if (servicioId === 1) {
        return { servicio_id: 1, estado: 'suspected', hallazgos_abiertos: 1, severidad_maxima: 'high', desde: minutosAtras(95), fuente: 'horus', stale: false, actualizado_en: minutosAtras(0), error: null }
    }
    if (servicioId === 2) {
        return { servicio_id: 2, estado: 'clean', hallazgos_abiertos: 0, severidad_maxima: null, desde: minutosAtras(600), fuente: 'consulta_360', stale: true, actualizado_en: minutosAtras(12), error: 'Horus respondió 503: mantenimiento' }
    }
    return { servicio_id: servicioId, estado: null, hallazgos_abiertos: null, severidad_maxima: null, desde: null, fuente: null, stale: false, actualizado_en: null, error: 'not_found' }
}
