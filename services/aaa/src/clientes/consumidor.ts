import type { Redis } from 'ioredis'
import { huboCambio, type ResultadoGeneracion } from './generar.ts'
import type { ResultadoAviso } from './recarga.ts'
import type { CriterioBaja, ResultadoBaja } from '../bajas.ts'

/**
 * Clientes de FreeRADIUS por evento (`contratos/conexion-routers.md` §6.4): cuando un router se
 * registra por el túnel WireGuard su `nas_ip` pasa a ser la IP del túnel, y FreeRADIUS tiene que
 * conocerla para aceptar sus paquetes.
 *
 * - Grupo propio por nodo `aaa` (`AAA_CLIENTES_GRUPO`, por defecto `radius-clientes:<nodo>`) sobre
 *   `argos:eventos`: cada nodo tiene su FreeRADIUS y su `clients.d`. Se crea en `$`; lo anterior lo
 *   cubre la regeneración al arrancar.
 * - `router.conexion_registrada`, `router.conexion_rotada`, `router.conexion_eliminada` y
 *   `router.radius_cambiado` (A1: `nas_ip` o `radius_secret` al crear o editar un router): regenera **todos** los clientes desde `network.routers` (como `pnpm aaa:clients`). Así un evento
 *   repetido, perdido o fuera de orden no deja clientes de más ni de menos.
 * - Si cambió algún archivo, avisa a FreeRADIUS por el FIFO (`recarga.ts`, `freeradius/recargar.sh`).
 *   Una rotación que no cambia `nas_ip` ni secret no reinicia nada.
 * - Un lote con varios eventos regenera una sola vez. Se confirma (XACK) después de regenerar; si
 *   falla (Postgres caído), no se confirma y se reintenta con espera creciente.
 * - Bajas definitivas (`contratos/eliminar.md`): `router.eliminado` regenera igual (el router ya no
 *   está en `network.routers`, así que su `router-<id>.conf` se borra y FreeRADIUS se recarga) y,
 *   con `bajas`, deja como lápida las claves `aaa:user:*` con ese `router_id`. `servicio.eliminado`
 *   (con `bajas`) deja como lápida la clave del servicio si A1 no alcanzó a escribirla y olvida el
 *   servicio del último perfil conocido de este nodo (`bajas.ts`). Las dos son idempotentes.
 * - Sin TTL ni sondeo: solo eventos y el arranque.
 */

export const EVENTOS_CLIENTES = [
    'router.conexion_registrada',
    'router.conexion_rotada',
    'router.conexion_eliminada',
    // A1, al crear o editar un router con cambios en `nas_ip` o `radius_secret`
    'router.radius_cambiado',
    // A1, al eliminar un router sin historial (`contratos/eliminar.md`)
    'router.eliminado',
] as const

/** Bajas definitivas que invalidan la autorización en caché (`bajas.ts`). */
export const EVENTOS_BAJA = ['servicio.eliminado', 'router.eliminado'] as const

export interface LogClientes {
    info(obj: object, msg: string): void
    warn(obj: object, msg: string): void
    error(obj: object, msg: string): void
}

export interface OpcionesConsumidorClientes {
    redis: Redis
    stream: string
    grupo: string
    consumidor: string
    /** Lee `network.routers` y escribe `clients.d` (`leerRouters` + `escribirClientes`). */
    regenerar: () => Promise<ResultadoGeneracion>
    /** Avisa a FreeRADIUS que relea los clientes. */
    recargar: (motivo: string) => Promise<ResultadoAviso>
    /** Invalida la autorización en caché de un servicio o router eliminado (`aplicarBaja`). */
    bajas?: (criterio: CriterioBaja) => Promise<ResultadoBaja>
    log: LogClientes
    bloqueoMs?: number
    lote?: number
}

type Entrada = [id: string, campos: string[]]

function campo(campos: string[], nombre: string): string {
    for (let i = 0; i + 1 < campos.length; i += 2) if (campos[i] === nombre) return campos[i + 1] ?? ''
    return ''
}

function evento(campos: string[]): string {
    return campo(campos, 'evento')
}

/** Id entero > 0 del payload, o null si falta o no es válido (el evento se confirma sin efecto). */
function idPayload(campos: string[], nombre: string): number | null {
    try {
        const payload = JSON.parse(campo(campos, 'payload') || '{}') as Record<string, unknown>
        const id = Number(payload?.[nombre])
        return Number.isInteger(id) && id > 0 ? id : null
    } catch {
        return null
    }
}

export class ConsumidorClientes {
    readonly #op: Required<Omit<OpcionesConsumidorClientes, 'bajas'>>
    #activo = false
    #bucle: Promise<void> | null = null

    readonly #bajas: OpcionesConsumidorClientes['bajas']

