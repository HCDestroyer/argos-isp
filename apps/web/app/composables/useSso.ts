import type { paths } from '@argosisp/contracts'

export type DatosVincularSso = paths['/api/v1/auth/sso/vincular']['post']['requestBody']['content']['application/json']

/**
 * Autologin desde Horus (`/sso/entrar#<ticket>`, `contratos/horus.md` §1.5, lado receptor de A1).
 * Con `resultado: 'sesion'` la API ya puso la cookie `argos_sesion`: aquí se guardan el usuario,
 * el `csrf` (solo en memoria) y los vencimientos, como hace el login. Nunca crea usuarios ni
 * vincula por correo: eso lo decide la API.
 */
export function useSso() {
    const api = useApi()

    function guardarSesion(canje: CanjeSso): void {
        const sesion = canje.sesion
        if (canje.resultado !== 'sesion' || !sesion) {
            return
        }
        useCsrf().value = sesion.csrf
        useExpiraSesion().value = sesion.expira_en
        useExpiraMaxSesion().value = sesion.expira_max_en ?? null
        useUsuarioActual().value = sesion.usuario
    }

    /** `POST /auth/sso/canjear` (público): 410 `ticket_invalido` si venció, se usó o el conector cambió. */
    async function canjear(ticket: string): Promise<Resultado<CanjeSso>> {
        const resultado = await resolver(api.POST('/api/v1/auth/sso/canjear', { body: { ticket } }))
        if (resultado.ok) {
            guardarSesion(resultado.data)
        }
        return resultado
    }

    /** `POST /auth/sso/vincular`: login normal con el token de vinculación (10 min, un uso). */
    async function vincular(datos: DatosVincularSso): Promise<Resultado<CanjeSso>> {
        const resultado = await resolver(api.POST('/api/v1/auth/sso/vincular', { body: datos }))
        if (resultado.ok) {
            guardarSesion(resultado.data)
        }
        return resultado
    }

    return { canjear, vincular }
}
