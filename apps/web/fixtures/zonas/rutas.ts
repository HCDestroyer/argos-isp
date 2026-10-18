import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, versionCambiada } from '../comun'

export const rutasZonas: RutasFixture = {
    'GET /api/v1/zonas': conPermiso('zonas.ver', () => ({ status: 200, cuerpo: bd.zonas })),

    /** Como `EditarZona` (A1): nombre y empresa sugerida (`null` la quita), con `version` (409). */
    'PUT /api/v1/zonas/:id': conPermiso('zonas.editar', (solicitud) => {
        const zona = bd.zonas.find(z => z.id === idDe(solicitud))
        if (!zona) {
            return noEncontrado('la zona')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== zona.version) {
            return versionCambiada()
        }
        if (typeof cuerpo.nombre !== 'string' || !cuerpo.nombre.trim()) {
            return datosInvalidos([{ field: 'nombre', message: 'Es obligatorio', rule: 'required' }])
        }
        const sugerida = cuerpo.empresa_sugerida_id
        if (sugerida !== undefined && sugerida !== null && !bd.empresas.some(e => e.id === sugerida && e.activa)) {
            return datosInvalidos([{ field: 'empresa_sugerida_id', message: 'La empresa no existe o está inactiva', rule: 'exists' }])
        }
        zona.nombre = cuerpo.nombre.trim()
        if (sugerida !== undefined) {
            zona.empresa_sugerida_id = sugerida as number | null
        }
        zona.version += 1
        zona.updated_at = ahora()
        registrarAccion(solicitud, 'zonas.editar', { tipo: 'zona', id: zona.id }, cuerpo)
        return { status: 200, cuerpo: zona }
    }),
}
