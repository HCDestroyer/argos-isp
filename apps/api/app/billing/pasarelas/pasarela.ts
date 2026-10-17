import env from '#start/env'
import { Problema, ValidacionFallida } from '#shared/errores'

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
    /**
     * adonde el proveedor devuelve al cliente al terminar (el real la recibe como `return_url`).
     * Ya validada contra `PASARELA_RETORNO_ORIGENES` y con `{cobro_id}` resuelto.
     */
    url_retorno?: string | null
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

/*
|--------------------------------------------------------------------------
| URL de retorno
|--------------------------------------------------------------------------
*/

/** Marcador que se reemplaza por el id del cobro (el id existe recién al crearlo). */
export const MARCADOR_COBRO = '{cobro_id}'

/**
 * Orígenes (`esquema://host[:puerto]`) a los que el proveedor puede devolver al cliente:
 * `PASARELA_RETORNO_ORIGENES` (separados por comas) o, sin ella, el origen de `NOTIFY_PORTAL_URL`
 * (el portal). Sin ninguna de las dos no se acepta `url_retorno`.
 */
export function origenesRetorno(): string[] {
    const lista = env.get('PASARELA_RETORNO_ORIGENES') || env.get('NOTIFY_PORTAL_URL') || ''
    return lista
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .flatMap((o) => {
            try {
                return [new URL(o).origin]
            } catch {
                return []
            }
        })
}

/**
 * Valida `url_retorno` (http/https, sin usuario ni clave, origen permitido) y reemplaza
 * `{cobro_id}`. Lanza 422 en `url_retorno` (`rule`: `url` u `origen_no_permitido`): evita que el
 * cobro sirva de redirección abierta hacia un sitio ajeno.
 */
export function resolverUrlRetorno(plantilla: string, cobroId: number | string): string {
    const error = (message: string, rule: string) =>
        new ValidacionFallida([{ field: 'url_retorno', message, rule }])
    const texto = plantilla.trim().replaceAll(MARCADOR_COBRO, String(cobroId))
    let url: URL
    try {
        url = new URL(texto)
    } catch {
        throw error('url_retorno debe ser una URL absoluta', 'url')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw error('url_retorno debe ser http o https, sin usuario ni clave', 'url')
    }
    const permitidos = origenesRetorno()
    if (!permitidos.includes(url.origin)) {
        throw error(
            permitidos.length === 0
                ? 'No hay orígenes permitidos para url_retorno (configure PASARELA_RETORNO_ORIGENES)'
                : `El origen ${url.origin} no está permitido para url_retorno`,
            'origen_no_permitido',
        )
    }
    return url.toString()
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
