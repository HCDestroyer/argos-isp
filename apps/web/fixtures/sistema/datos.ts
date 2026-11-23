/**
 * Salud, registro y almacenamiento del sistema, apariencia y accesos rápidos (A6,
 * `contratos/salud.md`, `contratos/apariencia.md`, `contratos/accesos-rapidos.md`). Valores con la
 * forma y los textos de la API (`apps/api/app/monitoreo`, `apps/api/app/core`).
 */
import type { Schema } from '@argosisp/contracts'

const GB = 1024 ** 3
const MB = 1024 ** 2

export const saludFixture: Schema<'SaludSistema'> = {
    estado_general: 'degradado',
    generado_en: '2026-10-16T17:30:00.000Z',
    duracion_ms: 84,
    componentes: [
        { id: 'api', grupo: 'nucleo', nombre: 'API', estado: 'ok', detalle: 'Versión 1.23.0 · encendida hace 3 d 4 h', latencia_ms: null, desde: null, metricas: { version: '1.23.0', commit: '3f67df49', uptime_s: 274000, node: '22.11.0', memoria_rss_bytes: 412 * MB } },
        { id: 'postgres', grupo: 'nucleo', nombre: 'Base de datos (PostgreSQL)', estado: 'ok', detalle: 'Responde en 3 ms · 12 conexiones de 100', latencia_ms: 3, desde: null, metricas: { conexiones: 12, conexiones_max: 100 } },
        { id: 'redis', grupo: 'nucleo', nombre: 'Redis', estado: 'ok', detalle: 'Responde en 1 ms', latencia_ms: 1, desde: null, metricas: {} },
        { id: 'cola.notify-envios', grupo: 'colas', nombre: 'Cola de envíos de avisos', estado: 'degradado', detalle: '2 trabajos fallaron en la última hora', latencia_ms: null, desde: '2026-10-16T17:02:00.000Z', metricas: { esperando: 4, activos: 1, retrasados: 0, fallidos: 9, fallidos_1h: 2 } },
        { id: 'cola.billing-cron', grupo: 'colas', nombre: 'Cola de facturación', estado: 'ok', detalle: 'Sin pendientes', latencia_ms: null, desde: null, metricas: { esperando: 0, activos: 0, retrasados: 0, fallidos: 0, fallidos_1h: 0 } },
        { id: 'outbox', grupo: 'eventos', nombre: 'Eventos (outbox)', estado: 'ok', detalle: 'Todo publicado', latencia_ms: null, desde: null, metricas: { sin_publicar: 0, antiguedad_s: 0 } },
        { id: 'aaa', grupo: 'red', nombre: 'RADIUS', estado: 'ok', detalle: '2 nodos respondiendo', latencia_ms: null, desde: null, metricas: { nodos: 2, nodos_caidos: 0, caidos: '' } },
        { id: 'coa', grupo: 'red', nombre: 'CoA y Disconnect', estado: 'ok', detalle: 'Sin fallos en 15 minutos', latencia_ms: null, desde: null, metricas: { fallidos_15m: 0, fallidos_24h: 1, ultimo_fallo: '2026-10-16T09:12:00.000Z' } },
        { id: 'routers', grupo: 'red', nombre: 'Routers', estado: 'degradado', detalle: '1 de 6 routers no responde', latencia_ms: null, desde: '2026-10-16T16:45:00.000Z', metricas: { total: 6, en_linea: 5, sin_respuesta: 1, sin_medicion: 0 } },
        { id: 'cron.facturacion', grupo: 'procesos', nombre: 'Facturación automática', estado: 'ok', detalle: 'Última corrida hoy a las 00:05', latencia_ms: null, desde: '2026-10-16T06:05:00.000Z', metricas: { ultima_corrida: '2026-10-16T06:05:00.000Z' } },
        { id: 'cron.corte', grupo: 'procesos', nombre: 'Corte automático', estado: 'ok', detalle: 'Última corrida hoy a las 06:00', latencia_ms: null, desde: '2026-10-16T12:00:00.000Z', metricas: { ultima_corrida: '2026-10-16T12:00:00.000Z' } },
        { id: 'respaldos', grupo: 'procesos', nombre: 'Respaldos', estado: 'ok', detalle: 'Último respaldo hace 9 h', latencia_ms: null, desde: '2026-10-16T08:30:00.000Z', metricas: { ultimo: '2026-10-16T08:30:00.000Z', archivo: 'argosisp-2026-10-16.dump', tamano_bytes: 380 * MB } },
        { id: 'host.cpu', grupo: 'host', nombre: 'Procesador', estado: 'ok', detalle: 'Carga 0.6 por núcleo', latencia_ms: null, desde: null, metricas: { carga_1: 2.1, carga_5: 2.4, carga_15: 2.2, nucleos: 4 } },
        { id: 'host.memoria', grupo: 'host', nombre: 'Memoria', estado: 'ok', detalle: '5.2 GB de 8 GB en uso (65 %)', latencia_ms: null, desde: null, metricas: { usada_bytes: 5.2 * GB, total_bytes: 8 * GB, porcentaje: 65 } },
        { id: 'host.disco', grupo: 'host', nombre: 'Disco', estado: 'ok', detalle: 'Libre el 58 % (116 GB de 200 GB)', latencia_ms: null, desde: null, metricas: { libre_bytes: 116 * GB, total_bytes: 200 * GB, porcentaje_libre: 58, ruta: '/var/lib/argosisp' } },
    ],
}

