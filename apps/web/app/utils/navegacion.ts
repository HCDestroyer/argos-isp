import { PERMISOS_AJUSTES, RUTA_AJUSTES, SECCIONES_CONFIGURACION } from './configuracionSecciones'

/**
 * Menú lateral del panel. Cada sección se muestra solo si el usuario tiene `permiso`, y la página
 * repite el mismo permiso en `definePageMeta({ permiso })` (`pnpm verificar:permisos`).
 *
 * Orden por frecuencia de uso en el día a día de un ISP (decisión del PM, rediseño del panel):
 * primero lo de mostrador (cobrar, caja, clientes, servicios), luego la gestión (facturación, red,
 * inventario, lealtad), la administración (finanzas y reportes) y al final la
 * configuración. Cada grupo pertenece a un `bloque` (encabezado en versalitas, no clicable).
 */
export interface SeccionPanel {
    id: string
    etiqueta: string
    descripcion: string
    icono: string
    ruta: string
    /** Uno, o una lista de la que basta uno (igual que el `permiso` de `definePageMeta`). */
    permiso: string | readonly string[]
    /** Pantalla sin permiso propio todavía: solo la ve este rol (su `permiso` es `SIN_PERMISO`). Ver `puedeSeccion`. */
    soloRol?: string
}

/** Subgrupo plegable dentro de un grupo (Finanzas, y los grupos de Ajustes para el buscador). */
export interface SubgrupoSecciones {
    id: string
    etiqueta: string
    icono: string
    /** Frase corta del subgrupo (los grupos de Ajustes). */
    descripcion?: string
    secciones: SeccionPanel[]
}

/**
 * Grupo plegable del menú. Sin permiso para ninguna de sus secciones, el grupo no aparece; el de la
 * página actual se abre solo.
 */
export interface GrupoSecciones {
    id: string
    etiqueta: string
    icono: string
    /** Encabezado del bloque al que pertenece (agrupa el buscador y la documentación). */
    bloque: string
    /** Etiqueta corta bajo el icono en el menú compacto (rail). */
    corta: string
    /** Sus secciones van sueltas en el menú (sin grupo plegable). */
    plano?: boolean
    secciones: SeccionPanel[]
    /** Subgrupos plegables, después de las secciones sueltas del grupo. */
    subgrupos?: SubgrupoSecciones[]
}

/** El `permiso` de una sección que todavía no tiene uno propio (con `soloRol`): nadie lo cumple. */
export const SIN_PERMISO: readonly string[] = []

