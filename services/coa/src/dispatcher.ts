import type { Almacen, SesionActiva } from './almacen.ts'
import { descifrar } from './cifrado.ts'
import type { ModoSuspensionIpv6, PerfilSuspendido } from './config.ts'
import { decidir, EVENTOS_COA, leerDesconexion, leerEvento, type Decision } from './decision.ts'
import type { ClienteNas, Respuesta, TipoPaquete } from './nas.ts'
import type { MetricasCoa } from './metricas.ts'

/**
 * coa-dispatcher: por cada `servicio.estado_cambiado` / `servicio.config_cambiada` decide CoA o
 * Disconnect (`decision.ts`), lo manda a cada sesión abierta del servicio (`nas_ip` de la sesión,
 * secret del router) y registra cada intento en `audit.red`.
 *
 * - Reintentos: hasta `reintentos` más tras el primer envío, con backoff exponencial, solo ante
 *   timeout o error de red. Un NAK es respuesta definitiva del NAS (p. ej. sesión inexistente).
 * - Si no hay ACK (NAK, reintentos agotados, NAS sin secret), `coa.fallido` por outbox.
 * - Idempotente por `id` del evento: una sesión que ya terminó para ese evento no se vuelve a tocar
 *   (un evento duplicado no desconecta dos veces).
 * - Si falla Postgres, `procesar` lanza: el consumidor no hace XACK y el evento se reintenta.
 */

export interface EventoEntrante {
    id: number | string
    evento: string
    payload: Record<string, unknown>
    requestId?: string | null
}

export interface Log {
    info(obj: object, msg: string): void
    warn(obj: object, msg: string): void
    error(obj: object, msg: string): void
}

export interface OpcionesDispatcher {
    almacen: Almacen
    nas: ClienteNas
    claveSecretos: Buffer
    suspendido: PerfilSuspendido
    /** `COA_SUSPENDER_CON_IPV6` (ver `config.ts`); por defecto `coa` */
    suspenderConIpv6?: ModoSuspensionIpv6
    puertoNas: number
    timeoutMs: number
    reintentos: number
    /** espera base del backoff (ms): esperaMs, 2·esperaMs, 4·esperaMs… */
    esperaMs: number
    log: Log
    metricas?: MetricasCoa
}

export interface ResultadoSesion {
    sesion_id: number
    tipo: TipoPaquete
    resultado: Respuesta['resultado'] | 'sin_secret' | 'ya_procesado'
    intentos: number
}

export interface ResultadoProcesar {
    decision: Decision | null
    sesiones: ResultadoSesion[]
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

export class Dispatcher {
    readonly nombre = 'coa'
    readonly #op: OpcionesDispatcher

    constructor(opciones: OpcionesDispatcher) {
        this.#op = opciones
    }

    acepta(evento: string): boolean {
        return (EVENTOS_COA as readonly string[]).includes(evento)
    }

    async procesar(entrada: EventoEntrante): Promise<ResultadoProcesar> {
        if (entrada.evento === 'sesion.desconexion_solicitada') return this.#desconectar(entrada)
        const evento = leerEvento(entrada.evento, entrada.payload)
        if (!evento) return { decision: null, sesiones: [] }
        const eventoId = String(entrada.id)
        const { almacen, log } = this.#op

        const servicio = await almacen.servicio(evento.servicio_id)
        const decision = decidir(evento, servicio, this.#op.suspendido)
        if (decision.accion === 'nada') {
            log.info(
                {
                    evento_id: eventoId,
                    request_id: entrada.requestId ?? null,
                    servicio_id: evento.servicio_id,
                    razon: decision.razon,
                },
                'coa: nada que enviar',
            )
            return { decision, sesiones: [] }
        }

        const sesiones = await almacen.sesionesActivas(evento.servicio_id)
        if (sesiones.length === 0) {
            log.info(
                {
                    evento_id: eventoId,
                    request_id: entrada.requestId ?? null,
                    servicio_id: evento.servicio_id,
                },
                'coa: sin sesión activa',
            )
        }
        const resultados: ResultadoSesion[] = []
        for (const sesion of sesiones) {
            resultados.push(
                await this.#enviarASesion(
                    entrada,
                    eventoId,
                    evento.servicio_id,
                    sesion,
                    this.#paraSesion(decision, sesion),
                ),
            )
        }
        return { decision, sesiones: resultados }
    }

    /**
     * Ajuste por sesión: con `suspenderConIpv6 = disconnect`, una sesión con prefijo IPv6 se suspende
     * con Disconnect (al reconectar entra con el perfil `suspendido`, que sí mete el /64 y el /56 en la
     * address-list IPv6 y permite el redirect a `/corte`). Sin IPv6 sigue por CoA.
     */
    #paraSesion(
        decision: Exclude<Decision, { accion: 'nada' }>,
        sesion: SesionActiva,
    ): Exclude<Decision, { accion: 'nada' }> {
        if (
            decision.accion === 'coa' &&
            decision.suspender &&
            this.#op.suspenderConIpv6 === 'disconnect' &&
            (sesion.prefijo_enlace_v6 !== null || sesion.prefijo_delegado_v6 !== null)
        ) {
            return {
                accion: 'disconnect',
                razon: `${decision.razon} (sesión con IPv6: reconecta con el perfil suspendido)`,
            }
        }
        return decision
    }