export const registroFixture: Schema<'EntradaRegistro'>[] = [
    { id: 'accion:9123', momento: '2026-10-16T17:02:11.000Z', nivel: 'error', origen: 'colas', titulo: 'Falló un trabajo en la cola notify-envios', detalle: 'SMTP 421: el servidor de correo no aceptó la conexión', entidad: null, request_id: null },
    { id: 'evento:7731', momento: '2026-10-16T16:45:00.000Z', nivel: 'error', origen: 'red', titulo: 'Falló una operación en RouterOS', detalle: 'RB-Norte API: tiempo de espera agotado (5 s)', entidad: { tipo: 'router', id: '3' }, request_id: null },
    { id: 'accion:9101', momento: '2026-10-16T15:20:43.000Z', nivel: 'advertencia', origen: 'contabilidad', titulo: 'Falló la acción «facturas.generar»', detalle: 'E_LIBRO_BLOQUEADO: El periodo 2026-09 está bloqueado', entidad: { tipo: 'factura', id: '812' }, request_id: '01JD7R2Q8V' },
    { id: 'evento:7702', momento: '2026-10-16T12:31:09.000Z', nivel: 'info', origen: 'radius', titulo: 'RADIUS volvió a responder (aaa-1)', detalle: null, entidad: null, request_id: null },
    { id: 'evento:7701', momento: '2026-10-16T12:28:40.000Z', nivel: 'error', origen: 'radius', titulo: 'RADIUS dejó de responder (aaa-1)', detalle: 'Sin respuesta en 3 intentos', entidad: null, request_id: null },
    { id: 'red:5540', momento: '2026-10-16T09:12:00.000Z', nivel: 'error', origen: 'coa', titulo: 'Falló un Disconnect', detalle: 'NAS 10.10.0.1: NAK (Session-Context-Not-Found)', entidad: { tipo: 'servicio', id: '2' }, request_id: null },
    { id: 'accion:9050', momento: '2026-10-15T22:04:17.000Z', nivel: 'advertencia', origen: 'api', titulo: 'Falló la acción «pagos.registrar»', detalle: 'E_CAJA_CERRADA: La caja Oficina está cerrada', entidad: { tipo: 'cliente', id: '1' }, request_id: '01JD5K0A1B' },
    { id: 'evento:7650', momento: '2026-10-15T06:00:00.000Z', nivel: 'info', origen: 'almacenamiento', titulo: 'Se recalculó el almacenamiento', detalle: '12.4 GB en archivos y base de datos', entidad: null, request_id: null },
]

