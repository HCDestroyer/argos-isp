/**
 * Programa de lealtad, fase 1 (A3, `contratos/lealtad.md` §15.1). Datos tipados con `Schema<'X'>` y
 * la forma de las respuestas capturadas de la API real (`pnpm demo:datos`, programa con
 * diferimiento al 80 %, cuatro reglas y dos ajustes el 2026-10-18), con los ids de los fixtures:
 *
 * - ArgosNet (empresa 1) tiene el programa activo "Puntos Argos" (Q 0.10 por punto, pasivo Q 0.08).
 * - Fibra del Sur (empresa 2) no tiene programa (`GET /lealtad/programa` → `programa: null`).
 * - Juan Carlos Ramírez (cliente 2) tiene 210 puntos vivos de un ajuste y dos pagos a tiempo.
 * - Dos referidos de María José Pérez (cliente 1): uno pendiente y uno calificado.
 */
import type { Schema } from '@argosisp/contracts'

type Movimiento = Schema<'MovimientoPuntos'>

const CREADO = '2026-10-01T15:00:00.000Z'

export const programasLealtad: Schema<'ProgramaLealtad'>[] = [
    {
        id: 1,
        empresa_id: 1,
        nombre: 'Puntos Argos',
        activo: true,
        valor_punto: '0.10',
        diferimiento: true,
        canje_esperado_pct: '80.000000',
        valor_pasivo_punto: '0.080000',
        vencimiento_meses: 12,
        aviso_vencimiento_dias: 30,
        minimo_canje: 100,
        terminos: 'Los puntos vencen a los 12 meses de ganados.',
        terminos_hash: '1b4ddb095e0e830703bc4bb3fe872b1edb9f614e318f83ad2ade95e288cf98cc',
        vigente_desde: '2026-10-01',
        vigente_hasta: null,
        version: 2,
        created_at: CREADO,
        updated_at: CREADO,
    },
]

function regla(id: number, tipo: Schema<'ReglaLealtad'>['tipo'], puntos: number, condiciones: Schema<'ReglaLealtad'>['condiciones'], extra: Partial<Schema<'ReglaLealtad'>> = {}): Schema<'ReglaLealtad'> {
    return {
        id,
        empresa_id: 1,
        programa_id: 1,
        tipo,
        condiciones,
        recompensa: 'puntos',
        puntos,
        premio_id: null,
        sorteo_id: null,
        tope_por_cliente: null,
        periodo_tope: null,
        activa: true,
        vigente_desde: '2026-10-01',
        vigente_hasta: null,
        version: 1,
        created_at: CREADO,
        updated_at: CREADO,
        ...extra,
    }
}

export const reglasLealtad: Schema<'ReglaLealtad'>[] = [
    regla(1, 'pago_a_tiempo', 10, { dias_antes_vencimiento: 0, solo_servicio: true, sin_promesa: true, racha: { periodos: 6, puntos_extra: 50 }, monto_minimo: null }),
    regla(2, 'antiguedad', 100, { cada_meses: 12, sin_vencidas_mas_de_dias: 15, estados_validos: ['activo'] }),
    regla(3, 'referido', 150, { facturas_pagadas_minimas: 2, dias_maximos: 120, tope_por_referidor: null, puntos_referido: 50 }, { tope_por_cliente: 10, periodo_tope: 'anio' }),
    regla(4, 'pago_adelantado', 0, { periodos_minimos: 3, puntos_por_periodo: 15 }, { activa: false }),
]

function movimiento(id: number, datos: Partial<Movimiento> & Pick<Movimiento, 'tipo' | 'puntos' | 'origen_tipo' | 'created_at'>): Movimiento {
    return {
        id,
        empresa_id: 1,
        programa_id: 1,
        cliente_id: 2,
        servicio_id: 2,
        regla_id: null,
        origen_id: null,
        clave_unica: `ajuste:fixture-${id}`,
        vence_en: null,
        valor: '0.00',
        asiento_id: null,
        reversa_de: null,
        motivo: null,
        creado_por: null,
        ...datos,
    }
}

/** Movimientos (solo inserción): ganados, un ajuste positivo y uno negativo. */
export const movimientosPuntos: Movimiento[] = [
    movimiento(1, { tipo: 'acumulacion', puntos: 10, regla_id: 1, origen_tipo: 'factura', origen_id: 2, clave_unica: 'pago_a_tiempo:factura:2', vence_en: '2027-09-05', valor: '0.80', created_at: '2026-09-05T16:20:00.000Z' }),
    movimiento(2, { tipo: 'acumulacion', puntos: 10, regla_id: 1, origen_tipo: 'factura', origen_id: 3, clave_unica: 'pago_a_tiempo:factura:3', vence_en: '2027-10-05', valor: '0.80', created_at: '2026-10-05T16:20:00.000Z' }),
    movimiento(3, { tipo: 'ajuste', puntos: 250, origen_tipo: 'ajuste', vence_en: '2027-10-12', valor: '20.00', motivo: 'Compensación por falla del 12 de octubre', creado_por: 1, created_at: '2026-10-12T18:00:00.000Z' }),
    movimiento(4, { tipo: 'ajuste', puntos: -40, origen_tipo: 'ajuste', valor: '3.20', motivo: 'Corrección de ajuste duplicado', creado_por: 1, created_at: '2026-10-13T15:00:00.000Z' }),
]

/** Lotes vivos de esos movimientos (el ajuste negativo consumió del lote más antiguo que vence primero). */
export const lotesPuntos: (Schema<'LotePuntos'> & { cliente_id: number, empresa_id: number })[] = [
    { id: 1, cliente_id: 2, empresa_id: 1, programa_id: 1, servicio_id: 2, regla_id: 1, tipo: 'acumulacion', puntos: 10, restante: 0, valor: '0.80', valor_restante: '0.00', vence_en: '2027-09-05', created_at: '2026-09-05T16:20:00.000Z' },
    { id: 2, cliente_id: 2, empresa_id: 1, programa_id: 1, servicio_id: 2, regla_id: 1, tipo: 'acumulacion', puntos: 10, restante: 0, valor: '0.80', valor_restante: '0.00', vence_en: '2027-10-05', created_at: '2026-10-05T16:20:00.000Z' },
    { id: 3, cliente_id: 2, empresa_id: 1, programa_id: 1, servicio_id: 2, regla_id: null, tipo: 'ajuste', puntos: 250, restante: 230, valor: '20.00', valor_restante: '18.40', vence_en: '2027-10-12', created_at: '2026-10-12T18:00:00.000Z' },
]

export const referidosLealtad: Schema<'ReferidoLealtad'>[] = [
    { id: 1, empresa_id: 1, referidor_id: 1, referidor_nombre: 'María José Pérez López', referido_id: 4, referido_nombre: 'Ana Lucía Morales', codigo: 'HJRBBGCN', estado: 'calificado', calificado_en: '2026-10-10T16:00:00.000Z', motivo: null, version: 2, created_at: '2026-09-02T15:00:00.000Z', updated_at: '2026-10-10T16:00:00.000Z' },
    { id: 2, empresa_id: 1, referidor_id: 1, referidor_nombre: 'María José Pérez López', referido_id: 7, referido_nombre: 'Rosa Elena Cifuentes', codigo: 'HJRBBGCN', estado: 'pendiente', calificado_en: null, motivo: null, version: 1, created_at: '2026-10-08T15:00:00.000Z', updated_at: '2026-10-08T15:00:00.000Z' },
]
