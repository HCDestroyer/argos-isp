import db from '@adonisjs/lucid/services/db'
import type { EventoEntrante } from '#shared/eventos_bus'
import { CAMPOS_CLIENTE_IDENTIDAD } from '#shared/eventos'
import { configHorus, type ConfigHorus } from '#integraciones/horus/configuracion'
import {
    entregarPendientesDe,
    insertarEnvio,
    type CanalWebhooks,
    type ResultadoEntrega,
} from '#integraciones/webhooks_salientes'

// El motor (firma, reintentos, entrega) es común con el conector Iris: `#integraciones/webhooks_salientes`.
export {
    INTENTOS_MAXIMOS,
    REINTENTOS_S,
    TIMEOUT_ENVIO_MS,
    idWebhook,
    type EstadoEnvio,
    type ResultadoEntrega,
} from '#integraciones/webhooks_salientes'

/**
 * Webhooks firmados Argos → Horus (`contratos/horus.md` §1.3 y §2.3).
 *
 * Es infraestructura del bus, como el relay: no decide nada de negocio ni cambia datos de Argos.
 * Cada evento queda registrado en `integraciones.horus_envios` (uno por evento del outbox, con
 * su estado e intentos), que es su bitácora; no se escribe `audit.acciones` por envío (serían
 * miles por día con las sesiones PPPoE).
 *
 * - `registrarEnvio` (lo llama `ConsumidorHorus`, grupo `horus`): solo con el conector activo y
 *   la URL y el secreto del receptor de Horus configurados; si no, el evento se ignora (Horus
 *   se resincroniza con su barrido periódico, §2.2).
 * - `entregarPendientes` (bucle de `node ace horus:worker`): manda lo que toca, firmado en el
 *   momento del envío. 2xx → `enviado`. Cualquier otra cosa → reintento a 1 min, 5 min, 30 min,
 *   2 h y 12 h; tras el último, `fallido`. Con el conector apagado → `descartado`.
 * - Cuerpo: `{ id, evento, ocurrido_en, payload }`; `id` = `argos-evt-<id del outbox>`, estable
 *   entre reintentos (Horus deduplica).
 */

/**
 * Eventos del bus que van a Horus (§2.3). `servicio.config_cambiada` (1.7.0) solo cuando cambian
 * el plan o la empresa del servicio, lo que Horus muestra en su identidad (`CAMPOS_CONFIG_A_HORUS`);
 * los cambios de IP llegan con `asignacion.cambiada`.
 */
export const EVENTOS_A_HORUS = [
    'asignacion.cambiada',
    'sesion.iniciada',
    'sesion.terminada',
    'cliente.actualizado',
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
] as const

/** Campos de `servicio.config_cambiada` que cambian lo que Horus guarda del servicio (§2.4). */
export const CAMPOS_CONFIG_A_HORUS = ['plan', 'empresa'] as const

type Payload = Record<string, unknown>

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && Number.isInteger(n) && n > 0 ? n : null
}

async function empresaDeServicio(servicioId: number | null): Promise<number | null> {
    if (!servicioId) return null
    const fila = (await db.from('core.servicios').where('id', servicioId).select('empresa_id').first()) as {
        empresa_id: number | null
    } | null
    return fila?.empresa_id === null || fila?.empresa_id === undefined ? null : Number(fila.empresa_id)
}

/**
 * Payload que recibe Horus (§2.3) a partir del evento de Argos; `null` si el evento no sirve a
 * Horus (sesión sin servicio). Los campos extra que Horus no conozca los ignora (§4).
 */
