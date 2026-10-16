import type { Schema, paths } from '@argosisp/contracts'

export type Empresa = Schema<'Empresa'>
export type CambiosEmpresa = paths['/api/v1/empresa']['put']['requestBody']['content']['application/json']

/**
 * Configuración de la empresa (A5): contacto, horario e instrucciones de pago que salen en el
 * aviso de cobro, el portal y las notificaciones. `version: 0` = nunca se guardó.
 */
export function useEmpresa() {
    const api = useApi()

    /** `GET /empresa` (`empresa.ver`). */
    function ver(): Promise<Resultado<Empresa>> {
        return resolver(api.GET('/api/v1/empresa'))
    }

    /** `PUT /empresa` (`empresa.editar`) con la `version` leída; 409 si alguien más la cambió. */
    function editar(cambios: CambiosEmpresa): Promise<Resultado<Empresa>> {
        return resolver(api.PUT('/api/v1/empresa', { body: cambios }))
    }

    return { ver, editar }
}
