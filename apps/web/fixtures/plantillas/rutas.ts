import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso } from '../comun'

export const rutasPlantillas: RutasFixture = {
    'GET /api/v1/plantillas-facturacion': conPermiso('plantillas.ver', () => ({ status: 200, cuerpo: bd.plantillas })),
}
