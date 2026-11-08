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

/**
 * Por qué no se identificó el servicio (`motivo` de `quien-soy`, `contratos/corte-identificacion.md`),
 * en palabras del cliente: nunca detalles de la red del ISP.
 */
const SIN_IDENTIFICAR: Record<NonNullable<Schema<'QuienSoy'>['motivo']>, string> = {
    codigo_vencido: 'El enlace que abriste ya venció. Abre cualquier página http:// otra vez o entra con tu NIT o usuario.',
    ip_de_router: 'Desde esta conexión no podemos saber cuál es tu servicio. Entra con tu NIT o usuario y te mandamos un código.',
    ip_de_servidor: 'Desde esta conexión no podemos saber cuál es tu servicio. Entra con tu NIT o usuario y te mandamos un código.',
    ip_de_proxy: 'Desde esta conexión no podemos saber cuál es tu servicio. Entra con tu NIT o usuario y te mandamos un código.',
    ip_desconocida: 'Conéctate desde la red de tu servicio de internet o entra con tu NIT o usuario.',
}

/** Título y explicación de la página de corte según lo que la API identificó (código o IP). */
export function mensajeCorte(corte: Schema<'QuienSoy'>): MensajeCorte {
    if (!corte.identificado || !corte.estado) {
        const motivo = corte.motivo ? SIN_IDENTIFICAR[corte.motivo] : SIN_IDENTIFICAR.ip_desconocida
        return {
            titulo: 'No pudimos identificar tu servicio',
            descripcion: `${motivo} También puedes pagar por depósito o comunicarte con nosotros.`,
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
