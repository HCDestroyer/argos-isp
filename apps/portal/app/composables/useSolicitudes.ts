import type { paths } from '@argosisp/contracts'

export type CuerpoSolicitud = paths['/api/v1/portal/soporte/solicitudes']['post']['requestBody']['content']['application/json']

/**
 * Solicitudes de servicio del cliente en Iris (`/portal/soporte/solicitudes`, contrato Iris 0.9.0
 * §11.7): alta, cambio de plan, traslado u otra. En Iris son prospectos que atiende un asesor.
 */
export function useSolicitudes() {
    const api = useApi()

    function lista(empresaId?: number) {
        return useListaCursor<SolicitudServicio>(cursor => resolver(api.GET('/api/v1/portal/soporte/solicitudes', {
            params: { query: { limit: 20, ...(empresaId ? { empresa_id: empresaId } : {}), ...(cursor ? { cursor } : {}) } },
        })))
    }

    function planes() {
        return resolver(api.GET('/api/v1/portal/soporte/planes'))
    }

    /** `clave` va en `Idempotency-Key`: la misma en los reintentos del mismo envío. */
    function solicitar(cuerpo: CuerpoSolicitud, clave: string) {
        return resolver(api.POST('/api/v1/portal/soporte/solicitudes', {
            params: { header: { 'Idempotency-Key': clave } },
            body: cuerpo,
        }))
    }

    return { lista, planes, solicitar }
}