export const GRUPOS_PANEL: GrupoSecciones[] = [
    {
        // Lo de mostrador, el primer grupo.
        id: 'dia',
        etiqueta: 'Día a día',
        icono: 'i-lucide-zap',
        bloque: 'Día a día',
        corta: 'Día a día',
        secciones: [
            { id: 'cobro', etiqueta: 'Cobrar', descripcion: 'Cobro rápido: buscar cliente, ver lo que debe, registrar y dar recibo.', icono: 'i-lucide-banknote', ruta: '/cobro', permiso: 'pagos.registrar' },
            { id: 'caja', etiqueta: 'Caja', descripcion: 'Abrir la caja, cobros del turno y cierre con arqueo.', icono: 'i-lucide-wallet', ruta: '/caja', permiso: 'cajas.ver' },
            { id: 'clientes', etiqueta: 'Clientes', descripcion: 'Búsqueda, fichas, datos fiscales y estado de cuenta.', icono: 'i-lucide-users', ruta: '/clientes', permiso: 'clientes.ver' },
            // Iris 0.14.1: cambios de titular a una empresa que esperan a una persona (dentro de Clientes).
            { id: 'titulares-empresa', etiqueta: 'Revisión de titulares', descripcion: 'Cambios de titular a una empresa que esperan revisión: representante nuevo o varias empresas con el mismo NIT.', icono: 'i-lucide-building-2', ruta: '/clientes/titulares', permiso: 'clientes.ver_identidad' },
            { id: 'servicios', etiqueta: 'Servicios', descripcion: 'Servicios PPPoE, sesiones activas y acciones de corte.', icono: 'i-lucide-wifi', ruta: '/servicios', permiso: 'servicios.ver' },
            { id: 'promesas', etiqueta: 'Promesas', descripcion: 'Promesas de pago y su evaluación.', icono: 'i-lucide-calendar-clock', ruta: '/promesas', permiso: 'promesas.ver' },
            { id: 'comprobantes', etiqueta: 'Comprobantes', descripcion: 'Depósitos y transferencias por verificar: aprobar registra el pago y reactiva.', icono: 'i-lucide-file-check-2', ruta: '/comprobantes', permiso: 'comprobantes.ver' },
        ],
    },
    {
        id: 'facturacion',
        etiqueta: 'Facturación',
        icono: 'i-lucide-receipt-text',
        bloque: 'Gestión',
        corta: 'Facturas',
        secciones: [
            { id: 'facturas', etiqueta: 'Facturas', descripcion: 'Avisos de cobro emitidos, vencidos y anulados.', icono: 'i-lucide-receipt-text', ruta: '/facturas', permiso: 'facturas.ver' },
            { id: 'pagos', etiqueta: 'Pagos', descripcion: 'Registro y anulación de pagos.', icono: 'i-lucide-hand-coins', ruta: '/pagos', permiso: 'pagos.ver' },
            { id: 'notas-credito', etiqueta: 'Notas de crédito', descripcion: 'Rebajas sobre el saldo de una factura, con su asiento.', icono: 'i-lucide-file-minus', ruta: '/notas-credito', permiso: 'facturas.ver' },
            { id: 'bonificaciones', etiqueta: 'Bonificaciones', descripcion: 'Periodos regalados y cargos sin costo, con su motivo: ya no son facturas.', icono: 'i-lucide-hand-heart', ruta: '/bonificaciones', permiso: 'facturas.ver' },
            { id: 'pasarela', etiqueta: 'Conciliación de la pasarela', descripcion: 'Cobros en línea de cada día contra el reporte del proveedor, con sus diferencias.', icono: 'i-lucide-scale', ruta: '/cobros/pasarela', permiso: 'pagos.ver' },
        ],
    },
    {
        id: 'red',
        etiqueta: 'Red',
        icono: 'i-lucide-network',
        bloque: 'Gestión',
        corta: 'Red',
        secciones: [
            { id: 'routers', etiqueta: 'Routers', descripcion: 'Routers MikroTik: estado, conexión, velocidad, redes y comandos.', icono: 'i-lucide-router', ruta: '/routers', permiso: 'routers.ver' },
            { id: 'planes', etiqueta: 'Planes', descripcion: 'Velocidades, precios y en qué routers se ofrece cada plan.', icono: 'i-lucide-gauge', ruta: '/planes', permiso: 'planes.ver' },
            { id: 'ips', etiqueta: 'Direcciones IP', descripcion: 'Todas las redes de todos los routers y de quién es cada IP.', icono: 'i-lucide-network', ruta: '/red/ips', permiso: 'redes.ver' },
            { id: 'red-acceso', etiqueta: 'Red de acceso', descripcion: 'Por dónde llega cada cliente: OLT, puerto PON, VLAN, servidor PPPoE y red.', icono: 'i-lucide-cable', ruta: '/red/acceso', permiso: 'red_acceso.ver' },
            { id: 'conectados', etiqueta: 'Conectados ahora', descripcion: 'Quién está navegando, desde cuándo y por cuál router.', icono: 'i-lucide-wifi', ruta: '/red/conectados', permiso: 'sesiones.ver' },
        ],
        // Decisión 29 del PM: el menú Red son esas cinco; lo demás va aparte, en «Más de red».
        subgrupos: [
            {
                id: 'red-mas',
                etiqueta: 'Más de red',
                icono: 'i-lucide-ellipsis',
                secciones: [
                    { id: 'qos', etiqueta: 'Prioridad (QoS)', descripcion: 'Clases de tráfico: lo interactivo y la web antes que las descargas cuando el plan o el router se llenan.', icono: 'i-lucide-list-ordered', ruta: '/red/qos', permiso: 'qos.ver' },
                    { id: 'adicionales', etiqueta: 'Adicionales', descripcion: 'Catálogo de streaming, IPTV y otros adicionales, y motivos de cortesía.', icono: 'i-lucide-package-plus', ruta: '/adicionales', permiso: 'adicionales.ver' },
                    { id: 'migracion', etiqueta: 'Migración de router', descripcion: 'Quién volvió a conectarse desde que el router pasó al nuevo servidor RADIUS, y fallos de red.', icono: 'i-lucide-arrow-right-left', ruta: '/routers/migracion', permiso: 'routers.ver' },
                ],
            },
        ],
    },
    {
        id: 'inventario',
        etiqueta: 'Inventario',
        icono: 'i-lucide-package',
        bloque: 'Gestión',
        corta: 'Inventario',
        secciones: [],
        // Más de 7 secciones: en dos subgrupos (lo de todos los días y los catálogos).
        subgrupos: [
            {
                id: 'inventario-movimientos',
                etiqueta: 'Movimientos',
                icono: 'i-lucide-arrow-left-right',
                secciones: [
                    { id: 'existencias', etiqueta: 'Existencias', descripcion: 'Qué hay en cada bodega, con su costo promedio y valor; saldo inicial, consumo, traslado, ajuste y baja.', icono: 'i-lucide-package', ruta: '/inventario', permiso: 'inventario.ver' },
                    { id: 'traslados', etiqueta: 'Traslados', descripcion: 'Órdenes de traslado entre bodegas y técnicos: en tránsito, recibir con firma, faltantes e imprimir.', icono: 'i-lucide-truck', ruta: '/inventario/traslados', permiso: 'inventario.ver' },
                    { id: 'mi-bodega', etiqueta: 'Mi bodega', descripcion: 'La bodega del técnico: existencias, equipos, órdenes por recibir y kardex.', icono: 'i-lucide-hard-hat', ruta: '/inventario/mi-bodega', permiso: 'inventario.ver' },
                    { id: 'unidades', etiqueta: 'Equipos por serie', descripcion: 'Equipos del cliente (router, ONU, antena) por serie o MAC: estado, dónde están e historial.', icono: 'i-lucide-barcode', ruta: '/inventario/unidades', permiso: 'inventario.ver' },
                    { id: 'por-recuperar', etiqueta: 'Por recuperar', descripcion: 'Equipos de servicios retirados, intentos de recuperación, no recuperados y cobros de equipo por decidir.', icono: 'i-lucide-undo-2', ruta: '/inventario/por-recuperar', permiso: 'inventario.ver' },
                    { id: 'revision-garantia', etiqueta: 'Revisión y garantía', descripcion: 'Equipos que se prueban en bodega, los que están en garantía del proveedor y los dados de baja.', icono: 'i-lucide-wrench', ruta: '/inventario/revision', permiso: 'inventario.ver' },
                    { id: 'conteos', etiqueta: 'Conteos físicos', descripcion: 'Contar una bodega contra el kardex y ajustar faltantes y sobrantes.', icono: 'i-lucide-clipboard-list', ruta: '/inventario/conteos', permiso: 'inventario.ver' },
                ],
            },
            {
                id: 'inventario-catalogos',
                etiqueta: 'Catálogos y kardex',
                icono: 'i-lucide-library',
                secciones: [
                    { id: 'productos', etiqueta: 'Productos', descripcion: 'Catálogo con SKU, seguimiento por cantidad o por serie y existencia mínima.', icono: 'i-lucide-box', ruta: '/inventario/productos', permiso: 'inventario.ver' },
                    { id: 'tipos-producto', etiqueta: 'Tipos de producto', descripcion: 'Catálogo de tipos con su seguimiento y modalidad por defecto (comodato, gasto o cobro).', icono: 'i-lucide-tags', ruta: '/inventario/tipos-producto', permiso: 'inventario.ver' },
                    { id: 'bodegas', etiqueta: 'Bodegas', descripcion: 'Bodegas y vehículos de técnico, con su tope.', icono: 'i-lucide-warehouse', ruta: '/inventario/bodegas', permiso: 'inventario.ver' },
                    { id: 'kardex', etiqueta: 'Kardex', descripcion: 'Entradas y salidas de cada producto con su saldo corrido.', icono: 'i-lucide-list-ordered', ruta: '/inventario/kardex', permiso: 'inventario.ver' },
                    { id: 'tecnicos-iris', etiqueta: 'Técnicos de Iris', descripcion: 'Cómo se vincula cada técnico de Iris con su usuario de Argos para mover su bodega; conciliar los rechazados.', icono: 'i-lucide-link', ruta: '/inventario/tecnicos-iris', permiso: 'inventario.ver' },
                    { id: 'valorizado', etiqueta: 'Inventario valorizado', descripcion: 'Existencias y valor a una fecha, con el cuadre contra 1.1.14.', icono: 'i-lucide-scale', ruta: '/inventario/valorizado', permiso: 'inventario.ver' },
                ],
            },
        ],
    },
    {
        id: 'lealtad',
        etiqueta: 'Clientes y lealtad',
        icono: 'i-lucide-gem',
        bloque: 'Gestión',
        corta: 'Lealtad',
        secciones: [
            { id: 'lealtad', etiqueta: 'Lealtad', descripcion: 'Programa de puntos de la empresa, reglas para ganarlos y referidos.', icono: 'i-lucide-gem', ruta: '/lealtad', permiso: 'lealtad.ver' },
            { id: 'premios-lealtad', etiqueta: 'Premios', descripcion: 'Catálogo de premios que se canjean con puntos, y los que se ofrecen en el portal.', icono: 'i-lucide-gift', ruta: '/lealtad/premios', permiso: 'lealtad.ver' },
            { id: 'canjes-lealtad', etiqueta: 'Canjes', descripcion: 'Canjes de puntos del panel y del portal; canjear y revertir.', icono: 'i-lucide-repeat', ruta: '/lealtad/canjes', permiso: 'lealtad.ver' },
            { id: 'sorteos', etiqueta: 'Sorteos', descripcion: 'Bases, checklist legal, corte, ejecución verificable y entrega de premios.', icono: 'i-lucide-ticket', ruta: '/lealtad/sorteos', permiso: 'sorteos.ver' },
            { id: 'anuncios', etiqueta: 'Anuncios', descripcion: 'Promociones en el inicio del portal y en la página de corte, con vistas y clics.', icono: 'i-lucide-megaphone', ruta: '/anuncios', permiso: 'anuncios.ver' },
        ],
    },
    {
        // Decisión 1 del PM (rediseño de Finanzas): Panel, Libro, Cierres, Impuestos, Compras, Cartera
        // y Bancos en un solo grupo; Reportes va aparte. Cajas entra aquí cuando exista su pantalla.
        id: 'finanzas',
        etiqueta: 'Finanzas',
        icono: 'i-lucide-landmark',
        bloque: 'Administración',
        corta: 'Finanzas',
        secciones: [
            { id: 'panel-financiero', etiqueta: 'Panel financiero', descripcion: 'Cobrado contra facturado, cartera vencida, efectivo, impuestos por pagar y avisos del libro, por empresa.', icono: 'i-lucide-layout-dashboard', ruta: '/finanzas', permiso: 'reportes.ver' },
            { id: 'libro', etiqueta: 'Libro contable', descripcion: 'Diario, mayor, auxiliar de cada cliente y plan de cuentas; un asiento nunca se edita.', icono: 'i-lucide-book-open', ruta: '/libro', permiso: 'libro.ver' },
            { id: 'cierres-libro', etiqueta: 'Periodos y cierres', descripcion: 'Cierre de cada mes con sus verificaciones, cierre del ejercicio, bloqueos y reabrir un mes.', icono: 'i-lucide-calendar-check-2', ruta: '/libro/cierres', permiso: 'libro.ver' },
            { id: 'bloqueos-libro', etiqueta: 'Bloqueos del libro', descripcion: 'Bloqueos por tipo, bloqueo duro, excepciones y procesos detenidos por un bloqueo.', icono: 'i-lucide-lock', ruta: '/libro/bloqueos', permiso: 'libro.ver' },
            { id: 'cartera', etiqueta: 'Cartera', descripcion: 'Lo que deben los clientes por antigüedad, gestiones de cobro, castigos y la estimación de incobrables.', icono: 'i-lucide-shield-alert', ruta: '/cartera', permiso: 'reportes.ver' },
        ],
        subgrupos: [
            {
                id: 'impuestos',
                etiqueta: 'Impuestos',
                icono: 'i-lucide-landmark',
                secciones: [
                    { id: 'tablero-fiscal', etiqueta: 'Resumen fiscal', descripcion: 'IVA, ISR e ISO estimados, límite del pequeño contribuyente, vencimientos, declaraciones y consejos.', icono: 'i-lucide-layout-dashboard', ruta: '/fiscal/tablero', permiso: 'fiscal.ver' },
                    { id: 'calendario-fiscal', etiqueta: 'Calendario fiscal', descripcion: 'Vencimientos de IVA, ISR, ISO y retenciones por mes o en lista, con las vencidas en rojo.', icono: 'i-lucide-calendar-check', ruta: '/fiscal/calendario', permiso: 'declaraciones.ver' },
                    { id: 'declaraciones', etiqueta: 'Declaraciones', descripcion: 'IVA y pequeño contribuyente: borrador desde los libros, revisión con liquidación, presentación y pago.', icono: 'i-lucide-file-spreadsheet', ruta: '/declaraciones', permiso: 'declaraciones.ver' },
                    { id: 'dte', etiqueta: 'Facturación electrónica', descripcion: 'Documentos FEL: en cola, rechazados, en contingencia, por anular y certificados.', icono: 'i-lucide-badge-check', ruta: '/dte', permiso: 'fel.ver' },
                    { id: 'libros-legales', etiqueta: 'Libros legales', descripcion: 'Diario, Mayor, Ventas y Compras con folio: vista previa, emisión, historial y habilitaciones.', icono: 'i-lucide-book-marked', ruta: '/libros', permiso: 'libros.ver' },
                    { id: 'comparador-regimenes', etiqueta: 'Comparador de regímenes', descripcion: 'Cuánto ISR pagarías en el régimen opcional y sobre utilidades con los datos del libro.', icono: 'i-lucide-scale', ruta: '/fiscal/comparador', permiso: 'fiscal.ver' },
                ],
            },
            {
                id: 'compras',
                etiqueta: 'Compras',
                icono: 'i-lucide-shopping-cart',
                secciones: [
                    { id: 'compras', etiqueta: 'Compras y gastos', descripcion: 'Facturas de proveedores con crédito fiscal, retenciones, condición y saldo; también desde un egreso.', icono: 'i-lucide-shopping-cart', ruta: '/compras', permiso: 'compras.ver' },
                    { id: 'proveedores', etiqueta: 'Proveedores', descripcion: 'Proveedores con su estado de cuenta, lo que se les debe y su antigüedad.', icono: 'i-lucide-truck', ruta: '/proveedores', permiso: 'proveedores.ver' },
                    { id: 'pagos-proveedores', etiqueta: 'Pagos a proveedores', descripcion: 'Pagos aplicados a sus compras, por caja, banco o cuenta; anular devuelve el saldo.', icono: 'i-lucide-banknote', ruta: '/pagos-proveedores', permiso: 'compras.ver' },
                    { id: 'egresos', etiqueta: 'Egresos', descripcion: 'Gastos pagados por caja, banco o cuenta bancaria, con su asiento.', icono: 'i-lucide-receipt', ruta: '/egresos', permiso: 'egresos.ver' },
                    { id: 'constancias', etiqueta: 'Constancias de retención', descripcion: 'Retenciones recibidas de clientes y emitidas a proveedores.', icono: 'i-lucide-file-check-2', ruta: '/constancias', permiso: 'compras.ver' },
                    { id: 'activos', etiqueta: 'Activos fijos', descripcion: 'Alta, depreciación mensual y baja por venta o retiro.', icono: 'i-lucide-boxes', ruta: '/activos', permiso: 'activos.ver' },
                    { id: 'diferimientos', etiqueta: 'Diferidos', descripcion: 'Gastos pagados por anticipado e ingresos diferidos con sus cuotas.', icono: 'i-lucide-calendar-range', ruta: '/diferimientos', permiso: 'libro.ver' },
                ],
            },
            {
                id: 'bancos',
                etiqueta: 'Bancos',
                icono: 'i-lucide-building-2',
                secciones: [
                    { id: 'cobros-por-liquidar', etiqueta: 'Cobros por liquidar', descripcion: 'Pagos por pasarela, agente o débito que esperan la liquidación del proveedor.', icono: 'i-lucide-hand-coins', ruta: '/cobros/por-liquidar', permiso: 'bancos.ver' },
                    { id: 'fondos-transito', etiqueta: 'Fondos en tránsito', descripcion: 'Depósitos de caja y traslados entre bancos por acreditar.', icono: 'i-lucide-truck', ruta: '/bancos/transito', permiso: 'bancos.ver' },
                    { id: 'conciliacion', etiqueta: 'Conciliación bancaria', descripcion: 'Extractos del banco, conciliación con el libro y reglas.', icono: 'i-lucide-file-spreadsheet', ruta: '/bancos/extractos', permiso: 'bancos.ver' },
                ],
            },
        ],
    },
    {
        id: 'control',
        etiqueta: 'Reportes',
        icono: 'i-lucide-chart-pie',
        bloque: 'Administración',
        corta: 'Reportes',
        secciones: [
            { id: 'reportes', etiqueta: 'Reportes', descripcion: 'Cobranza, ingresos, caja, contabilidad y fiscal: cada uno se filtra y se descarga en Excel o PDF.', icono: 'i-lucide-file-chart-column', ruta: '/reportes', permiso: 'reportes.ver' },
            { id: 'envios-reportes', etiqueta: 'Envíos programados', descripcion: 'Reportes que llegan solos por correo y los correos de fuera de la empresa que el admin aprobó.', icono: 'i-lucide-send', ruta: '/reportes/envios', permiso: 'reportes.programar_envio' },
            { id: 'bitacora', etiqueta: 'Bitácora', descripcion: 'Acciones por actor y canal, e historial de cambios.', icono: 'i-lucide-scroll-text', ruta: '/bitacora', permiso: 'bitacora.ver' },
        ],
    },
    {
        // Ajustes (respuestas del PM, 26 nov 2026): en el menú es una sola entrada fija abajo que abre
        // la página de tarjetas; aquí sus grupos salen del catálogo único (`configuracionSecciones.ts`)
        // para el buscador Ctrl K, las migas y los accesos rápidos.
        id: 'configuracion',
        etiqueta: 'Ajustes',
        icono: 'i-lucide-settings',
        bloque: 'Sistema',
        corta: 'Ajustes',
        secciones: [
            // Página de Ajustes: basta con poder abrir alguno de sus ajustes.
            { id: 'configuracion', etiqueta: 'Ajustes', descripcion: 'Todos los ajustes por grupo, con buscador.', icono: 'i-lucide-settings', ruta: RUTA_AJUSTES, permiso: PERMISOS_AJUSTES },
        ],
        subgrupos: SECCIONES_CONFIGURACION.map(grupo => ({
            id: grupo.id,
            etiqueta: grupo.etiqueta,
            icono: grupo.icono,
            descripcion: grupo.resumen,
            secciones: grupo.paginas.map(pagina => ({
                id: pagina.id,
                etiqueta: pagina.etiqueta,
                descripcion: pagina.descripcion,
                icono: pagina.icono,
                ruta: pagina.ruta,
                // Sin permiso propio (Importar desde Mikrowisp): solo el rol `admin`.
                permiso: pagina.permiso ?? SIN_PERMISO,
                ...(pagina.permiso === null ? { soloRol: 'admin' } : {}),
            })),
        })),
    },
]

