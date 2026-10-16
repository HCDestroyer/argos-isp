import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { bloquearOrigen } from '#notify/envios'
import {
    abrirIncidente,
    cerrarIncidente,
    crearAlerta,
    duracion,
    instanteLocal,
    type Incidente,
} from '#notify/alertas'
import { quetzales } from '#notify/formato'

/** Eventos del catálogo que generan alertas internas. */
export const EVENTOS_ALERTA = [
    'aaa.caido',
    'aaa.recuperado',
    'coa.fallido',
    'routeros.fallido',
    'caja.cerrada',
] as const
export type EventoAlerta = (typeof EVENTOS_ALERTA)[number]

/** Fallos de CoA del mismo router dentro de esta ventana son el mismo incidente. */
export const VENTANA_COA_MIN = 30

/** Fallos de la API REST del mismo router dentro de esta ventana son el mismo incidente. */
export const VENTANA_ROUTEROS_MIN = 30

export interface EntradaAlerta {
    /** `outbox:<id>` del evento: idempotencia por evento */
    origen: string
    evento: EventoAlerta
    payload: Record<string, unknown>
    /** instante ISO del procesamiento (por defecto, ahora); las pruebas lo fijan */
    ahora?: string
}

export interface ResultadoAlerta {
    /** el evento ya se había procesado */
    duplicado: boolean
    incidenteId: number | null
    /** se creó un envío al chat del equipo (no se avisa cuando el incidente ya estaba abierto) */
    alerta: boolean
    /** ids `encolado` que hay que poner en la cola */
    encolar: number[]
}

function texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor)
}

/**
 * `notificaciones.alertar`: convierte un evento interno en un incidente y, si es nuevo, en una
 * alerta al chat del equipo (`TELEGRAM_CHAT_EQUIPO`).
 *
 * | Evento | Incidente (`clave`) | Alerta |
 * | --- | --- | --- |
 * | `aaa.caido` | `aaa:<nodo>`, abierto hasta `aaa.recuperado` | al abrir |
 * | `aaa.recuperado` | cierra `aaa:<nodo>` | "resuelto", si había uno abierto |
 * | `coa.fallido` | `coa:<nas_ip>`, termina tras 30 min sin fallos | al abrir |
 * | `routeros.fallido` | `routeros:<router_id>`, termina tras 30 min sin fallos | al abrir |
 * | `caja.cerrada` con diferencia ≠ 0 | `caja:<caja_id>`, puntual | siempre |
 *
 * Idempotente por `origen`: un evento entregado dos veces no suma ni avisa otra vez (devuelve los
 * envíos de su incidente que sigan `encolado`, para reencolarlos; la cola deduplica).
 */
export default class RegistrarAlerta extends DomainAction<EntradaAlerta, ResultadoAlerta> {
    readonly nombre = 'notificaciones.alertar'

    protected async handle(input: EntradaAlerta, t: Transaccion): Promise<ResultadoAlerta> {
        const { trx } = t
        await bloquearOrigen(trx, input.origen)
        const previo = (await trx
            .from('notify.alertas_eventos')
            .where('origen', input.origen)
            .select('incidente_id')
            .first()) as { incidente_id: number | null } | null
        if (previo) {
            const pendientes = previo.incidente_id
                ? ((await trx
                      .from('notify.envios')
                      .whereLike('origen', `alerta:${previo.incidente_id}:%`)
                      .where('estado', 'encolado')
                      .select('id')) as Array<{ id: number }>)
                : []
            return {
                duplicado: true,
                incidenteId: previo.incidente_id,
                alerta: false,
                encolar: pendientes.map((e) => e.id),
            }
        }

        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        const resultado = await this.procesar(input, t, ahora)
        if (resultado.incidenteId) t.fijarEntidad('incidente', resultado.incidenteId)
        await trx.knexQuery().table('notify.alertas_eventos').insert({
            origen: input.origen,
            evento: input.evento,
            incidente_id: resultado.incidenteId,
        })
        return resultado
    }