export async function payloadParaHorus(evento: string, p: Payload): Promise<Payload | null> {
    switch (evento) {
        case 'asignacion.cambiada': {
            const servicioId = entero(p.servicio_id)
            if (!servicioId) return null
            const ipv4 = Array.isArray(p.ipv4) ? (p.ipv4 as string[]) : []
            const enlace = texto(p.prefijo_enlace_v6)
            const delegado = texto(p.prefijo_delegado_v6)
            return {
                servicio_id: servicioId,
                empresa_id: entero(p.empresa_id) ?? (await empresaDeServicio(servicioId)),
                ipv4: ipv4[0] ?? null,
                ipv4s: ipv4,
                prefijo_v6: delegado ?? enlace,
                prefijo_enlace_v6: enlace,
                prefijo_delegado_v6: delegado,
                inicio: texto(p.inicio),
                fin: texto(p.fin),
            }
        }
        case 'sesion.iniciada':
        case 'sesion.terminada': {
            const servicioId = entero(p.servicio_id)
            if (!servicioId) return null
            // El evento trae `prefijos_v6[]` sin decir cuál es cuál: se leen de la sesión.
            const sesion =
                texto(p.nas_ip) && texto(p.acct_session_id)
                    ? ((await db
                          .from('network.sesiones')
                          .where('nas_ip', String(p.nas_ip))
                          .where('acct_session_id', String(p.acct_session_id))
                          .select(
                              db.raw('prefijo_enlace_v6::text AS enlace'),
                              db.raw('prefijo_delegado_v6::text AS delegado'),
                          )
                          .first()) as { enlace: string | null; delegado: string | null } | null)
                    : null
            const prefijos = Array.isArray(p.prefijos_v6) ? (p.prefijos_v6 as string[]) : []
            return {
                servicio_id: servicioId,
                empresa_id: await empresaDeServicio(servicioId),
                ipv4: texto(p.ipv4),
                prefijo_enlace_v6: sesion?.enlace ?? null,
                prefijo_delegado_v6: sesion?.delegado ?? null,
                prefijos_v6: prefijos,
                nas_ip: texto(p.nas_ip),
                acct_session_id: texto(p.acct_session_id),
                ...(evento === 'sesion.terminada' ? { motivo: texto(p.motivo) } : {}),
            }
        }
        case 'cliente.actualizado': {
            const clienteId = entero(p.cliente_id)
            // Horus solo muestra la identidad: teléfono, dirección, coordenadas o zona (Iris 0.3.1)
            // no le cambian nada y no se le envían.
            const campos = (Array.isArray(p.campos) ? p.campos : []).filter((c): c is string =>
                (CAMPOS_CLIENTE_IDENTIDAD as readonly unknown[]).includes(c),
            )
            if (!clienteId || campos.length === 0) return null
            return { cliente_id: clienteId, campos }
        }
        case 'servicio.config_cambiada': {
            const servicioId = entero(p.servicio_id)
            const campos = (Array.isArray(p.campos) ? p.campos : []).filter((c): c is string =>
                (CAMPOS_CONFIG_A_HORUS as readonly unknown[]).includes(c),
            )
            if (!servicioId || campos.length === 0) return null
            return {
                servicio_id: servicioId,
                empresa_id: entero(p.empresa_id) ?? (await empresaDeServicio(servicioId)),
                campos,
                ...(entero(p.empresa_anterior_id)
                    ? { empresa_anterior_id: entero(p.empresa_anterior_id) }
                    : {}),
            }
        }
        case 'servicio.estado_cambiado': {
            const servicioId = entero(p.servicio_id)
            if (!servicioId) return null
            return {
                servicio_id: servicioId,
                empresa_id: entero(p.empresa_id) ?? (await empresaDeServicio(servicioId)),
                estado: texto(p.a),
                estado_anterior: texto(p.de),
            }
        }
        default:
            return null
    }
}

export function conectorListoParaEnviar(config: ConfigHorus): boolean {
    return Boolean(config.activo && config.webhookSalidaUrl && config.webhookSalidaSecreto)
}

/**
 * Registra el webhook de un evento del bus. Idempotente por id del outbox (un evento entregado
 * dos veces por el bus no crea dos envíos). Devuelve el id del envío o null si no aplica.
 */
export async function registrarEnvio(evento: EventoEntrante): Promise<number | null> {
    if (!(EVENTOS_A_HORUS as readonly string[]).includes(evento.evento)) return null
    const config = await configHorus()
    if (!conectorListoParaEnviar(config)) return null
    const payload = await payloadParaHorus(evento.evento, evento.payload ?? {})
    if (!payload) return null
    return insertarEnvio('integraciones.horus_envios', {
        outboxId: evento.id,
        evento: evento.evento,
        empresaId: entero(payload.empresa_id),
        payload,
    })
}

/** `fetch` para los envíos (las pruebas lo reemplazan para medir llamadas). */
let fetchEnvios: typeof fetch = (...args) => fetch(...args)

export function fijarFetchEnvios(fn?: typeof fetch) {
    fetchEnvios = fn ?? ((...args) => fetch(...args))
}

/**
 * Entrega los envíos pendientes cuyo `proximo_intento_en` ya llegó (o el de `soloId`). Cada uno
 * en su transacción con `FOR UPDATE SKIP LOCKED`: varios workers no mandan el mismo envío.
 */
export async function entregarPendientes(
    opciones: { limite?: number; ahora?: Date; soloId?: number } = {},
): Promise<ResultadoEntrega> {
    return entregarPendientesDe(CANAL_HORUS, opciones)
}

const CANAL_HORUS: CanalWebhooks = {
    sistema: 'horus',
    tabla: 'integraciones.horus_envios',
    destino: async () => {
        const config = await configHorus()
        return conectorListoParaEnviar(config)
            ? { url: config.webhookSalidaUrl!, secreto: config.webhookSalidaSecreto! }
            : null
    },
    motivoDescarte: 'Conector Horus apagado o sin receptor configurado',
    fetch: () => fetchEnvios,
}
