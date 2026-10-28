/**
 * Respuestas de `GET /api/v1/portal/quien-soy` y `GET /api/v1/portal/estado` para el modo fixtures y las pruebas.
 * Tipadas contra el contrato: si el schema `QuienSoy` cambia, `pnpm typecheck` lo detecta.
 */
import type { Schema } from '@argosisp/contracts'
import { MARCA_FIXTURE } from './empresa'

export const QUIEN_SOY_SUSPENDIDO: Schema<'QuienSoy'> = {
    identificado: true,
    ip: '198.51.100.23',
    nombre_parcial: 'Juan P.',
    estado: 'suspendido',
    promesa_activa: false,
    monto_adeudado: '525.00',
    facturas_vencidas: { cantidad: 2, total: '350.00' },
    empresa: MARCA_FIXTURE,
}

export const QUIEN_SOY_ACTIVO: Schema<'QuienSoy'> = {
    identificado: true,
    ip: '2001:db8:200:100::1',
    nombre_parcial: 'María G.',
    estado: 'activo',
    promesa_activa: true,
    monto_adeudado: '175.00',
    facturas_vencidas: { cantidad: 0, total: '0.00' },
    empresa: MARCA_FIXTURE,
}

export const QUIEN_SOY_DESCONOCIDO: Schema<'QuienSoy'> = {
    identificado: false,
    ip: '203.0.113.9',
    nombre_parcial: null,
    estado: null,
    promesa_activa: null,
    monto_adeudado: null,
    facturas_vencidas: null,
    empresa: null,
}

/**
 * Vendido y aún sin instalar (`contratos/instalacion.md`): no navega ni se factura la mensualidad;
 * solo debe el cargo de instalación, ya vencido. Nunca se muestra como cortado.
 */
export const QUIEN_SOY_PENDIENTE: Schema<'QuienSoy'> = {
    identificado: true,
    ip: '198.51.100.77',
    nombre_parcial: 'Ana L.',
    estado: 'pendiente_instalacion',
    promesa_activa: false,
    monto_adeudado: '250.00',
    facturas_vencidas: { cantidad: 1, total: '250.00' },
    empresa: MARCA_FIXTURE,
}

/** Suspendido con promesa aprobada: `/portal/estado` pasa a `activo` (escenario `reactivacion`). */
export const QUIEN_SOY_CON_PROMESA: Schema<'QuienSoy'> = {
    ...QUIEN_SOY_SUSPENDIDO,
    promesa_activa: true,
}

export const ESCENARIOS_CORTE = {
    suspendido: QUIEN_SOY_SUSPENDIDO,
    activo: QUIEN_SOY_ACTIVO,
    desconocido: QUIEN_SOY_DESCONOCIDO,
    reactivacion: QUIEN_SOY_CON_PROMESA,
    pendiente: QUIEN_SOY_PENDIENTE,
}

/** Respuesta de `GET /api/v1/portal/estado` que corresponde a una de `quien-soy`. */
export function estadoDe(quienSoy: Schema<'QuienSoy'>): Schema<'EstadoPortal'> {
    return {
        identificado: quienSoy.identificado,
        estado: quienSoy.estado,
        monto_adeudado: quienSoy.monto_adeudado,
    }
}

export const ESTADO_REACTIVADO: Schema<'EstadoPortal'> = {
    identificado: true,
    estado: 'activo',
    monto_adeudado: '0.00',
}

export type EscenarioCorte = keyof typeof ESCENARIOS_CORTE
