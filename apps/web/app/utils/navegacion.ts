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

/**
 * Grupo plegable del menú (menú resumido). Sin permiso para ninguna de sus
 * secciones, el grupo no aparece; el de la página actual se abre solo.
 */
export interface GrupoSecciones {
    id: string
    etiqueta: string
    icono: string
    /** Sus secciones van sueltas en el menú (sin grupo plegable). */
    plano?: boolean
    secciones: SeccionPanel[]
}

export const GRUPOS_PANEL: GrupoSecciones[] = [
    {
        // Accesos directos del día a día: van sueltos bajo «Inicio», sin grupo plegable.
        id: 'directo',
        etiqueta: 'Accesos directos',
        icono: 'i-lucide-zap',
        plano: true,
        secciones: [
            { id: 'cobro', etiqueta: 'Cobrar', descripcion: 'Cobro rápido: buscar cliente, ver lo que debe, registrar y dar recibo.', icono: 'i-lucide-hand-coins', ruta: '/cobro', permiso: 'pagos.registrar' },
            { id: 'caja', etiqueta: 'Caja', descripcion: 'Abrir la caja, cobros del turno y cierre con arqueo.', icono: 'i-lucide-wallet', ruta: '/caja', permiso: 'cajas.ver' },
        ],
    },
    {
        id: 'operacion',
        etiqueta: 'Operación',
        icono: 'i-lucide-activity',
        secciones: [
            { id: 'clientes', etiqueta: 'Clientes', descripcion: 'Búsqueda, fichas, datos fiscales y estado de cuenta.', icono: 'i-lucide-users', ruta: '/clientes', permiso: 'clientes.ver' },
            { id: 'servicios', etiqueta: 'Servicios', descripcion: 'Servicios PPPoE, sesiones activas y acciones de corte.', icono: 'i-lucide-wifi', ruta: '/servicios', permiso: 'servicios.ver' },
            { id: 'migracion', etiqueta: 'Migración de router', descripcion: 'Quién volvió a conectarse desde que el router pasó al nuevo servidor RADIUS, y fallos de red.', icono: 'i-lucide-arrow-right-left', ruta: '/routers/migracion', permiso: 'routers.ver' },
        ],
    },
    {
        id: 'cobros',
        etiqueta: 'Cobros',
        icono: 'i-lucide-coins',
        secciones: [
            { id: 'facturas', etiqueta: 'Facturas', descripcion: 'Avisos de cobro emitidos, vencidos y anulados.', icono: 'i-lucide-receipt-text', ruta: '/facturas', permiso: 'facturas.ver' },
            { id: 'pagos', etiqueta: 'Pagos', descripcion: 'Registro y anulación de pagos.', icono: 'i-lucide-banknote', ruta: '/pagos', permiso: 'pagos.ver' },
            { id: 'comprobantes', etiqueta: 'Comprobantes', descripcion: 'Depósitos y transferencias por verificar: aprobar registra el pago y reactiva.', icono: 'i-lucide-file-check-2', ruta: '/comprobantes', permiso: 'comprobantes.ver' },
            { id: 'pasarela', etiqueta: 'Conciliación de la pasarela', descripcion: 'Cobros en línea de cada día contra el reporte del proveedor, con sus diferencias.', icono: 'i-lucide-scale', ruta: '/cobros/pasarela', permiso: 'pagos.ver' },
            { id: 'promesas', etiqueta: 'Promesas', descripcion: 'Promesas de pago y su evaluación.', icono: 'i-lucide-calendar-clock', ruta: '/promesas', permiso: 'promesas.ver' },
            { id: 'dte', etiqueta: 'Cola de DTE', descripcion: 'Certificación FEL: pendientes, rechazados, en contingencia y anulaciones.', icono: 'i-lucide-badge-check', ruta: '/dte', permiso: 'fel.ver' },
            { id: 'notas-credito', etiqueta: 'Notas de crédito', descripcion: 'Rebajas sobre el saldo de una factura, con su asiento.', icono: 'i-lucide-file-minus', ruta: '/notas-credito', permiso: 'facturas.ver' },
            { id: 'bonificaciones', etiqueta: 'Bonificaciones', descripcion: 'Periodos regalados y cargos sin costo, con su motivo: ya no son facturas.', icono: 'i-lucide-hand-heart', ruta: '/bonificaciones', permiso: 'facturas.ver' },
            { id: 'lealtad', etiqueta: 'Lealtad', descripcion: 'Programa de puntos de la empresa, reglas para ganarlos y referidos.', icono: 'i-lucide-gem', ruta: '/lealtad', permiso: 'lealtad.ver' },
            { id: 'premios-lealtad', etiqueta: 'Premios', descripcion: 'Catálogo de premios que se canjean con puntos, y los que se ofrecen en el portal.', icono: 'i-lucide-gift', ruta: '/lealtad/premios', permiso: 'lealtad.ver' },
            { id: 'canjes-lealtad', etiqueta: 'Canjes', descripcion: 'Canjes de puntos del panel y del portal; canjear y revertir.', icono: 'i-lucide-repeat', ruta: '/lealtad/canjes', permiso: 'lealtad.ver' },
            { id: 'sorteos', etiqueta: 'Sorteos', descripcion: 'Bases, checklist legal, corte, ejecución verificable y entrega de premios.', icono: 'i-lucide-ticket', ruta: '/lealtad/sorteos', permiso: 'sorteos.ver' },
            { id: 'anuncios', etiqueta: 'Anuncios', descripcion: 'Promociones en el inicio del portal y en la página de corte, con vistas y clics.', icono: 'i-lucide-megaphone', ruta: '/anuncios', permiso: 'anuncios.ver' },
        ],
    },
    {
        id: 'contabilidad',
        etiqueta: 'Contabilidad',
        icono: 'i-lucide-calculator',
        secciones: [
            { id: 'libro', etiqueta: 'Libro', descripcion: 'Libro diario, libro mayor, cierre mensual e integridad de la cadena.', icono: 'i-lucide-book-open', ruta: '/libro', permiso: 'libro.ver' },
            { id: 'bloqueos-libro', etiqueta: 'Bloqueos del libro', descripcion: 'Bloqueos por tipo, bloqueo duro, excepciones y procesos detenidos por un bloqueo.', icono: 'i-lucide-lock', ruta: '/libro/bloqueos', permiso: 'libro.ver' },
            { id: 'libros-legales', etiqueta: 'Libros legales', descripcion: 'Diario, Mayor, Ventas y Compras con folio: vista previa, emisión, historial y habilitaciones.', icono: 'i-lucide-book-marked', ruta: '/libros', permiso: 'libros.ver' },
            { id: 'tablero-fiscal', etiqueta: 'Tablero fiscal', descripcion: 'Facturado, IVA, ISR e ISO estimados, límite del pequeño contribuyente, vencimientos, libros y FEL, con sus alertas.', icono: 'i-lucide-layout-dashboard', ruta: '/fiscal/tablero', permiso: 'fiscal.ver' },
            { id: 'comparador-regimenes', etiqueta: 'Comparador de regímenes', descripcion: 'Simulación del ISR en el régimen opcional y sobre utilidades con los datos del libro, m, m* y proyección.', icono: 'i-lucide-scale', ruta: '/fiscal/comparador', permiso: 'fiscal.ver' },
            { id: 'calendario-fiscal', etiqueta: 'Calendario fiscal', descripcion: 'Vencimientos de IVA, ISR, ISO y retenciones por mes o en lista, con las vencidas en rojo.', icono: 'i-lucide-calendar-check', ruta: '/fiscal/calendario', permiso: 'declaraciones.ver' },
            { id: 'declaraciones', etiqueta: 'Declaraciones', descripcion: 'IVA y pequeño contribuyente: borrador desde los libros, revisión con liquidación, presentación y pago.', icono: 'i-lucide-file-spreadsheet', ruta: '/declaraciones', permiso: 'declaraciones.ver' },
            { id: 'egresos', etiqueta: 'Egresos', descripcion: 'Gastos pagados por caja, banco o cuenta bancaria, con su asiento.', icono: 'i-lucide-receipt', ruta: '/egresos', permiso: 'egresos.ver' },
            { id: 'cartera', etiqueta: 'Cartera', descripcion: 'Estimación de incobrables y castigo de facturas con su gestión de cobro.', icono: 'i-lucide-shield-alert', ruta: '/cartera', permiso: 'reportes.ver' },
        ],
    },
    {
        id: 'compras',
        etiqueta: 'Compras',
        icono: 'i-lucide-shopping-cart',
        secciones: [
            { id: 'proveedores', etiqueta: 'Proveedores', descripcion: 'Proveedores con su estado de cuenta, lo que se les debe y su antigüedad.', icono: 'i-lucide-truck', ruta: '/proveedores', permiso: 'proveedores.ver' },
            { id: 'compras', etiqueta: 'Compras', descripcion: 'Facturas de proveedores con crédito fiscal, retenciones, condición y saldo; también desde un egreso.', icono: 'i-lucide-shopping-cart', ruta: '/compras', permiso: 'compras.ver' },
            { id: 'pagos-proveedores', etiqueta: 'Pagos a proveedores', descripcion: 'Pagos aplicados a sus compras, por caja, banco o cuenta; anular devuelve el saldo.', icono: 'i-lucide-banknote', ruta: '/pagos-proveedores', permiso: 'compras.ver' },
            { id: 'constancias', etiqueta: 'Constancias de retención', descripcion: 'Retenciones recibidas de clientes y emitidas a proveedores.', icono: 'i-lucide-file-check-2', ruta: '/constancias', permiso: 'compras.ver' },
            { id: 'activos', etiqueta: 'Activos fijos', descripcion: 'Alta, depreciación mensual y baja por venta o retiro.', icono: 'i-lucide-boxes', ruta: '/activos', permiso: 'activos.ver' },
            { id: 'diferimientos', etiqueta: 'Diferidos', descripcion: 'Gastos pagados por anticipado e ingresos diferidos con sus cuotas.', icono: 'i-lucide-calendar-range', ruta: '/diferimientos', permiso: 'libro.ver' },
        ],
    },
    {
        id: 'inventario',
        etiqueta: 'Inventario',
        icono: 'i-lucide-package',
        secciones: [
            { id: 'existencias', etiqueta: 'Existencias', descripcion: 'Qué hay en cada bodega, con su costo promedio y valor; saldo inicial, consumo, traslado, ajuste y baja.', icono: 'i-lucide-package', ruta: '/inventario', permiso: 'inventario.ver' },
            { id: 'traslados', etiqueta: 'Traslados', descripcion: 'Órdenes de traslado entre bodegas y técnicos: en tránsito, recibir con firma, faltantes e imprimir.', icono: 'i-lucide-truck', ruta: '/inventario/traslados', permiso: 'inventario.ver' },
            { id: 'mi-bodega', etiqueta: 'Mi bodega', descripcion: 'La bodega del técnico: existencias, equipos, órdenes por recibir y kardex.', icono: 'i-lucide-hard-hat', ruta: '/inventario/mi-bodega', permiso: 'inventario.ver' },
            { id: 'kardex', etiqueta: 'Kardex', descripcion: 'Entradas y salidas de cada producto con su saldo corrido.', icono: 'i-lucide-list-ordered', ruta: '/inventario/kardex', permiso: 'inventario.ver' },
            { id: 'productos', etiqueta: 'Productos', descripcion: 'Catálogo con SKU, seguimiento por cantidad o por serie y existencia mínima.', icono: 'i-lucide-box', ruta: '/inventario/productos', permiso: 'inventario.ver' },
            { id: 'tipos-producto', etiqueta: 'Tipos de producto', descripcion: 'Catálogo de tipos con su seguimiento y modalidad por defecto (comodato, gasto o cobro).', icono: 'i-lucide-tags', ruta: '/inventario/tipos-producto', permiso: 'inventario.ver' },
            { id: 'bodegas', etiqueta: 'Bodegas', descripcion: 'Bodegas y vehículos de técnico, con su tope.', icono: 'i-lucide-warehouse', ruta: '/inventario/bodegas', permiso: 'inventario.ver' },
            { id: 'unidades', etiqueta: 'Equipos por serie', descripcion: 'Equipos del cliente (router, ONU, antena) por serie o MAC: estado, dónde están e historial.', icono: 'i-lucide-barcode', ruta: '/inventario/unidades', permiso: 'inventario.ver' },
            { id: 'por-recuperar', etiqueta: 'Por recuperar', descripcion: 'Equipos en comodato de servicios retirados.', icono: 'i-lucide-undo-2', ruta: '/inventario/por-recuperar', permiso: 'inventario.ver' },
            { id: 'conteos', etiqueta: 'Conteos físicos', descripcion: 'Contar una bodega contra el kardex y ajustar faltantes y sobrantes.', icono: 'i-lucide-clipboard-list', ruta: '/inventario/conteos', permiso: 'inventario.ver' },
            { id: 'valorizado', etiqueta: 'Inventario valorizado', descripcion: 'Existencias y valor a una fecha, con el cuadre contra 1.1.14.', icono: 'i-lucide-scale', ruta: '/inventario/valorizado', permiso: 'inventario.ver' },
        ],
    },
    {
        id: 'bancos',
        etiqueta: 'Bancos',
        icono: 'i-lucide-landmark',
        secciones: [
            { id: 'cobros-por-liquidar', etiqueta: 'Cobros por liquidar', descripcion: 'Pagos por pasarela, agente o débito que esperan la liquidación del proveedor.', icono: 'i-lucide-hand-coins', ruta: '/cobros/por-liquidar', permiso: 'bancos.ver' },
            { id: 'fondos-transito', etiqueta: 'Fondos en tránsito', descripcion: 'Depósitos de caja y traslados entre bancos por acreditar.', icono: 'i-lucide-truck', ruta: '/bancos/transito', permiso: 'bancos.ver' },
            { id: 'conciliacion', etiqueta: 'Conciliación bancaria', descripcion: 'Extractos del banco, conciliación con el libro y reglas.', icono: 'i-lucide-file-spreadsheet', ruta: '/bancos/extractos', permiso: 'bancos.ver' },
        ],
    },
    {
        id: 'red',
        etiqueta: 'Red',
        icono: 'i-lucide-network',
        secciones: [
            { id: 'routers', etiqueta: 'Routers', descripcion: 'Routers MikroTik, redes IPv4 y bloques IPv6.', icono: 'i-lucide-router', ruta: '/routers', permiso: 'routers.ver' },
            { id: 'planes', etiqueta: 'Planes', descripcion: 'Velocidades, precios e implementación por router.', icono: 'i-lucide-gauge', ruta: '/planes', permiso: 'planes.ver' },
            { id: 'qos', etiqueta: 'Prioridad (QoS)', descripcion: 'Clases de tráfico: lo interactivo y la web antes que las descargas cuando el plan o el router se llenan.', icono: 'i-lucide-list-ordered', ruta: '/red/qos', permiso: 'qos.ver' },
            { id: 'adicionales', etiqueta: 'Adicionales', descripcion: 'Catálogo de streaming, IPTV y otros adicionales, y motivos de cortesía.', icono: 'i-lucide-package-plus', ruta: '/adicionales', permiso: 'adicionales.ver' },
        ],
    },
    {
        id: 'control',
        etiqueta: 'Reportes y bitácora',
        icono: 'i-lucide-chart-pie',
        secciones: [
            { id: 'reportes', etiqueta: 'Reportes', descripcion: 'Cartera vencida, ingresos, IVA, cobranza, cierres de caja y más, en CSV o Excel.', icono: 'i-lucide-file-chart-column', ruta: '/reportes', permiso: 'reportes.ver' },
            { id: 'bitacora', etiqueta: 'Bitácora', descripcion: 'Acciones por actor y canal, e historial de cambios.', icono: 'i-lucide-scroll-text', ruta: '/bitacora', permiso: 'bitacora.ver' },
        ],
    },
    {
        id: 'configuracion',
        etiqueta: 'Configuración',
        icono: 'i-lucide-settings',
        secciones: [
            { id: 'empresas', etiqueta: 'Empresas', descripcion: 'Empresas (NIT) con su logo y datos fiscales, y la empresa sugerida por zona y router.', icono: 'i-lucide-building-2', ruta: '/configuracion/empresas', permiso: 'empresas.ver' },
            { id: 'fiscal', etiqueta: 'Fiscal', descripcion: 'País, régimen, establecimientos, frases, parámetros con vigencia e impuestos de cada empresa, y feriados.', icono: 'i-lucide-landmark', ruta: '/configuracion/fiscal', permiso: 'fiscal.ver' },
            { id: 'fel', etiqueta: 'FEL', descripcion: 'Certificador, credenciales, modo de emisión, contingencia y momento de certificar de cada empresa.', icono: 'i-lucide-shield-check', ruta: '/configuracion/fel', permiso: 'fel.ver' },
            { id: 'inventario', etiqueta: 'Inventario', descripcion: 'Firma al recibir traslados y la IA que lee facturas de compra (proveedor, modelo y clave).', icono: 'i-lucide-package-search', ruta: '/configuracion/inventario', permiso: 'inventario.configurar' },
            { id: 'usuarios', etiqueta: 'Usuarios', descripcion: 'Usuarios del panel: alta, edición, roles con su alcance, desactivar y empresas.', icono: 'i-lucide-user-cog', ruta: '/usuarios', permiso: 'usuarios.ver' },
            { id: 'roles', etiqueta: 'Roles y permisos', descripcion: 'Roles con sus permisos y el catálogo de permisos del ACL.', icono: 'i-lucide-shield', ruta: '/usuarios/roles', permiso: 'roles.ver' },
            { id: 'tokens', etiqueta: 'Tokens de API', descripcion: 'Tokens para integraciones y agentes de IA: crear (se ven una vez) y revocar.', icono: 'i-lucide-key-round', ruta: '/usuarios/tokens', permiso: 'tokens.ver' },
            { id: 'plantillas', etiqueta: 'Plantillas', descripcion: 'Ciclos de facturación, corte, mora y reglas de promesas.', icono: 'i-lucide-file-cog', ruta: '/plantillas', permiso: 'plantillas.ver' },
            { id: 'cuentas-bancarias', etiqueta: 'Cuentas bancarias', descripcion: 'Cuentas propias para depósitos, transferencias, ACH y remesas.', icono: 'i-lucide-landmark', ruta: '/configuracion/cuentas-bancarias', permiso: 'cuentas_bancarias.ver' },
            { id: 'proveedores-cobro', etiqueta: 'Proveedores de cobro', descripcion: 'Pasarelas, agentes y débitos con su cuenta puente y fecha de corte.', icono: 'i-lucide-credit-card', ruta: '/configuracion/proveedores-cobro', permiso: 'bancos.ver' },
            { id: 'empresa', etiqueta: 'Contacto y pagos', descripcion: 'Contacto, horario e instrucciones de pago del aviso y el portal (empresa principal).', icono: 'i-lucide-contact', ruta: '/configuracion/empresa', permiso: 'empresa.ver' },
            { id: 'notificaciones', etiqueta: 'Notificaciones', descripcion: 'Correo y Telegram: servidor, bot, interruptores por canal y por aviso, global y por empresa.', icono: 'i-lucide-bell-ring', ruta: '/configuracion/notificaciones', permiso: 'notificaciones.ver' },
            { id: 'notificaciones-plantillas', etiqueta: 'Plantillas de avisos', descripcion: 'Texto de cada aviso por evento y canal, recordatorios de pago y registro de envíos.', icono: 'i-lucide-message-square-text', ruta: '/notificaciones', permiso: 'notificaciones.ver' },
            { id: 'campos-personalizados', etiqueta: 'Campos personalizados', descripcion: 'Datos extra de la ficha del cliente: tipo, obligatorio, orden; activar y desactivar.', icono: 'i-lucide-text-cursor-input', ruta: '/campos-personalizados', permiso: 'campos_personalizados.editar' },
            { id: 'nodos-portal', etiqueta: 'Nodos del portal', descripcion: 'Portales del cliente instalados en otro sitio: alta con token y revocar.', icono: 'i-lucide-server', ruta: '/configuracion/nodos-portal', permiso: 'nodos_portal.administrar' },
            { id: 'integraciones', etiqueta: 'Integraciones', descripcion: 'Horus Flow e Iris: conexión, token, enlace de conexión y autologin.', icono: 'i-lucide-blocks', ruta: '/configuracion/integraciones', permiso: 'horus.ver' },
            { id: 'integracion-iris', etiqueta: 'Iris', descripcion: 'Conector con Iris: enlace de conexión, configuración a mano, tokens y envíos.', icono: 'i-lucide-clipboard-list', ruta: '/configuracion/integraciones/iris', permiso: 'iris.ver' },
            { id: 'aviso-cobro', etiqueta: 'Plantillas de documentos', descripcion: 'HTML con variables del PDF del aviso de cobro, la factura FEL y la nota de crédito.', icono: 'i-lucide-file-code-2', ruta: '/configuracion/aviso-cobro', permiso: 'documentos.ver' },
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

/** Grupo al que pertenece la ruta actual (la sección con el prefijo más largo), o `null`. */
export function grupoDeRuta(ruta: string): GrupoSecciones | null {
    let mejor: { grupo: GrupoSecciones, largo: number } | null = null
    for (const grupo of GRUPOS_PANEL) {
        for (const seccion of grupo.secciones) {
            const coincide = ruta === seccion.ruta || ruta.startsWith(`${seccion.ruta}/`)
            if (coincide && (!mejor || seccion.ruta.length > mejor.largo)) {
                mejor = { grupo, largo: seccion.ruta.length }
            }
        }
    }
    return mejor?.grupo ?? null
}