    /**
     * Desconexión manual: un Disconnect-Request a la sesión del evento si sigue abierta. Si ya
     * terminó (el cliente se fue o la cortó otro evento) no hay nada que mandar.
     */
    async #desconectar(entrada: EventoEntrante): Promise<ResultadoProcesar> {
        const evento = leerDesconexion(entrada.payload)
        const eventoId = String(entrada.id)
        const sesion = await this.#op.almacen.sesionAbierta(evento.sesion_id)
        if (!sesion) {
            const decision: Decision = { accion: 'nada', razon: 'la sesión ya terminó' }
            this.#op.log.info(
                {
                    evento_id: eventoId,
                    request_id: entrada.requestId ?? null,
                    sesion_id: evento.sesion_id,
                    razon: decision.razon,
                },
                'coa: nada que enviar',
            )
            return { decision, sesiones: [] }
        }
        const decision: Decision = {
            accion: 'disconnect',
            razon: evento.motivo ? `manual: ${evento.motivo}` : 'manual',
        }
        const resultado = await this.#enviarASesion(entrada, eventoId, sesion.servicio_id, sesion, decision)
        return { decision, sesiones: [resultado] }
    }

    async #enviarASesion(
        entrada: EventoEntrante,
        eventoId: string,
        servicioId: number | null,
        sesion: SesionActiva,
        decision: Exclude<Decision, { accion: 'nada' }>,
    ): Promise<ResultadoSesion> {
        const { almacen, log } = this.#op
        const tipo: TipoPaquete = decision.accion
        if (await almacen.yaProcesado(eventoId, servicioId, sesion.id)) {
            return { sesion_id: sesion.id, tipo, resultado: 'ya_procesado', intentos: 0 }
        }

        const atributos: Record<string, string> = {
            'User-Name': sesion.user_ppp,
            'Acct-Session-Id': sesion.acct_session_id,
            ...(decision.accion === 'coa' ? decision.atributos : {}),
        }
        const comando = {
            evento_id: eventoId,
            evento: entrada.evento,
            razon: decision.razon,
            sesion_id: sesion.id,
            nas_ip: sesion.nas_ip,
            puerto: this.#op.puertoNas,
            atributos,
        }
        const fallar = (error: string) => ({
            payload: { servicio_id: servicioId, nas_ip: sesion.nas_ip, tipo, error },
            requestId: entrada.requestId ?? null,
        })

        let secret: string | null
        try {
            secret = sesion.radius_secret ? descifrar(sesion.radius_secret, this.#op.claveSecretos) : null
        } catch {
            secret = null
        }
        if (!secret) {
            const error =
                sesion.router_id === null
                    ? 'NAS no registrado en network.routers'
                    : 'router sin radius_secret válido'
            await almacen.registrar(
                {
                    tipo,
                    router_id: sesion.router_id,
                    servicio_id: servicioId,
                    comando: { ...comando, intento: 0 },
                    respuesta: { resultado: 'sin_secret', error, final: true },
                    ok: false,
                },
                fallar(error),
            )
            log.error(
                {
                    evento_id: eventoId,
                    request_id: entrada.requestId ?? null,
                    servicio_id: servicioId,
                    nas: sesion.nas_ip,
                    error,
                },
                'coa.fallido',
            )
            this.#op.metricas?.envio(tipo, 'sin_secret')
            return { sesion_id: sesion.id, tipo, resultado: 'sin_secret', intentos: 0 }
        }

        const maximo = 1 + Math.max(0, this.#op.reintentos)
        for (let intento = 1; ; intento++) {
            const r = await this.#op.nas.enviar({
                tipo,
                nasIp: sesion.nas_ip,
                puerto: this.#op.puertoNas,
                secret,
                atributos,
                timeoutMs: this.#op.timeoutMs,
            })
            const reintentable = r.resultado === 'timeout' || r.resultado === 'error'
            const final = !reintentable || intento >= maximo
            const respuesta = {
                resultado: r.resultado,
                codigo: r.codigo ?? null,
                atributos: r.atributos ?? null,
                error: r.error ?? null,
                rtt_ms: r.rttMs,
                final,
            }
            const fila = {
                tipo,
                router_id: sesion.router_id,
                servicio_id: servicioId,
                comando: { ...comando, intento },
                respuesta,
                ok: r.resultado === 'ack',
            }
            const descripcion = r.resultado === 'nak' ? describirNak(r) : r.resultado
            await almacen.registrar(fila, final && r.resultado !== 'ack' ? fallar(descripcion) : undefined)

            this.#op.metricas?.envio(tipo, r.resultado, r.rttMs)
            const contexto = {
                evento_id: eventoId,
                request_id: entrada.requestId ?? null,
                servicio_id: servicioId,
                nas: sesion.nas_ip,
                tipo,
                intento,
                rtt_ms: r.rttMs,
            }
            if (r.resultado === 'ack') {
                log.info(contexto, `coa: ${r.codigo}`)
                return { sesion_id: sesion.id, tipo, resultado: 'ack', intentos: intento }
            }
            if (final) {
                log.error({ ...contexto, resultado: descripcion }, 'coa.fallido')
                return { sesion_id: sesion.id, tipo, resultado: r.resultado, intentos: intento }
            }
            log.warn({ ...contexto, resultado: r.resultado }, 'coa: reintento')
            await dormir(this.#op.esperaMs * 2 ** (intento - 1))
        }
    }
}

function describirNak(r: Respuesta): string {
    const causa = r.atributos?.['Error-Cause']
    return causa ? `${r.codigo}: ${String(causa)}` : (r.codigo ?? 'nak')
}