export const almacenamientoFixture: Schema<'Almacenamiento'> = {
    volumenes: [
        { id: 'datos', nombre: 'Archivos (comprobantes, logos y documentos)', ruta: '/var/lib/argosisp', total_bytes: 200 * GB, usado_bytes: 84 * GB, libre_bytes: 116 * GB, porcentaje_usado: 42, estado: 'ok', aviso: null },
        { id: 'base', nombre: 'Base de datos', ruta: null, total_bytes: null, usado_bytes: 6.8 * GB, libre_bytes: null, porcentaje_usado: null, estado: 'desconocido', aviso: 'El volumen de PostgreSQL no se ve desde la API: se muestra solo el tamaño de la base.' },
    ],
    medicion: {
        id: 14,
        calculado_en: '2026-10-16T06:00:00.000Z',
        duracion_ms: 4210,
        origen: 'cron',
        parcial: false,
        categorias: [
            { id: 'comprobantes', nombre: 'Comprobantes de pago', ruta: '/var/lib/argosisp/comprobantes', estado: 'completo', bytes: 3.1 * GB, archivos: 18420, crecimiento_30d_bytes: 310 * MB, crecimiento_30d_archivos: 1840, mayor: { nombre: '2026/09/comprobante-8812.jpg', bytes: 4.8 * MB }, aviso: null },
            { id: 'respaldos', nombre: 'Respaldos', ruta: '/var/lib/argosisp/respaldos', estado: 'completo', bytes: 2.6 * GB, archivos: 7, crecimiento_30d_bytes: 0, crecimiento_30d_archivos: 0, mayor: { nombre: 'argosisp-2026-10-16.dump', bytes: 380 * MB }, aviso: null },
            { id: 'libros', nombre: 'Libros legales y documentos FEL', ruta: '/var/lib/argosisp/libros', estado: 'completo', bytes: 640 * MB, archivos: 2310, crecimiento_30d_bytes: 48 * MB, crecimiento_30d_archivos: 190, mayor: null, aviso: null },
            { id: 'inventario', nombre: 'Facturas de compra (inventario)', ruta: '/var/lib/argosisp/inventario', estado: 'completo', bytes: 210 * MB, archivos: 640, crecimiento_30d_bytes: 22 * MB, crecimiento_30d_archivos: 61, mayor: null, aviso: null },
            { id: 'anuncios', nombre: 'Imágenes de anuncios', ruta: '/var/lib/argosisp/anuncios', estado: 'completo', bytes: 38 * MB, archivos: 42, crecimiento_30d_bytes: 2 * MB, crecimiento_30d_archivos: 3, mayor: null, aviso: null },
            { id: 'logos', nombre: 'Logos y apariencia', ruta: '/var/lib/argosisp/logos', estado: 'completo', bytes: 4 * MB, archivos: 6, crecimiento_30d_bytes: null, crecimiento_30d_archivos: null, mayor: null, aviso: null },
        ],
        base_datos: {
            tamano_bytes: 6.8 * GB,
            por_schema: [
                { schema: 'audit', bytes: 3.9 * GB },
                { schema: 'billing', bytes: 1.4 * GB },
                { schema: 'network', bytes: 0.9 * GB },
                { schema: 'ledger', bytes: 0.5 * GB },
                { schema: 'core', bytes: 0.1 * GB },
            ],
            tablas_mayores: [
                { schema: 'audit', tabla: 'acciones', bytes: 2.2 * GB },
                { schema: 'network', tabla: 'sesiones', bytes: 0.8 * GB },
                { schema: 'audit', tabla: 'red', bytes: 0.7 * GB },
                { schema: 'audit', tabla: 'cambios', bytes: 0.6 * GB },
                { schema: 'billing', tabla: 'facturas', bytes: 0.4 * GB },
            ],
            aviso: null,
        },
        redis: { usada_bytes: 180 * MB, pico_bytes: 240 * MB, maxima_bytes: 1 * GB, aviso: null },
        volumen_datos: { id: 'datos', nombre: 'Archivos (comprobantes, logos y documentos)', ruta: '/var/lib/argosisp', total_bytes: 200 * GB, usado_bytes: 84 * GB, libre_bytes: 116 * GB, porcentaje_usado: 42, estado: 'ok', aviso: null },
    },
}