/** Todas las secciones de un grupo: las sueltas y las de sus subgrupos, en el orden del menú. */
export function seccionesDeGrupo(grupo: Pick<GrupoSecciones, 'secciones' | 'subgrupos'>): SeccionPanel[] {
    return [...grupo.secciones, ...(grupo.subgrupos ?? []).flatMap(subgrupo => subgrupo.secciones)]
}

export const SECCIONES_PANEL: SeccionPanel[] = GRUPOS_PANEL.flatMap(seccionesDeGrupo)

export function obtenerSeccion(id: string): SeccionPanel {
    const seccion = SECCIONES_PANEL.find(s => s.id === id)
    if (!seccion) {
        throw new Error(`Sección desconocida: ${id}`)
    }
    return seccion
}

/** Dónde vive una ruta en el menú: sección (prefijo más largo), su grupo y su subgrupo. */
export interface UbicacionMenu {
    grupo: GrupoSecciones
    subgrupo: SubgrupoSecciones | null
    seccion: SeccionPanel
}

function coincide(ruta: string, seccion: SeccionPanel): boolean {
    return ruta === seccion.ruta || ruta.startsWith(`${seccion.ruta}/`)
}

export function ubicacionDeRuta(ruta: string): UbicacionMenu | null {
    let mejor: UbicacionMenu | null = null
    const considerar = (grupo: GrupoSecciones, subgrupo: SubgrupoSecciones | null, seccion: SeccionPanel) => {
        if (coincide(ruta, seccion) && (!mejor || seccion.ruta.length > mejor.seccion.ruta.length)) {
            mejor = { grupo, subgrupo, seccion }
        }
    }
    for (const grupo of GRUPOS_PANEL) {
        for (const seccion of grupo.secciones) {
            considerar(grupo, null, seccion)
        }
        for (const subgrupo of grupo.subgrupos ?? []) {
            for (const seccion of subgrupo.secciones) {
                considerar(grupo, subgrupo, seccion)
            }
        }
    }
    return mejor
}

/** Grupo al que pertenece la ruta actual (la sección con el prefijo más largo), o `null`. */
export function grupoDeRuta(ruta: string): GrupoSecciones | null {
    return ubicacionDeRuta(ruta)?.grupo ?? null
}
