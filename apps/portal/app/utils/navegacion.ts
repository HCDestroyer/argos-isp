/**
 * Secciones del portal con sesión (`/cuenta?seccion=…`). La barra inferior (móvil) y la barra de
 * secciones (escritorio) salen de esta misma lista. Son enlaces reales con la sección en la URL:
 * "Atrás" del teléfono vuelve a la sección anterior y se pueden compartir o recargar.
 */
export type SeccionCuenta = 'inicio' | 'pagar' | 'facturas' | 'soporte' | 'puntos' | 'sorteos' | 'cuenta'

export interface ItemNavegacion {
    seccion: SeccionCuenta
    etiqueta: string
    icono: string
    to: string
}

export const SECCIONES_CUENTA: readonly ItemNavegacion[] = [
    { seccion: 'inicio', etiqueta: 'Inicio', icono: 'i-lucide-house', to: '/cuenta' },
    { seccion: 'pagar', etiqueta: 'Pagar', icono: 'i-lucide-wallet', to: '/cuenta?seccion=pagar' },
    { seccion: 'facturas', etiqueta: 'Facturas', icono: 'i-lucide-receipt', to: '/cuenta?seccion=facturas' },
    // Solo con Iris conectado (tickets y solicitudes, contrato Iris 0.9.0 §11): `seccionesVisibles`.
    { seccion: 'soporte', etiqueta: 'Soporte', icono: 'i-lucide-life-buoy', to: '/cuenta?seccion=soporte' },
    // Solo si el panel activó el programa de puntos en el portal (`seccionesVisibles`).
    { seccion: 'puntos', etiqueta: 'Puntos', icono: 'i-lucide-sparkles', to: '/cuenta?seccion=puntos' },
    { seccion: 'cuenta', etiqueta: 'Cuenta', icono: 'i-lucide-user-round', to: '/cuenta?seccion=cuenta' },
]

/**
 * Las secciones de la barra: «Puntos» solo con el programa visible en el portal y «Soporte» solo
 * con Iris conectado (aunque esté caído: la sección muestra el error con «Reintentar»).
 */
export function seccionesVisibles(conPuntos: boolean, conSoporte = false): readonly ItemNavegacion[] {
    return SECCIONES_CUENTA.filter(item => (item.seccion !== 'puntos' || conPuntos) && (item.seccion !== 'soporte' || conSoporte))
}

/** Secciones a las que se llega por un enlace (el aviso de un sorteo), sin lugar en la barra. */
const SECCIONES_SIN_BARRA: readonly SeccionCuenta[] = ['sorteos']

/** `?seccion=` de la ruta → sección; cualquier otra cosa → inicio. */
export function seccionDeLaRuta(valor: unknown): SeccionCuenta {
    const texto = Array.isArray(valor) ? valor[0] : valor
    return SECCIONES_CUENTA.find(item => item.seccion === texto)?.seccion
        ?? SECCIONES_SIN_BARRA.find(seccion => seccion === texto)
        ?? 'inicio'
}

/** Sección activa de la barra: solo en `/cuenta` (en `/corte` ninguna está marcada). */
export function seccionActiva(ruta: { path: string, query: Record<string, unknown> }): SeccionCuenta | null {
    return ruta.path === '/cuenta' ? seccionDeLaRuta(ruta.query.seccion) : null
}
