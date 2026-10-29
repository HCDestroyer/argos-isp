import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { cabecerasFirmadas } from '#integraciones/horus/firma'

/**
 * Motor de webhooks firmados Argos → otro sistema (A6). Lo comparten el conector Horus
 * (`contratos/horus.md` §1.3) y el conector Iris (`contratos/iris.md` §1.3 y §2.3): mismas
 * cabeceras (`X-Webhook-Id`, `X-Webhook-Timestamp`, `X-Webhook-Signature: v1=…`), mismo cuerpo
 * `{ id, evento, ocurrido_en, payload }` y mismos reintentos. Cada sistema tiene su tabla de envíos
 * (`integraciones.<sistema>_envios`, mismas columnas) y su destino.
 *
 * - `insertarEnvio`: un envío por evento del outbox (`evento_id` único = `argos-evt-<id>`, estable
 *   entre reintentos: el receptor deduplica). El cuerpo se guarda tal cual se va a firmar.
 * - `entregarPendientesDe`: manda lo que toca, firmado en el momento del envío. 2xx → `enviado`.
 *   Cualquier otra cosa → reintento a 1 min, 5 min, 30 min, 2 h y 12 h; tras el último, `fallido`
 *   (con `ultimo_error`, visible en el panel, y un aviso en el log). Sin destino → `descartado`.
 * - Es infraestructura del bus, como el relay: no escribe `audit.acciones` por envío (la tabla de
 *   envíos es su bitácora) ni cambia datos de Argos.
 */

/** Esperas antes de cada reintento (contratos Horus e Iris §1.3): 1 min, 5 min, 30 min, 2 h, 12 h. */
export const REINTENTOS_S = [60, 300, 1800, 7200, 43200] as const
/** Intentos totales: el primero más los cinco reintentos. */
export const INTENTOS_MAXIMOS = REINTENTOS_S.length + 1
export const TIMEOUT_ENVIO_MS = 5000

export type EstadoEnvio = 'pendiente' | 'enviado' | 'fallido' | 'descartado'

export interface ResultadoEntrega {
    enviados: number
    reintentar: number
    fallidos: number
    descartados: number
}

export interface DestinoWebhook {
    url: string
    secreto: string
}

/** Un sistema que recibe webhooks de Argos. */
export interface CanalWebhooks {
    /** `horus`, `iris` (logs) */
    sistema: string
    /** tabla de envíos (`integraciones.horus_envios`) */
    tabla: string
    /** destino vigente; null = conector apagado o sin receptor (los pendientes se descartan) */
    destino: () => Promise<DestinoWebhook | null>
    /** `ultimo_error` de un envío descartado */
    motivoDescarte: string
    /** `fetch` para los envíos (las pruebas lo reemplazan) */
    fetch: () => typeof fetch
}

/** Id estable del webhook de un evento del outbox. */
export function idWebhook(outboxId: number | string): string {
    return `argos-evt-${outboxId}`
}

