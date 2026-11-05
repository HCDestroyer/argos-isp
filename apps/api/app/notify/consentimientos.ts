import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { configIris } from '#integraciones/iris/configuracion'
import { REINTENTOS_S } from '#integraciones/webhooks_salientes'
import { estadoConectorWhatsapp, type EstadoWhatsapp } from '#notify/whatsapp'
import { configPara } from '#notify/configuracion'

/**
 * Permisos de contacto por WhatsApp hacia Iris (contrato Iris 0.6.0 §6.4). La acción
 * `RegistrarConsentimientoWhatsapp` deja la marca en `notify.consentimientos_iris`; aquí se entrega
 * (`iris:worker`) y se lee (ficha del cliente).
 *
 * - `POST <iris>/api/v1/mensajeria/consentimientos` con `{ cliente_id, canal, estado, origen,
 *   ocurrido_en }`, el token del conector e `Idempotency-Key = argos:consentimiento:<cliente_id>:
 *   <canal>:<ocurrido_en>`. Mismos bytes en cada reintento.
 * - Con el conector apagado, sin URL o token, o con contrato < 0.6.0: sigue `pendiente` sin gastar
 *   intentos (sale al activarse, §6.4).
 * - `2xx` → `enviado`. Red, timeout, `429`, `5xx` y `409 idempotencia_en_curso` se reintentan a 1 min,
 *   5 min, 30 min, 2 h y 12 h (como los webhooks); después, `fallido`. Otro `4xx` → `fallido`.
 */

export function claveConsentimiento(clienteId: number, canal: string, ocurridoEn: string): string {
    return `argos:consentimiento:${clienteId}:${canal}:${ocurridoEn}`
}

export interface VistaConsentimiento {
    id: number
    cliente_id: number
    canal: 'whatsapp'
    estado: 'acepta' | 'baja'
    origen: 'argos_panel' | 'argos_portal'
    ocurrido_en: string
    idempotency_key: string
    /** `pendiente` (en la cola hacia Iris), `enviado` o `fallido` */
    entrega: 'pendiente' | 'enviado' | 'fallido'
    intentos: number
    ultimo_error: string | null
    enviado_en: string | null
}

interface FilaConsentimiento {
    id: number
    cliente_id: number
    canal: 'whatsapp'
    estado: 'acepta' | 'baja'
    origen: 'argos_panel' | 'argos_portal'
    ocurrido_en: Date
    idempotency_key: string
    entrega: 'pendiente' | 'enviado' | 'fallido'
    intentos: number
    ultimo_error: string | null
    enviado_en: Date | null
}

const COLUMNAS = [
    'id',
    'cliente_id',
    'canal',
    'estado',
    'origen',
    'ocurrido_en',
    'idempotency_key',
    'entrega',
    'intentos',
    'ultimo_error',
    'enviado_en',
]

function vista(f: FilaConsentimiento): VistaConsentimiento {
    return {
        id: Number(f.id),
        cliente_id: Number(f.cliente_id),
        canal: f.canal,
        estado: f.estado,
        origen: f.origen,
        ocurrido_en: new Date(f.ocurrido_en).toISOString(),
        idempotency_key: f.idempotency_key,
        entrega: f.entrega,
        intentos: Number(f.intentos),
        ultimo_error: f.ultimo_error,
        enviado_en: f.enviado_en ? new Date(f.enviado_en).toISOString() : null,
    }
}

export async function verConsentimiento(
    cliente: QueryClientContract,
    clave: string,
): Promise<VistaConsentimiento> {
    const fila = (await cliente
        .from('notify.consentimientos_iris')
        .where('idempotency_key', clave)
        .select(COLUMNAS)
        .firstOrFail()) as FilaConsentimiento
    return vista(fila)
}

/** Cuerpo exacto de `POST /mensajeria/consentimientos` (§6.4). */
export function cuerpoConsentimiento(
    f: Pick<VistaConsentimiento, 'cliente_id' | 'canal' | 'estado' | 'origen' | 'ocurrido_en'>,
) {
    return JSON.stringify({
        cliente_id: f.cliente_id,
        canal: f.canal,
        estado: f.estado,
        origen: f.origen,
        ocurrido_en: f.ocurrido_en,
    })
}

// ── Entrega ──────────────────────────────────────────────────────────────────────────────────

let fetchConsentimientos: typeof fetch = (...args) => fetch(...args)

/** `fetch` de la entrega (las pruebas lo reemplazan). */
export function fijarFetchConsentimientosIris(fn?: typeof fetch) {
    fetchConsentimientos = fn ?? ((...args) => fetch(...args))
}

export interface ResultadoEntregaConsentimientos {
    enviados: number
    reintentar: number
    fallidos: number
    /** el conector no permite enviar: quedan pendientes */
    en_espera: number
}

