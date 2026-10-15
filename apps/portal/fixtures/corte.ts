/**
 * Respuestas de `GET /api/v1/portal/quien-soy` para el modo fixtures y las pruebas.
 * Tipadas contra el contrato: si el schema `QuienSoy` cambia, `pnpm typecheck` lo detecta.
 */
import type { Schema } from '@argosisp/contracts'

export const QUIEN_SOY_SUSPENDIDO: Schema<'QuienSoy'> = {
    identificado: true,
    ip: '198.51.100.23',
    nombre_parcial: 'Juan P.',
    estado: 'suspendido',
    promesa_activa: false,
    monto_adeudado: '525.00',
    facturas_vencidas: { cantidad: 2, total: '350.00' },
}

export const QUIEN_SOY_ACTIVO: Schema<'QuienSoy'> = {
    identificado: true,
    ip: '2001:db8:200:100::1',
    nombre_parcial: 'María G.',
    estado: 'activo',
    promesa_activa: true,
    monto_adeudado: '175.00',
    facturas_vencidas: { cantidad: 0, total: '0.00' },
}

export const QUIEN_SOY_DESCONOCIDO: Schema<'QuienSoy'> = {
    identificado: false,
    ip: '203.0.113.9',
    nombre_parcial: null,
    estado: null,
    promesa_activa: null,
    monto_adeudado: null,
    facturas_vencidas: null,
}

export const ESCENARIOS_CORTE = {
    suspendido: QUIEN_SOY_SUSPENDIDO,
    activo: QUIEN_SOY_ACTIVO,
    desconocido: QUIEN_SOY_DESCONOCIDO,
}

export type EscenarioCorte = keyof typeof ESCENARIOS_CORTE
