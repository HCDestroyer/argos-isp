/**
 * Guion del tour de ArgosIsp: la única fuente de verdad para escenas,
 * duraciones, capturas, puntos de interés, textos, momentos y efectos.
 *
 * Los componentes de `src/escenas/` leen todo de aquí; para ajustar tiempos o
 * textos no hace falta tocarlos. Los scripts de Node (`scripts/*.mjs`) también
 * importan este archivo (Node 22 quita los tipos), así que no debe importar nada.
 *
 * Unidades:
 *   - `segundos` y `momentos` en segundos, relativos al inicio de la escena.
 *   - Puntos de interés en píxeles lógicos de la captura (1280×800 en
 *     escritorio, 390×844 en móvil), medidos desde la esquina superior
 *     izquierda del contenido (sin el marco de ventana).
 */

export const FPS = 30
export const ANCHO = 1920
export const ALTO = 1080

/** Solapamiento entre escenas consecutivas (fundido + movimiento de cámara). */
export const SEGUNDOS_TRANSICION = 0.6

export type NombreSonido = 'whoosh' | 'clic' | 'confirmacion' | 'corte' | 'neon'

export interface PuntoInteres {
    x: number
    y: number
    /** Ancho y alto del elemento, para el halo. Si faltan, el halo es un círculo. */
    ancho?: number
    alto?: number
    /** Texto del elemento: lo dibuja la captura de relleno y sirve de referencia. */
    texto: string
    /** Variante visual en la captura de relleno. */
    tipo?: 'chip' | 'boton' | 'badge' | 'campo' | 'bloque' | 'fila' | 'check'
    /** Color del elemento en la captura de relleno (solo relleno). */
    tono?: 'verde' | 'rojo' | 'ambar' | 'azul' | 'gris'
}

export interface Captura {
    archivo: string
    ancho: number
    alto: number
    dispositivo: 'escritorio' | 'movil'
    /** Título de la pantalla (lo usa la captura de relleno). */
    titulo: string
    /** Ruta que se muestra en la barra del marco de ventana. */
    url: string
    puntos: Record<string, PuntoInteres>
}

const escritorio = { ancho: 1280, alto: 800, dispositivo: 'escritorio' } as const
const movil = { ancho: 390, alto: 844, dispositivo: 'movil' } as const

