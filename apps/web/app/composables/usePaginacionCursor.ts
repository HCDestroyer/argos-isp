import type { Problem } from '@argosisp/contracts'

export type CargadorPagina<T> = (cursor: string | undefined) => Promise<Resultado<Pagina<T>>>

/**
 * Estado de una lista con paginación por cursor (`?cursor=&limit=` → `{ data, nextCursor }`).
 *
 * La API solo sabe ir hacia adelante, así que se guarda la pila de cursores visitados para
 * poder volver. `recargar()` vuelve a la primera página (úsalo al cambiar filtros).
 *
 * ```ts
 * const lista = usePaginacionCursor(cursor => useClientes().listar({ q: busqueda.value }, cursor))
 * await lista.recargar()
 * ```
 */
export function usePaginacionCursor<T>(cargar: CargadorPagina<T>) {
    const filas = shallowRef<T[]>([])
    const cargando = ref(false)
    const problema = ref<Problem | null>(null)
    /** Cursores con los que se pidió cada página; la primera es `undefined`. */
    const cursores = ref<(string | undefined)[]>([undefined])
    const siguienteCursor = ref<string | null>(null)

    const pagina = computed(() => cursores.value.length)
    const hayAnterior = computed(() => cursores.value.length > 1)
    const haySiguiente = computed(() => siguienteCursor.value !== null)

    /** Evita que una respuesta lenta pise a una más reciente (búsqueda mientras se escribe). */
    let solicitud = 0

    async function pedir(cursor: string | undefined): Promise<boolean> {
        const actual = ++solicitud
        cargando.value = true
        const resultado = await cargar(cursor)
        if (actual !== solicitud) {
            return false
        }
        cargando.value = false
        if (!resultado.ok) {
            problema.value = resultado.problema
            filas.value = []
            siguienteCursor.value = null
            return false
        }
        problema.value = null
        filas.value = resultado.data.data
        siguienteCursor.value = resultado.data.nextCursor
        return true
    }

    async function recargar(): Promise<void> {
        cursores.value = [undefined]
        await pedir(undefined)
    }

    async function siguiente(): Promise<void> {
        const cursor = siguienteCursor.value
        if (cursor === null || cargando.value) {
            return
        }
        if (await pedir(cursor)) {
            cursores.value = [...cursores.value, cursor]
        }
    }

    async function anterior(): Promise<void> {
        if (!hayAnterior.value || cargando.value) {
            return
        }
        const previos = cursores.value.slice(0, -1)
        if (await pedir(previos.at(-1))) {
            cursores.value = previos
        }
    }

    return { filas, cargando, problema, pagina, hayAnterior, haySiguiente, recargar, siguiente, anterior }
}
