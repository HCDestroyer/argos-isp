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
            chipCortados: { x: 397, y: 102, ancho: 96, alto: 28, texto: 'Chip "Cortados": clientes con el servicio suspendido', tipo: 'chip', tono: 'rojo' },
            filtroEstado: { x: 385, y: 233, ancho: 222, alto: 32, texto: 'Filtro aplicado: estado del servicio', tipo: 'campo' },
            tabla: { x: 760, y: 500, ancho: 992, alto: 244, texto: 'Clientes cortados por deuda vencida', tipo: 'bloque' },
        },
    },
    servicioFicha: {
        ...escritorio,
        archivo: 'servicio-ficha.png',
        titulo: 'Servicio PPPoE · rosa.15',
        url: 'panel.argosisp.gt/servicios/14',
        puntos: {
            badge: { x: 392, y: 102, ancho: 72, alto: 22, texto: 'Estado del servicio: activo tras el pago', tipo: 'badge', tono: 'verde' },
            acciones: { x: 600, y: 180, ancho: 676, alto: 34, texto: 'Acciones explícitas con motivo', tipo: 'bloque' },
            suspender: { x: 323, y: 180, ancho: 118, alto: 32, texto: 'Suspender', tipo: 'boton', tono: 'rojo' },
            red: { x: 1004, y: 360, ancho: 480, alto: 100, texto: 'IPv4 y prefijos IPv6 asignados', tipo: 'bloque' },
        },
    },
    cobroFacturas: {
        ...escritorio,
        archivo: 'cobro-facturas.png',
        titulo: 'Cobrar',
        url: 'panel.argosisp.gt/cobrar',
        puntos: {
            facturasCliente: { x: 556, y: 190, ancho: 584, alto: 248, texto: 'Facturas vencidas marcadas', tipo: 'bloque' },
            dependiente: { x: 556, y: 358, ancho: 584, alto: 56, texto: 'Facturas del dependiente, cargadas solas', tipo: 'fila' },
            monto: { x: 1064, y: 228, ancho: 336, alto: 42, texto: 'Monto = suma de lo marcado de los dos clientes', tipo: 'campo' },
            metodo: { x: 1064, y: 362, ancho: 336, alto: 32, texto: 'Método de pago', tipo: 'campo' },
            transferencia: { x: 1064, y: 488, ancho: 352, alto: 190, texto: 'Transferencia: banco de origen y cuenta de destino', tipo: 'bloque' },
            registrar: { x: 971, y: 760, ancho: 150, alto: 36, texto: 'Registrar pago', tipo: 'boton', tono: 'azul' },
        },
    },
    cobroRecibo: {
        ...escritorio,
        archivo: 'cobro-recibo.png',
        titulo: 'Recibo de pago',
        url: 'panel.argosisp.gt/cobrar',
        puntos: {
            reactivados: { x: 1064, y: 635, ancho: 364, alto: 52, texto: 'Recibo: "Servicio reactivado" de cada cliente', tipo: 'bloque', tono: 'verde' },
            dependiente: { x: 1064, y: 454, ancho: 364, alto: 150, texto: 'Facturas del dependiente: "pagado por Rosa Elena Batz"', tipo: 'bloque' },
            badge: { x: 403, y: 277, ancho: 124, alto: 22, texto: 'Reactivación inmediata, sin esperar al cron', tipo: 'badge', tono: 'verde' },
        },
    },
    caja: {
        ...escritorio,
        archivo: 'caja.png',
        titulo: 'Caja',
        url: 'panel.argosisp.gt/caja',
        puntos: {
            turno: { x: 360, y: 210, ancho: 156, alto: 26, texto: 'Turno abierto con fondo inicial', tipo: 'bloque' },
            esperado: { x: 1055, y: 278, ancho: 124, alto: 42, texto: 'Esperado: fondo + efectivo cobrado', tipo: 'bloque' },
            cobros: { x: 760, y: 522, ancho: 992, alto: 136, texto: 'Cobros en efectivo del turno', tipo: 'bloque' },
        },
    },
    promesas: {
        ...escritorio,
        archivo: 'promesas.png',
        titulo: 'Resultado de la promesa',
        url: 'panel.argosisp.gt/servicios/17',
        puntos: {
            aprobada: { x: 471, y: 252, ancho: 94, alto: 26, texto: 'Resultado de la evaluación de la plantilla', tipo: 'badge', tono: 'verde' },
            regla: { x: 593, y: 396, ancho: 340, alto: 22, texto: 'Regla que aplicó: plazo máximo del canal', tipo: 'fila' },
            deuda: { x: 640, y: 550, ancho: 446, alto: 74, texto: 'Deuda e historial con los que se evaluó', tipo: 'bloque' },
        },
    },
    facturas: {
        ...escritorio,
        archivo: 'facturas.png',
        titulo: 'Facturas',
        url: 'panel.argosisp.gt/facturas',
        puntos: {
            estado: { x: 1193, y: 227, ancho: 54, alto: 20, texto: 'Estado de cada aviso de cobro', tipo: 'badge', tono: 'rojo' },
            pagada: { x: 1192, y: 665, ancho: 52, alto: 20, texto: 'Pagada al registrar el cobro', tipo: 'badge', tono: 'verde' },
            recargo: { x: 337, y: 246, ancho: 118, alto: 22, texto: 'Recargo por mora generado al vencer', tipo: 'badge', tono: 'ambar' },
        },
    },
    libro: {
        ...escritorio,
        archivo: 'libro.png',
        titulo: 'Libro',
        url: 'panel.argosisp.gt/libro',
        puntos: {
            cuadre: { x: 1012, y: 242, ancho: 476, alto: 32, texto: 'Debe = Haber: el diario cuadra', tipo: 'bloque' },
            filtros: { x: 760, y: 160, ancho: 992, alto: 34, texto: 'Filtros por cuenta, periodo y origen', tipo: 'bloque' },
            asiento: { x: 509, y: 404, ancho: 490, alto: 256, texto: 'Asiento de doble partida de cada cobro', tipo: 'bloque' },
        },
    },
    bitacora: {
        ...escritorio,
        archivo: 'bitacora.png',
        titulo: 'Bitácora',
        url: 'panel.argosisp.gt/bitacora',
        puntos: {
            fila: { x: 760, y: 691, ancho: 992, alto: 76, texto: 'Cada acción con actor, canal y resultado', tipo: 'fila' },
            filtros: { x: 760, y: 160, ancho: 992, alto: 34, texto: 'Filtros por actor, canal, acción, entidad y fecha', tipo: 'bloque' },
        },
    },
    portalCorte: {
        ...movil,
        archivo: 'portal-corte-movil.png',
        titulo: 'Tu servicio está suspendido',
        url: 'portal/corte',
        puntos: {
            monto: { x: 100, y: 245, ancho: 150, alto: 56, texto: 'Monto pendiente identificado por la IP, sin login', tipo: 'bloque' },
            vencidas: { x: 195, y: 316, ancho: 342, alto: 30, texto: 'Facturas vencidas: cantidad y total', tipo: 'fila' },
            deposito: { x: 195, y: 462, ancho: 358, alto: 40, texto: 'Cuentas para depositar', tipo: 'boton', tono: 'azul' },
            comprobante: { x: 195, y: 510, ancho: 358, alto: 40, texto: 'Subir la foto del comprobante', tipo: 'boton', tono: 'gris' },
            promesa: { x: 195, y: 558, ancho: 358, alto: 40, texto: 'Promesa de pago: reactiva al instante', tipo: 'boton', tono: 'gris' },
        },
    },
    portalCuenta: {
        ...escritorio,
        archivo: 'portal-cuenta.png',
        titulo: 'Mi cuenta',
        url: 'portal.redaltiplano.gt/cuenta',
        puntos: {
            saldo: { x: 640, y: 215, ancho: 488, alto: 70, texto: 'Saldo total pendiente del cliente', tipo: 'bloque' },
            servicio: { x: 640, y: 297, ancho: 464, alto: 40, texto: 'Servicio, estado y pedir promesa', tipo: 'fila' },
            facturas: { x: 640, y: 536, ancho: 514, alto: 166, texto: 'Facturas con total y saldo', tipo: 'bloque' },
            pdf: { x: 492, y: 588, ancho: 186, alto: 30, texto: 'PDF del aviso de cobro', tipo: 'boton', tono: 'gris' },
            pagos: { x: 577, y: 426, ancho: 84, alto: 30, texto: 'Pagos y comprobantes enviados', tipo: 'chip' },
        },
    },
    portalPdf: {
        ...escritorio,
        archivo: 'portal-pdf.png',
        titulo: 'Aviso de cobro',
        url: 'portal.redaltiplano.gt/avisos/12.pdf',
        puntos: {
            titulo: { x: 835, y: 74, ancho: 112, alto: 22, texto: 'Aviso de cobro generado desde la plantilla editable', tipo: 'bloque' },
            cliente: { x: 449, y: 178, ancho: 120, alto: 52, texto: 'Datos del cliente ({{cliente.nombre}})', tipo: 'bloque' },
            vence: { x: 842, y: 115, ancho: 92, alto: 16, texto: 'Fecha de vencimiento ({{factura.vence}})', tipo: 'bloque' },
            saldo: { x: 768, y: 351, ancho: 244, alto: 26, texto: 'Saldo a pagar del aviso', tipo: 'bloque' },
        },
    },
    portalPromesa: {
        ...movil,
        archivo: 'portal-promesa.png',
        titulo: 'Ya tienes servicio',
        url: 'portal/promesa',
        puntos: {
            aprobada: { x: 195, y: 172, ancho: 340, alto: 120, texto: 'Promesa aprobada: servicio reactivado en segundos', tipo: 'bloque', tono: 'verde' },
            recordatorio: { x: 195, y: 335, ancho: 358, alto: 112, texto: 'Monto y fecha que el cliente prometió', tipo: 'bloque', tono: 'azul' },
            seguir: { x: 195, y: 429, ancho: 358, alto: 40, texto: 'Vuelve a navegar', tipo: 'boton', tono: 'azul' },
        },
    },
} satisfies Record<string, Captura>

