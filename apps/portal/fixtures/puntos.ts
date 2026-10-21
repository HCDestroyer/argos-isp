import type { Schema } from '@argosisp/contracts'
import { MARCA_FIXTURE } from './empresa'

/**
 * Puntos de lealtad en fixtures (contrato `lealtad.md` §12), como los devuelve la API: un programa
 * en Red Altiplano con 140 puntos (90 vencen pronto) y premios de cada caso.
 */

export const PROGRAMA_FIXTURE: Schema<'PortalPuntosEmpresa'>['programa'] = {
    nombre: 'Puntos Altiplano',
    terminos: 'Ganas 10 puntos por cada pago a tiempo. Los puntos vencen a los 12 meses de ganarlos.\nUn premio por servicio a la vez.',
    minimo_canje: 50,
    vencimiento_meses: 12,
    aviso_vencimiento_dias: 30,
    canje_portal: true,
}

export const PUNTOS_FIXTURE: Schema<'PortalPuntosEmpresa'> = {
    empresa: MARCA_FIXTURE,
    programa: PROGRAMA_FIXTURE,
    saldo: 140,
    por_vencer: 90,
    proximo_vencimiento: '2026-11-05',
    vencen_pronto: [
        { puntos: 40, vence_en: '2026-11-05' },
        { puntos: 50, vence_en: '2026-11-12' },
    ],
    movimientos: [
        { id: 9105, tipo: 'acumulacion', origen_tipo: 'pago', puntos: 10, servicio_id: 41, vence_en: '2027-10-02', created_at: '2026-10-02T15:20:00.000Z' },
        { id: 9104, tipo: 'canje', origen_tipo: 'canje', puntos: -60, servicio_id: 41, vence_en: null, created_at: '2026-09-18T17:02:00.000Z' },
        { id: 9103, tipo: 'acumulacion', origen_tipo: 'referido', puntos: 100, servicio_id: null, vence_en: '2027-09-10', created_at: '2026-09-10T14:00:00.000Z' },
        { id: 9102, tipo: 'vencimiento', origen_tipo: 'lote', puntos: -20, servicio_id: null, vence_en: null, created_at: '2026-08-31T06:00:00.000Z' },
        { id: 9101, tipo: 'acumulacion', origen_tipo: 'pago', puntos: 10, servicio_id: 41, vence_en: '2026-11-05', created_at: '2025-11-05T16:45:00.000Z' },
    ],
}

function premio(datos: Partial<Schema<'PortalPremio'>> & Pick<Schema<'PortalPremio'>, 'id' | 'nombre' | 'tipo' | 'costo_puntos'>): Schema<'PortalPremio'> {
    return {
        empresa_id: MARCA_FIXTURE.id,
        descuento_tipo: null,
        descuento_valor: null,
        tope: null,
        dias: null,
        plan_destino: null,
        agotado: false,
        canjeable: true,
        motivo_no_canjeable: null,
        faltan: 0,
        ...datos,
    }
}

export const PREMIOS_FIXTURE: Schema<'PortalPremio'>[] = [
    premio({ id: 501, nombre: 'Q 25 de descuento', tipo: 'descuento_factura', costo_puntos: 60, descuento_tipo: 'monto', descuento_valor: '25.00' }),
    premio({ id: 502, nombre: 'Doble de velocidad un mes', tipo: 'mejora_plan', costo_puntos: 120, dias: 30, plan_destino: 'Fibra 50 Mbps' }),
    premio({ id: 503, nombre: 'Un mes gratis', tipo: 'mes_gratis', costo_puntos: 300, canjeable: false, motivo_no_canjeable: 'puntos_insuficientes', faltan: 160 }),
    premio({ id: 504, nombre: 'Router de regalo', tipo: 'bien', costo_puntos: 100, agotado: true, canjeable: false, motivo_no_canjeable: 'no_disponible_en_portal' }),
]

export const CANJES_FIXTURE: Schema<'PortalCanje'>[] = [
    {
        id: 77,
        empresa_id: MARCA_FIXTURE.id,
        servicio_id: 41,
        premio_nombre: 'Q 25 de descuento',
        tipo: 'descuento_factura',
        puntos: 60,
        estado: 'aplicado',
        descuento: '25.00',
        aplicado_en: '2026-10-01T06:10:00.000Z',
        created_at: '2026-09-18T17:02:00.000Z',
    },
]