export const CAPTURAS = {
    clientesFiltros: {
        ...escritorio,
        archivo: 'clientes-filtros.png',
        titulo: 'Clientes',
        url: 'panel.argosisp.gt/clientes',
        puntos: {
            buscar: { x: 420, y: 148, ancho: 360, alto: 40, texto: 'Buscar por nombre, NIT o IP…', tipo: 'campo' },
            chipTodos: { x: 330, y: 214, ancho: 92, alto: 34, texto: 'Todos', tipo: 'chip' },
            chipCortados: { x: 452, y: 214, ancho: 128, alto: 34, texto: 'Cortados · 37', tipo: 'chip', tono: 'rojo' },
            chipDeuda: { x: 600, y: 214, ancho: 146, alto: 34, texto: 'Con deuda · 112', tipo: 'chip', tono: 'ambar' },
            filtroRouter: { x: 780, y: 214, ancho: 190, alto: 34, texto: 'Router: Norte-CCR2004', tipo: 'chip', tono: 'azul' },
            filtroPlan: { x: 980, y: 214, ancho: 180, alto: 34, texto: 'Plan: Hogar 30 Mbps', tipo: 'chip', tono: 'azul' },
            tabla: { x: 760, y: 470, ancho: 940, alto: 380, texto: 'Clientes filtrados', tipo: 'bloque' },
        },
    },
    servicioFicha: {
        ...escritorio,
        archivo: 'servicio-ficha.png',
        titulo: 'Servicio PPPoE · Juan Pérez',
        url: 'panel.argosisp.gt/servicios/1042',
        puntos: {
            badge: { x: 1120, y: 120, ancho: 120, alto: 34, texto: 'Activo', tipo: 'badge', tono: 'verde' },
            suspender: { x: 1004, y: 186, ancho: 128, alto: 40, texto: 'Suspender', tipo: 'boton', tono: 'rojo' },
            reactivar: { x: 1146, y: 186, ancho: 128, alto: 40, texto: 'Reactivar', tipo: 'boton', tono: 'verde' },
            ipv4: { x: 520, y: 330, ancho: 520, alto: 64, texto: 'IPv4 100.64.12.37', tipo: 'bloque' },
            ipv6: { x: 520, y: 430, ancho: 520, alto: 96, texto: 'IPv6 2803:d100:a::/64 · PD 2803:d100:1a00::/56', tipo: 'bloque' },
            plan: { x: 1000, y: 380, ancho: 320, alto: 200, texto: 'Plan Hogar 30 Mbps', tipo: 'bloque' },
        },
    },
    servicioSuspendido: {
        ...escritorio,
        archivo: 'servicio-ficha-suspendido.png',
        titulo: 'Servicio PPPoE · Juan Pérez',
        url: 'panel.argosisp.gt/servicios/1042',
        puntos: {
            badge: { x: 1120, y: 120, ancho: 140, alto: 34, texto: 'Suspendido', tipo: 'badge', tono: 'rojo' },
            suspender: { x: 1004, y: 186, ancho: 128, alto: 40, texto: 'Suspender', tipo: 'boton', tono: 'gris' },
            reactivar: { x: 1146, y: 186, ancho: 128, alto: 40, texto: 'Reactivar', tipo: 'boton', tono: 'verde' },
            ipv4: { x: 520, y: 330, ancho: 520, alto: 64, texto: 'IPv4 100.64.12.37', tipo: 'bloque' },
            ipv6: { x: 520, y: 430, ancho: 520, alto: 96, texto: 'IPv6 2803:d100:a::/64 · PD 2803:d100:1a00::/56', tipo: 'bloque' },
            plan: { x: 1000, y: 380, ancho: 320, alto: 200, texto: 'Plan Hogar 30 Mbps', tipo: 'bloque' },
        },
    },
    cobroFacturas: {
        ...escritorio,
        archivo: 'cobro-facturas.png',
        titulo: 'Cobro rápido',
        url: 'panel.argosisp.gt/cobros/nuevo',
        puntos: {
            buscar: { x: 440, y: 148, ancho: 400, alto: 40, texto: 'Juan Pérez · 4523-8890', tipo: 'campo' },
            factura1: { x: 440, y: 262, ancho: 400, alto: 44, texto: 'Factura sep · Q 225.00', tipo: 'check' },
            factura2: { x: 440, y: 316, ancho: 400, alto: 44, texto: 'Factura oct · Q 225.00', tipo: 'check' },
            familiar: { x: 440, y: 452, ancho: 400, alto: 44, texto: 'Marta Pérez (responsable) · Q 150.00', tipo: 'check' },
            efectivo: { x: 856, y: 300, ancho: 108, alto: 38, texto: 'Efectivo', tipo: 'chip' },
            deposito: { x: 976, y: 300, ancho: 108, alto: 38, texto: 'Depósito', tipo: 'chip' },
            transferencia: { x: 1110, y: 300, ancho: 140, alto: 38, texto: 'Transferencia', tipo: 'chip' },
            ach: { x: 880, y: 350, ancho: 80, alto: 38, texto: 'ACH', tipo: 'chip' },
            remesa: { x: 990, y: 350, ancho: 112, alto: 38, texto: 'Remesa', tipo: 'chip' },
            total: { x: 1000, y: 560, ancho: 360, alto: 70, texto: 'Total Q 600.00', tipo: 'bloque' },
            cobrar: { x: 1000, y: 660, ancho: 360, alto: 52, texto: 'Registrar pago', tipo: 'boton', tono: 'azul' },
        },
    },
    cobroRecibo: {
        ...escritorio,
        archivo: 'cobro-recibo.png',
        titulo: 'Recibo de pago',
        url: 'panel.argosisp.gt/pagos/88123',
        puntos: {
            recibo: { x: 640, y: 380, ancho: 560, alto: 420, texto: 'Recibo #88123 · Q 600.00', tipo: 'bloque' },
            reactivado: { x: 640, y: 650, ancho: 300, alto: 40, texto: 'Servicio reactivado', tipo: 'badge', tono: 'verde' },
        },
    },
    caja: {
        ...escritorio,
        archivo: 'caja.png',
        titulo: 'Caja del día',
        url: 'panel.argosisp.gt/cajas/actual',
        puntos: {
            diferencia: { x: 980, y: 300, ancho: 380, alto: 120, texto: 'Esperado Q 8 450 · Contado Q 8 450', tipo: 'bloque' },
        },
    },
    promesas: {
        ...escritorio,
        archivo: 'promesas.png',
        titulo: 'Promesas de pago',
        url: 'panel.argosisp.gt/promesas',
        puntos: {
            aprobada: { x: 980, y: 262, ancho: 130, alto: 32, texto: 'Vigente', tipo: 'badge', tono: 'verde' },
        },
    },
    facturas: {
        ...escritorio,
        archivo: 'facturas.png',
        titulo: 'Facturas',
        url: 'panel.argosisp.gt/facturas',
        puntos: {
            vencida: { x: 980, y: 316, ancho: 120, alto: 32, texto: 'Vencida', tipo: 'badge', tono: 'rojo' },
        },
    },
    libro: {
        ...escritorio,
        archivo: 'libro.png',
        titulo: 'Libro contable',
        url: 'panel.argosisp.gt/libro',
        puntos: {
            cuadre: { x: 900, y: 640, ancho: 480, alto: 56, texto: 'Debe Q 600.00 = Haber Q 600.00', tipo: 'bloque' },
        },
    },
    bitacora: {
        ...escritorio,
        archivo: 'bitacora.png',
        titulo: 'Bitácora de auditoría',
        url: 'panel.argosisp.gt/auditoria',
        puntos: {
            coa: { x: 700, y: 316, ancho: 860, alto: 44, texto: 'coa.disconnect · NAS 10.0.0.1 · ACK', tipo: 'fila' },
        },
    },
    portalCorte: {
        ...movil,
        archivo: 'portal-corte-movil.png',
        titulo: 'Tu servicio está suspendido',
        url: 'portal.argosisp.gt/corte',
        puntos: {
            codigo: { x: 195, y: 470, ancho: 310, alto: 48, texto: 'Código de cliente', tipo: 'campo' },
            entrar: { x: 195, y: 546, ancho: 310, alto: 48, texto: 'Entrar', tipo: 'boton', tono: 'azul' },
        },
    },
    portalCuenta: {
        ...movil,
        archivo: 'portal-cuenta.png',
        titulo: 'Mi cuenta',
        url: 'portal.argosisp.gt/cuenta',
        puntos: {
            promesa: { x: 195, y: 330, ancho: 200, alto: 34, texto: 'Promesa aprobada', tipo: 'badge', tono: 'verde' },
            pdf: { x: 195, y: 600, ancho: 310, alto: 48, texto: 'Aviso de cobro (PDF)', tipo: 'boton', tono: 'gris' },
            solicitar: { x: 195, y: 664, ancho: 310, alto: 48, texto: 'Solicitar promesa', tipo: 'boton', tono: 'azul' },
        },
    },
    portalPdf: {
        ...movil,
        archivo: 'portal-pdf.png',
        titulo: 'Aviso de cobro',
        url: 'portal.argosisp.gt/aviso.pdf',
        puntos: {
            documento: { x: 195, y: 420, ancho: 330, alto: 520, texto: 'Aviso de cobro · Q 450.00', tipo: 'bloque' },
        },
    },
} satisfies Record<string, Captura>

