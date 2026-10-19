/*
|--------------------------------------------------------------------------
| Rutas de sistema (A6, app/monitoreo): versión instalada
|--------------------------------------------------------------------------
|
| `/health` y `/metrics` viven fuera de /api/v1 (start/routes.ts). La versión va dentro para que el
| panel la lea con su cliente tipado (packages/contracts).
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { VersionInstalada } from '#monitoreo/esquemas'
import { versionInstalada } from '#monitoreo/version'

const monitoreo: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/version',
        operacion: 'versionInstalada',
        resumen: 'Versión instalada de ArgosIsp y qué cambió en ella',
        descripcion:
            'Cualquier usuario con sesión (sin permiso del ACL, como `/me`). `cambios` es la sección ' +
            'de la versión en CHANGELOG.md (Markdown); `notas_url`, la página de GitHub Releases.',
        etiqueta: 'sistema',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Versión instalada', esquema: VersionInstalada },
        handler: () => versionInstalada(),
    }),
]

export default monitoreo
