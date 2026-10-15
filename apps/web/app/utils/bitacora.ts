import type { Schema } from '@argosisp/contracts'

type Accion = Schema<'AccionAuditoria'>

/** Texto para las acciones conocidas; las demás se muestran con su nombre técnico. */
const ETIQUETAS_ACCION: Record<string, string> = {
    'clientes.crear': 'Cliente creado',
    'clientes.editar': 'Datos del cliente editados',
    'servicios.crear': 'Servicio creado',
    'servicios.editar': 'Servicio editado',
    'servicios.suspender': 'Servicio suspendido',
    'servicios.reactivar': 'Servicio reactivado',
    'servicios.limitar': 'Velocidad limitada',
    'servicios.quitar_limite': 'Límite de velocidad quitado',
    'servicios.retirar': 'Servicio retirado',
    'servicios.desconectar': 'Sesión PPPoE desconectada',
    'pagos.registrar': 'Pago registrado',
    'pagos.anular': 'Pago anulado',
    'facturas.anular': 'Aviso de cobro anulado',
    'promesas.crear': 'Promesa de pago creada',
    'promesas.aprobar': 'Promesa de pago aprobada',
}

const ICONOS_ACCION: Record<string, string> = {
    crear: 'i-lucide-plus',
    editar: 'i-lucide-pencil',
    suspender: 'i-lucide-circle-x',
    reactivar: 'i-lucide-circle-check',
    limitar: 'i-lucide-gauge',
    quitar_limite: 'i-lucide-gauge',
    retirar: 'i-lucide-archive',
    desconectar: 'i-lucide-unplug',
    registrar: 'i-lucide-banknote',
    anular: 'i-lucide-ban',
    aprobar: 'i-lucide-check',
}

const ACTORES: Record<Accion['actor_tipo'], string> = {
    usuario: 'Usuario',
    token: 'Token de API',
    agente: 'Agente de IA',
    sistema: 'Sistema',
}

export function etiquetaAccion(accion: string): string {
    return ETIQUETAS_ACCION[accion] ?? accion
}

export function iconoAccion(accion: Accion): string {
    if (accion.resultado === 'error') {
        return 'i-lucide-triangle-alert'
    }
    const verbo = accion.accion.split('.').at(-1) ?? ''
    return ICONOS_ACCION[verbo] ?? 'i-lucide-dot'
}

/** `Usuario #1`, `Sistema`. La API todavía no manda el nombre del actor (pedido a A1). */
export function etiquetaActor(accion: Accion): string {
    const base = ACTORES[accion.actor_tipo]
    return accion.actor_id === null ? base : `${base} #${accion.actor_id}`
}

/** `servicio 12`, o `null` si la acción no tiene entidad. */
export function etiquetaEntidad(accion: Accion): string | null {
    if (!accion.entidad_tipo) {
        return null
    }
    return accion.entidad_id === null ? accion.entidad_tipo : `${accion.entidad_tipo} ${accion.entidad_id}`
}