/** Instante del evento: `created_at` de su fila en `audit.outbox` (o ahora). */
export async function instanteDelEvento(outboxId: number | string): Promise<string> {
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

/**
 * Registra el webhook de un evento del bus en `tabla`. Idempotente por id del outbox (un evento
 * entregado dos veces por el bus no crea dos envíos). Devuelve el id del envío o null si ya existía.
 */
export async function insertarEnvio(
    tabla: string,
    datos: {
        outboxId: number | string
        evento: string
        empresaId: number | null
        payload: Record<string, unknown>
    },
): Promise<number | null> {
    const id = idWebhook(datos.outboxId)
    const cuerpo = JSON.stringify({
        id,
        evento: datos.evento,
        ocurrido_en: await instanteDelEvento(datos.outboxId),
        payload: datos.payload,
    })
    const filas = (await db.rawQuery(
        `INSERT INTO ${tabla} (evento_id, evento, empresa_id, cuerpo, proximo_intento_en)
         VALUES (?, ?, ?, ?, now())
         ON CONFLICT (evento_id) DO NOTHING
         RETURNING id`,
        [id, datos.evento, datos.empresaId, cuerpo],
    )) as { rows: Array<{ id: number }> }
    return filas.rows[0]?.id ?? null
}

/**
 * Entrega los envíos pendientes cuyo `proximo_intento_en` ya llegó (o el de `soloId`). Cada uno
 * en su transacción con `FOR UPDATE SKIP LOCKED`: varios workers no mandan el mismo envío.
 */
export async function entregarPendientesDe(
    canal: CanalWebhooks,
    opciones: { limite?: number; ahora?: Date; soloId?: number } = {},
): Promise<ResultadoEntrega> {
    const resultado: ResultadoEntrega = { enviados: 0, reintentar: 0, fallidos: 0, descartados: 0 }
    const ahora = opciones.ahora ?? new Date()
    // `proximo_intento_en` lo fija Postgres (`now()`, microsegundos). Compararlo con un `Date` de
    // Node (milisegundos, truncado) deja fuera un envío recién registrado en el mismo milisegundo
    // (`…52.743061 <= …52.743` es falso): sin `ahora` explícito se compara con el reloj de la base.
    const candidatos = (await db
        .from(canal.tabla)
        .where('estado', 'pendiente')
        .if(opciones.soloId !== undefined, (q) => q.where('id', opciones.soloId!))
        // Con `ahora` explícito (milisegundos) se trunca la hora de la base a milisegundos para que
        // un envío registrado en ese mismo milisegundo sí entre.
        .if(opciones.soloId === undefined, (q) =>
            opciones.ahora
                ? q.whereRaw(`date_trunc('milliseconds', proximo_intento_en) <= ?`, [opciones.ahora])
                : q.where('proximo_intento_en', '<=', db.raw('clock_timestamp()')),
        )
        .orderBy('proximo_intento_en')
        .orderBy('id')
        .limit(opciones.limite ?? 50)
        .select('id')) as Array<{ id: number }>
    if (candidatos.length === 0) return resultado

    const destino = await canal.destino()
    for (const { id } of candidatos) {
        const estado = await entregarUno(canal, Number(id), destino, ahora)
        if (estado === 'enviado') resultado.enviados++
        else if (estado === 'pendiente') resultado.reintentar++
        else if (estado === 'fallido') resultado.fallidos++
        else if (estado === 'descartado') resultado.descartados++
    }
    return resultado
}

async function entregarUno(
    canal: CanalWebhooks,
    id: number,
    destino: DestinoWebhook | null,
    ahora: Date,
): Promise<EstadoEnvio | null> {
    return db.transaction(async (trx) => {
        const envio = (await trx
            .from(canal.tabla)
            .where('id', id)
            .where('estado', 'pendiente')
            .forUpdate()
            .skipLocked()
            .select('id', 'evento_id', 'cuerpo', 'intentos')
            .first()) as { id: number; evento_id: string; cuerpo: string; intentos: number } | null
        if (!envio) return null

        if (!destino) {
            await trx
                .from(canal.tabla)
                .where('id', id)
                .update({
                    estado: 'descartado',
                    proximo_intento_en: null,
                    ultimo_error: canal.motivoDescarte,
                    updated_at: trx.knexRawQuery('now()'),
                })
            return 'descartado'
        }

        const intentos = envio.intentos + 1
        let status: number | null = null
        let error: string | null = null
        try {
            const respuesta = await canal.fetch()(destino.url, {
                method: 'POST',
                headers: cabecerasFirmadas(destino.secreto, envio.evento_id, envio.cuerpo),
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
                `${canal.sistema}: webhook fallido tras todos los reintentos`,
            )
        } else {
            estado = 'pendiente'
            const espera = REINTENTOS_S[intentos - 1]!
            cambios.proximo_intento_en = new Date(ahora.getTime() + espera * 1000)
        }
        await trx.from(canal.tabla).where('id', id).update(cambios)
        return estado
    })
}
