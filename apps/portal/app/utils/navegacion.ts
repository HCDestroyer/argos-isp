/**
 * Secciones del portal con sesión (`/cuenta?seccion=…`). La barra inferior (móvil) y la barra de
 * secciones (escritorio) salen de esta misma lista. Son enlaces reales con la sección en la URL:
 * "Atrás" del teléfono vuelve a la sección anterior y se pueden compartir o recargar.
 */
export type SeccionCuenta = 'inicio' | 'pagar' | 'facturas' | 'cuenta'

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
    { seccion: 'cuenta', etiqueta: 'Cuenta', icono: 'i-lucide-user-round', to: '/cuenta?seccion=cuenta' },
]

/** `?seccion=` de la ruta → sección; cualquier otra cosa → inicio. */
export function seccionDeLaRuta(valor: unknown): SeccionCuenta {
    const texto = Array.isArray(valor) ? valor[0] : valor
    return SECCIONES_CUENTA.find(item => item.seccion === texto)?.seccion ?? 'inicio'
}

/** Sección activa de la barra: solo en `/cuenta` (en `/corte` ninguna está marcada). */
export function seccionActiva(ruta: { path: string, query: Record<string, unknown> }): SeccionCuenta | null {
    return ruta.path === '/cuenta' ? seccionDeLaRuta(ruta.query.seccion) : null
}
