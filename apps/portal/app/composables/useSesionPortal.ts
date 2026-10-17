/**
 * ¿Hay sesión del portal? La cookie es httpOnly (el navegador no la ve), así que:
 *
 * - `activa`: estado compartido (layout, `/cuenta`, `/corte`). Lo pone en `true` una lectura de la
 *   cuenta que salió bien y en `false` un 401 o "Salir". Con `true` el layout muestra la barra de
 *   navegación del cliente.
 * - Una **pista** en `localStorage` (solo `1`, nunca datos del cliente) dice si vale la pena
 *   preguntar: `/corte` solo pide `GET /portal/cuenta` cuando la pista existe. Así la página de corte
 *   de un cliente que nunca entró no hace una petición extra que respondería 401.
 */
const CLAVE_PISTA = 'argos:portal:sesion'

function leerPista(): boolean {
    try {
        return localStorage.getItem(CLAVE_PISTA) === '1'
    }
    catch {
        return false
    }
}

function escribirPista(valor: boolean): void {
    try {
        if (valor) {
            localStorage.setItem(CLAVE_PISTA, '1')
        }
        else {
            localStorage.removeItem(CLAVE_PISTA)
        }
    }
    catch {
        // Sin almacenamiento (modo privado): /corte simplemente no pregunta por la sesión.
    }
}

export function useSesionPortal() {
    const activa = useState<boolean>('portal:sesion-activa', () => false)
    const api = useApi()

    function confirmar(): void {
        activa.value = true
        escribirPista(true)
    }

    function cerrar(): void {
        activa.value = false
        escribirPista(false)
    }

    /** Solo en el navegador: hubo una sesión en este dispositivo y aún no se sabe si sigue. */
    function puedeHaberSesion(): boolean {
        return import.meta.client && leerPista()
    }

    /**
     * `/corte`: si hubo sesión en este dispositivo, la confirma con `GET /portal/cuenta`. Sin pista no
     * pregunta (la mayoría de los suspendidos nunca entró: sería un 401 por visita).
     */
    async function comprobar(): Promise<boolean> {
        if (!puedeHaberSesion()) {
            return false
        }
        const resultado = await resolver(api.GET('/api/v1/portal/cuenta'))
        if (resultado.ok) {
            confirmar()
            return true
        }
        if (esSinSesion(resultado.problema)) {
            cerrar()
        }
        return false
    }

    return { activa: readonly(activa), confirmar, cerrar, puedeHaberSesion, comprobar }
}
