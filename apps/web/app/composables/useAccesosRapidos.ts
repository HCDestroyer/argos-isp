import type { Problem, Schema } from '@argosisp/contracts'

export type AccesosRapidos = Schema<'AccesosRapidos'>

/**
 * Accesos rápidos del usuario (pedido del PM: «en un clic, según los permisos»): hasta 12
 * secciones del menú en el orden que el usuario elige, en la barra superior de todas las pantallas
 * (Alt+1…9) y en el inicio. `GET/PUT /api/v1/me/accesos-rapidos` (A6,
 * `contratos/accesos-rapidos.md`): sin lista guardada la API da los del rol (`predeterminados`).
 * Los ids que el panel no conoce o que el usuario no puede abrir no se muestran ni se borran.
 */
export const MAX_ACCESOS_RAPIDOS = 12

/** Grupo del menú de una sección, para agrupar los accesos por área. */
function grupoDe(id: string): GrupoSecciones | undefined {
    return GRUPOS_PANEL.find(grupo => seccionesDeGrupo(grupo).some(seccion => seccion.id === id))
}

export function useAccesosRapidos() {
    const api = useApi()
    const { usuario } = useAuth()
    const { puede } = usePermisos()
    const datos = useState<AccesosRapidos | null>('accesos-rapidos', () => null)
    const problema = useState<Problem | null>('accesos-rapidos-problema', () => null)
    const cargando = useState('accesos-rapidos-cargando', () => false)

    async function cargar(): Promise<void> {
        if (!usuario.value) {
            datos.value = null
            return
        }
        cargando.value = true
        const resultado = await resolver(api.GET('/api/v1/me/accesos-rapidos'))
        cargando.value = false
        datos.value = resultado.ok ? resultado.data : null
        problema.value = resultado.ok ? null : resultado.problema
    }

    /** Ids vigentes: los de la API que existen en el menú y el usuario puede abrir. */
    const ids = computed(() => (datos.value?.secciones ?? [])
        .filter(id => SECCIONES_PANEL.some(seccion => seccion.id === id && puede(seccion.permiso)))
        .slice(0, MAX_ACCESOS_RAPIDOS))

    const accesos = computed(() => ids.value.map(id => obtenerSeccion(id)))

    /** Los accesos agrupados por área del menú, con su número de atajo (Alt+n). */
    const porArea = computed(() => {
        const areas = new Map<string, { etiqueta: string, icono: string, secciones: { seccion: SeccionPanel, numero: number }[] }>()
        accesos.value.forEach((seccion, indice) => {
            const grupo = grupoDe(seccion.id)
            const clave = grupo?.id ?? 'otros'
            const area = areas.get(clave) ?? { etiqueta: grupo?.etiqueta ?? 'Otros', icono: grupo?.icono ?? 'i-lucide-zap', secciones: [] }
            area.secciones.push({ seccion, numero: indice + 1 })
            areas.set(clave, area)
        })
        return [...areas.values()]
    })

    /**
     * Guarda la lista (o `null`: vuelve a los del rol). Los ids que el panel no muestra se conservan
     * al final (otra versión del panel o un permiso quitado por un rato), sin pasar de 12.
     */
    async function guardar(nuevos: readonly string[] | null): Promise<Resultado<AccesosRapidos>> {
        const ocultos = (datos.value?.secciones ?? []).filter(id => !ids.value.includes(id))
        const secciones = nuevos === null ? null : [...new Set([...nuevos, ...ocultos])].slice(0, MAX_ACCESOS_RAPIDOS)
        const resultado = await resolver(api.PUT('/api/v1/me/accesos-rapidos', {
            body: { secciones, ...(datos.value?.version !== null && datos.value?.version !== undefined ? { version: datos.value.version } : {}) },
            params: { header: { 'Idempotency-Key': nuevaClaveIdempotencia() } },
        }))
        if (resultado.ok) {
            datos.value = resultado.data
        }
        return resultado
    }

    return { datos, problema, cargando, cargar, ids, accesos, porArea, guardar }
}