export const TEMAS_APARIENCIA: Schema<'TemaApariencia'>[] = [
    { id: 'indigo', nombre: 'Índigo', color: 'indigo', claro: '#4f46e5', oscuro: '#818cf8' },
    { id: 'azul', nombre: 'Azul', color: 'blue', claro: '#2563eb', oscuro: '#60a5fa' },
    { id: 'violeta', nombre: 'Violeta', color: 'violet', claro: '#7c3aed', oscuro: '#a78bfa' },
    { id: 'esmeralda', nombre: 'Esmeralda', color: 'emerald', claro: '#047857', oscuro: '#34d399' },
    { id: 'naranja', nombre: 'Naranja', color: 'orange', claro: '#c2410c', oscuro: '#fb923c' },
    { id: 'rosa', nombre: 'Rosa', color: 'pink', claro: '#be185d', oscuro: '#f472b6' },
    { id: 'pizarra', nombre: 'Pizarra', color: 'slate', claro: '#475569', oscuro: '#94a3b8' },
]

export const aparienciaFixture: Schema<'Apariencia'> = {
    tema: 'indigo',
    paleta: { color: 'indigo', claro: '#4f46e5', oscuro: '#818cf8' },
    modo_predeterminado: 'sistema',
    nombre_marca: 'ArgosIsp',
    eslogan: null,
    logo_login_url: null,
    fondo_login_url: null,
    version: 0,
    logo_login: null,
    fondo_login: null,
    temas: TEMAS_APARIENCIA,
    updated_at: '2026-10-01T00:00:00.000Z',
}

/** Igual que la API: la parte pública de la apariencia (sin archivos ni catálogo). */
export function aparienciaPublica(apariencia: Schema<'Apariencia'>): Schema<'AparienciaPublica'> {
    const { tema, paleta, modo_predeterminado, nombre_marca, eslogan, logo_login_url, fondo_login_url, version } = apariencia
    return { tema, paleta, modo_predeterminado, nombre_marca, eslogan, logo_login_url, fondo_login_url, version }
}

/*
 * Tareas programadas (`GET /sistema/crons`): una muestra del catálogo de la API
 * (`apps/api/app/monitoreo/crons/catalogo.ts`) con los mismos textos y valores por defecto. Los
 * instantes se guardan como desfase en segundos desde «ahora» y se arman al pedirlos.
 */
type Tarea = Schema<'TareaProgramada'>
type Corrida = Schema<'CorridaCron'>

const ZONA = 'America/Guatemala'
const horarioCada = (segundos: number, texto: string): Tarea['horario'] => ({ tipo: 'cada', cada_segundos: segundos, hora: null, dia: null, zona: ZONA, texto })
const horarioDiario = (hora: string): Tarea['horario'] => ({ tipo: 'diario', cada_segundos: null, hora, dia: null, zona: ZONA, texto: `Todos los días a las ${hora}` })

export interface CorridaSemilla {
    hace: number
    estado: Corrida['estado']
    duracion_ms: number | null
    resumen: string | null
    error?: string | null
    repeticiones?: number
    origen?: Corrida['origen']
    instancia?: string
}

export interface TareaSemilla {
    base: Omit<Tarea, 'ultima' | 'ultima_correcta' | 'proxima' | 'en_curso'>
    /** segundos hasta la próxima corrida (negativo: debió correr) */
    proxima: number | null
    en_curso?: { hace: number, instancia: string }
    corridas: CorridaSemilla[]
}

const EJECUTAR = 'sistema.ejecutar_cron'
const lockPg = (tomado: boolean, instancia: string | null = null): Tarea['lock'] => ({ tipo: 'postgres', tomado, dueno: tomado ? '48211' : null, instancia })

