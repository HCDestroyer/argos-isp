/**
 * Barra lateral compacta (solo iconos) o expandida, recordada por usuario en `localStorage`.
 * El almacenamiento puede no existir o lanzar (ventana privada, datos bloqueados): entonces la
 * barra arranca expandida y la preferencia solo dura la visita.
 */
const PREFIJO = 'argos_menu_compacto:'

export function claveMenuCompacto(usuarioId: number | string): string {
    return `${PREFIJO}${usuarioId}`
}

export function leerMenuCompacto(usuarioId: number | string | null | undefined): boolean {
    if (usuarioId === null || usuarioId === undefined) {
        return false
    }
    try {
        return window.localStorage.getItem(claveMenuCompacto(usuarioId)) === '1'
    }
    catch {
        return false
    }
}

export function guardarMenuCompacto(usuarioId: number | string | null | undefined, compacto: boolean): void {
    if (usuarioId === null || usuarioId === undefined) {
        return
    }
    try {
        window.localStorage.setItem(claveMenuCompacto(usuarioId), compacto ? '1' : '0')
    }
    catch {
        // Sin almacenamiento: la preferencia vale solo para esta visita.
    }
}

export function useMenuCompacto() {
    const { usuario } = useAuth()
    const compacto = ref(leerMenuCompacto(usuario.value?.id))

    // Otro usuario en el mismo navegador (desbloqueo, cambio de cuenta): su propia preferencia.
    watch(() => usuario.value?.id, (id) => {
        compacto.value = leerMenuCompacto(id)
    })
    watch(compacto, valor => guardarMenuCompacto(usuario.value?.id, valor))

    return { compacto }
}
