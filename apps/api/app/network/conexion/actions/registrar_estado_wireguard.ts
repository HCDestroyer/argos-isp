import { DomainAction, type Transaccion } from '#shared/domain_action'
import { HANDSHAKE_RECIENTE_S, filaConexion } from '#network/conexion/consultas'

export interface EntradaEstadoWireguard {
    servidor: {
        public_key: string
        ip?: string | null
        red?: string | null
        puerto?: number | null
        interfaz?: string | null
        modo?: string | null
    }
    peers: Array<{
        public_key: string
        ultimo_handshake: Date | string | null
        endpoint?: string | null
        rx_bytes?: number | null
        tx_bytes?: number | null
    }>
    generado_en?: Date | string | null
}

export interface ResultadoEstadoWireguard {
    /** routers cuyo estado cambió (`pendiente` ↔ `conectado`) */
    cambios: Array<{ router_id: number; de: string; a: string }>
    clave_servidor_cambiada: boolean
}

/**
 * `routers.registrar_estado_wireguard` (`contratos/conexion-routers.md` §6.3): el `wireguard-agente`
 * informa la clave pública del servidor y el último handshake de cada peer, cuando cambia algo
 * (como mucho cada 60 s y al menos cada 10 min).
 *
 * - La clave del servidor se guarda en `network.wireguard_servidor` (va en los scripts nuevos).
 * - `ultimo_handshake` por router es telemetría: solo avanza y no se audita por fila.
 * - `conectado` = handshake de menos de 3 min al momento del informe; un peer que no aparece cuenta
 *   como sin handshake. El cambio `pendiente` ↔ `conectado` queda en `audit.cambios`; la acción deja
 *   fila en `audit.acciones` solo si cambió algún estado o la clave del servidor (como
 *   `sesiones.cerrar_colgadas`). No emite evento: nadie lo consume hoy.
 */
export default class RegistrarEstadoWireguard extends DomainAction<
    EntradaEstadoWireguard,
    ResultadoEstadoWireguard
> {
    readonly nombre = 'routers.registrar_estado_wireguard'

    protected auditarExito(salida: ResultadoEstadoWireguard): boolean {
        return salida.cambios.length > 0 || salida.clave_servidor_cambiada
    }

    protected async handle(input: EntradaEstadoWireguard, t: Transaccion): Promise<ResultadoEstadoWireguard> {
        const resultado: ResultadoEstadoWireguard = { cambios: [], clave_servidor_cambiada: false }
        const generado = input.generado_en ? new Date(input.generado_en) : new Date()
        const momento = Number.isNaN(generado.getTime()) ? new Date() : generado

        const anterior = (await t.trx
            .from('network.wireguard_servidor')
            .where('id', 1)
            .forUpdate()
            .select('public_key')
            .first()) as { public_key: string } | null
        const s = input.servidor
        await t.trx.rawQuery(
            `INSERT INTO network.wireguard_servidor AS w (id, public_key, ip, red, puerto, interfaz, modo, generado_en)
             VALUES (1, ?, ?::inet, ?::cidr, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE
                SET public_key = EXCLUDED.public_key, ip = EXCLUDED.ip, red = EXCLUDED.red,
                    puerto = EXCLUDED.puerto, interfaz = EXCLUDED.interfaz, modo = EXCLUDED.modo,
                    generado_en = EXCLUDED.generado_en, updated_at = now()`,
            [
                s.public_key,
                s.ip ?? null,
                s.red ?? null,
                s.puerto ?? null,
                s.interfaz ?? null,
                s.modo ?? null,
                momento,
            ] as unknown as string[],
        )
        if (anterior?.public_key !== s.public_key) {
            resultado.clave_servidor_cambiada = true
            await t.registrarCambios(
                { tipo: 'wireguard_servidor', id: 1 },
                anterior ? { public_key: anterior.public_key } : null,
                { public_key: s.public_key },
            )
        }

        const handshakes = new Map<string, Date>()
        for (const peer of input.peers) {
            if (!peer.ultimo_handshake) continue
            const en = new Date(peer.ultimo_handshake)
            if (!Number.isNaN(en.getTime()) && en.getTime() > 0) handshakes.set(peer.public_key, en)
        }

        const registrados = (await t.trx
            .from('network.routers_conexion')
            .whereNotNull('public_key')
            .forUpdate()
            .select('router_id', 'public_key', 'estado', 'ultimo_handshake')) as Array<{
            router_id: number
            public_key: string
            estado: 'pendiente' | 'conectado'
            ultimo_handshake: Date | null
        }>
        for (const fila of registrados) {
            const informado = handshakes.get(fila.public_key) ?? null
            const guardado = fila.ultimo_handshake ? new Date(fila.ultimo_handshake) : null
            const avanza = informado !== null && (guardado === null || informado > guardado)
            const handshake = avanza ? informado : guardado
            const conectado =
                informado !== null &&
                handshake !== null &&
                momento.getTime() - handshake.getTime() < HANDSHAKE_RECIENTE_S * 1000
            const estado = conectado ? 'conectado' : 'pendiente'
            if (!avanza && estado === fila.estado) continue
            const antes = estado === fila.estado ? null : await filaConexion(fila.router_id, t.trx)
            await t.trx
                .from('network.routers_conexion')
                .where('router_id', fila.router_id)
                .update({
                    ...(avanza ? { ultimo_handshake: informado } : {}),
                    ...(estado === fila.estado
                        ? {}
                        : {
                              estado,
                              version: t.trx.knexRawQuery('version + 1'),
                              updated_at: t.trx.knexRawQuery('now()'),
                          }),
                })
            if (antes) {
                await t.registrarCambios(
                    { tipo: 'router_conexion', id: fila.router_id },
                    { estado: antes.estado },
                    { estado },
                )
                resultado.cambios.push({ router_id: Number(fila.router_id), de: fila.estado, a: estado })
            }
        }
        t.anotarAuditoria({ cambios: resultado.cambios })
        return resultado
    }
}