export const tareasSemilla: TareaSemilla[] = [
    {
        base: { clave: 'billing.corte', nombre: 'Corte por hora', modulo: 'cobranza', modulo_nombre: 'Cobranza', descripcion: 'A cada hora de corte de las plantillas, limita o suspende los servicios con facturas vencidas.', proceso: 'billing:worker', horario: horarioCada(60, 'Cada minuto'), activo: true, manual: true, permisos: [EJECUTAR, 'servicios.suspender'], estado: 'ok', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(false), nota: null },
        proxima: 40,
        corridas: [
            { hace: 20, estado: 'ok', duracion_ms: 840, resumen: '3 servicios cambiaron de estado, 1 hora de corte procesada' },
            { hace: 80, estado: 'sin_cambios', duracion_ms: 120, resumen: 'Nada pendiente', repeticiones: 58 },
        ],
    },
    {
        base: { clave: 'billing.generar', nombre: 'Generar facturas', modulo: 'facturacion', modulo_nombre: 'Facturación', descripcion: 'Emite las facturas de todos los periodos que ya tocan y aún no tienen factura.', proceso: 'billing:worker', horario: horarioCada(3600, 'Cada hora'), activo: true, manual: true, permisos: [EJECUTAR, 'facturas.generar'], estado: 'en_curso', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(true, 'worker-2'), nota: null },
        proxima: 3300,
        en_curso: { hace: 300, instancia: 'worker-2' },
        corridas: [
            { hace: 300, estado: 'en_curso', duracion_ms: null, resumen: null, instancia: 'worker-2' },
            { hace: 3900, estado: 'ok', duracion_ms: 61_200, resumen: '24 facturas emitidas, 1 periodo bonificado', instancia: 'worker-2' },
        ],
    },
    {
        base: { clave: 'billing.vencer', nombre: 'Vencimiento y mora', modulo: 'facturacion', modulo_nombre: 'Facturación', descripcion: 'Marca vencidas las facturas que pasaron su fecha y aplica la mora de la plantilla.', proceso: 'billing:worker', horario: horarioCada(3600, 'Cada hora'), activo: true, manual: true, permisos: [EJECUTAR], estado: 'atrasada', proxima_fuente: 'calculada', atrasada: true, lock: lockPg(false), nota: null },
        proxima: -2040,
        corridas: [
            { hace: 8040, estado: 'ok', duracion_ms: 3100, resumen: '18 facturas vencidas, 6 moras aplicadas', instancia: 'worker-1' },
            { hace: 11_640, estado: 'sin_cambios', duracion_ms: 200, resumen: 'Nada pendiente', repeticiones: 6, instancia: 'worker-1' },
            { hace: 40_000, estado: 'ok', duracion_ms: 2800, resumen: '4 facturas vencidas', origen: 'manual', instancia: 'worker-2' },
        ],
    },
    {
        base: { clave: 'fiscal.fel', nombre: 'Cola de facturación electrónica', modulo: 'fiscal', modulo_nombre: 'Fiscal', descripcion: 'Certifica los DTE pendientes, reintenta los que fallaron y envía las anulaciones.', proceso: 'fiscal:worker', horario: horarioCada(60, 'Cada minuto'), activo: true, manual: true, permisos: [EJECUTAR, 'fel.certificar'], estado: 'error', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(false), nota: null },
        proxima: 10,
        corridas: [
            { hace: 50, estado: 'error', duracion_ms: 400, resumen: '2 DTE enviados', error: '3 elementos fallaron' },
            { hace: 110, estado: 'ok', duracion_ms: 900, resumen: '5 DTE enviados' },
        ],
    },
    {
        base: { clave: 'billing.sellar', nombre: 'Sellar el libro', modulo: 'contabilidad', modulo_nombre: 'Contabilidad', descripcion: 'Encadena con su huella (hash) los asientos nuevos para que nadie pueda alterarlos.', proceso: 'billing:worker', horario: horarioCada(60, 'Cada minuto'), activo: true, manual: true, permisos: [EJECUTAR], estado: 'sin_cambios', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(false), nota: null },
        proxima: 30,
        corridas: [{ hace: 30, estado: 'sin_cambios', duracion_ms: 90, resumen: 'Nada pendiente', repeticiones: 58 }],
    },
    {
        base: { clave: 'routeros.reconciliar', nombre: 'Reconciliar RouterOS', modulo: 'red', modulo_nombre: 'Red', descripcion: 'Revisa que cada router tenga la configuración que Argos espera (colas, corte, secrets) y la corrige.', proceso: 'routeros:worker', horario: horarioCada(900, 'Cada 15 min'), activo: true, manual: true, permisos: [EJECUTAR, 'routers.reconciliar'], estado: 'ok', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(false), nota: null },
        proxima: 540,
        corridas: [{ hace: 360, estado: 'ok', duracion_ms: 4200, resumen: '4 correcciones' }],
    },
    {
        base: { clave: 'billing.integridad', nombre: 'Verificar integridad del libro', modulo: 'contabilidad', modulo_nombre: 'Contabilidad', descripcion: 'Recalcula la cadena de sellos del libro y avisa si algún asiento fue alterado.', proceso: 'billing:worker', horario: horarioDiario('02:15'), activo: true, manual: true, permisos: [EJECUTAR], estado: 'ok', proxima_fuente: 'bullmq', atrasada: false, lock: lockPg(false), nota: null },
        proxima: 60_000,
        corridas: [{ hace: 26_000, estado: 'ok', duracion_ms: 1500, resumen: '2 empresas verificadas' }],
    },
    {
        base: { clave: 'sistema.relay_outbox', nombre: 'Relay de eventos', modulo: 'sistema', modulo_nombre: 'Sistema', descripcion: 'Publica los eventos guardados en la base para que los demás procesos se enteren.', proceso: 'eventos:relay', horario: { tipo: 'continuo', cada_segundos: 1, hora: null, dia: null, zona: ZONA, texto: 'Siempre activo' }, activo: true, manual: false, permisos: [], estado: 'ok', proxima_fuente: null, atrasada: false, lock: { tipo: 'redis', tomado: true, dueno: '8c1f6a2e-4b1d-4f7a-9d0e-3b6a1c2d4e5f', instancia: null }, nota: 'Sin eventos pendientes' },
        proxima: null,
        corridas: [],
    },
    {
        base: { clave: 'routeros.sondear', nombre: 'Sondeo de routers', modulo: 'red', modulo_nombre: 'Red', descripcion: 'Pregunta a los routers sin contacto reciente si siguen en línea.', proceso: 'routeros:worker', horario: null, activo: false, manual: true, permisos: [EJECUTAR], estado: 'apagada', proxima_fuente: null, atrasada: false, lock: lockPg(false), nota: 'Apagada por configuración (su periodo está en 0).' },
        proxima: null,
        corridas: [],
    },
]

