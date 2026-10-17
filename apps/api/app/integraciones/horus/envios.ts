import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { EventoEntrante } from '#shared/eventos_bus'
import { configHorus, type ConfigHorus } from '#integraciones/horus/configuracion'
import { cabecerasFirmadas } from '#integraciones/horus/firma'

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

/** Eventos del bus que van a Horus. `cliente.actualizado` lo emite A1 (puede no existir aún). */
export const EVENTOS_A_HORUS = [
    'asignacion.cambiada',
    'sesion.iniciada',
    'sesion.terminada',
    'cliente.actualizado',
    'servicio.estado_cambiado',
] as const

/** Esperas antes de cada reintento (contrato §1.3): 1 min, 5 min, 30 min, 2 h, 12 h. */
export const REINTENTOS_S = [60, 300, 1800, 7200, 43200] as const
/** Intentos totales: el primero más los cinco reintentos. */
export const INTENTOS_MAXIMOS = REINTENTOS_S.length + 1
export const TIMEOUT_ENVIO_MS = 5000

export type EstadoEnvio = 'pendiente' | 'enviado' | 'fallido' | 'descartado'

export function idWebhook(outboxId: number | string): string {
    return `argos-evt-${outboxId}`
}

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
            if (!clienteId) return null
            return { cliente_id: clienteId, campos: Array.isArray(p.campos) ? p.campos : [] }
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

/** Instante del evento: `created_at` de su fila en `audit.outbox` (o ahora). */
async function instanteDelEvento(outboxId: number | string): Promise<string> {
    if (typeof outboxId === 'number' || /^\d+$/.test(String(outboxId))) {
        const fila = (await db
            .from('audit.outbox')
            .where('id', Number(outboxId))
            .select('created_at')
            .first()) as {
            created_at: Date
        } | null
        if (fila) return new Date(fila.created_at).toISOString()
    }
    return new Date().toISOString()
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
    const id = idWebhook(evento.id)
    const cuerpo = JSON.stringify({
        id,
        evento: evento.evento,
        ocurrido_en: await instanteDelEvento(evento.id),
        payload,
    })
    const filas = (await db.rawQuery(
        `INSERT INTO integraciones.horus_envios (evento_id, evento, empresa_id, cuerpo, proximo_intento_en)
         VALUES (?, ?, ?, ?, now())
         ON CONFLICT (evento_id) DO NOTHING
         RETURNING id`,
        [id, evento.evento, entero(payload.empresa_id), cuerpo],
    )) as { rows: Array<{ id: number }> }
    return filas.rows[0]?.id ?? null
}

export interface ResultadoEntrega {
    enviados: number
    reintentar: number
    fallidos: number
    descartados: number
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
    const resultado: ResultadoEntrega = { enviados: 0, reintentar: 0, fallidos: 0, descartados: 0 }
    const ahora = opciones.ahora ?? new Date()
    // `proximo_intento_en` lo fija Postgres (`now()`, microsegundos). Compararlo con un `Date` de
    // Node (milisegundos, truncado) deja fuera un envío recién registrado en el mismo milisegundo
    // (`…52.743061 <= …52.743` es falso): sin `ahora` explícito se compara con el reloj de la base.
    const hasta = opciones.ahora ? opciones.ahora : db.raw('clock_timestamp()')
    const candidatos = (await db
        .from('integraciones.horus_envios')
        .where('estado', 'pendiente')
        .if(opciones.soloId !== undefined, (q) => q.where('id', opciones.soloId!))
        .if(opciones.soloId === undefined, (q) => q.where('proximo_intento_en', '<=', hasta))
        .orderBy('proximo_intento_en')
        .orderBy('id')
        .limit(opciones.limite ?? 50)
        .select('id')) as Array<{ id: number }>
    if (candidatos.length === 0) return resultado

    const config = await configHorus()
    for (const { id } of candidatos) {
        const estado = await entregarUno(Number(id), config, ahora)
        if (estado === 'enviado') resultado.enviados++
        else if (estado === 'pendiente') resultado.reintentar++
        else if (estado === 'fallido') resultado.fallidos++
        else if (estado === 'descartado') resultado.descartados++
    }
    return resultado
}

async function entregarUno(id: number, config: ConfigHorus, ahora: Date): Promise<EstadoEnvio | null> {
    return db.transaction(async (trx) => {
        const envio = (await trx
            .from('integraciones.horus_envios')
            .where('id', id)
            .where('estado', 'pendiente')
            .forUpdate()
            .skipLocked()
            .select('id', 'evento_id', 'cuerpo', 'intentos')
            .first()) as { id: number; evento_id: string; cuerpo: string; intentos: number } | null
        if (!envio) return null

        if (!conectorListoParaEnviar(config)) {
            await trx
                .from('integraciones.horus_envios')
                .where('id', id)
                .update({
                    estado: 'descartado',
                    proximo_intento_en: null,
                    ultimo_error: 'Conector Horus apagado o sin receptor configurado',
                    updated_at: trx.knexRawQuery('now()'),
                })
            return 'descartado'
        }

        const intentos = envio.intentos + 1
        let status: number | null = null
        let error: string | null = null
        try {
            const respuesta = await fetchEnvios(config.webhookSalidaUrl!, {
                method: 'POST',
                headers: cabecerasFirmadas(config.webhookSalidaSecreto!, envio.evento_id, envio.cuerpo),
                body: envio.cuerpo,
                signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
                redirect: 'error',
            })
            status = respuesta.status
            if (!respuesta.ok) {
                const textoRespuesta = await respuesta.text().catch(() => '')
                const detalle = textoRespuesta.slice(0, 300)
                error = `HTTP ${respuesta.status}${detalle ? `: ${detalle}` : ''}`
            }
        } catch (fallo) {
            const causa = (fallo as { cause?: { code?: string } }).cause?.code
            error =
                (fallo as Error).name === 'TimeoutError'
                    ? `Sin respuesta en ${TIMEOUT_ENVIO_MS} ms`
                    : `Sin conexión: ${causa ?? (fallo as Error).message}`
        }

        let estado: EstadoEnvio
        const cambios: Record<string, unknown> = {
            intentos,
            ultimo_status: status,
            ultimo_error: error,
            updated_at: trx.knexRawQuery('now()'),
        }
        if (error === null) {
            estado = 'enviado'
            Object.assign(cambios, { estado, enviado_en: ahora, proximo_intento_en: null })
        } else if (intentos >= INTENTOS_MAXIMOS) {
            estado = 'fallido'
            Object.assign(cambios, { estado, proximo_intento_en: null })
            logger.warn(
                { envio_id: id, evento_id: envio.evento_id, error },
                'horus: webhook fallido tras todos los reintentos',
            )
        } else {
            estado = 'pendiente'
            const espera = REINTENTOS_S[intentos - 1]!
            cambios.proximo_intento_en = new Date(ahora.getTime() + espera * 1000)
        }
        await trx.from('integraciones.horus_envios').where('id', id).update(cambios)
        return estado
    })
}
