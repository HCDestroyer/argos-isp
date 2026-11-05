import type { Schema } from '@argosisp/contracts'
import { bd, siguienteId } from '../bd'

type Servicio = Schema<'Servicio'>

/**
 * Servicios para probar «Editar servicio» (IPv4 y credenciales): un PPPoE con IP fija de la red
 * «Fijas del centro» (100.64.10.0/24, router 1) y uno `ip_estatica` en la misma red, como los
 * devuelve la API (`GET /servicios/:id`). Se agregan a `bd` con `agregarServicio*`; la semilla
 * base no cambia.
 */

/** El primer PPPoE activo del router 1 (semilla base), con su IP fija. */
export function servicioPppoeEdicion(): Servicio {
    const servicio = bd.servicios.find(s => s.router_id === 1 && s.tipo_conexion === 'pppoe' && s.estado === 'activo' && s.ipv4)
    if (!servicio) {
        throw new Error('La semilla no tiene un PPPoE activo con IP en el router 1')
    }
    return servicio
}

/** `ip_estatica`: sin usuario ni contraseña PPP, sin servidor PPPoE, IPv6 sin RADIUS (`ninguno`). */
export function agregarServicioIpEstatica(cambios: Partial<Servicio> = {}): Servicio {
    const base = servicioPppoeEdicion()
    const id = siguienteId(bd.servicios)
    const servicio: Servicio = {
        ...structuredClone(base),
        id,
        tipo_conexion: 'ip_estatica',
        amarre_ip_mac: true,
        user_ppp: null,
        mac: '4C:5E:0C:77:00:01',
        servidor_pppoe_id: null,
        local_address: null,
        local_address_derivado: false,
        ipv4: '100.64.10.200',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        ipv6_modo: 'ninguno',
        ipv6_duid: null,
        externo: null,
        version: 1,
        ...cambios,
    }
    bd.servicios.push(servicio)
    return servicio
}
