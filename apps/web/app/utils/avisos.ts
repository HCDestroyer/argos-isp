import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

type Envio = Schema<'EnvioNotificacion'>
export type CanalAviso = Schema<'PlantillaNotificacion'>['canal']

/**
 * Plantillas de notificación, recordatorios y envíos (A6, `apps/api/app/notify/README.md`):
 * nombres legibles de eventos, canales y estados, y el catálogo de variables Mustache.
 */

export const CANALES_AVISO: Record<CanalAviso, { etiqueta: string, icono: string }> = {
    correo: { etiqueta: 'Correo', icono: 'i-lucide-mail' },
    telegram: { etiqueta: 'Telegram', icono: 'i-lucide-send' },
    whatsapp: { etiqueta: 'WhatsApp', icono: 'i-lucide-message-circle' },
}

export const ESTADOS_ENVIO: Record<Envio['estado'], { etiqueta: string, color: BadgeProps['color'], icono: string }> = {
    encolado: { etiqueta: 'En cola', color: 'info', icono: 'i-lucide-clock' },
    enviado: { etiqueta: 'Enviado', color: 'success', icono: 'i-lucide-circle-check' },
    fallido: { etiqueta: 'Fallido', color: 'error', icono: 'i-lucide-circle-x' },
    omitido: { etiqueta: 'Omitido', color: 'neutral', icono: 'i-lucide-circle-minus' },
}

const EVENTOS: Record<string, string> = {
    'factura.emitida': 'Factura emitida',
    'factura.vencida': 'Factura vencida',
    'pago.registrado': 'Pago registrado',
    'pago.registrado.tercero': 'Pago hecho por otro cliente',
    'promesa.creada': 'Promesa creada',
    'promesa.cumplida': 'Promesa cumplida',
    'promesa.incumplida': 'Promesa incumplida',
    'servicio.estado_cambiado': 'Cambio de estado del servicio',
    'comprobante.recibido': 'Comprobante recibido',
    'comprobante.aprobado': 'Comprobante aprobado',
    'comprobante.rechazado': 'Comprobante rechazado',
    'lealtad.puntos_acumulados': 'Puntos ganados',
    'lealtad.puntos_por_vencer': 'Puntos por vencer',
    'lealtad.referido_calificado': 'Referido calificado',
}

/** Nombre del evento de una plantilla o un envío; los internos (`alerta.*`) y los desconocidos se ven tal cual. */
export function etiquetaEvento(evento: string): string {
    const recordatorio = /^recordatorio\.(\d)$/.exec(evento)
    if (recordatorio) {
        return `Recordatorio de pago ${recordatorio[1]}`
    }
    if (evento.startsWith('alerta.')) {
        return `Alerta al equipo · ${evento.slice('alerta.'.length).replaceAll('_', ' ').replaceAll('.', ' · ')}`
    }
    return EVENTOS[evento] ?? evento
}

export type GrupoEvento = 'cliente' | 'recordatorio' | 'alerta'

export function grupoEvento(evento: string): GrupoEvento {
    if (evento.startsWith('recordatorio.')) {
        return 'recordatorio'
    }
    return evento.startsWith('alerta.') ? 'alerta' : 'cliente'
}

export const GRUPOS_EVENTO: Record<GrupoEvento, string> = {
    cliente: 'Avisos al cliente',
    recordatorio: 'Recordatorios de pago',
    alerta: 'Alertas al equipo',
}

/**
 * Variables Mustache que A6 arma para cada evento (`notify/README.md` § Variables). Las de
 * `alerta.*` dependen de cada alerta: se ven en su plantilla de fábrica.
 */
const SIEMPRE = ['evento', 'empresa.nombre', 'empresa.nit', 'empresa.telefono', 'empresa.whatsapp', 'empresa.correo', 'empresa.horario', 'empresa.instrucciones_pago', 'empresa.soporte.texto', 'empresa.portal_url', 'cliente.id', 'cliente.nombre', 'cliente.email']
const GRUPOS_VARIABLES: Record<string, string[]> = {
    servicio: ['servicio.id', 'servicio.usuario', 'servicio.estado', 'servicio.direccion', 'servicio.plan'],
    factura: ['factura.numero', 'factura.autorizacion', 'factura.total_q', 'factura.saldo_q', 'factura.vence', 'factura.periodo', 'factura.dias_para_vencer', 'factura.dias_vencida', 'factura.vence_relativo', 'factura.vencida', 'factura.vence_hoy'],
    pago: ['pago.id', 'pago.monto_q', 'pago.metodo', 'pago.facturas', 'pago.fecha'],
    tercero: ['pago.facturas_cliente', 'pago.varias_facturas', 'pago.monto_cliente_q', 'pagador.nombre'],
    cobro: ['cobro.monto_q', 'cobro.partes', 'cobro.repartido', 'cobro.otras_empresas'],
    promesa: ['promesa.id', 'promesa.monto_q', 'promesa.vence'],
    estado: ['estado.de', 'estado.a', 'estado.motivo', 'estado.es_activo', 'estado.es_limitado', 'estado.es_suspendido', 'estado.es_retirado'],
    comprobante: ['comprobante.monto_q', 'comprobante.referencia', 'comprobante.metodo', 'comprobante.fecha_deposito', 'comprobante.motivo'],
    recordatorio: ['recordatorio.orden', 'recordatorio.dias'],
}

/** Variables disponibles para el evento de una plantilla, agrupadas. */
export function variablesDeEvento(evento: string): { grupo: string, variables: string[] }[] {
    const grupos: { grupo: string, variables: string[] }[] = [{ grupo: 'Siempre', variables: SIEMPRE }]
    const agregar = (grupo: string, clave: string) => grupos.push({ grupo, variables: GRUPOS_VARIABLES[clave] ?? [] })
    if (evento.startsWith('factura.') || evento.startsWith('recordatorio.')) {
        agregar('Factura', 'factura')
        agregar('Servicio', 'servicio')
    }
    if (evento.startsWith('recordatorio.')) {
        agregar('Recordatorio', 'recordatorio')
    }
    if (evento.startsWith('pago.') || evento === 'comprobante.aprobado') {
        agregar('Pago', 'pago')
        agregar('Cobro en caja', 'cobro')
    }
    if (evento === 'pago.registrado.tercero') {
        agregar('Pago de un tercero', 'tercero')
    }
    if (evento.startsWith('promesa.')) {
        agregar('Promesa', 'promesa')
        agregar('Servicio', 'servicio')
    }
    if (evento === 'servicio.estado_cambiado') {
        agregar('Cambio de estado', 'estado')
        agregar('Servicio', 'servicio')
    }
    if (evento.startsWith('comprobante.')) {
        agregar('Comprobante', 'comprobante')
    }
    return grupos
}

/** Días respecto al vencimiento, en palabras («3 días antes», «el día que vence»). */
export function diasRecordatorio(dias: number): string {
    if (dias === 0) {
        return 'El día que vence'
    }
    const n = Math.abs(dias)
    return `${n} ${n === 1 ? 'día' : 'días'} ${dias < 0 ? 'antes' : 'después'} del vencimiento`
}
