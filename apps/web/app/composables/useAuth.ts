import type { Problem, Schema, paths } from '@argosisp/contracts'

export type Usuario = Schema<'Me'>
export type CredencialesLogin = paths['/api/v1/auth/login']['post']['requestBody']['content']['application/json']

export type ResultadoLogin = { ok: true, usuario: Usuario } | { ok: false, problema: Problem }

const PROBLEMA_SIN_CONEXION: Problem = {
    type: 'about:blank',
    title: 'Sin conexión con la API',
    status: 0,
    detail: 'No se pudo contactar al servidor. Revisa tu conexión e intenta de nuevo.',
}

function comoProblema(error: unknown, status: number): Problem {
    if (typeof error === 'object' && error !== null && 'title' in error && typeof error.title === 'string') {
        return error as Problem
    }
    return { type: 'about:blank', title: 'Error inesperado', status }
}

/** Usuario de la sesión (`GET /api/v1/me`), compartido por toda la app. */
export function useUsuarioActual() {
    return useState<Usuario | null>('auth:usuario', () => null)
}

export function useAuth() {
    const api = useApi()
    const token = useNuxtApp().$tokenSesion
    const usuario = useUsuarioActual()

    const autenticado = computed(() => Boolean(token.value))

    async function login(credenciales: CredencialesLogin): Promise<ResultadoLogin> {
        try {
            const { data, error, response } = await api.POST('/api/v1/auth/login', { body: credenciales })
            if (!data) {
                return { ok: false, problema: comoProblema(error, response.status) }
            }
            token.value = data.token
            usuario.value = data.usuario
            return { ok: true, usuario: data.usuario }
        }
        catch {
            return { ok: false, problema: PROBLEMA_SIN_CONEXION }
        }
    }

    /** Carga `GET /api/v1/me`. Si el token ya no sirve, limpia la sesión y devuelve `null`. */
    async function cargarMe(): Promise<Usuario | null> {
        if (!token.value) {
            usuario.value = null
            return null
        }
        try {
            const { data, response } = await api.GET('/api/v1/me')
            if (data) {
                usuario.value = data
                return data
            }
            if (response.status === 401) {
                token.value = null
            }
        }
        catch {
            // Sin conexión: no se borra el token para reintentar después.
        }
        usuario.value = null
        return null
    }

    /**
     * Revoca el token en la API (`POST /auth/logout`, queda `auth.logout` en la bitácora) y luego
     * borra la cookie. Antes solo se borraba la cookie y el token seguía valiendo hasta 12 h.
     * Sin conexión se sale igual: la cookie se borra y el token expira solo.
     */
    async function logout(): Promise<void> {
        if (token.value) {
            try {
                await api.POST('/api/v1/auth/logout')
            }
            catch {
                // Sin conexión: se cierra la sesión local de todos modos.
            }
        }
        token.value = null
        usuario.value = null
        await navigateTo('/login')
    }

    return { usuario, autenticado, login, logout, cargarMe }
}
