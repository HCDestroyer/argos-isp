import type { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import { enteroDeEntorno, prefijoRedisPortal, redisPortal } from '#portal/redis_portal'

/**
 * Ventana de auditoría de las consultas públicas del portal (`portal.quien_soy`, `portal.estado`).
 *
 * Cada visita a `/corte` (y cada consulta del estado en vivo, cada 5 s) escribía una fila en
 * `audit.acciones` y llenaba la línea de tiempo del cliente. Ahora la misma IP consultando el mismo
 * servicio con la misma acción se audita una sola vez por ventana; la consulta se sigue
 * respondiendo siempre. Una IP que pasa a otro servicio (o que deja de identificarse) se audita
 * de nuevo en el acto, porque cambia la clave.
 *
 * Marca en Redis con `SET NX PX`: `<prefijo>:portal:auditado:<accion>:<ip>:<servicio|ninguno>`.
 * Si Redis no responde, se audita (ante la duda, sobra un registro antes que faltar).
 *
 * - `PORTAL_AUDITORIA_VENTANA_S`: largo de la ventana en segundos (600 por defecto; `0` audita
 *   todas las consultas).
 */

export interface VentanaAuditoria {
    /** `true` si esta consulta es la primera de su ventana y debe auditarse. */
    reclamar(accion: string, ip: string, servicioId: number | null): Promise<boolean>
    /** Libera la marca (la auditoría falló): la siguiente consulta vuelve a intentarlo. */
    liberar(accion: string, ip: string, servicioId: number | null): Promise<void>
}

export function ventanaAuditoriaS(entorno: NodeJS.ProcessEnv = process.env): number {
    return enteroDeEntorno(entorno, 'PORTAL_AUDITORIA_VENTANA_S', 600, 0)
}

export class VentanaAuditoriaRedis implements VentanaAuditoria {
    constructor(private readonly redis: Redis) {}

    async reclamar(accion: string, ip: string, servicioId: number | null): Promise<boolean> {
        const ventanaS = ventanaAuditoriaS()
        if (ventanaS === 0) return true
        try {
            const marcada = await this.redis.set(
                clave(accion, ip, servicioId),
                '1',
                'PX',
                ventanaS * 1000,
                'NX',
            )
            return marcada === 'OK'
        } catch (error) {
            logger.warn({ err: error, accion }, 'No se pudo consultar la ventana de auditoría; se audita')
            return true
        }
    }

    async liberar(accion: string, ip: string, servicioId: number | null): Promise<void> {
        try {
            await this.redis.del(clave(accion, ip, servicioId))
        } catch (error) {
            logger.warn({ err: error, accion }, 'No se pudo liberar la marca de auditoría')
        }
    }
}

function clave(accion: string, ip: string, servicioId: number | null): string {
    return `${prefijoRedisPortal()}:portal:auditado:${accion}:${ip}:${servicioId ?? 'ninguno'}`
}

let compartida: VentanaAuditoria | undefined

export function ventanaAuditoria(): VentanaAuditoria {
    compartida ??= new VentanaAuditoriaRedis(redisPortal())
    return compartida
}
