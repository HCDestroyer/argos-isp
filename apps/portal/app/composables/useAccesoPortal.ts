import type { Schema } from '@argosisp/contracts'

export type SolicitudCodigo = Schema<'PortalSolicitudCodigo'>
export type SesionPortal = Schema<'PortalSesion'>

/**
 * Acceso al portal con código (`POST /portal/codigo`, `POST /portal/verificar`, `POST /portal/salir`).
 *
 * El código llega al correo o Telegram registrado del cliente; el portal nunca pide ni envía un
 * destino. Al verificar, la API pone la cookie httpOnly de la sesión: el portal no ve el token.
 */
export function useAccesoPortal() {
    const api = useApi()

    function solicitarPorIdentificador(identificador: string): Promise<Resultado<SolicitudCodigo>> {
        return resolver(api.POST('/api/v1/portal/codigo', { body: { identificador } }))
    }

    /** Desde `/corte`: la API identifica al cliente por la IP de origen. */
    function solicitarPorIp(): Promise<Resultado<SolicitudCodigo>> {
        return resolver(api.POST('/api/v1/portal/codigo', { body: { por_ip: true } }))
    }

    function verificar(solicitud: string, codigo: string): Promise<Resultado<SesionPortal>> {
        return resolver(api.POST('/api/v1/portal/verificar', { body: { solicitud, codigo } }))
    }

    async function salir(): Promise<Resultado<undefined>> {
        const resultado = await resolver(api.POST('/api/v1/portal/salir'))
        clearNuxtData(clave => clave.startsWith('portal:cuenta'))
        return resultado as Resultado<undefined>
    }

    return { solicitarPorIdentificador, solicitarPorIp, verificar, salir }
}
