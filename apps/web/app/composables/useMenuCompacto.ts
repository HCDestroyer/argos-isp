/**
 * Menú lateral compacto (rail de iconos con etiqueta corta y menús flotantes por área) o expandido
 * (con nombres y grupos en acordeón), recordado por usuario en `localStorage`. Por defecto, el rail
 * (pedido del PM: «que respire»). Sin almacenamiento (ventana privada, datos bloqueados) arranca en
 * rail y la preferencia solo dura la visita.
 */
const PREFIJO = 'argos_menu_compacto:'

export function claveMenuCompacto(usuarioId: number | string): string {
    return `${PREFIJO}${usuarioId}`
}

export function leerMenuCompacto(usuarioId: number | string | null | undefined): boolean {
    if (usuarioId === null || usuarioId === undefined) {
        return true
    }
    try {
        return window.localStorage.getItem(claveMenuCompacto(usuarioId)) !== '0'
    }
    catch {
        return true
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
