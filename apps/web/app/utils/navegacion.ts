/**
 * Secciones del menú lateral. Cada una se muestra solo si el usuario tiene `permiso`,
 * y la página repite el mismo permiso en `definePageMeta({ permiso })`.
 *
 * NEEDS(A1): confirmar los nombres `<recurso>.ver` en el seed del ACL.
 */
export interface SeccionPanel {
    id: string
    etiqueta: string
    descripcion: string
    icono: string
    ruta: string
    permiso: string
}

export interface GrupoSecciones {
    etiqueta: string
    secciones: SeccionPanel[]
}

export const GRUPOS_PANEL: GrupoSecciones[] = [
    {
        etiqueta: 'Operación',
        secciones: [
            { id: 'clientes', etiqueta: 'Clientes', descripcion: 'Búsqueda, fichas, datos fiscales y estado de cuenta.', icono: 'i-lucide-users', ruta: '/clientes', permiso: 'clientes.ver' },
            { id: 'servicios', etiqueta: 'Servicios', descripcion: 'Servicios PPPoE, sesiones activas y acciones de corte.', icono: 'i-lucide-wifi', ruta: '/servicios', permiso: 'servicios.ver' },
            { id: 'routers', etiqueta: 'Routers', descripcion: 'Routers MikroTik, redes IPv4 y bloques IPv6.', icono: 'i-lucide-router', ruta: '/routers', permiso: 'routers.ver' },
            { id: 'planes', etiqueta: 'Planes', descripcion: 'Velocidades, precios e implementación por router.', icono: 'i-lucide-gauge', ruta: '/planes', permiso: 'planes.ver' },
            { id: 'plantillas', etiqueta: 'Plantillas', descripcion: 'Ciclos de facturación, corte, mora y reglas de promesas.', icono: 'i-lucide-file-cog', ruta: '/plantillas', permiso: 'plantillas.ver' },
        ],
    },
    {
        etiqueta: 'Cobros',
        secciones: [
            { id: 'facturas', etiqueta: 'Facturas', descripcion: 'Avisos de cobro emitidos, vencidos y anulados.', icono: 'i-lucide-receipt-text', ruta: '/facturas', permiso: 'facturas.ver' },
            { id: 'pagos', etiqueta: 'Pagos', descripcion: 'Registro y anulación de pagos.', icono: 'i-lucide-banknote', ruta: '/pagos', permiso: 'pagos.ver' },
            { id: 'caja', etiqueta: 'Caja', descripcion: 'Turnos, cobros del turno y cierre con arqueo.', icono: 'i-lucide-wallet', ruta: '/caja', permiso: 'cajas.ver' },
            { id: 'promesas', etiqueta: 'Promesas', descripcion: 'Promesas de pago y su evaluación.', icono: 'i-lucide-calendar-clock', ruta: '/promesas', permiso: 'promesas.ver' },
        ],
    },
    {
        etiqueta: 'Control',
        secciones: [
            { id: 'bitacora', etiqueta: 'Bitácora', descripcion: 'Acciones por actor y canal, e historial de cambios.', icono: 'i-lucide-scroll-text', ruta: '/bitacora', permiso: 'bitacora.ver' },
            { id: 'libro', etiqueta: 'Libro', descripcion: 'Libro diario, libro mayor y egresos.', icono: 'i-lucide-book-open', ruta: '/libro', permiso: 'libro.ver' },
            { id: 'usuarios', etiqueta: 'Usuarios', descripcion: 'Usuarios, roles, permisos y tokens de API.', icono: 'i-lucide-user-cog', ruta: '/usuarios', permiso: 'usuarios.ver' },
        ],
    },
]

export const SECCIONES_PANEL: SeccionPanel[] = GRUPOS_PANEL.flatMap(grupo => grupo.secciones)

export function obtenerSeccion(id: string): SeccionPanel {
    const seccion = SECCIONES_PANEL.find(s => s.id === id)
    if (!seccion) {
        throw new Error(`Sección desconocida: ${id}`)
    }
    return seccion
}
