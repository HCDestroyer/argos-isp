import { DomainAction, type Transaccion } from '#shared/domain_action'
import { auditableConexion, filaConexion } from '#network/conexion/consultas'

export interface EntradaHandshakes {
    peers: Array<{ public_key: string; ultimo_handshake: Date | string | null }>
}

export interface ResultadoHandshakes {
    actualizados: number
    /** routers que pasaron de `pendiente` a `conectado` */
    conectados: number[]
}

/**
 * `routers.registrar_handshakes`: el servicio `wireguard` (A6) informa el último handshake de cada
 * peer (`wg show wg-argos latest-handshakes`) por `POST /internal/routers/conexion/handshakes`.
 *
 * - `ultimo_handshake` es telemetría: solo avanza (un informe atrasado no lo retrocede) y no se audita
 *   por fila, igual que el contacto de los routers.
 * - El primer handshake de un router `pendiente` lo pasa a `conectado`: ese cambio sí queda en
 *   `audit.cambios`, y la acción solo deja fila en `audit.acciones` si conectó a alguno (como
 *   `sesiones.cerrar_colgadas`). Una clave que no está registrada se ignora.
 */
export default class RegistrarHandshakes extends DomainAction<EntradaHandshakes, ResultadoHandshakes> {
    readonly nombre = 'routers.registrar_handshakes'

    protected auditarExito(salida: ResultadoHandshakes): boolean {
        return salida.conectados.length > 0
    }

    protected async handle(input: EntradaHandshakes, t: Transaccion): Promise<ResultadoHandshakes> {
        const resultado: ResultadoHandshakes = { actualizados: 0, conectados: [] }
        for (const peer of input.peers) {
            if (!peer.ultimo_handshake) continue
            const en = new Date(peer.ultimo_handshake)
            if (Number.isNaN(en.getTime()) || en.getTime() <= 0) continue
            const filas = (await t.trx
                .from('network.routers_conexion')
                .where('public_key', peer.public_key)
                .where((q) => q.whereNull('ultimo_handshake').orWhere('ultimo_handshake', '<', en))
                .update({ ultimo_handshake: en }, ['router_id', 'estado'])) as Array<{
                router_id: number
                estado: string
            }>
            const fila = filas[0]
            if (!fila) continue
            resultado.actualizados += 1
            if (fila.estado !== 'pendiente') continue
            const antes = await filaConexion(fila.router_id, t.trx)
            await t.trx
                .from('network.routers_conexion')
                .where('router_id', fila.router_id)
                .update({
                    estado: 'conectado',
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'router_conexion', id: fila.router_id },
                auditableConexion(antes),
                auditableConexion(await filaConexion(fila.router_id, t.trx)),
            )
            resultado.conectados.push(Number(fila.router_id))
        }
        t.anotarAuditoria({ conectados: resultado.conectados })
        return resultado
    }
}
