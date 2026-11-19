import type { Schema } from '@argosisp/contracts'

export type ContrasenaCambiada = Schema<'PortalContrasenaCambiada'>

/**
 * Contraseña del portal del cliente de la sesión: leer la sesión (`GET /portal/sesion`, dice si
 * debe cambiar la contraseña por defecto) y cambiarla (`POST /portal/contrasena`, pide la actual).
 */
export function useContrasenaPortal() {
    const api = useApi()

    function leerSesion(): Promise<Resultado<SesionPortal>> {
        return resolver(api.GET('/api/v1/portal/sesion'))
    }

    function cambiar(actual: string, nueva: string): Promise<Resultado<ContrasenaCambiada>> {
        return resolver(api.POST('/api/v1/portal/contrasena', {
            body: { contrasena_actual: actual, contrasena_nueva: nueva },
        }))
    }

    return { leerSesion, cambiar }
}