export type IdCaptura = keyof typeof CAPTURAS

export interface Efecto {
    /** Nombre de un momento de la escena o segundos desde su inicio. */
    en: string | number
    sonido: NombreSonido
    volumen?: number
}

export interface Escena {
    id: string
    segundos: number
    capturas: IdCaptura[]
    /** Volumen relativo de la música (ducking): 1 = completo, menos cuando hay texto. */
    musica: number
    /** Intensidad de la grilla neón de fondo (0 = apagada). */
    grilla: number
    textos: Record<string, string>
    momentos: Record<string, number>
    efectos: Efecto[]
}

export const ESCENAS: Escena[] = [
    {
        id: 'portada',
        segundos: 5,
        capturas: [],
        musica: 1,
        grilla: 1,
        textos: {
            titulo: 'ArgosIsp',
            subtitulo: 'Gestión completa para tu ISP',
        },
        momentos: { trazo: 0.2, encendido: 1.3, nombre: 1.8, subtitulo: 2.5, salida: 4.2 },
        efectos: [
            { en: 'encendido', sonido: 'neon' },
            { en: 'salida', sonido: 'whoosh', volumen: 0.8 },
        ],
    },
    {
        id: 'clientes',
        segundos: 10,
        capturas: ['clientesFiltros'],
        musica: 0.5,
        grilla: 0.35,
        textos: {
            seccion: '01 · Clientes',
            titulo: 'Encuentra a quien necesitas',
            leyenda: 'Filtros avanzados: cortados, con deuda, por router y por plan.',
            etiquetaCortados: '37 servicios cortados',
            etiquetaFiltros: 'Router + plan, combinables',
        },
        momentos: {
            vista: 0.9,
            clicCortados: 2.6,
            seguir: 3.0,
            clicRouter: 5.0,
            clicPlan: 6.1,
            alejar: 7.2,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'clicCortados', sonido: 'clic' },
            { en: 'clicRouter', sonido: 'clic' },
            { en: 'clicPlan', sonido: 'clic' },
            { en: 'alejar', sonido: 'whoosh', volumen: 0.45 },
        ],
    },
    {
        id: 'servicio',
        segundos: 10,
        capturas: ['servicioFicha', 'servicioSuspendido'],
        musica: 0.5,
        grilla: 0.35,
        textos: {
            seccion: '02 · Servicio',
            titulo: 'Cada servicio, bajo control',
            leyenda: 'PPPoE con IPv4 y prefijos IPv6. Acciones explícitas y auditadas.',
            etiquetaIps: 'IPv4 + prefijo de enlace y delegado IPv6',
            etiquetaSuspendido: 'Suspendido manualmente',
            etiquetaActivo: 'Reactivado al instante',
        },
        momentos: {
            vista: 0.9,
            ips: 1.6,
            clicSuspender: 4.6,
            badge: 4.9,
            clicReactivar: 7.4,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'ips', sonido: 'whoosh', volumen: 0.35 },
            { en: 'clicSuspender', sonido: 'clic' },
            { en: 'badge', sonido: 'corte' },
            { en: 'clicReactivar', sonido: 'clic' },
            { en: 7.6, sonido: 'confirmacion', volumen: 0.8 },
        ],
    },
    {
        id: 'cobro',
        segundos: 14,
        capturas: ['cobroFacturas', 'cobroRecibo'],
        musica: 0.45,
        grilla: 0.35,
        textos: {
            seccion: '03 · Cobro rápido',
            titulo: 'Cobra en segundos',
            leyenda: 'Busca, marca facturas, incluye las de un familiar y elige el método.',
            etiquetaFamiliar: 'Responsable de pago: paga por su familia',
            etiquetaMetodos: 'Efectivo · Depósito · Transferencia · ACH · Remesa',
            etiquetaRecibo: 'Recibo listo',
            etiquetaReactivado: 'Reactivado por evento, sin esperar al cron',
        },
        momentos: {
            clicBuscar: 1.3,
            clicFactura1: 2.4,
            clicFactura2: 3.0,
            clicFamiliar: 4.0,
            metodos: 5.4,
            clicMetodo: 7.4,
            clicCobrar: 8.4,
            vuelo: 8.8,
            reactivado: 10.4,
            salida: 13.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'clicBuscar', sonido: 'clic' },
            { en: 'clicFactura1', sonido: 'clic' },
            { en: 'clicFactura2', sonido: 'clic' },
            { en: 'clicFamiliar', sonido: 'clic' },
            { en: 'clicMetodo', sonido: 'clic' },
            { en: 'clicCobrar', sonido: 'clic' },
            { en: 'vuelo', sonido: 'whoosh', volumen: 0.7 },
            { en: 'reactivado', sonido: 'confirmacion' },
        ],
    },
    {
        id: 'diagrama',
        segundos: 12,
        capturas: [],
        musica: 0.7,
        grilla: 0.8,
        textos: {
            seccion: '04 · Ciclo automático',
            titulo: 'Corte y reactivación sin tocar el router',
            nodo1: 'Factura',
            nodo2: 'Vence',
            nodo3: 'Limita',
            nodo4: 'Corta',
            nodo5: 'Pago',
            nodo6: 'Evento',
            nodo7: 'CoA / Disconnect',
            nodo8: 'Activo',
            detalle1: 'factura.emitida',
            detalle2: 'factura.vencida',
            detalle3: 'estado → limitado',
            detalle4: 'estado → suspendido',
            detalle5: 'pago.registrado',
            detalle6: 'outbox → Redis',
            detalle7: 'RADIUS → MikroTik',
            detalle8: 'estado → activo',
        },
        momentos: { primerNodo: 0.7, intervalo: 1.1, cierreCiclo: 9.7, salida: 11.2 },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 4.0, sonido: 'corte', volumen: 0.7 },
            { en: 8.4, sonido: 'confirmacion', volumen: 0.8 },
        ],
    },
    {
        id: 'montaje',
        segundos: 14,
        capturas: ['caja', 'promesas', 'facturas', 'libro', 'bitacora'],
        musica: 0.55,
        grilla: 0.4,
        textos: {
            seccion: '05 · Operación diaria',
            titulo: 'Todo cuadra, todo queda registrado',
            caja: 'Cierre de caja: esperado vs. contado',
            promesas: 'Promesas de pago con vencimiento',
            facturas: 'Facturación por periodo, sin duplicados',
            libro: 'Libro de doble partida: Debe = Haber',
            bitacora: 'Bitácora: quién hizo qué, y la respuesta del router',
        },
        momentos: { primerPanel: 0.5, intervalo: 2.55, salida: 13.2 },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 0.5, sonido: 'whoosh', volumen: 0.4 },
            { en: 3.05, sonido: 'whoosh', volumen: 0.4 },
            { en: 5.6, sonido: 'whoosh', volumen: 0.4 },
            { en: 8.15, sonido: 'whoosh', volumen: 0.4 },
            { en: 10.7, sonido: 'whoosh', volumen: 0.4 },
        ],
    },
    {
        id: 'portal',
        segundos: 10,
        capturas: ['portalCorte', 'portalCuenta', 'portalPdf'],
        musica: 0.5,
        grilla: 0.45,
        textos: {
            seccion: '06 · Portal del cliente',
            titulo: 'Tu cliente se atiende solo',
            leyenda: 'Página de corte, consulta con su código, aviso en PDF y promesa de pago.',
            etiquetaCodigo: 'Entra con su código',
            etiquetaPromesa: 'Promesa aprobada: servicio restablecido',
            etiquetaPdf: 'Aviso de cobro en PDF',
        },
        momentos: {
            tocarCodigo: 1.1,
            tocarEntrar: 2.2,
            vueloCuenta: 2.7,
            tocarSolicitar: 4.0,
            promesa: 4.4,
            tocarPdf: 6.0,
            vueloPdf: 6.4,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'tocarCodigo', sonido: 'clic' },
            { en: 'tocarEntrar', sonido: 'clic' },
            { en: 'vueloCuenta', sonido: 'whoosh', volumen: 0.45 },
            { en: 'tocarSolicitar', sonido: 'clic' },
            { en: 'promesa', sonido: 'confirmacion' },
            { en: 'tocarPdf', sonido: 'clic' },
            { en: 'vueloPdf', sonido: 'whoosh', volumen: 0.45 },
        ],
    },
    {
        id: 'red',
        segundos: 8,
        capturas: [],
        musica: 0.75,
        grilla: 0.8,
        textos: {
            seccion: '07 · Red y operación',
            titulo: 'Conectado a tu red',
            radius: 'RADIUS · FreeRADIUS',
            router: 'MikroTik · CoA',
            telegram: 'Alertas por Telegram',
            respaldos: 'Respaldos',
            monitoreo: 'Monitoreo',
        },
        momentos: { centro: 0.3, primerIcono: 0.9, intervalo: 0.45, salida: 7.2 },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 0.3, sonido: 'neon', volumen: 0.35 },
        ],
    },
    {
        id: 'cierre',
        segundos: 6,
        capturas: [],
        musica: 1,
        grilla: 0,
        // Sin textos: solo el logo y el wordmark "ArgosIsp" (src/logo/LogoArgos.tsx).
        textos: {},
        momentos: { trazo: 0.3, encendido: 1.7, nombre: 2.5 },
        efectos: [{ en: 'encendido', sonido: 'neon' }],
    },
]

