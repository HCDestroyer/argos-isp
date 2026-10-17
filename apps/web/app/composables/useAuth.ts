import type { Problem, Schema, paths } from '@argosisp/contracts'

export type Usuario = Schema<'Me'>
export type CredencialesLogin = paths['/api/v1/auth/sesion']['post']['requestBody']['content']['application/json']

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

/**
 * `csrf` de la sesión del panel, **solo en memoria** (`contratos/sesion-panel.md`): nunca en
 * `localStorage` ni en una cookie. Tras recargar la página se recupera con `GET /me`.
 */
export function useCsrf() {
    return useState<string | null>('auth:csrf', () => null)
}

/** Cuándo vence la sesión (`SesionPanel.expira_en`); no se renueva sola. */
export function useExpiraSesion() {
    return useState<string | null>('auth:expira', () => null)
}

/** Deja la sesión local vacía (sin tocar la API). */
export function limpiarSesionLocal(): void {
    useUsuarioActual().value = null
    useCsrf().value = null
    useExpiraSesion().value = null
}

/**
 * Sesión del panel con la cookie `HttpOnly` `argos_sesion` que pone la API: el panel nunca ve ni
 * guarda el token. `autenticado` = se leyó el usuario (login o `GET /me` con la cookie).
 */
export function useAuth() {
    const api = useApi()
    const usuario = useUsuarioActual()
    const csrf = useCsrf()
    const expira = useExpiraSesion()

    const autenticado = computed(() => usuario.value !== null)

    /** `POST /auth/sesion`: la API pone la cookie y devuelve el usuario y el `csrf`. */
    async function login(credenciales: CredencialesLogin): Promise<ResultadoLogin> {
        try {
            const { data, error, response } = await api.POST('/api/v1/auth/sesion', { body: credenciales })
            if (!data) {
                return { ok: false, problema: comoProblema(error, response.status) }
            }
            csrf.value = data.csrf
            expira.value = data.expira_en
            usuario.value = data.usuario
            return { ok: true, usuario: data.usuario }
        }
        catch {
            return { ok: false, problema: PROBLEMA_SIN_CONEXION }
        }
    }

    /**
     * `GET /api/v1/me` con la cookie: el usuario y el `csrf` (así sobrevive a recargar la página).
     * Con 401 (sin cookie, vencida o revocada) limpia la sesión local y devuelve `null`.
     */
    async function cargarMe(): Promise<Usuario | null> {
        try {
            const { data, response } = await api.GET('/api/v1/me')
            if (data) {
                usuario.value = data
                if (data.csrf) {
                    csrf.value = data.csrf
                }
                return data
            }
            if (response.status === 401) {
                limpiarSesionLocal()
                return null
            }
        }
        catch {
            // Sin conexión: se intenta de nuevo en la siguiente navegación.
        }
        usuario.value = null
        return null
    }

    /**
     * `POST /auth/logout` con `X-CSRF-Token`: la API revoca el token y borra la cookie (queda
     * `auth.logout` en la bitácora). Con la sesión ya vencida responde 401 y se sale igual.
     */
    async function logout(): Promise<void> {
        try {
            await api.POST('/api/v1/auth/logout')
        }
        catch {
            // Sin conexión: se cierra la sesión local de todos modos.
        }
        limpiarSesionLocal()
        await navigateTo('/login')
    }

    return { usuario, autenticado, login, logout, cargarMe }
}
