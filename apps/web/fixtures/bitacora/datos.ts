import type { Schema } from '@argosisp/contracts'
import { clientes } from '../clientes/datos'
import { servicios } from '../servicios/datos'

type Accion = Schema<'AccionAuditoria'>

function mas(fecha: string, horas: number): string {
    return new Date(new Date(fecha).getTime() + horas * 3_600_000).toISOString()
}

let siguiente = 1

function accion(datos: Omit<Accion, 'id' | 'error' | 'resultado' | 'request_id'> & Partial<Pick<Accion, 'resultado' | 'error'>>): Accion {
    const id = siguiente++
    return {
        id,
        resultado: 'ok',
        error: null,
        request_id: `req-fixture-${id}`,
        // Como la API: nombre del usuario; `null` para el sistema.
        actor_nombre: datos.actor_id === 1 ? 'Ana Administradora' : null,
        ...datos,
    }
}

const delCliente: Accion[] = clientes.flatMap((cliente) => {
    const lista = [accion({
        actor_tipo: 'usuario',
        actor_id: 1,
        canal: 'panel',
        accion: 'clientes.crear',
        entidad_tipo: 'cliente',
        entidad_id: cliente.id,
        entrada: { nombre: cliente.nombre, nit_cui: cliente.nit_cui },
        created_at: cliente.created_at,
    })]
    if (cliente.id % 4 === 1) {
        lista.push(accion({
            actor_tipo: 'usuario',
            actor_id: 1,
            canal: 'panel',
            accion: 'clientes.editar',
            entidad_tipo: 'cliente',
            entidad_id: cliente.id,
            entrada: { telefono: cliente.telefono, version: 1 },
            created_at: mas(cliente.created_at, 72),
        }))
    }
    return lista
})

const delServicio: Accion[] = servicios.flatMap((servicio) => {
    const lista = [accion({
        actor_tipo: 'usuario',
        actor_id: 1,
        canal: 'panel',
        accion: 'servicios.crear',
        entidad_tipo: 'servicio',
        entidad_id: servicio.id,
        entrada: { cliente_id: servicio.cliente_id, router_id: servicio.router_id, plan_id: servicio.plan_id, pass_ppp: '***' },
        created_at: servicio.created_at,
    })]
    if (servicio.estado === 'suspendido' || servicio.estado === 'limitado') {
        // El corte automático pasa por `evaluarEstadoServicio` → `servicios.cambiar_estado`
        // (apps/api/app/core/actions/cambiar_estado_servicio.ts), con su entrada tal cual.
        lista.push(accion({
            actor_tipo: 'sistema',
            actor_id: null,
            canal: 'cron',
            accion: 'servicios.cambiar_estado',
            entidad_tipo: 'servicio',
            entidad_id: servicio.id,
            entrada: { servicioId: servicio.id, nuevo: servicio.estado, motivo: 'Facturas vencidas según la plantilla' },
            created_at: '2026-10-11T14:00:00.000Z',
        }))
    }
    if (servicio.estado === 'suspendido') {
        // Cada visita a la página de corte audita un `portal.quien_soy` (captura 07).
        for (let visita = 0; visita < 6; visita++) {
            lista.push(accion({
                actor_tipo: 'sistema',
                actor_id: null,
                canal: 'portal',
                accion: 'portal.quien_soy',
                entidad_tipo: 'servicio',
                entidad_id: servicio.id,
                entrada: { ip: servicio.ipv4 },
                created_at: mas('2026-10-11T15:00:00.000Z', visita * 3),
            }))
        }
    }
    if (servicio.estado === 'suspendido' && servicio.id % 2 === 0) {
        lista.push(accion({
            actor_tipo: 'sistema',
            actor_id: null,
            canal: 'worker',
            accion: 'servicios.desconectar',
            entidad_tipo: 'servicio',
            entidad_id: servicio.id,
            entrada: { motivo: 'Suspensión' },
            resultado: 'error',
            error: 'El NAS no respondió al Disconnect-Request',
            created_at: '2026-10-11T14:00:05.000Z',
        }))
    }
    if (servicio.estado === 'retirado') {
        lista.push(accion({
            actor_tipo: 'usuario',
            actor_id: 1,
            canal: 'panel',
            accion: 'servicios.retirar',
            entidad_tipo: 'servicio',
            entidad_id: servicio.id,
            entrada: { motivo: 'Cambio de domicilio fuera de cobertura' },
            created_at: '2026-10-05T17:20:00.000Z',
        }))
    }
    return lista
})

export const acciones: Accion[] = [...delCliente, ...delServicio]
