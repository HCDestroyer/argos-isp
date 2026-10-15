import { generarOpenApi } from '#shared/openapi/generador'
import { registroRutas } from '#start/routes/index'

/**
 * Documento OpenAPI serializado tal como se escribe en `packages/contracts/openapi.json`.
 */
export async function construirOpenApi(): Promise<string> {
    const documento = generarOpenApi(registroRutas, {
        titulo: 'ArgosIsp API',
        version: '1.0.0',
        descripcion:
            'API REST de ArgosIsp. Generado desde apps/api (no editar a mano): `pnpm contracts:build`. ' +
            'Errores en RFC 9457 (application/problem+json); listas con paginación por cursor; ' +
            'operaciones con `x-implementado: false` responden 501 por ahora.',
    })
    return JSON.stringify(documento, null, 2) + '\n'
}
