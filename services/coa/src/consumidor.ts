import type { Redis } from 'ioredis'
import { EventoInvalido } from './decision.ts'
import type { EventoEntrante, Log } from './dispatcher.ts'

/**
 * Consumidor del bus de eventos (`.claude/integration/contratos/eventos.md`): grupo `coa` sobre el
 * stream `argos:eventos` con `XREADGROUP` + `XACK`.
 *
 * - Al arrancar crea el grupo si no existe (`XGROUP CREATE … MKSTREAM`) y relee sus pendientes
 *   (entradas entregadas a este consumidor y nunca confirmadas, p. ej. si el proceso cayó).
 * - Cada `reclamarTrasMs` reclama con `XAUTOCLAIM` las pendientes de cualquier consumidor que
 *   lleven ese tiempo sin confirmar (un `procesar` que lanzó, otro nodo caído).
 * - Una entrada se confirma cuando `procesar` termina bien, o si el evento no es para `coa` o su
 *   payload es ilegible (no tiene arreglo reintentarlo). Si `procesar` lanza, no se confirma.
 * - Dentro de un lote, los eventos del mismo servicio van en orden y los de servicios distintos en
 *   paralelo (un NAS que no responde no frena a los demás).
 */

export interface Procesador {
    acepta(evento: string): boolean
    procesar(evento: EventoEntrante): Promise<unknown>
}

export interface OpcionesConsumidor {
    redis: Redis
    stream: string
    grupo: string
    consumidor: string
    grupoInicio?: string
    reclamarTrasMs?: number
    bloqueoMs?: number
    lote?: number
    procesador: Procesador
    log: Log
}

type Entrada = [id: string, campos: string[]]

function campos(lista: string[]): Record<string, string> {
    const salida: Record<string, string> = {}
    for (let i = 0; i + 1 < lista.length; i += 2) salida[lista[i]!] = lista[i + 1]!
    return salida
}

export class ConsumidorStream {
    readonly #op: Required<Omit<OpcionesConsumidor, 'redis' | 'procesador' | 'log'>> & OpcionesConsumidor
    #activo = false
    #bucle: Promise<void> | null = null
    #ultimoReclamo = 0
    /** Última vez que el bucle leyó del stream (para /health). */
    ultimaLectura: Date | null = null

