import { createHmac, timingSafeEqual } from 'node:crypto'
import env from '#start/env'
import { Problema, ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec } from '#ledger/dinero'
import {
    FirmaInvalida,
    PasarelaNoConfigurada,
    VENTANA_WEBHOOK_S,
    type CobroCreado,
    type EntradaCrearCobro,
    type EntradaWebhook,
    type EstadoCobroProveedor,
    type EstadoEnProveedor,
    type EstadoNotificacion,
    type NotificacionPasarela,
    type Pasarela,
} from '#billing/pasarelas/pasarela'

/**
 * Adaptador de **Recurrente** (decisión del PM; contrato `pago-en-linea.md` § Recurrente).
 * Documentación oficial: https://docs.recurrente.com (índice: https://docs.recurrente.com/llms.txt).
 *
 * - Autenticación: cabecera `X-SECRET-KEY` (`sk_live_…` en producción, `sk_test_…` en un Sandbox; la
 *   misma URL base `https://app.recurrente.com/api` para los dos).
 * - `crearCobro`: `POST /checkouts` con un ítem en línea (`name`, `currency: GTQ`,
 *   `amount_in_cents`, `quantity: 1`, `charge_type: one_time`), `success_url`, `cancel_url`,
 *   `metadata.referencia` = nuestro cobro y `expires_at`. Mínimo del proveedor: Q5.00 (500 centavos).
 *   Respuesta: `id` (`ch_…`) y `checkout_url`.
 * - `verificarWebhook`: Recurrente firma con Svix. Cabeceras `svix-id`, `svix-timestamp`,
 *   `svix-signature` (`v1,<base64>` separadas por espacio); firma = base64(HMAC-SHA256(secreto,
 *   `<id>.<timestamp>.<cuerpo crudo>`)) con el secreto `whsec_<base64>` decodificado. Ventana ± 5 min.
 *   Eventos: `intent.succeeded` / `payment_intent.succeeded` → pagado; `intent.failed`,
 *   `intent.canceled`, `payment_intent.failed` → fallido; `refund.*` con `refund.status = succeeded`
 *   → reembolsado (se anula el pago); `dispute.*` → disputa (solo se registra); el resto → pendiente.
 *   El cobro es `checkout.id` (en reembolsos, el del `intentable`); el monto `amount_in_cents`; la
 *   comisión `details.fee` (unificado) o `fee` (legacy) y la retención de IVA de la emisora
 *   `details.vat_withheld` o `vat_withheld` (H51), en centavos. El id del evento es `svix-id`.
 * - `consultar`: `GET /checkouts/{id}` (`status`: `unpaid`, `payment_in_progress`, `paid`,
 *   `expired`; `total_in_cents`) y, si está pagado, `GET /intents/{payment.id}` para la comisión
 *   (si no responde, la comisión queda 0.00: la conciliación compara monto y estado).
 */

export const CABECERAS_SVIX = { id: 'svix-id', marca: 'svix-timestamp', firma: 'svix-signature' } as const
export const MINIMO_CENTAVOS_GTQ = 500
const URL_BASE = 'https://app.recurrente.com/api'
const EVENTOS_PAGADO = new Set(['intent.succeeded', 'payment_intent.succeeded'])
const EVENTOS_FALLIDO = new Set(['intent.failed', 'intent.canceled', 'payment_intent.failed'])

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ConfigRecurrente {
    secretKey: string
    webhookSecret: string
    urlBase: string
    expiraHoras: number
}

/** Configuración de las variables de entorno (`RECURRENTE_*`); nunca en el repo. */
export function configRecurrente(): ConfigRecurrente {
    return {
        secretKey: env.get('RECURRENTE_SECRET_KEY') ?? '',
        webhookSecret: env.get('RECURRENTE_WEBHOOK_SECRETO') ?? '',
        urlBase: (env.get('RECURRENTE_API_URL') ?? URL_BASE).replace(/\/$/, ''),
        expiraHoras: Number(env.get('RECURRENTE_EXPIRA_HORAS') ?? 24),
    }
}

/** Centavos enteros de un string decimal ("150.25" → "15025"), sin pasar por `number`. */
export function aCentavos(monto: string): string {
    return dec(monto).times(100).toFixed(0)
}

/** Entero JSON sin `number` de JS (Recurrente pide `amount_in_cents` numérico). */
function enteroJson(texto: string): unknown {
    return (JSON as unknown as { rawJSON(t: string): unknown }).rawJSON(texto)
}

