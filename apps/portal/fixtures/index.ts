/**
 * Rutas del modo fixtures del portal (`NUXT_PUBLIC_USE_FIXTURES=true`).
 * Las respuestas se tipan contra `@argosisp/contracts`.
 *
 * El portal usa sesión por cookie httpOnly (sin Bearer); en fixtures no hay sesión real.
 */
import type { RutasFixture } from '~/utils/fetchFixtures'
import { ESCENARIOS_CORTE, type EscenarioCorte } from './corte'

/**
 * Escenario de `/corte` en fixtures: `?fixture=activo|suspendido|desconocido` en la URL del
 * portal (solo desarrollo). Por defecto, suspendido.
 */
function escenarioCorte(): EscenarioCorte {
    const pedido = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('fixture')
    return pedido && pedido in ESCENARIOS_CORTE ? pedido as EscenarioCorte : 'suspendido'
}

export const rutasFixture: RutasFixture = {
    'GET /api/v1/portal/quien-soy': () => ({ status: 200, cuerpo: ESCENARIOS_CORTE[escenarioCorte()] }),
}
