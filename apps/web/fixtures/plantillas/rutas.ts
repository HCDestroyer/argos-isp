import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, versionCambiada } from '../comun'

const CERTIFICAR_AL = ['emitir', 'pagar', 'nunca'] as const

export const rutasPlantillas: RutasFixture = {
    'GET /api/v1/plantillas-facturacion': conPermiso('plantillas.ver', () => ({ status: 200, cuerpo: bd.plantillas })),

    /** Edición parcial con `version` (aquí, solo `certificar_al`, lo que usa Configuración → FEL). */
    'PUT /api/v1/plantillas-facturacion/:id': conPermiso('plantillas.editar', (solicitud) => {
        const plantilla = bd.plantillas.find(p => p.id === idDe(solicitud))
        if (!plantilla) {
            return noEncontrado('la plantilla')
        }
        const { version, certificar_al: certificarAl } = cuerpoObjeto(solicitud)
        if (typeof version !== 'number') {
            return datosInvalidos([{ field: 'version', message: 'El campo version es obligatorio', rule: 'required' }])
        }
        if (certificarAl !== undefined && !(CERTIFICAR_AL as readonly unknown[]).includes(certificarAl)) {
            return datosInvalidos([{ field: 'certificar_al', message: 'El valor de certificar_al no es válido', rule: 'enum' }])
        }
        if (version !== plantilla.version) {
            return versionCambiada()
        }
        const anterior = plantilla.certificar_al
        Object.assign(plantilla, {
            certificar_al: (CERTIFICAR_AL as readonly unknown[]).includes(certificarAl) ? certificarAl : plantilla.certificar_al,
            version: plantilla.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'plantillas.editar', { tipo: 'plantilla', id: plantilla.id }, { certificar_al: { de: anterior, a: plantilla.certificar_al } })
        return { status: 200, cuerpo: plantilla }
    }),
}
