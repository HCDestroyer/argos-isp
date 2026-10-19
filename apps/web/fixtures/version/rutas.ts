/**
 * `GET /version` (A6, `app/monitoreo/version.ts`): cualquier sesión, sin permiso del ACL. La forma es
 * la de la API con `ARGOSISP_VERSION`, `ARGOSISP_COMMIT`, `ARGOSISP_COMPILADA` y la sección del
 * CHANGELOG generada por release-please (capturada contra la API real el 2026-10-19). Las pruebas
 * cambian `bd.version` para simular otra versión o `desarrollo`.
 */
import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { sinSesion, usuariosPorToken } from '../comun'

export const versionFixture: Schema<'VersionInstalada'> = {
    version: '1.4.2',
    commit: '72de300a1b2c3d4e5f60718293a4b5c6d7e8f901',
    compilada: '2026-10-19T02:10:00.000Z',
    notas_url: 'https://github.com/HCDestroyer/argos-isp/releases/tag/v1.4.2',
    cambios: [
        '### Funcionalidades',
        '',
        '* **web:** programa de lealtad: reglas, puntos del cliente y referidos ([#95](https://github.com/HCDestroyer/argos-isp/pull/95))',
        '* **ledger:** cobros por liquidar y conciliación bancaria',
        '',
        '### Correcciones',
        '',
        '* **billing:** el recargo por mora no cuenta para el corte (`tipo = mora`)',
        '* <script>alert("no")</script> se ve como texto',
    ].join('\n'),
}

export const rutasVersion: RutasFixture = {
    'GET /api/v1/version': ({ token }) => (token && usuariosPorToken[token]
        ? { status: 200, cuerpo: bd.version }
        : sinSesion()),
}
