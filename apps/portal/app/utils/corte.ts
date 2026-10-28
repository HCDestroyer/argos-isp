import Decimal from 'decimal.js'
import type { Schema } from '@argosisp/contracts'

export interface MensajeCorte {
    titulo: string
    descripcion: string
}

/** `true` si el string decimal de la API es mayor que cero. Nunca convierte a `number`. */
export function hayMonto(monto: string | null | undefined): boolean {
    if (!monto) {
        return false
    }
    try {
        return new Decimal(monto).greaterThan(0)
    }
    catch {
        return false
    }
}

/** Título y explicación de la página de corte según lo que la API identificó por la IP. */
export function mensajeCorte(corte: Schema<'QuienSoy'>): MensajeCorte {
    if (!corte.identificado || !corte.estado) {
        return {
            titulo: 'No pudimos identificar tu servicio',
            descripcion: 'Conéctate desde la red de tu servicio de internet o comunícate con nosotros. '
                + 'También puedes pagar por depósito.',
        }
    }
    switch (corte.estado) {
        case 'suspendido':
            return {
                titulo: 'Tu servicio está suspendido',
                descripcion: corte.promesa_activa
                    ? 'Tienes una promesa de pago activa. Tu servicio se reactivará en unos momentos.'
                    : 'Paga el saldo pendiente o solicita una promesa de pago para reactivarlo.',
            }
        case 'limitado':
            return {
                titulo: 'Tu servicio está limitado',
                descripcion: 'Tu velocidad está reducida por saldo pendiente. Paga para recuperarla.',
            }
        case 'retirado':
            return {
                titulo: 'Tu servicio está dado de baja',
                descripcion: 'Comunícate con nosotros si quieres reactivarlo.',
            }
        case 'pendiente_instalacion':
            // Nunca como cortado: aún no se instala, así que no hay corte ni promesa (`instalacion.md` §3).
            return {
                titulo: 'Tu instalación está pendiente',
                descripcion: hayMonto(corte.monto_adeudado)
                    ? 'Tu servicio empezará a funcionar cuando el técnico termine la instalación. '
                    + 'Mientras tanto puedes pagar tus cargos pendientes.'
                    : 'Tu servicio empezará a funcionar cuando el técnico termine la instalación.',
            }
        case 'activo':
            return {
                titulo: 'Tu servicio está activo',
                descripcion: hayMonto(corte.monto_adeudado)
                    ? 'Tienes un saldo pendiente. Paga antes del vencimiento para evitar el corte.'
                    : 'No tienes saldo pendiente.',
            }
    }
}
