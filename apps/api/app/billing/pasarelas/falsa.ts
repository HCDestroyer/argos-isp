import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { NoEncontrado } from '#shared/errores'
import { aTexto, dec, redondear } from '#ledger/dinero'
import {
    FirmaInvalida,
    VENTANA_WEBHOOK_S,
    type CobroCreado,
    type EntradaCrearCobro,
    type EntradaWebhook,
    type EstadoCobroProveedor,
    type EstadoEnProveedor,
    type NotificacionPasarela,
    type Pasarela,
} from '#billing/pasarelas/pasarela'

/**
 * Pasarela falsa para el laboratorio y las pruebas. Se comporta como un proveedor real: guarda
 * "su lado" en `billing.pasarela_falsa`, firma sus webhooks con HMAC-SHA256 y responde
 * `consultar`. Sirve de modelo para el adaptador real.
 *
 * Firma (cabecera `X-Pasarela-Firma`): `t=<unix>,v1=<hex(HMAC_SHA256(secreto, "<t>.<cuerpo>"))>`.
 * Cuerpo: `{ id_evento, tipo: "cobro.pagado" | "cobro.fallido", cobro: { id, estado, monto, comision } }`.
 * Comisión simulada: 3.5 % del monto. Secreto: `PASARELA_FALSA_SECRETO` (en desarrollo y pruebas
 * hay uno por defecto).
 */

export const CABECERA_FIRMA = 'x-pasarela-firma'
const COMISION_PCT = '3.5'

export function secretoFalsa(): string {
    return env.get('PASARELA_FALSA_SECRETO') ?? 'secreto-de-la-pasarela-falsa-solo-laboratorio'
}

export function firmar(cuerpo: string, marca: number, secreto = secretoFalsa()): string {
    const firma = createHmac('sha256', secreto).update(`${marca}.${cuerpo}`).digest('hex')
    return `t=${marca},v1=${firma}`
}

interface FilaFalsa {
    id_proveedor: string
    referencia: string
    monto: string
    estado: EstadoCobroProveedor
    monto_pagado: string | null
    comision: string
    pagado_en: Date | null
}

export class PasarelaFalsa implements Pasarela {
    readonly nombre = 'falsa'

    async crearCobro(entrada: EntradaCrearCobro): Promise<CobroCreado> {
        const idProveedor = `falsa_${randomUUID().replaceAll('-', '')}`
        await db.table('billing.pasarela_falsa').insert({
            id_proveedor: idProveedor,
            referencia: entrada.referencia,
            monto: aTexto(entrada.monto),
        })
        const base = (env.get('PASARELA_URL_PUBLICA') ?? '').replace(/\/$/, '')
        return {
            id_proveedor: idProveedor,
            url_pago: `${base}/api/v1/pasarela/falsa/${idProveedor}`,
            expira_en: new Date(Date.now() + 24 * 3600_000),
        }
    }

    verificarWebhook(entrada: EntradaWebhook): NotificacionPasarela {
        const cabecera = entrada.cabeceras[CABECERA_FIRMA]
        if (!cabecera) throw new FirmaInvalida(`Falta la cabecera ${CABECERA_FIRMA}`)
        const partes = new Map(
            cabecera.split(',').map((p) => {
                const [clave, ...valor] = p.trim().split('=')
                return [clave, valor.join('=')] as const
            }),
        )
        const marca = Number(partes.get('t'))
        const recibida = partes.get('v1') ?? ''
        if (!Number.isInteger(marca)) throw new FirmaInvalida('Marca de tiempo inválida')
        const ahora = Math.floor((entrada.ahora ?? new Date()).getTime() / 1000)
        if (Math.abs(ahora - marca) > VENTANA_WEBHOOK_S) {
            throw new FirmaInvalida(`La notificación está fuera de la ventana de ${VENTANA_WEBHOOK_S} s`)
        }
        const esperada = firmar(entrada.cuerpo, marca).split('v1=')[1]!
        const a = Buffer.from(esperada, 'hex')
        const b = Buffer.from(/^[0-9a-f]+$/i.test(recibida) ? recibida : '', 'hex')
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new FirmaInvalida('La firma no coincide')

        let datos: Record<string, any>
        try {
            datos = JSON.parse(entrada.cuerpo) as Record<string, any>
        } catch {
            throw new FirmaInvalida('Cuerpo inválido')
        }
        const cobro = (datos.cobro ?? {}) as Record<string, unknown>
        return {
            id_evento: String(datos.id_evento ?? ''),
            id_proveedor: String(cobro.id ?? ''),
            estado: (cobro.estado as EstadoCobroProveedor) ?? 'pendiente',
            monto: aTexto(String(cobro.monto ?? '0')),
            comision: aTexto(String(cobro.comision ?? '0')),
            ocurrido_en: new Date(marca * 1000),
            payload: datos,
        }
    }

    async consultar(idProveedor: string): Promise<EstadoEnProveedor> {
        const fila = (await db
            .from('billing.pasarela_falsa')
            .where('id_proveedor', idProveedor)
            .first()) as FilaFalsa | null
        if (!fila) throw new NoEncontrado(`La pasarela falsa no conoce el cobro ${idProveedor}`)
        return {
            id_proveedor: fila.id_proveedor,
            estado: fila.estado,
            monto: aTexto(fila.monto),
            monto_pagado: fila.monto_pagado === null ? null : aTexto(fila.monto_pagado),
            comision: aTexto(fila.comision),
            pagado_en: fila.pagado_en,
        }
    }

    /**
     * Laboratorio: el cliente "paga" en la pasarela. Marca el cobro en el lado del proveedor y
     * devuelve el webhook firmado que el proveedor enviaría (`monto` permite simular un pago por
     * otro monto). `notificar: false` simula un webhook perdido (la conciliación lo detecta).
     */
    async simularPago(
        idProveedor: string,
        opciones: { estado?: 'pagado' | 'fallido'; monto?: string; ahora?: Date } = {},
    ): Promise<{ cuerpo: string; cabeceras: Record<string, string> }> {
        const fila = (await db
            .from('billing.pasarela_falsa')
            .where('id_proveedor', idProveedor)
            .first()) as FilaFalsa | null
        if (!fila) throw new NoEncontrado(`La pasarela falsa no conoce el cobro ${idProveedor}`)
        const estado = opciones.estado ?? 'pagado'
        const monto = aTexto(opciones.monto ?? fila.monto)
        const comision =
            estado === 'pagado' ? aTexto(redondear(dec(monto).times(COMISION_PCT).div(100))) : '0.00'
        await db
            .from('billing.pasarela_falsa')
            .where('id_proveedor', idProveedor)
            .update({
                estado,
                monto_pagado: estado === 'pagado' ? monto : null,
                comision,
                pagado_en: estado === 'pagado' ? (opciones.ahora ?? new Date()) : null,
                updated_at: new Date(),
            })
        const cuerpo = JSON.stringify({
            id_evento: `evt_${randomUUID().replaceAll('-', '')}`,
            tipo: estado === 'pagado' ? 'cobro.pagado' : 'cobro.fallido',
            cobro: { id: idProveedor, referencia: fila.referencia, estado, monto, comision },
        })
        const marca = Math.floor((opciones.ahora ?? new Date()).getTime() / 1000)
        return { cuerpo, cabeceras: { [CABECERA_FIRMA]: firmar(cuerpo, marca) } }
    }
}
