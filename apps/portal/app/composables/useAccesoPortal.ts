import type { Schema } from '@argosisp/contracts'

export type SolicitudCodigo = Schema<'PortalSolicitudCodigo'>
export type SesionPortal = Schema<'PortalSesion'>

/**
 * Entrada al portal. Las tres formas abren la misma sesión (cookie httpOnly que el portal no ve):
 *
 * - **Documento y contraseña** (`POST /portal/entrar`). Si entró con la contraseña por defecto de la
 *   empresa, la sesión trae `debe_cambiar_contrasena` y hay que ir a `/cambiar-contrasena`.
 * - **Código** (`POST /portal/codigo` y `POST /portal/verificar`): llega al correo o Telegram
 *   registrado; el portal nunca pide ni envía un destino.
 * - **«Ver mi cuenta» en `/corte`** (`POST /portal/corte/sesion`): la API vuelve a identificar el
 *   servicio por la conexión (o el código de corte) y abre una sesión corta sin pedir nada.
 */
export function useAccesoPortal() {
    const api = useApi()
    const sesion = useSesionPortal()

    function solicitarPorIdentificador(identificador: string): Promise<Resultado<SolicitudCodigo>> {
        return resolver(api.POST('/api/v1/portal/codigo', { body: { identificador } }))
    }

    /** Desde `/corte`: la API identifica al cliente por la IP de origen. */
    function solicitarPorIp(): Promise<Resultado<SolicitudCodigo>> {
        return resolver(api.POST('/api/v1/portal/codigo', { body: { por_ip: true } }))
    }

    async function verificar(solicitud: string, codigo: string): Promise<Resultado<SesionPortal>> {
        const resultado = await resolver(api.POST('/api/v1/portal/verificar', { body: { solicitud, codigo } }))
        if (resultado.ok) {
            sesion.confirmar()
        }
        return resultado
    }

    async function entrarConContrasena(
        documento: string,
        contrasena: string,
        empresaId: number | null = null,
    ): Promise<Resultado<SesionPortal>> {
        const resultado = await resolver(api.POST('/api/v1/portal/entrar', {
            body: empresaId ? { documento, contrasena, empresa_id: empresaId } : { documento, contrasena },
        }))
        if (resultado.ok) {
            sesion.confirmar()
        }
        return resultado
    }

    /** «Ver mi cuenta» en `/corte`: sin datos; la API identifica por la conexión o el código de corte. */
    async function entrarDesdeCorte(): Promise<Resultado<SesionPortal>> {
        const resultado = await resolver(api.POST('/api/v1/portal/corte/sesion'))
        if (resultado.ok) {
            sesion.confirmar()
        }
        return resultado
    }

    async function salir(): Promise<Resultado<undefined>> {
        const resultado = await resolver(api.POST('/api/v1/portal/salir'))
        sesion.cerrar()
        clearNuxtData(clave => clave.startsWith('portal:cuenta'))
        return resultado as Resultado<undefined>
    }

    return { solicitarPorIdentificador, solicitarPorIp, verificar, entrarConContrasena, entrarDesdeCorte, salir }
}
