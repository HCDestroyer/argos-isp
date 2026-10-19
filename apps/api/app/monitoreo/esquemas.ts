import { definirEsquema, nulable, objeto, texto } from '#shared/openapi/esquemas'

/** Respuesta de `GET /api/v1/version` (`app/monitoreo/version.ts`). */
export const VersionInstalada = definirEsquema(
    'VersionInstalada',
    objeto({
        version: {
            type: 'string',
            description:
                'SemVer de la imagen instalada (`1.4.2`) o `desarrollo` fuera de una imagen publicada',
        },
        commit: { ...nulable(texto), description: 'SHA del commit de la imagen' },
        compilada: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'Fecha de compilación de la imagen (UTC)',
        },
        notas_url: {
            type: ['string', 'null'],
            format: 'uri',
            description: 'Notas de la versión en GitHub Releases (null en desarrollo)',
        },
        cambios: {
            ...nulable(texto),
            description: 'Sección de la versión en CHANGELOG.md, en Markdown (null si no está)',
        },
    }),
)
