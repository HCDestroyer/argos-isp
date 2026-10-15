import type { Schema } from '@argosisp/contracts'
import { routers } from '../routers/datos'
import { servicios } from '../servicios/datos'

type Sesion = Schema<'Sesion'>
type Servicio = Schema<'Servicio'>

/** `Acct-Session-Id` como lo manda RouterOS: 8 dígitos hexadecimales en mayúscula. */
function acctSessionId(id: number): string {
    return (0x81A00000 + id * 4099).toString(16).toUpperCase().slice(-8)
}

/** Sesión PPPoE abierta para un servicio, con las direcciones que le entregó RADIUS. */
export function nuevaSesion(id: number, servicio: Servicio, inicio: string): Sesion {
    const router = routers.find(r => r.id === servicio.router_id)
    return {
        id,
        servicio_id: servicio.id,
        router_id: servicio.router_id,
        nas_ip: router?.nas_ip ?? '10.10.0.1',
        acct_session_id: acctSessionId(id),
        user_ppp: servicio.user_ppp,
        ipv4: servicio.ipv4,
        prefijo_enlace_v6: servicio.prefijo_enlace_v6,
        prefijo_delegado_v6: servicio.prefijo_delegado_v6,
        inicio,
        fin: null,
        bytes_in: 0,
        bytes_out: 0,
        causa_fin: null,
    }
}

/**
 * Sesiones del laboratorio: una cerrada (reinicio del CPE) y una abierta por cada servicio
 * activo o limitado. Los suspendidos de id par están desconectados (el Disconnect falló y el
 * CPE no volvió a marcar).
 */
export const sesiones: Sesion[] = servicios
    .filter(servicio => servicio.estado !== 'retirado')
    .flatMap((servicio) => {
        const abierta = servicio.estado !== 'suspendido' || servicio.id % 2 === 1
        const cerrada: Sesion = {
            ...nuevaSesion(servicio.id * 2 - 1, servicio, '2026-10-01T12:04:00.000Z'),
            fin: '2026-10-09T03:12:41.000Z',
            bytes_in: 18_734_000_000 + servicio.id * 91_000_000,
            bytes_out: 2_310_000_000 + servicio.id * 12_000_000,
            causa_fin: 'Lost-Carrier',
        }
        if (!abierta) {
            return [cerrada]
        }
        return [cerrada, {
            ...nuevaSesion(servicio.id * 2, servicio, '2026-10-09T03:14:02.000Z'),
            bytes_in: 7_412_000_000 + servicio.id * 53_000_000,
            bytes_out: 904_000_000 + servicio.id * 7_000_000,
        }]
    })
