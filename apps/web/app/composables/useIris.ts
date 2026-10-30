import type { paths } from '@argosisp/contracts'

export type CambiosConectorIris = paths['/api/v1/integraciones/iris']['put']['requestBody']['content']['application/json']
export type DatosTokenIris = paths['/api/v1/integraciones/iris/tokens']['post']['requestBody']['content']['application/json']
export type FiltrosEnviosIris = NonNullable<paths['/api/v1/integraciones/iris/envios']['get']['parameters']['query']>
export type PaginaEnviosIris = paths['/api/v1/integraciones/iris/envios']['get']['responses'][200]['content']['application/json']

/**
 * Conector con Iris (A1 + A6, `contratos/iris.md`): configuración, enlace de conexión para pegar
 * en Iris, tokens `atk_` del usuario técnico Iris y los webhooks Argos → Iris. El navegador nunca
 * ve secretos: solo lo que la API muestra una sola vez.
 */
export function useIris() {
    const api = useApi()

    /** `GET /integraciones/iris` (`iris.ver`): secretos como `***`, `version: 0` si nunca se guardó. */
    function conector(): Promise<Resultado<ConectorIris>> {
        return resolver(api.GET('/api/v1/integraciones/iris'))
    }

    /** `PUT /integraciones/iris` (`iris.configurar`) con la `version` leída (409 si cambió). */
    function guardar(cambios: CambiosConectorIris): Promise<Resultado<ConectorIris>> {
        return resolver(api.PUT('/api/v1/integraciones/iris', { body: cambios }))
    }

    /** `POST /integraciones/iris/enlace` (`iris.configurar`): 15 min, un uso, se muestra una vez. */
    function generarEnlace(): Promise<Resultado<EnlaceConexionIris>> {
        return resolver(api.POST('/api/v1/integraciones/iris/enlace'))
    }

    /** `GET /integraciones/iris/tokens` (`iris.ver`): sin su valor, los más nuevos primero. */
    function tokens(): Promise<Resultado<TokenApi[]>> {
        return resolver(api.GET('/api/v1/integraciones/iris/tokens'))
    }

    /** `POST /integraciones/iris/tokens` (`iris.generar_token`): el `atk_` se muestra una sola vez. */
    function generarToken(datos: DatosTokenIris): Promise<Resultado<TokenIrisCreado>> {
        return resolver(api.POST('/api/v1/integraciones/iris/tokens', { body: datos }))
    }

    /** `POST /integraciones/iris/tokens/:id/revocar` (`iris.revocar_token`). */
    function revocarToken(id: number): Promise<Resultado<TokenApi>> {
        return resolver(api.POST('/api/v1/integraciones/iris/tokens/{id}/revocar', { params: { path: { id } } }))
    }

    /** `GET /integraciones/iris/envios` (`iris.ver`): webhooks a Iris, los más nuevos primero. */
    function envios(filtros: FiltrosEnviosIris = {}): Promise<Resultado<PaginaEnviosIris>> {
        return resolver(api.GET('/api/v1/integraciones/iris/envios', { params: { query: filtros } }))
    }

    /** `GET /integraciones/iris/envios/resumen` (`iris.ver`): destino, alcance, pendientes y fallidos. */
    function resumenEnvios(): Promise<Resultado<ResumenEnviosIris>> {
        return resolver(api.GET('/api/v1/integraciones/iris/envios/resumen'))
    }

    return { conector, guardar, generarEnlace, tokens, generarToken, revocarToken, envios, resumenEnvios }
}
