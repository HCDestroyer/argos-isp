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

/** Desde aquí `audit.cambios` usa `nombreCampo` (sin separar dígitos). */
const CAMBIO_NOMBRES = '2026-10-16'

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
        // Como la API (A1, día 4): `GET /bitacora/cambios` siempre trae el nombre del actor.
        actor_nombre: accion.actor_nombre ?? null,
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
            // Antes del 2026-10-16 la API guardaba los nombres con el dígito separado (`ipv_4`,
            // `prefijo_enlace_v_6`) y esas filas no se reescriben: el panel las muestra con el actual.
            cambio(accion, accion.created_at < CAMBIO_NOMBRES ? 'ipv_4' : 'ipv4', null, servicio.ipv4),
            cambio(accion, accion.created_at < CAMBIO_NOMBRES ? 'prefijo_enlace_v_6' : 'prefijo_enlace_v6', null, servicio.prefijo_enlace_v6),
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
