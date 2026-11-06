import type { paths } from '@argosisp/contracts'

export type CuerpoPortalCorte = paths['/api/v1/corte/configuracion']['put']['requestBody']['content']['application/json']

/**
 * Portal de corte: a dónde mandan los routers a los suspendidos (IPv4, IPv6 y puerto del NAT) y
 * cómo se suspende una sesión. Una sola configuración para toda la instalación; la página que ve
 * cada empresa es su `url_corte` (Configuración → Empresas).
 */
export function usePortalCorte() {
    const api = useApi()

    /** `GET /corte/configuracion` (`portal_corte.ver`): `version` 0 = nunca se guardó (valores del servidor). */
    function ver(): Promise<Resultado<PortalCorte>> {
        return resolver(api.GET('/api/v1/corte/configuracion'))
    }

    /**
     * `PUT /corte/configuracion` (`portal_corte.configurar`): solo cambia lo enviado; 409 si `version`
     * cambió. Con IPv4, IPv6 o puerto distintos se reescriben las reglas de corte de todos los routers.
     */
    function configurar(cuerpo: CuerpoPortalCorte): Promise<Resultado<PortalCorte>> {
        return resolver(api.PUT('/api/v1/corte/configuracion', { body: cuerpo }))
    }

    return { ver, configurar }
}
