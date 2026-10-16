import env from '#start/env'
import { Problema } from '#shared/errores'

/**
 * Contrato de un proveedor de pago en línea. Cada proveedor (el falso del laboratorio y, cuando
 * el PM entregue credenciales, el real) es un adaptador con estas tres operaciones; el resto
 * (cobros, webhook idempotente, pago, asiento, conciliación) no depende del proveedor.
 *
 * - `crearCobro`: crea el cobro en el proveedor y devuelve dónde paga el cliente.
 * - `verificarWebhook`: valida la firma (HMAC) y la ventana de tiempo y traduce la notificación;
 *   lanza `FirmaInvalida` (401) si no es auténtica o es vieja.
 * - `consultar`: estado del cobro según el proveedor (lo usa la conciliación diaria).
 */

export type EstadoCobroProveedor = 'pendiente' | 'pagado' | 'fallido' | 'expirado'

export interface EntradaCrearCobro {
    /** nuestro id del cobro (`billing.pasarela_cobros.id`), como referencia en el proveedor */
    referencia: string
    /** string decimal "150.00" en quetzales */
    monto: string
    descripcion: string
    cliente: { id: number; nombre: string; email?: string | null }
}

export interface CobroCreado {
    id_proveedor: string
    url_pago: string
    expira_en: Date | null
}

export interface NotificacionPasarela {
    /** id único del evento en el proveedor (idempotencia del webhook) */
    id_evento: string
    id_proveedor: string
    estado: EstadoCobroProveedor
    /** lo que el cliente pagó (string decimal) */
    monto: string
    /** comisión que retiene el proveedor (string decimal) */
    comision: string
    ocurrido_en: Date
    payload: Record<string, unknown>
}

export interface EstadoEnProveedor {
    id_proveedor: string
    estado: EstadoCobroProveedor
    monto: string
    monto_pagado: string | null
    comision: string
    pagado_en: Date | null
}

export interface EntradaWebhook {
    /** cuerpo crudo, tal como llegó (la firma se calcula sobre él) */
    cuerpo: string
    cabeceras: Record<string, string | undefined>
    ahora?: Date
}

export interface Pasarela {
    readonly nombre: string
    crearCobro(entrada: EntradaCrearCobro): Promise<CobroCreado>
    verificarWebhook(entrada: EntradaWebhook): NotificacionPasarela
    consultar(idProveedor: string): Promise<EstadoEnProveedor>
}

export class FirmaInvalida extends Problema {
    constructor(detalle: string) {
        super(401, 'firma_invalida', 'Firma inválida', detalle)
    }
}

export class PasarelaNoConfigurada extends Problema {
    constructor(detalle = 'No hay pasarela de pago en línea configurada (PASARELA_PROVEEDOR)') {
        super(503, 'pasarela_no_configurada', 'Pasarela no configurada', detalle)
    }
}

/** Ventana de tiempo aceptada para la marca de tiempo de un webhook (± 5 minutos). */
export const VENTANA_WEBHOOK_S = 300

/**
 * Proveedor configurado: `PASARELA_PROVEEDOR` o, fuera de producción, `falsa`. En producción sin
 * la variable no hay pasarela (503).
 */
export function proveedorConfigurado(): string | null {
    const configurado = env.get('PASARELA_PROVEEDOR')
    if (configurado) return configurado
    return env.get('NODE_ENV') === 'production' ? null : 'falsa'
}

const registro = new Map<string, () => Promise<Pasarela>>([
    [
        'falsa',
        async () => {
            const { PasarelaFalsa } = await import('#billing/pasarelas/falsa')
            return new PasarelaFalsa()
        },
    ],
])

/** Adaptador por nombre (el del webhook) o el configurado. 503 si no existe. */
export async function pasarela(nombre: string | null = proveedorConfigurado()): Promise<Pasarela> {
    const fabrica = nombre ? registro.get(nombre) : undefined
    if (!fabrica) throw new PasarelaNoConfigurada(nombre ? `La pasarela ${nombre} no existe` : undefined)
    return fabrica()
}
