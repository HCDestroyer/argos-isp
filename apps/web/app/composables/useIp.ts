import type { Schema } from '@argosisp/contracts'

export type ResolucionIp = Schema<'ResolucionIp'>

/**
 * Quién tiene una IP (`GET /ip/:ip`, `ip.resolver`): busca en sesiones activas y asignaciones
 * vigentes. 404 = nadie la tiene. El alta de servicio lo usa para decir «Libre» u «Ocupada por
 * S-000123» antes de guardar; el 409 de `POST /servicios` sigue siendo la última palabra.
 */
export function useIp() {
    const api = useApi()

    function consultar(ip: string): Promise<Resultado<ResolucionIp>> {
        return resolver(api.GET('/api/v1/ip/{ip}', { params: { path: { ip } } }))
    }

    return { consultar }
}
