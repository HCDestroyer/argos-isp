import type { Schema, paths } from '@argosisp/contracts'

export type FiltroRevocarVinculaciones = NonNullable<paths['/api/v1/vinculaciones/revocar']['post']['requestBody']>['content']['application/json']
export type RevocacionVinculaciones = Schema<'RevocacionVinculaciones'>

/**
 * Vinculaciones de autologin (A1, `contratos/horus.md` §1.5): la cuenta de Horus de un usuario
 * ligada a su usuario de ArgosIsp. Cada usuario ve y quita las suyas; un administrador
 * (`vinculaciones.revocar`) puede revocar todas, las de un usuario o las de un conector.
 */
export function useVinculaciones() {
    const api = useApi()

    /** `GET /me/vinculaciones`: solo las vigentes del usuario de la sesión. */
    function mias(): Promise<Resultado<VinculacionExterna[]>> {
        return resolver(api.GET('/api/v1/me/vinculaciones'))
    }

    /** `POST /me/vinculaciones/:id/quitar`. */
    function quitar(id: number): Promise<Resultado<VinculacionExterna>> {
        return resolver(api.POST('/api/v1/me/vinculaciones/{id}/quitar', { params: { path: { id } } }))
    }

    /** `POST /vinculaciones/revocar` (`vinculaciones.revocar`): sin filtros, todas. */
    function revocar(filtro: FiltroRevocarVinculaciones): Promise<Resultado<RevocacionVinculaciones>> {
        return resolver(api.POST('/api/v1/vinculaciones/revocar', { body: filtro }))
    }

    return { mias, quitar, revocar }
}
