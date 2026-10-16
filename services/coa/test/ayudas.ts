import { randomBytes } from 'node:crypto'
import type { Almacen, CoaFallido, FilaRed, SesionActiva, SesionPorId } from '../src/almacen.ts'
import { cifrar } from '../src/cifrado.ts'
import type { ServicioActual } from '../src/decision.ts'
import type { Log } from '../src/dispatcher.ts'

export const CLAVE = randomBytes(32)
export const SECRET = 'secreto-del-router'

export const SUSPENDIDO = { rateLimit: '256k/256k', addressList: 'suspendidos', filterId: 'argos-corte.in' }

export const silencio: Log = { info: () => {}, warn: () => {}, error: () => {} }

export function servicio(parcial: Partial<ServicioActual> = {}): ServicioActual {
    return {
        servicio_id: 101,
        estado: 'activo',
        subida_kbps: 5120,
        bajada_kbps: 20480,
        subida_limitada_kbps: 1024,
        bajada_limitada_kbps: 2048,
        rate_limit_override: null,
        ...parcial,
    }
}

export function sesion(parcial: Partial<SesionActiva> = {}): SesionActiva {
    return {
        id: 1,
        nas_ip: '127.0.0.1',
        acct_session_id: '81a00003',
        user_ppp: 'cliente-101',
        router_id: 1,
        radius_secret: cifrar(SECRET, CLAVE),
        ...parcial,
    }
}

/** `audit.red` y `audit.outbox` en memoria. */
export class AlmacenMemoria implements Almacen {
    servicios = new Map<number, ServicioActual>()
    sesiones = new Map<number, SesionActiva[]>()
    /** sesiones abiertas por id (desconexión manual) */
    abiertas = new Map<number, SesionPorId>()
    readonly red: FilaRed[] = []
    readonly outbox: Array<{ payload: CoaFallido; requestId: string | null }> = []

    async servicio(id: number) {
        return this.servicios.get(id) ?? null
    }

    async sesionesActivas(id: number) {
        return this.sesiones.get(id) ?? []
    }

    async sesionAbierta(id: number) {
        return this.abiertas.get(id) ?? null
    }

    async yaProcesado(eventoId: string, servicioId: number | null, sesionId: number) {
        return this.red.some(
            (f) =>
                f.servicio_id === servicioId &&
                f.comando.evento_id === eventoId &&
                f.comando.sesion_id === sesionId &&
                (f.ok || f.respuesta.final === true),
        )
    }

    async registrar(fila: FilaRed, fallido?: { payload: CoaFallido; requestId: string | null }) {
        this.red.push(fila)
        if (fallido) this.outbox.push(fallido)
    }
}
