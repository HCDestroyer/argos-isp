/**
 * Catálogo de eventos de dominio (ver `.claude/CLAUDE.md`).
 *
 * Los eventos se escriben en `audit.outbox` con `t.emit(evento, payload)` dentro de la misma
 * transacción que el cambio; un relay (A1) los publica a Redis Streams. Los consumidores deben
 * ser idempotentes: un evento puede llegar dos veces.
 *
 * Convenciones del payload: claves en snake_case, ids numéricos, dinero como string decimal
 * ("150.00"), fechas como ISO 8601 (UTC para instantes, YYYY-MM-DD para fechas).
 */

export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'
/** Métodos de pago (`billing.pagos.metodo`). transferencia, ach y remesa: decisión del PM 2026-10-16. */
export const METODOS_PAGO = [
    'caja',
    'pasarela',
    'deposito',
    'transferencia',
    'ach',
    'remesa',
    'agente',
    'debito',
] as const
export type MetodoPago = (typeof METODOS_PAGO)[number]
export type CanalNotificacion = 'correo' | 'telegram' | 'whatsapp'

/** Monto decimal serializado, p. ej. "150.00". Nunca `number`. */
export type Dinero = string

interface PayloadFactura {
    factura_id: number
    servicio_id: number | null
    cliente_id: number
    total: Dinero
    /** fecha de vencimiento YYYY-MM-DD */
    vence: string
}

interface PayloadPago {
    pago_id: number
    /** quien paga */
    cliente_id: number
    monto: Dinero
    metodo: MetodoPago
    facturas: number[]
    /**
     * el pagador y los dueños de las facturas aplicadas (pago de terceros: una persona paga la
     * factura de un familiar). Siempre lo envía billing desde 2026-10-16; opcional por eventos
     * anteriores.
     */
    clientes?: number[]
}

interface PayloadPromesa {
    promesa_id: number
    servicio_id: number
    /** instante ISO 8601 */
    vence: string
    monto: Dinero
}

/** Comprobante de depósito (A3, día 4). `pago_id` solo al aprobar; `motivo` solo al rechazar. */
interface PayloadComprobante {
    comprobante_id: number
    cliente_id: number
    pago_id: number | null
    motivo: string | null
}

interface PayloadSesion {
    servicio_id: number | null
    nas_ip: string
    acct_session_id: string
    ipv4: string | null
    prefijos_v6: string[]
}

export interface CatalogoEventos {
    // núcleo (A1)
    'servicio.creado': { servicio_id: number; cliente_id: number; router_id: number; plan_id: number }
    'servicio.estado_cambiado': {
        servicio_id: number
        de: EstadoServicio
        a: EstadoServicio
        motivo: string
    }
    'servicio.config_cambiada': {
        servicio_id: number
        campos: Array<'plan' | 'ips' | 'prefijo_v6' | 'router'>
    }
    'asignacion.cambiada': {
        servicio_id: number
        ipv4: string[]
        prefijo_enlace_v6: string | null
        prefijo_delegado_v6: string | null
        inicio: string
        fin: string | null
    }

    // aaa (A2)
    'sesion.iniciada': PayloadSesion
    'sesion.terminada': PayloadSesion
    /** Desconexión manual pedida desde el panel o la API; la ejecuta `coa` (Disconnect-Request). */
    'sesion.desconexion_solicitada': {
        sesion_id: number
        servicio_id: number | null
        nas_ip: string
        acct_session_id: string
        user_ppp: string
        motivo: string
    }
    /** `servicio_id` null solo en una desconexión manual de una sesión sin servicio conocido. */
    'coa.fallido': { servicio_id: number | null; nas_ip: string; tipo: 'coa' | 'disconnect'; error: string }
    /** `aaa` no respondió su health check durante el umbral (60 s). `desde` = primer fallo. */
    'aaa.caido': { nodo: string; desde: string; ultimo_error?: string | null }
    /** `aaa` volvió a responder. `desde` = inicio de la caída, `hasta` = primer health check bueno. */
    'aaa.recuperado': { nodo: string; desde: string; hasta: string; ultimo_error: string | null }

    // billing (A3)
    'factura.emitida': PayloadFactura
    'factura.vencida': PayloadFactura
    'factura.anulada': PayloadFactura
    'pago.registrado': PayloadPago
    'pago.anulado': PayloadPago
    'promesa.creada': PayloadPromesa
    'promesa.cumplida': PayloadPromesa
    'promesa.incumplida': PayloadPromesa
    /** el cliente (portal) o un operador (panel) subió un comprobante; queda pendiente de revisión */
    'comprobante.recibido': PayloadComprobante
    /** se aprobó y ya es un pago (`pago_id`); el pago emite además `pago.registrado` */
    'comprobante.aprobado': PayloadComprobante
    /** se rechazó con `motivo`; la referencia queda libre para subirlo de nuevo */
    'comprobante.rechazado': PayloadComprobante

    // ledger (A3)
    'caja.cerrada': {
        caja_id: number
        cajero_id: number | null
        esperado: Dinero
        contado: Dinero
        diferencia: Dinero
    }

    // notify (A6)
    'notificacion.enviada': {
        cliente_id: number
        canal: CanalNotificacion
        evento_origen: string
        estado: 'enviado' | 'fallido'
    }
}

export type NombreEvento = keyof CatalogoEventos
export type PayloadEvento<E extends NombreEvento> = CatalogoEventos[E]

/** Lista en tiempo de ejecución (para validar y para el relay). */
export const EVENTOS = [
    'servicio.creado',
    'servicio.estado_cambiado',
    'servicio.config_cambiada',
    'asignacion.cambiada',
    'sesion.iniciada',
    'sesion.terminada',
    'sesion.desconexion_solicitada',
    'coa.fallido',
    'aaa.caido',
    'aaa.recuperado',
    'factura.emitida',
    'factura.vencida',
    'factura.anulada',
    'pago.registrado',
    'pago.anulado',
    'promesa.creada',
    'promesa.cumplida',
    'promesa.incumplida',
    'comprobante.recibido',
    'comprobante.aprobado',
    'comprobante.rechazado',
    'caja.cerrada',
    'notificacion.enviada',
] as const satisfies readonly NombreEvento[]

type Faltantes = Exclude<NombreEvento, (typeof EVENTOS)[number]>
// Si agregas un evento al catálogo y no a EVENTOS, esta línea no compila.
const eventosCompletos: Faltantes extends never ? true : Faltantes = true
void eventosCompletos

export function esEvento(nombre: string): nombre is NombreEvento {
    return (EVENTOS as readonly string[]).includes(nombre)
}
