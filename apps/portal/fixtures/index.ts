/**
 * Rutas del modo fixtures del portal (`NUXT_PUBLIC_USE_FIXTURES=true`).
 * Las respuestas se tipan contra `@argosisp/contracts` cuando el endpoint existe ahí.
 *
 * El portal usa sesión por cookie httpOnly (sin Bearer); en fixtures no hay sesión real.
 */
import type { RutasFixture } from '~/utils/fetchFixtures'
import corteSuspendido from './corte/suspendido.json'

export const rutasFixture: RutasFixture = {
    // NEEDS(A5): endpoint aún fuera del contrato; `useCorte()` lee el JSON directo mientras tanto.
    'GET /api/v1/portal/quien-soy': () => ({ status: 200, cuerpo: corteSuspendido }),
}
