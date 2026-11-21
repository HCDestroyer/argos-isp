import type { Schema } from '@argosisp/contracts'

export type ResolucionIp = Schema<'ResolucionIp'>

/** Dueño de una IP (`GET /ip/:ip`, `ip.resolver`): servicio que la tiene ahora (sesión o asignación vigente). */
export function useIp() {
    const api = useApi()

    /** IPv4 exacta o IPv6 dentro del prefijo; 404 si nadie la tiene. */
    function duenoDe(ip: string): Promise<Resultado<ResolucionIp>> {
        return resolver(api.GET('/api/v1/ip/{ip}', { params: { path: { ip: ip.trim() } } }))
    }

    return { duenoDe }
}