/** Entrega los consentimientos pendientes que tocan ahora (bucle de `node ace iris:worker`). */
export async function entregarConsentimientosIris(
    opciones: { limite?: number; ahora?: Date } = {},
): Promise<ResultadoEntregaConsentimientos> {
    const resultado: ResultadoEntregaConsentimientos = {
        enviados: 0,
        reintentar: 0,
        fallidos: 0,
        en_espera: 0,
    }
    const ahora = opciones.ahora ?? new Date()
    const pendientes = (await db
        .from('notify.consentimientos_iris')
        .where('entrega', 'pendiente')
        .where('proximo_intento_en', '<=', ahora)
        .orderBy('id')
        .limit(opciones.limite ?? 50)
        .select(COLUMNAS)) as FilaConsentimiento[]
    if (pendientes.length === 0) return resultado

    const conector = await estadoConectorWhatsapp()
    const config = await configIris()
    if (!conector.disponible || !config.urlBase || !config.token) {
        resultado.en_espera = pendientes.length
        return resultado
    }
    const url = `${config.urlBase.replace(/\/+$/, '')}/api/v1/mensajeria/consentimientos`

    for (const fila of pendientes) {
        const datos = vista(fila)
        // Toma la fila: otra réplica del worker no la manda a la vez
        const tomada = await db
            .from('notify.consentimientos_iris')
            .where('id', datos.id)
            .where('entrega', 'pendiente')
            .where('intentos', datos.intentos)
            .update({ intentos: datos.intentos + 1, updated_at: db.knexRawQuery('now()') })
        if (Number(tomada) === 0) continue
        const intento = datos.intentos + 1
        let status: number | null = null
        let error: string | null = null
        let reintentable = true
        try {
            const respuesta = await fetchConsentimientos(url, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${config.token}`,
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': datos.idempotency_key,
                },
                body: cuerpoConsentimiento(datos),
                signal: AbortSignal.timeout(10_000),
            })
            status = respuesta.status
            const crudo = await respuesta.text()
            if (!respuesta.ok) {
                error = `Iris ${status} ${crudo.slice(0, 500)}`
                reintentable =
                    status >= 500 || status === 429 || (status === 409 && /idempotencia_en_curso/.test(crudo))
            }
        } catch (e) {
            error = `Iris no respondió: ${e instanceof Error ? e.message : String(e)}`
        }

        if (!error) {
            await db
                .from('notify.consentimientos_iris')
                .where('id', datos.id)
                .update({
                    entrega: 'enviado',
                    ultimo_status: status,
                    ultimo_error: null,
                    enviado_en: db.knexRawQuery('now()'),
                    updated_at: db.knexRawQuery('now()'),
                })
            resultado.enviados++
            continue
        }
        const espera = REINTENTOS_S[intento - 1]
        const definitivo = !reintentable || espera === undefined
        await db
            .from('notify.consentimientos_iris')
            .where('id', datos.id)
            .update({
                entrega: definitivo ? 'fallido' : 'pendiente',
                ultimo_status: status,
                ultimo_error: error.slice(0, 2000),
                proximo_intento_en: definitivo
                    ? db.knexRawQuery('now()')
                    : new Date(ahora.getTime() + espera * 1000),
                updated_at: db.knexRawQuery('now()'),
            })
        if (definitivo) {
            resultado.fallidos++
            logger.warn({ consentimiento: datos.id, error }, 'iris: consentimiento no entregado')
        } else {
            resultado.reintentar++
        }
    }
    return resultado
}

// ── Lectura (ficha del cliente) ──────────────────────────────────────────────────────────────

export interface VistaWhatsappCliente {
    cliente_id: number
    /** el canal está encendido en la configuración que aplica y el conector lo permite */
    canal: { activo: boolean; disponible: boolean; motivo: string | null }
    /** último estado de contacto conocido en Argos: una baja de Iris o lo último que marcó Argos */
    contacto: { estado: 'acepta' | 'baja'; ocurrido_en: string; origen: string } | null
    /** última marca enviada (o por enviar) a Iris */
    ultimo_consentimiento: VistaConsentimiento | null
}

/** `GET /notificaciones/whatsapp/clientes/:id`. `empresaId`: la empresa activa (su configuración). */
export async function verWhatsappCliente(
    clienteId: number,
    empresaId: number | null,
): Promise<VistaWhatsappCliente> {
    const config = await configPara(empresaId)
    const conector: EstadoWhatsapp = await estadoConectorWhatsapp()
    const contacto = (await db
        .from('notify.contacto_iris')
        .where('cliente_id', clienteId)
        .where('canal', 'whatsapp')
        .select('estado', 'ocurrido_en', 'origen')
        .first()) as { estado: 'acepta' | 'baja'; ocurrido_en: Date; origen: string } | null
    const ultimo = (await db
        .from('notify.consentimientos_iris')
        .where('cliente_id', clienteId)
        .orderBy('id', 'desc')
        .select(COLUMNAS)
        .first()) as FilaConsentimiento | null
    return {
        cliente_id: clienteId,
        canal: {
            activo: config.whatsapp.activo,
            disponible: config.whatsapp.activo && conector.disponible,
            motivo: !config.whatsapp.activo
                ? 'WhatsApp apagado en la configuración de notificaciones'
                : conector.motivo,
        },
        contacto: contacto
            ? {
                  estado: contacto.estado,
                  ocurrido_en: new Date(contacto.ocurrido_en).toISOString(),
                  origen: contacto.origen,
              }
            : null,
        ultimo_consentimiento: ultimo ? vista(ultimo) : null,
    }
}
