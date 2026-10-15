import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso } from '../comun'

export const rutasZonas: RutasFixture = {
    'GET /api/v1/zonas': conPermiso('zonas.ver', () => ({ status: 200, cuerpo: bd.zonas })),
}