/** String decimal de centavos (15025 → "150.25"). */
export function deCentavos(centavos: unknown): string {
    const texto = String(centavos ?? 0).trim()
    return /^-?\d+$/.test(texto) ? aTexto(dec(texto).div(100)) : aTexto(CERO)
}

/** Firma Svix (`v1,<base64>`) de un cuerpo: la usan las pruebas para simular a Recurrente. */
export function firmarSvix(secreto: string, id: string, marca: number, cuerpo: string): string {
    const clave = Buffer.from(secreto.replace(/^whsec_/, ''), 'base64')
    const firma = createHmac('sha256', clave).update(`${id}.${marca}.${cuerpo}`).digest('base64')
    return `v1,${firma}`
}

function estadoDeEvento(tipo: string, datos: Record<string, any>): EstadoNotificacion {
    if (EVENTOS_PAGADO.has(tipo)) return 'pagado'
    if (EVENTOS_FALLIDO.has(tipo)) return 'fallido'
    // reembolso hecho (refund.status = succeeded): el pago se anula
    if (tipo.startsWith('refund.')) return datos.refund?.status === 'succeeded' ? 'reembolsado' : 'pendiente'
    if (tipo.startsWith('dispute.')) return 'disputa'
    return 'pendiente'
}

/** Checkout del pago original de un reembolso o contracargo (el intent viene en `intentable`). */
function checkoutDe(datos: Record<string, any>): string {
    const id =
        datos.checkout?.id ??
        datos.intentable?.checkout?.id ??
        datos.intentable?.checkout_id ??
        datos.refund?.intentable?.checkout?.id ??
        datos.payment_intent?.checkout?.id
    return id ? String(id) : ''
}

function estadoDeCheckout(status: string): EstadoCobroProveedor {
    if (status === 'paid') return 'pagado'
    if (status === 'expired') return 'expirado'
    return 'pendiente'
}

export class ErrorRecurrente extends Problema {
    constructor(detalle: string, status = 502) {
        super(status, 'pasarela_error', 'Error de la pasarela', detalle)
    }
}

export class PasarelaRecurrente implements Pasarela {
    readonly nombre = 'recurrente'

    constructor(
        private readonly config: ConfigRecurrente = configRecurrente(),
        private readonly http: FetchLike = (url, init) => fetch(url, init),
    ) {}

    private exigirLlave() {
        if (!this.config.secretKey) {
            throw new PasarelaNoConfigurada('Falta RECURRENTE_SECRET_KEY para la pasarela recurrente')
        }
    }

