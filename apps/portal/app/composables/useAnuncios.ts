import type { Problem, Schema } from '@argosisp/contracts'

export type Anuncio = Schema<'PortalAnuncio'>
export type LugarAnuncio = 'portal_inicio' | 'pagina_corte'
export type EventoAnuncio = 'vista' | 'clic'

/** Identificador del visitante para las métricas: un UUID por sesión del navegador, nunca un dato suyo. */
const CLAVE_VISITANTE = 'argos:visitante'

function visitante(): string {
    try {
        const guardado = sessionStorage.getItem(CLAVE_VISITANTE)
        if (guardado) {
            return guardado
        }
        const nuevo = crypto.randomUUID()
        sessionStorage.setItem(CLAVE_VISITANTE, nuevo)
        return nuevo
    }
    catch {
        // Sin almacenamiento (modo privado): uno por carga de la página; la API sigue siendo idempotente.
        return memoria ??= crypto.randomUUID()
    }
}
let memoria: string | undefined

/** Eventos ya enviados en esta carga (la API es idempotente; esto solo ahorra peticiones). */
const enviados = new Set<string>()

/**
 * Anuncios del portal (contrato `.claude/integration/contratos/anuncios.md`).
 *
 * - `cargar()`: `GET /portal/anuncios?lugar=…`. En `pagina_corte` la API identifica al cliente por la
 *   IP; en `portal_inicio`, por la sesión. Sin anuncios publicados la lista viene vacía y la página
 *   queda igual que siempre.
 * - `registrar(anuncio, 'vista' | 'clic')`: `POST /portal/anuncios/:id/eventos` con el visitante de
 *   la sesión del navegador en el cuerpo (nada en la URL). Nunca bloquea ni muestra errores: es
 *   telemetría.
 */
export function useAnuncios(lugar: LugarAnuncio) {
    const api = useApi()
    const anuncios = ref<Anuncio[]>([])
    const cargando = ref(false)
    const problema = ref<Problem | null>(null)

    async function cargar(): Promise<void> {
        cargando.value = true
        const resultado = await resolver(api.GET('/api/v1/portal/anuncios', {
            params: { query: { lugar } },
            headers: { 'X-Canal': 'portal' },
        }))
        cargando.value = false
        if (resultado.ok) {
            anuncios.value = resultado.data.data
            problema.value = null
        }
        else {
            problema.value = resultado.problema
        }
    }

    function registrar(anuncio: Anuncio, tipo: EventoAnuncio): void {
        const clave = `${anuncio.id}:${tipo}:${lugar}`
        if (enviados.has(clave)) {
            return
        }
        enviados.add(clave)
        void resolver(api.POST('/api/v1/portal/anuncios/{id}/eventos', {
            params: { path: { id: anuncio.id } },
            body: { tipo, visitante: visitante(), lugar },
            headers: { 'X-Canal': 'portal' },
            // el clic suele navegar fuera: que la petición sobreviva a la navegación
            keepalive: true,
        })).then((resultado) => {
            if (!resultado.ok) {
                enviados.delete(clave)
            }
        })
    }

    return { anuncios, cargando, problema, cargar, registrar }
}

/** Pruebas: olvida los eventos enviados en esta carga. */
export function reiniciarEventosAnuncios(): void {
    enviados.clear()
}
