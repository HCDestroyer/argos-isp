import type { RutasFixture } from '~/utils/fetchFixtures'
import { conPermiso } from '../comun'
import { resumenDashboard } from './datos'

export const rutasReportes: RutasFixture = {
    'GET /api/v1/dashboard/resumen': conPermiso('reportes.ver', () => ({ status: 200, cuerpo: structuredClone(resumenDashboard) })),
}