/** Frames de transición entre escenas. */
export const FRAMES_TRANSICION = Math.round(SEGUNDOS_TRANSICION * FPS)

export interface EscenaCalculada extends Escena {
    /** Frame global en el que empieza la escena. */
    desde: number
    /** Duración en frames (incluye los solapamientos). */
    frames: number
}

/** Escenas con su frame de inicio; cada una empieza `FRAMES_TRANSICION` antes de que termine la anterior. */
export const LINEA_DE_TIEMPO: EscenaCalculada[] = (() => {
    let desde = 0
    return ESCENAS.map((escena) => {
        const frames = Math.round(escena.segundos * FPS)
        const calculada = { ...escena, desde, frames }
        desde += frames - FRAMES_TRANSICION
        return calculada
    })
})()

export const DURACION_TOTAL = (() => {
    const ultima = LINEA_DE_TIEMPO[LINEA_DE_TIEMPO.length - 1]
    return ultima.desde + ultima.frames
})()

/** Resuelve un efecto (momento o segundos) a frames desde el inicio de la escena. */
export function frameDeEfecto(escena: Escena, efecto: Efecto): number {
    const segundos = typeof efecto.en === 'number' ? efecto.en : escena.momentos[efecto.en]
    if (segundos === undefined) {
        throw new Error(`La escena "${escena.id}" no tiene el momento "${String(efecto.en)}"`)
    }
    return Math.round(segundos * FPS)
}

export function escenaPorId(id: string): EscenaCalculada {
    const escena = LINEA_DE_TIEMPO.find((e) => e.id === id)
    if (!escena) throw new Error(`No existe la escena "${id}"`)
    return escena
}
