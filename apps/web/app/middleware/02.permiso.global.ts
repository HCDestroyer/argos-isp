/**
 * Valida `definePageMeta({ permiso: 'routers.ver' })` contra los permisos de `GET /me`.
 * Sin permiso redirige a `/sin-permiso` (dentro del layout, con el menú visible), tanto al
 * entrar por URL como al navegar dentro del panel. Con una lista (`['horus.ver', 'iris.ver']`)
 * basta uno de ellos.
 */
export default defineNuxtRouteMiddleware((to) => {
    const permiso = to.meta.permiso
    if (!permiso || to.meta.publica) {
        return
    }

    const { puede } = usePermisos()
    if (!puede(permiso)) {
        return navigateTo({ path: '/sin-permiso', query: { permiso: typeof permiso === 'string' ? permiso : permiso.join(' o '), ruta: to.fullPath } }, { replace: true })
    }
})
