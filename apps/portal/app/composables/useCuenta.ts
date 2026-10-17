import type { Schema } from '@argosisp/contracts'

export type CuentaPortal = Schema<'PortalCuenta'>

/**
 * Cuenta del cliente de la sesión (`GET /portal/cuenta`): contacto, servicios y saldo.
 * Solo en el navegador (la cookie de la sesión tiene ruta `/api/v1/portal`). Sin sesión, el
 * resultado es un problema 401 y la página manda a `/entrar`.
 */
export function useCuenta() {
    const api = useApi()
    const sesion = useSesionPortal()

    return useAsyncData<Resultado<CuentaPortal>>(
        'portal:cuenta',
        async () => {
            const resultado = await resolver(api.GET('/api/v1/portal/cuenta'))
            // La lectura de la cuenta es la que confirma (o descarta) la sesión del portal.
            if (resultado.ok) {
                sesion.confirmar()
            }
            else if (esSinSesion(resultado.problema)) {
                sesion.cerrar()
            }
            return resultado
        },
        { server: false },
    )
}
