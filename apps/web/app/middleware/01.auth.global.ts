/**
 * Sin token → `/login?redirect=...`. Con token, carga `GET /api/v1/me` la primera vez.
 */
export default defineNuxtRouteMiddleware(async (to) => {
    const { autenticado, usuario, cargarMe } = useAuth()

    if (to.meta.publica) {
        if (to.path === '/login' && autenticado.value && (usuario.value || await cargarMe())) {
            return navigateTo('/', { replace: true })
        }
        return
    }

    const aLogin = () => navigateTo({
        path: '/login',
        query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
    }, { replace: true })

    if (!autenticado.value) {
        return aLogin()
    }

    if (!usuario.value && !(await cargarMe())) {
        return aLogin()
    }
})
