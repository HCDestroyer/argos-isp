/**
 * Sesión del panel por cookie (`contratos/sesion-panel.md`), del lado de las respuestas:
 *
 * - **401** en cualquier llamada (sesión vencida, revocada o usuario desactivado): se limpia la
 *   sesión local y se vuelve a `/login?redirect=` como al entrar sin sesión. La sesión no se
 *   renueva sola.
 * - **403 `csrf_invalido`** no es un problema de permisos: se recarga el `csrf` con `GET /me` y se
 *   repite la petición una vez; si `/me` ya no tiene sesión, a `/login`.
 *
 * Corre después de `api.ts` y `canal.ts` (orden alfabético), sobre el mismo cliente.
 */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Rutas que manejan su propio 401 (login fallido, logout con la sesión vencida, `/me` del middleware). */
const RUTAS_DE_SESION = new Set(['/api/v1/auth/sesion', '/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/me'])

async function esCsrfInvalido(respuesta: Response): Promise<boolean> {
    if (respuesta.status !== 403) {
        return false
    }
    try {
        const cuerpo: unknown = await respuesta.clone().json()
        return typeof cuerpo === 'object' && cuerpo !== null && 'type' in cuerpo
            && typeof cuerpo.type === 'string' && cuerpo.type.endsWith(':csrf_invalido')
    }
    catch {
        return false
    }
}

export default defineNuxtPlugin((nuxtApp) => {
    /** Copia de cada POST/PUT/DELETE antes de enviarlo, para repetirlo con el `csrf` nuevo. */
    const copias = new WeakMap<Request, Request>()
    const auth = useAuth()
    const csrfActual = useCsrf()

    async function aLogin(): Promise<void> {
        limpiarSesionLocal()
        const actual = nuxtApp.$router.currentRoute.value
        if (actual.meta.publica) {
            return
        }
        await nuxtApp.runWithContext(() => navigateTo({
            path: '/login',
            query: actual.fullPath === '/' ? {} : { redirect: actual.fullPath },
        }, { replace: true }))
    }

    nuxtApp.$api.use({
        onRequest({ request }) {
            if (!METODOS_SEGUROS.has(request.method.toUpperCase())) {
                copias.set(request, request.clone())
            }
            return request
        },

        async onResponse({ request, response }) {
            if (RUTAS_DE_SESION.has(new URL(request.url).pathname)) {
                return response
            }
            if (response.status === 401) {
                await aLogin()
                return response
            }
            if (!(await esCsrfInvalido(response))) {
                return response
            }
            const usuario = await auth.cargarMe()
            const csrf = csrfActual.value
            const copia = copias.get(request)
            if (!usuario || !csrf) {
                await aLogin()
                return response
            }
            if (!copia) {
                return response
            }
            copia.headers.set('X-CSRF-Token', csrf)
            return nuxtApp.$fetchPanel(copia)
        },
    })
})
