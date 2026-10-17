/**
 * Sesión del panel por cookie (`contratos/sesion-panel.md`), del lado de las respuestas:
 *
 * - **401 `sesion_expirada`** con el usuario en memoria: se abre la ventana de bloqueo
 *   (`SesionBloqueo.vue`) y la petición **espera**; la página sigue montada con su estado. Al
 *   desbloquear se repite una vez con el `csrf` nuevo (todas las que estaban en vuelo, en cola).
 *   Con "No soy yo / Salir" la petición devuelve el 401 original y se va al login. Mientras está
 *   bloqueada, cualquier otro 401 (la API ya borró la cookie) también espera en la cola.
 * - **Otro 401** (sin cookie, token revocado, usuario desactivado) o sin usuario en memoria (tras
 *   recargar): se limpia la sesión local y se vuelve a `/login?redirect=`.
 * - **403 `csrf_invalido`** no es un problema de permisos: se recarga el `csrf` con `GET /me` y se
 *   repite la petición una vez; si `/me` ya no tiene sesión, a `/login`.
 *
 * La API renueva la sesión sola mientras se usa (12 h sin uso, tope 72 h desde el login).
 * Corre después de `api.ts` y `canal.ts` (orden alfabético), sobre el mismo cliente.
 */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Rutas que manejan su propio 401 (login fallido, logout con la sesión vencida, `/me` del middleware). */
const RUTAS_DE_SESION = new Set(['/api/v1/auth/sesion', '/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/me'])

async function cuerpoProblema(respuesta: Response): Promise<unknown> {
    try {
        return await respuesta.clone().json()
    }
    catch {
        return null
    }
}

function esCsrfInvalido(cuerpo: unknown): boolean {
    return typeof cuerpo === 'object' && cuerpo !== null && 'type' in cuerpo
        && typeof cuerpo.type === 'string' && cuerpo.type.endsWith(':csrf_invalido')
}

export default defineNuxtPlugin((nuxtApp) => {
    /** Copia de cada petición antes de enviarla, para repetirla tras el desbloqueo o con otro `csrf`. */
    const copias = new WeakMap<Request, Request>()
    const auth = useAuth()
    const usuario = useUsuarioActual()
    const bloqueada = useSesionBloqueada()
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

    /** Repite la copia con el `csrf` vigente (solo los métodos no seguros lo llevan). */
    function repetir(copia: Request): Promise<Response> {
        const csrf = csrfActual.value
        if (csrf && !METODOS_SEGUROS.has(copia.method.toUpperCase())) {
            copia.headers.set('X-CSRF-Token', csrf)
        }
        return nuxtApp.$fetchPanel(copia)
    }

    nuxtApp.$api.use({
        onRequest({ request }) {
            copias.set(request, request.clone())
            return request
        },

        async onResponse({ request, response }) {
            if (RUTAS_DE_SESION.has(new URL(request.url).pathname)) {
                return response
            }
            if (response.status === 401) {
                const copia = copias.get(request)
                // Ya bloqueada: un 401 cualquiera (la cookie ya se borró) también espera en la cola.
                if (usuario.value && copia && (bloqueada.value || esSesionExpirada(await cuerpoProblema(response)))) {
                    const desbloqueada = await nuxtApp.runWithContext(() => esperarDesbloqueo())
                    return desbloqueada ? repetir(copia) : response
                }
                await aLogin()
                return response
            }
            if (response.status !== 403 || !esCsrfInvalido(await cuerpoProblema(response))) {
                return response
            }
            const actualizado = await auth.cargarMe()
            const copia = copias.get(request)
            if (!actualizado || !csrfActual.value) {
                await aLogin()
                return response
            }
            return copia ? repetir(copia) : response
        },
    })
})
