import type { Schema } from '@argosisp/contracts'

export type OpcionesLogin = Schema<'OpcionesLogin'>
export type ContrasenaRestablecida = Schema<'ContrasenaRestablecida'>

/**
 * Pantalla de login sin sesión (decisión 22 del PM, A1): qué muestra (`GET /auth/opciones`), pedir
 * el enlace para cambiar la contraseña y cambiarla con él. Las tres rutas son públicas.
 */
export function useRecuperacionContrasena() {
    const api = useApi()

    /** `GET /auth/opciones`: si se puede recuperar por correo y si Iris y Horus están conectados. */
    function opciones(): Promise<Resultado<OpcionesLogin>> {
        return resolver(api.GET('/api/v1/auth/opciones'))
    }

    /**
     * `POST /auth/recuperar-contrasena`: siempre 202 igual, exista o no el correo; 429
     * `demasiadas_solicitudes` y 404 `recuperacion_apagada` si el admin la apagó.
     */
    function pedirEnlace(email: string): Promise<Resultado<Schema<'RecuperacionAceptada'>>> {
        return resolver(api.POST('/api/v1/auth/recuperar-contrasena', { body: { email } }))
    }

    /** `POST /auth/restablecer-contrasena`: un uso (422 `enlace_invalido`); cierra todas las sesiones. */
    function restablecer(token: string, password: string): Promise<Resultado<ContrasenaRestablecida>> {
        return resolver(api.POST('/api/v1/auth/restablecer-contrasena', { body: { token, password } }))
    }

    return { opciones, pedirEnlace, restablecer }
}
