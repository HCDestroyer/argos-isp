/**
 * Submenú de Configuración (tableros OperConfig*, diseño aprobado el 21 nov 2026): las secciones de
 * la columna izquierda y las pantallas internas de cada una. Una pantalla interna se ve como
 * pestaña segmentada dentro de la tarjeta de la sección (`pestana: true`) o como subpágina a la que
 * se llega desde la sección (`pestana: false`, con «Atrás»). Los permisos son los de cada página
 * (`definePageMeta`), con los nombres de `apps/api/app/core/permisos.ts`.
 */
export interface PaginaConfiguracion {
    id: string
    etiqueta: string
    icono: string
    ruta: string
    /** Uno, o una lista de la que basta uno. `null`: solo el rol `admin` (pantallas sin permiso propio todavía). */
    permiso: string | readonly string[] | null
    /** Se muestra como pestaña de la sección (las demás son subpáginas). */
    pestana: boolean
    /** Rutas que cuentan como esta pantalla (subpáginas de una lista, como la edición de una plantilla). */
    tambien?: RegExp
}

export interface SeccionConfiguracion {
    id: string
    etiqueta: string
    /** Frase corta del submenú (debajo del nombre). */
    resumen: string
    icono: string
    paginas: PaginaConfiguracion[]
}

export const SECCIONES_CONFIGURACION: SeccionConfiguracion[] = [
    {
        id: 'empresa',
        etiqueta: 'Empresa y fiscal',
        resumen: 'Datos, régimen y factura electrónica',
        icono: 'i-lucide-building',
        paginas: [
            { id: 'empresas', etiqueta: 'Datos de la empresa', icono: 'i-lucide-building', ruta: '/configuracion/empresas', permiso: 'empresas.ver', pestana: true },
            { id: 'fiscal', etiqueta: 'Régimen e impuestos', icono: 'i-lucide-landmark', ruta: '/configuracion/fiscal', permiso: 'fiscal.ver', pestana: true },
            { id: 'fel', etiqueta: 'Factura electrónica (FEL)', icono: 'i-lucide-shield-check', ruta: '/configuracion/fel', permiso: 'fel.ver', pestana: true },
            { id: 'contacto', etiqueta: 'Contacto y pagos', icono: 'i-lucide-contact', ruta: '/configuracion/empresa', permiso: 'empresa.ver', pestana: true },
        ],
    },
    {
        id: 'cobro',
        etiqueta: 'Facturación y cobro',
        resumen: 'Plantillas, cuentas y bancos',
        icono: 'i-lucide-landmark',
        paginas: [
            { id: 'cuentas-bancarias', etiqueta: 'Cuentas bancarias', icono: 'i-lucide-landmark', ruta: '/configuracion/cuentas-bancarias', permiso: 'cuentas_bancarias.ver', pestana: true },
            { id: 'bancos-origen', etiqueta: 'Bancos de origen', icono: 'i-lucide-list', ruta: '/configuracion/bancos-origen', permiso: 'cuentas_bancarias.ver', pestana: true },
            { id: 'plantillas-conceptos', etiqueta: 'Plantillas y conceptos', icono: 'i-lucide-file-text', ruta: '/configuracion/plantillas-conceptos', permiso: ['plantillas.ver', 'documentos.ver'], pestana: true, tambien: /^\/configuracion\/(aviso-cobro|plantillas-documentos)(\/|$)/ },
            { id: 'reglas-cobro', etiqueta: 'Reglas de cobro y libro', icono: 'i-lucide-shield-check', ruta: '/configuracion/reglas-cobro', permiso: 'ajustes_cobro.ver', pestana: true },
            { id: 'proveedores-cobro', etiqueta: 'Proveedores de cobro', icono: 'i-lucide-credit-card', ruta: '/configuracion/proveedores-cobro', permiso: 'bancos.ver', pestana: true },
        ],
    },
    {
        id: 'red',
        etiqueta: 'Red y portal',
        resumen: 'Portal de corte y del cliente',
        icono: 'i-lucide-globe',
        paginas: [
            { id: 'portal-corte', etiqueta: 'Red y portal', icono: 'i-lucide-globe', ruta: '/configuracion/portal-corte', permiso: 'portal_corte.ver', pestana: false },
            { id: 'portal-contrasena', etiqueta: 'Contraseña del portal', icono: 'i-lucide-key-round', ruta: '/configuracion/portal-contrasena', permiso: 'empresa.ver', pestana: false },
            { id: 'nodos-portal', etiqueta: 'Nodos del portal', icono: 'i-lucide-server', ruta: '/configuracion/nodos-portal', permiso: 'nodos_portal.administrar', pestana: false },
            { id: 'inventario', etiqueta: 'Inventario', icono: 'i-lucide-package-search', ruta: '/configuracion/inventario', permiso: 'inventario.configurar', pestana: false },
        ],
    },
    {
        id: 'usuarios',
        etiqueta: 'Usuarios y permisos',
        resumen: 'Usuarios, roles y tokens',
        icono: 'i-lucide-users',
        paginas: [
            { id: 'usuarios', etiqueta: 'Usuarios', icono: 'i-lucide-user-cog', ruta: '/usuarios', permiso: 'usuarios.ver', pestana: false },
            { id: 'roles', etiqueta: 'Roles y permisos', icono: 'i-lucide-shield', ruta: '/usuarios/roles', permiso: 'roles.ver', pestana: false },
            { id: 'tokens', etiqueta: 'Tokens de API', icono: 'i-lucide-key-round', ruta: '/usuarios/tokens', permiso: 'tokens.ver', pestana: false },
        ],
    },
    {
        id: 'notificaciones',
        etiqueta: 'Notificaciones',
        resumen: 'Canales y plantillas de mensajes',
        icono: 'i-lucide-bell',
        paginas: [
            { id: 'notificaciones', etiqueta: 'Notificaciones', icono: 'i-lucide-bell', ruta: '/configuracion/notificaciones', permiso: 'notificaciones.ver', pestana: false },
        ],
    },
    {
        id: 'integraciones',
        etiqueta: 'Integraciones',
        resumen: 'Iris, Horus, pasarela',
        icono: 'i-lucide-link',
        paginas: [
            { id: 'integraciones', etiqueta: 'Integraciones', icono: 'i-lucide-link', ruta: '/configuracion/integraciones', permiso: ['horus.ver', 'iris.ver', 'equipos.ver'], pestana: false, tambien: /^\/configuracion\/integraciones\// },
        ],
    },
    {
        id: 'importar',
        etiqueta: 'Importar datos',
        resumen: 'Desde Mikrowisp u otro sistema',
        icono: 'i-lucide-upload',
        paginas: [
            // Decisión 24 del PM: solo el admin. La API de la importación aún no tiene permiso propio.
            { id: 'importar', etiqueta: 'Importar desde Mikrowisp', icono: 'i-lucide-upload', ruta: '/configuracion/importar', permiso: null, pestana: false },
        ],
    },
    {
        id: 'reportes',
        etiqueta: 'Reportes',
        resumen: 'Bajas y envíos programados',
        icono: 'i-lucide-chart-pie',
        paginas: [
            { id: 'reportes', etiqueta: 'Reportes', icono: 'i-lucide-chart-pie', ruta: '/configuracion/reportes', permiso: 'reportes.ver', pestana: false },
        ],
    },
    {
        id: 'apariencia',
        etiqueta: 'Apariencia',
        resumen: 'Logo, colores e inicio de sesión',
        icono: 'i-lucide-brush',
        paginas: [
            { id: 'apariencia', etiqueta: 'Apariencia', icono: 'i-lucide-brush', ruta: '/configuracion/apariencia', permiso: 'apariencia.ver', pestana: false },
        ],
    },
    {
        id: 'sistema',
        etiqueta: 'Sistema',
        resumen: 'Salud, registro y almacenamiento',
        icono: 'i-lucide-activity',
        paginas: [
            { id: 'salud', etiqueta: 'Salud', icono: 'i-lucide-heart-pulse', ruta: '/sistema/salud', permiso: 'sistema.ver_salud', pestana: true },
            { id: 'registro', etiqueta: 'Registro', icono: 'i-lucide-scroll', ruta: '/sistema/registro', permiso: 'sistema.ver_registro', pestana: true },
            { id: 'almacenamiento', etiqueta: 'Almacenamiento', icono: 'i-lucide-hard-drive', ruta: '/sistema/almacenamiento', permiso: 'sistema.ver_almacenamiento', pestana: true },
        ],
    },
]

/** La sección y la pantalla de una ruta (`null` fuera de Configuración). */
export function ubicacionConfiguracion(ruta: string): { seccion: SeccionConfiguracion, pagina: PaginaConfiguracion } | null {
    for (const seccion of SECCIONES_CONFIGURACION) {
        const pagina = seccion.paginas.find(p => p.ruta === ruta) ?? seccion.paginas.find(p => p.tambien?.test(ruta))
        if (pagina) {
            return { seccion, pagina }
        }
    }
    return null
}

/** Quita tildes y pasa a minúsculas, para buscar «fel», «envios»… sin importar cómo se escriba. */
export function normalizarBusqueda(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Fila de la lista de integraciones (tablero OperConfigIntegraciones). */
export interface IntegracionItem {
    id: string
    nombre: string
    frase: string
    icono: string
    tono: string
    to: string
    estado: { etiqueta: string, color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral', icono?: string, prueba?: string } | null
}
