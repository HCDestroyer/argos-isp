import type { Schema, paths } from '@argosisp/contracts'

// `TokenApi` sale de `utils/horus.ts` (mismo esquema del contrato).
export type TokenApiCreado = Schema<'TokenApiCreado'>
export type DatosTokenApi = paths['/api/v1/tokens']['post']['requestBody']['content']['application/json']
export type AlcancesTokenApi = NonNullable<DatosTokenApi['alcances']>

/** Tokens de API (integraciones, agentes de IA): lista, alta (el valor se ve una sola vez) y revocar. */
export function useTokensApi() {
    const api = useApi()

    function listar(cursor?: string): Promise<Resultado<Pagina<TokenApi>>> {
        const query: { limit: number, cursor?: string } = { limit: 50 }
        if (cursor) {
            query.cursor = cursor
        }
        return resolver(api.GET('/api/v1/tokens', { params: { query } }))
    }

    /** `POST /tokens` (`tokens.crear`): devuelve el valor en claro una sola vez; la API guarda su sha256. */
    function crear(datos: DatosTokenApi): Promise<Resultado<TokenApiCreado>> {
        return resolver(api.POST('/api/v1/tokens', { body: datos }))
    }

    /** `POST /tokens/:id/revocar` (`tokens.revocar`); repetirla no cambia la fecha. */
    function revocar(id: number): Promise<Resultado<TokenApi>> {
        return resolver(api.POST('/api/v1/tokens/{id}/revocar', { params: { path: { id } } }))
    }

    return { listar, crear, revocar }
}