    private async procesar(input: EntradaAlerta, t: Transaccion, ahora: DateTime): Promise<ResultadoAlerta> {
        const p = input.payload
        const sinAlerta = (incidente: Incidente | null): ResultadoAlerta => ({
            duplicado: false,
            incidenteId: incidente?.id ?? null,
            alerta: false,
            encolar: [],
        })
        const avisar = async (
            incidente: Incidente,
            fase: 'abierto' | 'cerrado',
            evento: string,
            alerta: Record<string, unknown>,
        ): Promise<ResultadoAlerta> => {
            const envio = await crearAlerta(t.trx, {
                incidente,
                fase,
                evento,
                alerta,
                requestId: t.ctx.requestId,
            })
            return {
                duplicado: false,
                incidenteId: incidente.id,
                alerta: Boolean(envio),
                encolar: envio?.estado === 'encolado' ? [envio.id] : [],
            }
        }

        switch (input.evento) {
            case 'aaa.caido': {
                const nodo = texto(p.nodo) || 'aaa'
                const desde = texto(p.desde) || ahora.toISO()!
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `aaa:${nodo}`,
                    tipo: 'aaa',
                    detalle: { nodo, desde, ultimo_error: texto(p.ultimo_error) || null },
                    ahora,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.aaa.caido', {
                    nodo,
                    desde: instanteLocal(desde),
                    ultimo_error: texto(p.ultimo_error),
                })
            }
            case 'aaa.recuperado': {
                const nodo = texto(p.nodo) || 'aaa'
                const incidente = await cerrarIncidente(t.trx, `aaa:${nodo}`, ahora)
                if (!incidente) return sinAlerta(null)
                const desdeIso = texto(incidente.detalle.desde) || texto(p.desde)
                const desde = desdeIso ? DateTime.fromISO(desdeIso).toJSDate() : incidente.abierto_en
                // `hasta` = primer health check bueno (contrato de A2); si no viene, el procesamiento
                const hastaDt = texto(p.hasta) ? DateTime.fromISO(texto(p.hasta)) : ahora
                const hasta = hastaDt.isValid ? hastaDt.toJSDate() : ahora.toJSDate()
                return avisar(incidente, 'cerrado', 'alerta.aaa.recuperado', {
                    nodo,
                    desde: instanteLocal(desde),
                    hasta: instanteLocal(hasta),
                    duracion: duracion(desde, hasta),
                    ultimo_error: texto(p.ultimo_error),
                })
            }
            case 'coa.fallido': {
                const nasIp = texto(p.nas_ip) || 'desconocido'
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `coa:${nasIp}`,
                    tipo: 'coa',
                    detalle: { nas_ip: nasIp, primer_servicio_id: p.servicio_id ?? null },
                    ahora,
                    ventanaMin: VENTANA_COA_MIN,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.coa.fallido', {
                    nas_ip: nasIp,
                    servicio_id: texto(p.servicio_id),
                    tipo: p.tipo === 'disconnect' ? 'Disconnect' : 'CoA',
                    error: texto(p.error),
                    ventana_min: VENTANA_COA_MIN,
                })
            }
            case 'routeros.fallido': {
                // contratos/routeros.md: { servicio_id, router_id, operacion, error } tras 3 reintentos
                const routerId = texto(p.router_id) || 'desconocido'
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `routeros:${routerId}`,
                    tipo: 'routeros',
                    detalle: {
                        router_id: p.router_id ?? null,
                        primer_servicio_id: p.servicio_id ?? null,
                        operacion: texto(p.operacion) || null,
                    },
                    ahora,
                    ventanaMin: VENTANA_ROUTEROS_MIN,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.routeros.fallido', {
                    router_id: routerId,
                    router: await nombreRouter(t, p.router_id),
                    servicio_id: texto(p.servicio_id),
                    operacion: texto(p.operacion),
                    error: texto(p.error),
                    ventana_min: VENTANA_ROUTEROS_MIN,
                })
            }
            case 'caja.cerrada': {
                const diferencia = new Decimal(texto(p.diferencia) || '0')
                if (diferencia.isZero()) return sinAlerta(null)
                const { incidente } = await abrirIncidente(t.trx, {
                    clave: `caja:${texto(p.caja_id)}`,
                    tipo: 'caja',
                    detalle: { caja_id: p.caja_id, diferencia: diferencia.toFixed(2) },
                    ahora,
                    puntual: true,
                })
                return avisar(incidente, 'abierto', 'alerta.caja.diferencia', {
                    caja_id: texto(p.caja_id),
                    cajero_id: texto(p.cajero_id),
                    esperado_q: quetzales(texto(p.esperado) || '0'),
                    contado_q: quetzales(texto(p.contado) || '0'),
                    diferencia_q: quetzales(diferencia),
                    // faltante = se contó menos de lo esperado (no depende del signo de `diferencia`)
                    faltante:
                        p.contado !== undefined && p.esperado !== undefined
                            ? new Decimal(texto(p.contado)).lessThan(texto(p.esperado))
                            : diferencia.isNegative(),
                })
            }
        }
    }
}

/** "Torre Norte (10.0.0.1)" o, si no existe, "#<id>". Solo para el texto de la alerta. */
async function nombreRouter(t: Transaccion, routerId: unknown): Promise<string> {
    const id = Number(routerId)
    if (!Number.isInteger(id) || id <= 0) return `#${texto(routerId) || '?'}`
    const fila = (await t.trx.from('network.routers').where('id', id).select('nombre', 'host').first()) as {
        nombre: string
        host: string | null
    } | null
    if (!fila) return `#${id}`
    return fila.host ? `${fila.nombre} (${fila.host})` : fila.nombre
}
