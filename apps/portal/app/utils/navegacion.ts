/**
 * Secciones del portal con sesión (`/cuenta?seccion=…`). La barra inferior (móvil) y la barra de
 * secciones (escritorio) salen de esta misma lista. Son enlaces reales con la sección en la URL:
 * "Atrás" del teléfono vuelve a la sección anterior y se pueden compartir o recargar.
 */
export type SeccionCuenta = 'inicio' | 'pagar' | 'facturas' | 'soporte' | 'puntos' | 'sorteos' | 'cuenta'

export interface ItemNavegacion {
    seccion: SeccionCuenta
    /** En la barra inferior del teléfono (corta). */
    etiqueta: string
    /** En el menú lateral de escritorio (tablero `NuevoPortal`). */
    etiquetaLarga: string
    icono: string
    to: string
}

export const SECCIONES_CUENTA: readonly ItemNavegacion[] = [
    { seccion: 'inicio', etiqueta: 'Inicio', etiquetaLarga: 'Inicio', icono: 'i-lucide-house', to: '/cuenta' },
    // «Facturas y pagos» (diseño aprobado): una sección con dos pestañas segmentadas, Facturas y
    // Pagar (`?seccion=pagar`, sin lugar propio en la barra: marca esta misma).
    { seccion: 'facturas', etiqueta: 'Facturas', etiquetaLarga: 'Facturas y pagos', icono: 'i-lucide-receipt', to: '/cuenta?seccion=facturas' },
    // Solo con Iris conectado (tickets y solicitudes, contrato Iris 0.9.0 §11): `seccionesVisibles`.
    { seccion: 'soporte', etiqueta: 'Soporte', etiquetaLarga: 'Soporte', icono: 'i-lucide-life-buoy', to: '/cuenta?seccion=soporte' },
    // Solo si el panel activó el programa de puntos en el portal (`seccionesVisibles`).
    { seccion: 'puntos', etiqueta: 'Puntos', etiquetaLarga: 'Mis puntos', icono: 'i-lucide-gem', to: '/cuenta?seccion=puntos' },
    { seccion: 'cuenta', etiqueta: 'Cuenta', etiquetaLarga: 'Mi cuenta', icono: 'i-lucide-user-round', to: '/cuenta?seccion=cuenta' },
]

/**
 * Las secciones de la barra: «Puntos» solo con el programa visible en el portal y «Soporte» solo
 * con Iris conectado (aunque esté caído: la sección muestra el error con «Reintentar»).
 */
export function seccionesVisibles(conPuntos: boolean, conSoporte = false): readonly ItemNavegacion[] {
    return SECCIONES_CUENTA.filter(item => (item.seccion !== 'puntos' || conPuntos) && (item.seccion !== 'soporte' || conSoporte))
}

/**
 * Secciones sin lugar propio en la barra: «Pagar» es una pestaña de «Facturas y pagos»; a
 * «Sorteos» se llega por el aviso del carrusel.
 */
const SECCIONES_SIN_BARRA: readonly SeccionCuenta[] = ['pagar', 'sorteos']

/** `?seccion=` de la ruta → sección; cualquier otra cosa → inicio. */
export function seccionDeLaRuta(valor: unknown): SeccionCuenta {
    const texto = Array.isArray(valor) ? valor[0] : valor
    return SECCIONES_CUENTA.find(item => item.seccion === texto)?.seccion
        ?? SECCIONES_SIN_BARRA.find(seccion => seccion === texto)
        ?? 'inicio'
}

/**
 * Sección activa de la barra: solo en `/cuenta` (en `/corte` ninguna está marcada). «Pagar» marca
 * «Facturas y pagos», que la contiene.
 */
export function seccionActiva(ruta: { path: string, query: Record<string, unknown> }): SeccionCuenta | null {
    if (ruta.path !== '/cuenta') {
        return null
    }
    const seccion = seccionDeLaRuta(ruta.query.seccion)
    return seccion === 'pagar' ? 'facturas' : seccion
}
