import type { Schema } from '@argosisp/contracts'

type Accion = Schema<'AccionAuditoria'>

/**
 * Texto legible de cada acción de dominio (`DomainAction.nombre`). Las que no estén aquí se
 * muestran con su nombre técnico, para no esconder nada que la API registre.
 */
const ETIQUETAS_ACCION: Record<string, string> = {
    'auth.login': 'Inicio de sesión',
    'auth.logout': 'Cierre de sesión',
    'clientes.crear': 'Cliente creado',
    'clientes.editar': 'Datos del cliente editados',
    'zonas.crear': 'Zona creada',
    'zonas.editar': 'Zona editada',
    'servicios.crear': 'Servicio creado',
    'servicios.editar': 'Servicio editado',
    'servicios.cambiar_estado': 'Estado del servicio cambiado',
    'servicios.suspender': 'Servicio suspendido',
    'servicios.reactivar': 'Servicio reactivado',
    'servicios.limitar': 'Velocidad limitada',
    'servicios.quitar_limite': 'Límite de velocidad quitado',
    'servicios.retirar': 'Servicio retirado',
    'servicios.desconectar': 'Sesión PPPoE desconectada',
    'servicios.ver_credenciales': 'Credenciales PPPoE consultadas',
    'routers.crear': 'Router creado',
    'routers.editar': 'Router editado',
    'redes.crear': 'Red IPv4 creada',
    'planes.crear': 'Plan creado',
    'planes.editar': 'Plan editado',
    'plantillas.crear': 'Plantilla de facturación creada',
    'plantillas.editar': 'Plantilla de facturación editada',
    'facturas.generar': 'Avisos de cobro generados',
    'facturas.anular': 'Aviso de cobro anulado',
    'pagos.registrar': 'Pago registrado',
    'pagos.anular': 'Pago anulado',
    'promesas.crear': 'Promesa de pago creada',
    'promesas.aprobar': 'Promesa de pago aprobada',
    'cajas.abrir': 'Turno de caja abierto',
    'cajas.cerrar': 'Turno de caja cerrado',
    'notificaciones.enviar': 'Notificación enviada',
    'notificaciones.programar': 'Notificación programada',
    'notificaciones.recordatorios': 'Recordatorios de pago programados',
    'notificaciones.editar': 'Plantilla de notificación editada',
    'portal.quien_soy': 'Consulta desde la página de corte',
}

/**
 * Lecturas que la API audita pero que no cuentan la historia del cliente: cada visita a la
 * página de corte (`/corte`) registra un `portal.quien_soy`. La línea de tiempo las oculta;
 * la bitácora completa las sigue mostrando.
 */
const LECTURAS_OCULTAS = new Set(['portal.quien_soy'])

/** Canales de `ContextoAccion` (`apps/api/app/shared/contexto.ts`). */
const CANALES: Record<string, string> = {
    panel: 'Panel',
    portal: 'Portal',
    api: 'API',
    ia: 'Agente de IA',
    cron: 'Automático',
    worker: 'Automático',
    webhook: 'Webhook',
    interno: 'Interno',
    consola: 'Consola',
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
    ver_credenciales: 'i-lucide-key-round',
    abrir: 'i-lucide-lock-open',
    cerrar: 'i-lucide-lock',
}

const ACTORES: Record<Accion['actor_tipo'], string> = {
    usuario: 'Usuario',
    token: 'Token de API',
    agente: 'Agente de IA',
    sistema: 'Sistema',
}

/** `servicios.suspender` → `Servicio suspendido`; nombres desconocidos, tal cual. */
export function etiquetaAccion(accion: string): string {
    return ETIQUETAS_ACCION[accion] ?? accion
}

/** Estado destino de `servicios.cambiar_estado` (`entrada.nuevo`), o `null`. */
function estadoDestino(entrada: unknown): EstadoServicio | null {
    if (typeof entrada !== 'object' || entrada === null || !('nuevo' in entrada)) {
        return null
    }
    const { nuevo } = entrada
    return typeof nuevo === 'string' && Object.hasOwn(ESTADOS_SERVICIO, nuevo) ? nuevo as EstadoServicio : null
}

/**
 * Título de una entrada. `servicios.cambiar_estado` (corte automático, reactivación por pago)
 * dice a qué estado pasó: "Servicio suspendido", "Servicio activo".
 */
export function tituloAccion(accion: Accion): string {
    if (accion.accion === 'servicios.cambiar_estado') {
        const estado = estadoDestino(accion.entrada)
        if (estado) {
            return `Servicio ${ESTADOS_SERVICIO[estado].etiqueta.toLowerCase()}`
        }
    }
    return etiquetaAccion(accion.accion)
}

/** `false` para las lecturas del portal, que la línea de tiempo del cliente no muestra. */
export function visibleEnLineaTiempo(accion: Accion): boolean {
    return !LECTURAS_OCULTAS.has(accion.accion)
}

/** `cron` → `Automático`; canales desconocidos, tal cual. */
export function etiquetaCanal(canal: string): string {
    return CANALES[canal] ?? canal
}

export function iconoAccion(accion: Accion): string {
    if (accion.resultado === 'error') {
        return 'i-lucide-triangle-alert'
    }
    if (accion.accion === 'servicios.cambiar_estado') {
        const estado = estadoDestino(accion.entrada)
        return estado ? ESTADOS_SERVICIO[estado].icono : 'i-lucide-refresh-cw'
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