    constructor(opciones: OpcionesConsumidorClientes) {
        const { bajas, ...resto } = opciones
        this.#op = { bloqueoMs: 5000, lote: 50, ...resto }
        this.#bajas = bajas
    }

    async asegurarGrupo(): Promise<void> {
        const { redis, stream, grupo } = this.#op
        try {
            await redis.xgroup('CREATE', stream, grupo, '$', 'MKSTREAM')
        } catch (e) {
            if (!String((e as Error).message).includes('BUSYGROUP')) throw e
        }
    }

    /** Regenera y, si cambió algo, avisa a FreeRADIUS. */
    async aplicar(motivo: string): Promise<ResultadoGeneracion> {
        const { regenerar, recargar, log } = this.#op
        const r = await regenerar()
        for (const o of r.errores)
            log.error({ router_id: o.id, motivo: o.motivo }, 'clientes RADIUS: router con error')
        if (huboCambio(r)) {
            const aviso = await recargar(motivo)
            log.info(
                { motivo, escritos: r.escritos, borrados: r.borrados, recarga: aviso },
                aviso === 'avisado'
                    ? 'clientes RADIUS regenerados; FreeRADIUS se recarga'
                    : 'clientes RADIUS regenerados; FreeRADIUS sin recargar.sh (los lee al arrancar)',
            )
        }
        return r
    }

    /**
     * Procesa un lote: si trae algún evento de conexión, regenera una vez; luego confirma todo.
     * Devuelve los eventos aplicados (para las pruebas).
     */
    async procesarLote(entradas: Entrada[]): Promise<string[]> {
        const { redis, stream, grupo } = this.#op
        const aplicados = entradas
            .map(([, campos]) => evento(campos))
            .filter((e) => (EVENTOS_CLIENTES as readonly string[]).includes(e))
        if (aplicados.length > 0) await this.aplicar([...new Set(aplicados)].join(','))
        if (this.#bajas) {
            for (const [id, campos] of entradas) {
                const e = evento(campos)
                if (!(EVENTOS_BAJA as readonly string[]).includes(e)) continue
                const n = idPayload(campos, e === 'servicio.eliminado' ? 'servicio_id' : 'router_id')
                if (n === null) {
                    this.#op.log.warn({ evento: e, stream_id: id }, 'baja sin id válido; se ignora')
                    continue
                }
                const criterio: CriterioBaja = e === 'servicio.eliminado' ? { servicioId: n } : { routerId: n }
                const r = await this.#bajas(criterio)
                if (!aplicados.includes(e)) aplicados.push(e)
                if (r.lapidas.length > 0 || r.olvidados > 0)
                    this.#op.log.info({ evento: e, ...criterio, ...r }, 'autorización en caché invalidada')
            }
        }
        if (entradas.length > 0) await redis.xack(stream, grupo, ...entradas.map(([id]) => id))
        return aplicados
    }

    /** Arranque: grupo, regeneración completa, pendientes propias y después lo nuevo. */
    async iniciar(): Promise<void> {
        if (this.#activo) return
        this.#activo = true
        this.#bucle = this.#correr()
    }

    async detener(): Promise<void> {
        this.#activo = false
        await this.#bucle
    }

    async #leer(desde: string): Promise<Entrada[]> {
        const { redis, stream, grupo, consumidor, lote, bloqueoMs } = this.#op
        const r = (
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
                      '>',
                  )
                : await redis.xreadgroup('GROUP', grupo, consumidor, 'COUNT', lote, 'STREAMS', stream, desde)
        ) as Array<[string, Entrada[]]> | null
        return r?.[0]?.[1] ?? []
    }

    async #correr(): Promise<void> {
        const { log } = this.#op
        let espera = 500
        let arrancado = false
        let pendientesDesde: string | null = '0'
        while (this.#activo) {
            try {
                await this.asegurarGrupo()
                if (!arrancado) {
                    await this.aplicar('arranque')
                    arrancado = true
                }
                if (pendientesDesde !== null) {
                    const propias = await this.#leer(pendientesDesde)
                    if (propias.length === 0) pendientesDesde = null
                    else {
                        await this.procesarLote(propias)
                        pendientesDesde = propias[propias.length - 1]![0]
                    }
                    continue
                }
                await this.procesarLote(await this.#leer('>'))
                espera = 500
            } catch (e) {
                if (!this.#activo) break
                log.error({ error: (e as Error).message }, 'clientes RADIUS: error; se reintenta')
                // Lo leído y no confirmado se relee como pendiente propia.
                pendientesDesde = '0'
                await new Promise((r) => setTimeout(r, espera))
                espera = Math.min(espera * 2, 10_000)
            }
        }
    }
}
