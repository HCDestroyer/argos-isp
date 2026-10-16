import type { Schema } from '@argosisp/contracts'
import { clientes } from '../clientes/datos'
import { servicios } from '../servicios/datos'
import { acciones } from './datos'

type Cambio = Schema<'CambioAuditoria'>

/**
 * `audit.cambios` de los fixtures, derivados de la bitácora de acciones (mismo `request_id`):
 * al crear un servicio, cada campo con `antes = null`, y la contraseña PPPoE como `***`, igual
 * que la API; al editar un cliente, el teléfono; al suspender a mano, el estado.
 */
let siguiente = 1

function cambio(accion: Schema<'AccionAuditoria'>, campo: string, antes: unknown, despues: unknown): Cambio {
    return {
        id: siguiente++,
        entidad_tipo: accion.entidad_tipo ?? '',
        entidad_id: accion.entidad_id ?? 0,
        campo,
        antes,
        despues,
        actor_tipo: accion.actor_tipo,
        actor_id: accion.actor_id,
        request_id: accion.request_id,
        created_at: accion.created_at,
    }
}

export const cambios: Cambio[] = acciones.flatMap((accion): Cambio[] => {
    if (accion.accion === 'servicios.crear') {
        const servicio = servicios.find(s => s.id === accion.entidad_id)
        if (!servicio) {
            return []
        }
        return [
            cambio(accion, 'user_ppp', null, servicio.user_ppp),
            cambio(accion, 'pass_ppp', null, '***'),
            cambio(accion, 'plan_id', null, servicio.plan_id),
            cambio(accion, 'router_id', null, servicio.router_id),
            cambio(accion, 'estado', null, 'activo'),
            cambio(accion, 'ipv4', null, servicio.ipv4),
        ]
    }
    if (accion.accion === 'clientes.editar') {
        const cliente = clientes.find(c => c.id === accion.entidad_id)
        return cliente ? [cambio(accion, 'telefono', '2222-0000', cliente.telefono), cambio(accion, 'version', 1, 2)] : []
    }
    if (accion.accion === 'servicios.suspender') {
        return [cambio(accion, 'estado', 'activo', 'suspendido'), cambio(accion, 'suspension_manual', false, true)]
    }
    return []
})
