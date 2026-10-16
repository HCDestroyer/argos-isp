import type { Problem } from '@argosisp/contracts'

/**
 * Lista paginada por cursor (`{ data, nextCursor }`) con "Ver más". La usan `useFacturas`,
 * `usePagos` y `usePromesas`. Si una página falla, `problema` queda puesto y `items` conserva
 * lo ya cargado; la primera carga fallida deja `items` vacío y la pantalla muestra el error.
 */
export function useListaCursor<T>(cargar: (cursor?: string) => Promise<Resultado<Pagina<T>>>) {
    const items = ref<T[]>([]) as Ref<T[]>
    const cursor = ref<string | null>(null)
    const cargando = ref(false)
    const cargado = ref(false)
    const problema = ref<Problem | null>(null)
    const hayMas = computed(() => cursor.value !== null)

    async function traer(siguiente?: string): Promise<void> {
        cargando.value = true
        problema.value = null
        const resultado = await cargar(siguiente)
        cargando.value = false
        if (!resultado.ok) {
            problema.value = resultado.problema
            return
        }
        items.value = siguiente ? [...items.value, ...resultado.data.data] : resultado.data.data
        cursor.value = resultado.data.nextCursor
        cargado.value = true
    }

    function recargar(): Promise<void> {
        return traer()
    }

    function cargarMas(): Promise<void> {
        return cursor.value ? traer(cursor.value) : Promise.resolve()
    }

    return { items, cargando, cargado, problema, hayMas, recargar, cargarMas }
}
