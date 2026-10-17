/**
 * Sin sesión → `/login?redirect=...`. La sesión es la cookie `HttpOnly` de la API, que el panel no
 * puede leer: la primera vez se pregunta con `GET /api/v1/me` (trae también el `csrf`).
 */
export default defineNuxtRouteMiddleware(async (to) => {
    const { usuario, cargarMe } = useAuth()

    if (to.meta.publica) {
        if (to.path === '/login' && (usuario.value || await cargarMe())) {
            return navigateTo('/', { replace: true })
        }
        return
    }

    if (!usuario.value && !(await cargarMe())) {
        return navigateTo({
            path: '/login',
            query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
        }, { replace: true })
    }
})