    constructor(opciones: OpcionesConsumidor) {
        this.#op = {
            grupoInicio: '$',
            reclamarTrasMs: 60_000,
            bloqueoMs: 5000,
            lote: 20,
            ...opciones,
        }
    }

    async asegurarGrupo(): Promise<void> {
        const { redis, stream, grupo, grupoInicio } = this.#op
        try {
            await redis.xgroup('CREATE', stream, grupo, grupoInicio, 'MKSTREAM')
        } catch (e) {
            if (!String((e as Error).message).includes('BUSYGROUP')) throw e
        }
    }

    iniciar(): void {
        if (this.#activo) return
        this.#activo = true
        this.#bucle = this.#correr()
    }

    async detener(): Promise<void> {
        this.#activo = false
        await this.#bucle
    }

    get activo(): boolean {
        return this.#activo
    }

    async #correr(): Promise<void> {
        const { log } = this.#op
        let espera = 500
        let pendientesDesde: string | null = '0'
        while (this.#activo) {
            try {
                await this.asegurarGrupo()
                if (pendientesDesde !== null) {
                    // Pendientes propias (entregadas a este consumidor y nunca confirmadas, p. ej. si el
                    // proceso cayó): se recorren una vez por páginas. Las que vuelvan a fallar las
                    // recoge XAUTOCLAIM más tarde.
                    const propias = await this.#leer(pendientesDesde)
                    if (propias.length === 0) pendientesDesde = null
                    else {
                        await this.procesarLote(propias)
                        pendientesDesde = propias[propias.length - 1]![0]
                    }
                    continue
                }
                await this.reclamar()
                const nuevas = await this.#leer('>')
                if (nuevas.length > 0) await this.procesarLote(nuevas)
                espera = 500
            } catch (e) {
                if (!this.#activo) break
                log.error({ error: (e as Error).message }, 'coa: error leyendo el stream')
                await new Promise((r) => setTimeout(r, espera))
                espera = Math.min(espera * 2, 10_000)
            }
        }
    }

    async #leer(desde: string): Promise<Entrada[]> {
        const { redis, stream, grupo, consumidor, lote, bloqueoMs } = this.#op
        const respuesta = (
            desde === '>'
                ? await redis.xreadgroup(
                      'GROUP',
                      grupo,
                      consumidor,
                      'COUNT',
                      lote,
                      'BLOCK',
                      bloqueoMs,
                      'STREAMS',
                      stream,
                      desde,
                  )
                : await redis.xreadgroup('GROUP', grupo, consumidor, 'COUNT', lote, 'STREAMS', stream, desde)
        ) as Array<[string, Entrada[]]> | null
        this.ultimaLectura = new Date()
        return respuesta?.[0]?.[1] ?? []
    }

    /** XAUTOCLAIM de entradas ajenas o propias que llevan `reclamarTrasMs` sin confirmar. */
    async reclamar(forzar = false): Promise<void> {
        const { redis, stream, grupo, consumidor, reclamarTrasMs, lote } = this.#op
        if (!forzar && Date.now() - this.#ultimoReclamo < Math.min(reclamarTrasMs, 10_000)) return
        this.#ultimoReclamo = Date.now()
        let cursor = '0-0'
        do {
            const [siguiente, entradas] = (await redis.xautoclaim(
                stream,
                grupo,
                consumidor,
                reclamarTrasMs,
                cursor,
                'COUNT',
                lote,
            )) as [string, Array<Entrada | null>, string[]?]
            const validas = entradas.filter((e): e is Entrada => Array.isArray(e) && Array.isArray(e[1]))
            if (validas.length > 0) await this.procesarLote(validas)
            cursor = siguiente
        } while (cursor !== '0-0' && this.#activo)
    }

    /** Procesa un lote: en orden por servicio, en paralelo entre servicios. */
    async procesarLote(entradas: Entrada[]): Promise<void> {
        const grupos = new Map<string, Entrada[]>()
        for (const entrada of entradas) {
            const datos = campos(entrada[1])
            let clave = `sin-servicio:${entrada[0]}`
            try {
                const servicio = (JSON.parse(datos.payload ?? '{}') as { servicio_id?: unknown }).servicio_id
                if (servicio !== undefined) clave = `servicio:${String(servicio)}`
            } catch {
                // payload ilegible: va solo y se confirma en procesarEntrada
            }
            const lista = grupos.get(clave) ?? []
            lista.push(entrada)
            grupos.set(clave, lista)
        }
        await Promise.all(
            [...grupos.values()].map(async (lista) => {
                for (const entrada of lista) {
                    // Si una entrada del servicio falla, las siguientes del mismo servicio esperan al
                    // reclamo para no adelantarse a ella.
                    if (!(await this.procesarEntrada(entrada))) break
                }
            }),
        )
    }

    /** Devuelve true si la entrada quedó confirmada. */
    async procesarEntrada([idStream, lista]: Entrada): Promise<boolean> {
        const { redis, stream, grupo, procesador, log } = this.#op
        const datos = campos(lista)
        const nombre = datos.evento ?? ''
        if (!procesador.acepta(nombre)) {
            await redis.xack(stream, grupo, idStream)
            return true
        }
        let payload: Record<string, unknown>
        try {
            payload = JSON.parse(datos.payload ?? '') as Record<string, unknown>
        } catch {
            log.error(
                { stream_id: idStream, id: datos.id, evento: nombre },
                'coa: payload ilegible, se descarta',
            )
            await redis.xack(stream, grupo, idStream)
            return true
        }
        try {
            await procesador.procesar({
                id: datos.id ?? idStream,
                evento: nombre,
                payload,
                requestId: datos.request_id || null,
            })
        } catch (e) {
            const mensaje = (e as Error).message
            // Payload que no cumple el contrato: reintentarlo no lo arregla.
            if (e instanceof EventoInvalido) {
                log.error(
                    { stream_id: idStream, id: datos.id, evento: nombre, error: mensaje },
                    'coa: evento inválido, se descarta',
                )
                await redis.xack(stream, grupo, idStream)
                return true
            }
            log.error(
                { stream_id: idStream, id: datos.id, evento: nombre, error: mensaje },
                'coa: se reintentará',
            )
            return false
        }
        await redis.xack(stream, grupo, idStream)
        return true
    }
}