    private async llamar(
        metodo: 'GET' | 'POST',
        ruta: string,
        cuerpo?: unknown,
    ): Promise<Record<string, any>> {
        this.exigirLlave()
        let respuesta: Response
        try {
            respuesta = await this.http(`${this.config.urlBase}${ruta}`, {
                method: metodo,
                headers: {
                    'X-SECRET-KEY': this.config.secretKey,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            })
        } catch (error) {
            throw new ErrorRecurrente(`Recurrente no respondió: ${(error as Error).message}`, 503)
        }
        const texto = await respuesta.text()
        let datos: Record<string, any> = {}
        try {
            datos = texto ? (JSON.parse(texto) as Record<string, any>) : {}
        } catch {
            datos = { error: texto.slice(0, 200) }
        }
        if (!respuesta.ok) {
            const mensaje = String(datos.error ?? datos.message ?? datos.code ?? respuesta.statusText)
            throw new ErrorRecurrente(`Recurrente respondió ${respuesta.status}: ${mensaje}`)
        }
        return datos
    }

    async crearCobro(entrada: EntradaCrearCobro): Promise<CobroCreado> {
        const centavos = aCentavos(entrada.monto)
        if (dec(centavos).lt(MINIMO_CENTAVOS_GTQ)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: `Recurrente cobra desde Q${deCentavos(MINIMO_CENTAVOS_GTQ)}`,
                    rule: 'minimo_pasarela',
                },
            ])
        }
        const expira = new Date(Date.now() + this.config.expiraHoras * 3600_000)
        const retorno = (estado: string) => {
            if (!entrada.url_retorno) return undefined
            const url = new URL(entrada.url_retorno)
            url.searchParams.set('estado', estado)
            return url.toString()
        }
        const datos = await this.llamar('POST', '/checkouts', {
            items: [
                {
                    name: entrada.descripcion.slice(0, 120),
                    currency: 'GTQ',
                    amount_in_cents: enteroJson(centavos),
                    quantity: 1,
                    charge_type: 'one_time',
                    tax_category: 'service',
                },
            ],
            success_url: retorno('pagado'),
            cancel_url: retorno('pendiente'),
            metadata: { referencia: entrada.referencia, cliente_id: entrada.cliente.id },
            expires_at: expira.toISOString(),
            // la FEL la certifica ArgosIsp (INFILE): el pago en línea no emite otro documento
        })
        const id = String(datos.id ?? '')
        const url = String(datos.checkout_url ?? '')
        if (!id || !url) throw new ErrorRecurrente('Recurrente no devolvió id ni checkout_url del checkout')
        return {
            id_proveedor: id,
            url_pago: url,
            expira_en: datos.expires_at ? new Date(datos.expires_at) : expira,
        }
    }

    verificarWebhook(entrada: EntradaWebhook): NotificacionPasarela {
        if (!this.config.webhookSecret) {
            throw new FirmaInvalida('Falta RECURRENTE_WEBHOOK_SECRETO: no se puede verificar el webhook')
        }
        const id = entrada.cabeceras[CABECERAS_SVIX.id]
        const marcaTexto = entrada.cabeceras[CABECERAS_SVIX.marca]
        const firmas = entrada.cabeceras[CABECERAS_SVIX.firma]
        if (!id || !marcaTexto || !firmas) {
            throw new FirmaInvalida('Faltan las cabeceras svix-id, svix-timestamp o svix-signature')
        }
        const marca = Number(marcaTexto)
        if (!Number.isInteger(marca)) throw new FirmaInvalida('Marca de tiempo inválida')
        const ahora = Math.floor((entrada.ahora ?? new Date()).getTime() / 1000)
        if (Math.abs(ahora - marca) > VENTANA_WEBHOOK_S) {
            throw new FirmaInvalida(`La notificación está fuera de la ventana de ${VENTANA_WEBHOOK_S} s`)
        }
        const esperada = Buffer.from(
            firmarSvix(this.config.webhookSecret, id, marca, entrada.cuerpo).slice(3),
        )
        const coincide = firmas
            .split(' ')
            .map((f) => f.trim())
            .filter((f) => f.startsWith('v1,'))
            .some((f) => {
                const recibida = Buffer.from(f.slice(3))
                return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
            })
        if (!coincide) throw new FirmaInvalida('La firma no coincide')

        let datos: Record<string, any>
        try {
            datos = JSON.parse(entrada.cuerpo) as Record<string, any>
        } catch {
            throw new FirmaInvalida('Cuerpo inválido')
        }
        const tipo = String(datos.event_type ?? '')
        const estado = estadoDeEvento(tipo, datos)
        const fee = datos.details?.fee ?? datos.fee ?? 0
        const retenido = datos.details?.vat_withheld ?? datos.vat_withheld ?? 0
        const referencia =
            estado === 'reembolsado' ? datos.refund?.id : estado === 'disputa' ? datos.id : null
        const checkout = checkoutDe(datos)
        return {
            id_evento: id,
            // un contracargo puede no traer el checkout: se registra con su propio id (cobro desconocido)
            id_proveedor: checkout || (estado === 'disputa' ? `disputa:${String(datos.id ?? id)}` : ''),
            estado,
            monto: deCentavos(
                estado === 'reembolsado'
                    ? datos.refund?.customer_refunded_amount_in_cents
                    : datos.amount_in_cents,
            ),
            comision: deCentavos(fee),
            retenido_iva: deCentavos(retenido),
            referencia_evento: referencia ? String(referencia) : null,
            ocurrido_en: datos.created_at ? new Date(datos.created_at) : new Date(marca * 1000),
            payload: datos,
        }
    }

    async consultar(idProveedor: string): Promise<EstadoEnProveedor> {
        const checkout = await this.llamar('GET', `/checkouts/${encodeURIComponent(idProveedor)}`)
        const estado = estadoDeCheckout(String(checkout.status ?? ''))
        const monto = deCentavos(checkout.total_in_cents)
        let comision = '0.00'
        let pagadoEn: Date | null = null
        const pagoId = checkout.payment?.id
        if (estado === 'pagado' && pagoId) {
            try {
                const intent = await this.llamar('GET', `/intents/${encodeURIComponent(String(pagoId))}`)
                comision = deCentavos(intent.details?.fee ?? intent.fee ?? 0)
                pagadoEn = intent.created_at ? new Date(intent.created_at) : null
            } catch {
                // sin el intent la comisión queda en 0.00 (la conciliación compara monto y estado)
            }
        }
        return {
            id_proveedor: String(checkout.id ?? idProveedor),
            estado,
            monto,
            monto_pagado: estado === 'pagado' ? monto : null,
            comision,
            pagado_en: pagadoEn,
        }
    }
}