const iso = (ms: number) => new Date(ms).toISOString()

export function corridasDe(semilla: TareaSemilla, ahoraMs: number): Corrida[] {
    return semilla.corridas.map((c, i) => {
        const inicio = ahoraMs - c.hace * 1000
        const repeticiones = c.repeticiones ?? 1
        return {
            id: 1000 - i,
            clave: semilla.base.clave,
            origen: c.origen ?? 'programado',
            estado: c.estado,
            inicio: iso(inicio),
            primera: iso(inicio - (repeticiones - 1) * (semilla.base.horario?.cada_segundos ?? 60) * 1000),
            fin: c.estado === 'en_curso' ? null : iso(inicio + (c.duracion_ms ?? 0)),
            duracion_ms: c.duracion_ms,
            repeticiones,
            resumen: c.resumen,
            error: c.error ?? null,
            instancia: c.instancia ?? 'worker-1',
            usuario_id: c.origen === 'manual' ? 1 : null,
            fuente: 'corridas',
        }
    })
}

export function tareasDe(semillas: TareaSemilla[], ahoraMs: number): Schema<'TareasProgramadas'> {
    return {
        data: semillas.map((s) => {
            const corridas = corridasDe(s, ahoraMs).filter(c => c.estado !== 'en_curso')
            const correcta = corridas.find(c => c.estado === 'ok' || c.estado === 'sin_cambios')
            return {
                ...s.base,
                ultima: corridas[0] ?? null,
                ultima_correcta: correcta?.fin ?? null,
                proxima: s.proxima === null ? null : iso(ahoraMs + s.proxima * 1000),
                en_curso: s.en_curso ? { corrida_id: 1000, desde: iso(ahoraMs - s.en_curso.hace * 1000), instancia: s.en_curso.instancia, origen: 'programado' } : null,
            }
        }),
        avisos: [],
        generado_en: iso(ahoraMs),
    }
}

export interface SistemaFixtures {
    salud: Schema<'SaludSistema'>
    registro: Schema<'EntradaRegistro'>[]
    almacenamiento: Schema<'Almacenamiento'>
    apariencia: Schema<'Apariencia'>
    /** Por id de usuario; sin fila = predeterminados de su rol. */
    accesos: Record<number, { secciones: string[], version: number }>
    tareas: TareaSemilla[]
}

export function sistemaInicial(): SistemaFixtures {
    return {
        salud: structuredClone(saludFixture),
        registro: structuredClone(registroFixture),
        almacenamiento: structuredClone(almacenamientoFixture),
        apariencia: structuredClone(aparienciaFixture),
        accesos: {},
        tareas: structuredClone(tareasSemilla),
    }
}
