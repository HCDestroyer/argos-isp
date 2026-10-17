/**
 * Multiempresa (`contratos/multiempresa.md`): cada petición del panel lleva `X-Empresa-Id` con la
 * empresa del selector. Con "Todas" (solo alcance global) no va cabecera y las listas que lo
 * aceptan piden el consolidado (`?empresas=todas`). La elección se arma al cargar el usuario
 * (login o `GET /me`) y se recuerda por usuario.
 */
export default defineNuxtPlugin(() => {
    const usuario = useUsuarioActual()
    const { eleccion, inicializar } = useEmpresaActiva()

    watch(() => usuario.value?.id, () => inicializar(), { immediate: true })
    // Las empresas del usuario pueden cambiar (otra persona le asignó una): se revalida la elección.
    watch(() => (usuario.value?.empresas ?? []).map(e => e.id).join(','), () => inicializar())

    useNuxtApp().$api.use({
        onRequest({ request }) {
            const actual = eleccion.value
            if (typeof actual === 'number') {
                request.headers.set('X-Empresa-Id', String(actual))
                return request
            }
            if (actual === 'todas' && request.method === 'GET') {
                const url = new URL(request.url)
                if (LISTAS_CONSOLIDABLES.includes(url.pathname) && !url.searchParams.has('empresas')) {
                    url.searchParams.set('empresas', 'todas')
                    return new Request(url, request)
                }
            }
            return request
        },
    })
})
