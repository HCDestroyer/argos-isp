import type { Problem, Schema, paths } from '@argosisp/contracts'

export type Usuario = Schema<'Me'>
export type CredencialesLogin = paths['/api/v1/auth/sesion']['post']['requestBody']['content']['application/json']

export type ResultadoLogin = { ok: true, usuario: Usuario } | { ok: false, problema: Problem }

/**
 * Resultado de desbloquear la sesión: `otro_usuario` = la API devolvió otra cuenta (ya se hizo
 * logout); con 429, `esperarS` dice cuántos segundos esperar.
 */
export type ResultadoDesbloqueo
    = | { ok: true }
        | { ok: false, motivo: 'credenciales', problema: Problem, esperarS: number | null }
        | { ok: false, motivo: 'otro_usuario' }

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

/**
 * Segundos de espera de un 429: `Retry-After` si la API lo expone por CORS; si no, el número del
 * `detail` ("intenta de nuevo en 840 s").
 */
export function segundosDeEspera(respuesta: Response, problema: Problem): number | null {
    const cabecera = Number(respuesta.headers.get('Retry-After'))
    if (Number.isInteger(cabecera) && cabecera > 0) {
        return cabecera
    }
    const enDetalle = /(\d+)\s*s\b/.exec(problema.detail ?? '')
    return enDetalle ? Number(enDetalle[1]) : null
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

/**
 * Cuándo vence la sesión si no se usa (`expira_en`). La API la renueva sola con cada petición
 * (`contratos/sesion-panel.md` §4), así que este valor es el último que se leyó (login o `GET /me`).
 */
export function useExpiraSesion() {
    return useState<string | null>('auth:expira', () => null)
}

/** Tope absoluto de la sesión (`expira_max_en`, login + 72 h): ahí vence aunque se use. */
export function useExpiraMaxSesion() {
    return useState<string | null>('auth:expira-max', () => null)
}

/** `type` del 401 de una sesión del panel vencida (por inactividad o por el tope). */
export const TIPO_SESION_EXPIRADA = 'urn:argosisp:problema:sesion_expirada'

/** El cuerpo de un 401 dice que la sesión venció (y no que falta o se revocó). */
export function esSesionExpirada(cuerpo: unknown): boolean {
    return typeof cuerpo === 'object' && cuerpo !== null && 'type' in cuerpo && cuerpo.type === TIPO_SESION_EXPIRADA
}

/**
 * Ventana de bloqueo (decisión del PM, semana 3, tanda 3): con 401 `sesion_expirada` y el usuario
 * todavía en memoria, la página queda montada debajo y solo se pide la contraseña.
 */
export function useSesionBloqueada() {
    return useState<boolean>('auth:bloqueada', () => false)
}

/** Peticiones que fallaron por la sesión vencida, esperando el desbloqueo (true) o la salida (false). */
const enEspera: ((desbloqueada: boolean) => void)[] = []

/** Abre la ventana de bloqueo y espera: `true` al desbloquear (reintentar), `false` al salir. */
export function esperarDesbloqueo(): Promise<boolean> {
    useSesionBloqueada().value = true
    return new Promise((resolve) => {
        enEspera.push(resolve)
    })
}

function liberarEspera(desbloqueada: boolean): void {
    useSesionBloqueada().value = false
    for (const resolver of enEspera.splice(0)) {
        resolver(desbloqueada)
    }
}

/** Deja la sesión local vacía (sin tocar la API) y suelta las peticiones en espera sin reintentar. */
export function limpiarSesionLocal(): void {
    useUsuarioActual().value = null
    useCsrf().value = null
    useExpiraSesion().value = null
    useExpiraMaxSesion().value = null
    liberarEspera(false)
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
    const expiraMax = useExpiraMaxSesion()

    const autenticado = computed(() => usuario.value !== null)

    function guardarSesion(data: Schema<'SesionPanel'>): void {
        csrf.value = data.csrf
        expira.value = data.expira_en
        expiraMax.value = data.expira_max_en ?? null
        usuario.value = data.usuario
    }

    /** `POST /auth/sesion`: la API pone la cookie y devuelve el usuario y el `csrf`. */
    async function login(credenciales: CredencialesLogin): Promise<ResultadoLogin> {
        try {
            const { data, error, response } = await api.POST('/api/v1/auth/sesion', { body: credenciales })
            if (!data) {
                return { ok: false, problema: comoProblema(error, response.status) }
            }
            guardarSesion(data)
            return { ok: true, usuario: data.usuario }
        }
        catch {
            return { ok: false, problema: PROBLEMA_SIN_CONEXION }
        }
    }

    /**
     * Desbloquea con la contraseña: `POST /auth/sesion` con el correo de la sesión. Si entra el
     * mismo usuario, guarda `csrf` y vencimientos y reintenta (una vez) las peticiones en espera.
     * Si la API devuelve otro usuario, cierra la sesión y va al login.
     */
    async function desbloquear(password: string): Promise<ResultadoDesbloqueo> {
        const anterior = usuario.value
        if (!anterior) {
            await salir()
            return { ok: false, motivo: 'otro_usuario' }
        }
        try {
            const { data, error, response } = await api.POST('/api/v1/auth/sesion', { body: { email: anterior.email, password } })
            if (!data) {
                const problema = comoProblema(error, response.status)
                return { ok: false, motivo: 'credenciales', problema, esperarS: response.status === 429 ? segundosDeEspera(response, problema) : null }
            }
            if (data.usuario.id !== anterior.id) {
                await salir()
                return { ok: false, motivo: 'otro_usuario' }
            }
            guardarSesion(data)
            liberarEspera(true)
            return { ok: true }
        }
        catch {
            return { ok: false, motivo: 'credenciales', problema: PROBLEMA_SIN_CONEXION, esperarS: null }
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
                if (data.expira_en !== undefined) {
                    expira.value = data.expira_en
                }
                if (data.expira_max_en !== undefined) {
                    expiraMax.value = data.expira_max_en
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

    /**
     * "No soy yo / Salir" de la ventana de bloqueo: logout, login completo y el estado de la app
     * vacío (filtros, borradores y datos de la otra persona no quedan en memoria).
     */
    async function salir(): Promise<void> {
        await logout()
        clearNuxtState()
    }

    return { usuario, autenticado, login, logout, cargarMe, desbloquear, salir }
}
