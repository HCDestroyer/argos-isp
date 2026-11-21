/**
 * Accesos rápidos del usuario (pedido del PM): hasta 12 secciones del menú, en el orden que el
 * usuario elige, a mano desde cualquier pantalla (botón del rayo, Alt+1…9) y en el inicio.
 *
 * NEEDS(A6): persistir con `GET/PUT /api/v1/me/accesos-rapidos`
 * (`.claude/integration/contratos/accesos-rapidos.md`, aún sin publicar). Mientras ese endpoint no
 * esté en `packages/contracts`, la elección se recuerda por usuario en `localStorage` (con
 * try/catch: sin almacenamiento valen los de fábrica) y se lee y escribe solo aquí, para cambiar a
 * la API sin tocar las pantallas.
 */
export const MAX_ACCESOS_RAPIDOS = 12

/**
 * Predeterminados por rol, iguales a los de la API (`contratos/accesos-rapidos.md` §2): la unión,
 * en este orden de rol y sin repetidos, de los roles base del usuario; sin ninguno, los de `lectura`.
 */
export const ACCESOS_POR_ROL: Record<string, readonly string[]> = {
    admin: ['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion'],
    contabilidad: ['libro', 'facturas', 'pagos', 'declaraciones', 'conciliacion', 'egresos'],
    cajero: ['cobro', 'caja', 'clientes', 'comprobantes'],
    soporte: ['clientes', 'servicios', 'promesas', 'routers'],
    tecnico: ['servicios', 'routers', 'mi-bodega', 'clientes'],
    lectura: ['clientes', 'servicios', 'facturas'],
}

export function accesosPredeterminados(roles: readonly string[]): string[] {
    const base = Object.keys(ACCESOS_POR_ROL).filter(rol => roles.includes(rol))
    const lista = (base.length ? base : ['lectura']).flatMap(rol => ACCESOS_POR_ROL[rol] ?? [])
    return [...new Set(lista)].slice(0, MAX_ACCESOS_RAPIDOS)
}

const PREFIJO = 'argos_accesos_rapidos:'

export function claveAccesosRapidos(usuarioId: number | string): string {
    return `${PREFIJO}${usuarioId}`
}

export function leerAccesosRapidos(usuarioId: number | string | null | undefined): string[] | null {
    if (usuarioId === null || usuarioId === undefined) {
        return null
    }
    try {
        const crudo = window.localStorage.getItem(claveAccesosRapidos(usuarioId))
        const lista: unknown = crudo ? JSON.parse(crudo) : null
        return Array.isArray(lista) && lista.every(id => typeof id === 'string') ? lista.slice(0, MAX_ACCESOS_RAPIDOS) : null
    }
    catch {
        return null
    }
}

export function guardarAccesosRapidos(usuarioId: number | string | null | undefined, ids: readonly string[]): void {
    if (usuarioId === null || usuarioId === undefined) {
        return
    }
    try {
        window.localStorage.setItem(claveAccesosRapidos(usuarioId), JSON.stringify(ids.slice(0, MAX_ACCESOS_RAPIDOS)))
    }
    catch {
        // Sin almacenamiento: la elección vale solo para esta visita.
    }
}

/** Grupo del menú de una sección, para agrupar los accesos por área. */
function grupoDe(id: string): GrupoSecciones | undefined {
    return GRUPOS_PANEL.find(grupo => seccionesDeGrupo(grupo).some(seccion => seccion.id === id))
}

export function useAccesosRapidos() {
    const { usuario } = useAuth()
    const { puede } = usePermisos()
    const elegidos = useState<string[] | null>('accesos-rapidos', () => null)

    watch(() => usuario.value?.id, (id) => {
        elegidos.value = leerAccesosRapidos(id)
    }, { immediate: true })

    /** Ids vigentes: los elegidos (o los de fábrica) que existen y el usuario puede abrir. */
    const ids = computed(() => (elegidos.value ?? accesosPredeterminados(usuario.value?.roles ?? []))
        .filter(id => SECCIONES_PANEL.some(seccion => seccion.id === id && puede(seccion.permiso)))
        .slice(0, MAX_ACCESOS_RAPIDOS))

    const accesos = computed(() => ids.value.map(id => obtenerSeccion(id)))

    /** Los accesos agrupados por área del menú, en el orden elegido dentro de cada área. */
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

    /** Secciones permitidas que todavía no están entre los accesos. */
    const disponibles = computed(() => SECCIONES_PANEL.filter(seccion => puede(seccion.permiso) && !ids.value.includes(seccion.id)))

    function guardar(nuevos: readonly string[]) {
        elegidos.value = [...new Set(nuevos)].slice(0, MAX_ACCESOS_RAPIDOS)
        guardarAccesosRapidos(usuario.value?.id, elegidos.value)
    }

    /** Los predeterminados del rol (sin guardar), para «Volver a los de fábrica». */
    const predeterminados = computed(() => accesosPredeterminados(usuario.value?.roles ?? [])
        .filter(id => SECCIONES_PANEL.some(seccion => seccion.id === id && puede(seccion.permiso))))

    return { ids, accesos, porArea, disponibles, predeterminados, guardar }
}