export type IdCaptura = keyof typeof CAPTURAS

/**
 * Punto de interés medido sobre una captura real (formato de
 * `public/capturas/puntos.json`). `x`, `y` en px lógicos (1280×800), desde la
 * esquina superior izquierda del contenido. `etiqueta` es la clave del punto en
 * este guion (p. ej. `chipCortados`) o su `texto` (p. ej. "Cortados · 37",
 * basta con el comienzo: "Cortados").
 */
export interface PuntoExterno {
    archivo: string
    x: number
    y: number
    etiqueta: string
    ancho?: number
    alto?: number
}

const normalizar = (texto: string) =>
    texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()

/**
 * Sobrescribe, en el sitio, las coordenadas de los puntos del guion con las de
 * `puntos.json`. Se modifica cada objeto existente (no se reemplaza) para que
 * las escenas que ya guardaron una referencia vean los valores nuevos.
 * Devuelve los avisos (puntos que no se pudieron emparejar).
 */
export function aplicarPuntos(lista: PuntoExterno[]): string[] {
    const avisos: string[] = []
    for (const externo of lista) {
        const archivo = externo.archivo.replace(/^.*\//, '').replace(/(\.png)?$/i, '.png')
        const capturas = Object.values(CAPTURAS).filter((c) => c.archivo === archivo)
        if (capturas.length === 0) {
            avisos.push(`puntos.json: no hay captura "${archivo}" en el guion`)
            continue
        }
        const buscado = normalizar(externo.etiqueta)
        let aplicado = false
        for (const captura of capturas) {
            const puntos = captura.puntos as Record<string, PuntoInteres>
            const clave =
                Object.keys(puntos).find((k) => normalizar(k) === buscado) ??
                Object.keys(puntos).find((k) => normalizar(puntos[k].texto) === buscado) ??
                Object.keys(puntos).find((k) => normalizar(puntos[k].texto).startsWith(buscado))
            if (!clave) continue
            const punto = puntos[clave]
            punto.x = externo.x
            punto.y = externo.y
            if (externo.ancho !== undefined) punto.ancho = externo.ancho
            if (externo.alto !== undefined) punto.alto = externo.alto
            aplicado = true
        }
        if (!aplicado) avisos.push(`puntos.json: "${externo.etiqueta}" no coincide con ningún punto de ${archivo}`)
    }
    return avisos
}

/** Todos los puntos del guion en el formato de `puntos.json` (plantilla para medir las capturas reales). */
export function plantillaPuntos(): PuntoExterno[] {
    return Object.values(CAPTURAS).flatMap((captura) =>
        Object.entries(captura.puntos as Record<string, PuntoInteres>).map(([clave, p]) => ({
            archivo: captura.archivo,
            x: p.x,
            y: p.y,
            etiqueta: clave,
            ...(p.ancho !== undefined ? { ancho: p.ancho } : {}),
            ...(p.alto !== undefined ? { alto: p.alto } : {}),
        }))
    )
}

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
            leyenda: 'Filtros por estado, deuda, promesa, zona, router y plan.',
            // Las etiquetas de los puntos salen de su `texto` (puntos.json).
        },
        momentos: {
            vista: 0.9,
            clicCortados: 2.6,
            seguir: 3.0,
            filtro: 5.0,
            tabla: 6.4,
            alejar: 7.8,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'clicCortados', sonido: 'clic' },
            { en: 'filtro', sonido: 'clic', volumen: 0.7 },
            { en: 'tabla', sonido: 'whoosh', volumen: 0.35 },
            { en: 'alejar', sonido: 'whoosh', volumen: 0.45 },
        ],
    },
    {
        id: 'servicio',
        segundos: 10,
        capturas: ['servicioFicha'],
        musica: 0.5,
        grilla: 0.35,
        textos: {
            seccion: '02 · Servicio',
            titulo: 'Cada servicio, bajo control',
            leyenda: 'PPPoE con IPv4 y prefijos IPv6. Acciones explícitas y auditadas.',
            etiquetaSuspendido: 'Suspendido: CoA al MikroTik, queda en la bitácora',
            etiquetaActivo: 'Reactivado al instante',
            // Estados que el video dibuja encima de la captura (no hay captura del estado suspendido).
            badgeSuspendido: 'Suspendido',
            botonReactivar: 'Reactivar',
        },
        momentos: {
            vista: 0.9,
            ips: 1.6,
            clicSuspender: 4.6,
            badge: 4.9,
            clicReactivar: 7.2,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'ips', sonido: 'whoosh', volumen: 0.35 },
            { en: 'clicSuspender', sonido: 'clic' },
            { en: 'badge', sonido: 'corte' },
            { en: 'clicReactivar', sonido: 'clic' },
            { en: 7.4, sonido: 'confirmacion', volumen: 0.8 },
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
            leyenda: 'Marca facturas, incluye las de un familiar y elige el método.',
            etiquetaFacturas: 'Facturas vencidas, ya marcadas',
            etiquetaMetodos: 'Efectivo · Depósito · Transferencia · ACH · Remesa',
        },
        momentos: {
            clicFacturas: 1.2,
            dependiente: 2.6,
            monto: 4.2,
            metodo: 5.6,
            transferencia: 7.0,
            clicRegistrar: 8.4,
            vuelo: 8.8,
            reactivado: 10.4,
            badge: 11.6,
            salida: 13.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'clicFacturas', sonido: 'clic' },
            { en: 'dependiente', sonido: 'clic' },
            { en: 'monto', sonido: 'clic', volumen: 0.6 },
            { en: 'metodo', sonido: 'clic' },
            { en: 'transferencia', sonido: 'clic', volumen: 0.6 },
            { en: 'clicRegistrar', sonido: 'clic' },
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
            caja: 'Caja: esperado = fondo + efectivo cobrado',
            promesas: 'Promesa evaluada con las reglas de la plantilla',
            facturas: 'Recargo por mora generado al vencer',
            libro: 'Libro de doble partida: Debe = Haber',
            bitacora: 'Bitácora: cada acción con actor, canal y resultado',
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
        capturas: ['portalCorte', 'portalPromesa', 'portalCuenta', 'portalPdf'],
        musica: 0.5,
        grilla: 0.45,
        textos: {
            seccion: '06 · Portal del cliente',
            titulo: 'Tu cliente se atiende solo',
            leyenda: 'Página de corte sin login y promesa de pago desde el teléfono.',
            etiquetaMonto: 'Monto pendiente, identificado por la IP',
            etiquetaPromesa: 'Promesa de pago: reactiva al instante',
            etiquetaAprobada: 'Promesa aprobada: servicio reactivado',
            etiquetaPdf: 'Aviso de cobro en PDF',
            etiquetaSaldo: 'Saldo a pagar del aviso',
        },
        momentos: {
            monto: 0.7,
            tocarPromesa: 2.0,
            vueloPromesa: 2.5,
            aprobada: 3.1,
            vueloCuenta: 4.8,
            tocarPdf: 6.1,
            vueloPdf: 6.6,
            saldo: 7.3,
            salida: 9.2,
        },
        efectos: [
            { en: 0.1, sonido: 'whoosh', volumen: 0.6 },
            { en: 'tocarPromesa', sonido: 'clic' },
            { en: 'vueloPromesa', sonido: 'whoosh', volumen: 0.45 },
            { en: 'aprobada', sonido: 'confirmacion' },
            { en: 'vueloCuenta', sonido: 'whoosh', volumen: 0.45 },
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
