import env from '#start/env'
import type { Permiso } from '#core/permisos'
import type { Contador } from '#monitoreo/crons/resumen'

/**
 * Catálogo único de las tareas programadas (pantalla «Tareas programadas», `GET /sistema/crons`).
 *
 * Cada módulo sigue declarando y agendando sus crons donde siempre (`app/<modulo>/jobs.ts`,
 * `notify/recordatorios.ts`, `network/sesiones/colgadas.ts`…); aquí se describen todos en un solo lugar
 * con su nombre en español, horario, qué hacen, si se pueden ejecutar a mano y con qué permiso.
 * `tests/monitoreo/crons_catalogo.spec.ts` falla si aparece un job scheduler de BullMQ (o un archivo
 * nuevo que agenda uno) que no está aquí, o si un horario de aquí no es el que el módulo agenda.
 *
 * No importa los módulos (evita ciclos: sus workers importan `corridas.ts`, que importa este archivo);
 * los periodos que dependen del entorno se leen con las mismas variables y valores por defecto.
 */

export const MODULOS_CRON = {
    facturacion: 'Facturación',
    cobranza: 'Cobranza',
    contabilidad: 'Contabilidad',
    lealtad: 'Lealtad',
    fiscal: 'Fiscal',
    red: 'Red',
    nucleo: 'Clientes y servicios',
    notificaciones: 'Notificaciones',
    integraciones: 'Integraciones',
    sistema: 'Sistema',
} as const
export type ModuloCron = keyof typeof MODULOS_CRON

/**
 * - `cada`: periódico cada `ms` (job scheduler `every`).
 * - `diario`: a la hora `HH:mm` de Guatemala.
 * - `mensual`: el día `dia` a la hora `HH:mm` de Guatemala.
 * - `continuo`: un proceso que da vueltas cada `ms` (relay, vigía, webhooks); no es un job de BullMQ.
 */
export type Horario =
    | { tipo: 'cada'; ms: number }
    | { tipo: 'diario'; hora: string }
    | { tipo: 'mensual'; dia: number; hora: string }
    | { tipo: 'continuo'; ms: number }

/**
 * Cómo se sabe si alguien la está corriendo:
 * - `postgres`: advisory lock de Postgres (`pg_try_advisory_xact_lock(espacio, hashtext(nombre))`, o
 *   `pg_try_advisory_xact_lock(hashtext(nombre))` con `espacio` null).
 * - `redis`: lock con dueño en Redis (`<COLAS_PREFIJO>:lock:<sufijo>`), el del relay y el del vigía.
 * - `cola`: sin lock propio; BullMQ entrega cada disparo a un solo worker (concurrencia 1).
 */
export type LockCron =
    | { tipo: 'postgres'; espacio: number | null; nombre: string }
    | { tipo: 'redis'; sufijo: string }
    | { tipo: 'cola' }

export interface CronCatalogo {
    /** id estable (`billing.generar`); va en la URL */
    clave: string
    nombre: string
    modulo: ModuloCron
    /** qué hace, en una frase */
    descripcion: string
    /** proceso que lo corre (`node ace <proceso>`) */
    proceso: string
    /** null = apagado por configuración (p. ej. `ROUTEROS_SONDEO_CADA_MS=0`) */
    horario: () => Horario | null
    /** cola y nombre del job de BullMQ; null en los procesos continuos */
    bullmq: { cola: string; job: string } | null
    /** se puede pedir «Ejecutar ahora» (encola el job en su cola, con su lock) */
    manual: boolean
    /** permisos que hacen falta para ejecutarlo a mano, además de `sistema.ver_crons` para verlo */
    permisos: Permiso[]
    lock: LockCron | null
    /** acción que deja su fila en `audit.acciones` (para corridas anteriores a `core.cron_corridas`) */
    accion: string | null
    /** canal con el que la acción se audita */
    canalAuditoria?: 'cron' | 'worker'
    /** lo que cuenta como cambio para el resumen («24 facturas emitidas») */
    contadores?: Contador[]
    /** rutas que cuentan errores parciales */
    errores?: string[]
}

const GT = (hora: string): Horario => ({ tipo: 'diario', hora })
const cada = (ms: number) => (): Horario => ({ tipo: 'cada', ms })
const MIN = 60_000
const EJECUTAR: Permiso = 'sistema.ejecutar_cron'

/** `ROUTEROS_SONDEO_CADA_MS` o un Interim-Update (`AAA_INTERIM_SEGUNDOS`); 0 = apagado. */
function sondeoRouterOS(): number {
    return env.get('ROUTEROS_SONDEO_CADA_MS') ?? (env.get('AAA_INTERIM_SEGUNDOS') ?? 300) * 1000
}

function siPositivo(ms: number): Horario | null {
    return ms > 0 ? { tipo: 'cada', ms } : null
}

const billing = (job: string) => ({
    proceso: 'billing:worker',
    bullmq: { cola: 'billing-cron', job },
    lock: { tipo: 'postgres', espacio: 4004, nombre: job } as LockCron,
})
const core = (job: string) => ({
    proceso: 'eventos:relay',
    bullmq: { cola: 'core-cron', job },
    lock: { tipo: 'postgres', espacio: 4001, nombre: job } as LockCron,
})
const routeros = (job: string) => ({
    proceso: 'routeros:worker',
    bullmq: { cola: 'routeros-cron', job },
    lock: { tipo: 'postgres', espacio: 4103, nombre: job } as LockCron,
})
const notifyCron = (job: string) => ({
    proceso: 'notify:worker',
    bullmq: { cola: 'notify-cron', job },
    lock: { tipo: 'cola' } as LockCron,
})

const c = (uno: string, varios: string, ruta: string): Contador => ({ ruta, uno, varios })

export const CATALOGO_CRONS: readonly CronCatalogo[] = [
    // ── Facturación y cobranza (billing:worker) ────────────────────────────────────────────────
    {
        clave: 'billing.generar',
        nombre: 'Generar facturas',
        modulo: 'facturacion',
        descripcion: 'Emite las facturas de todos los periodos que ya tocan y aún no tienen factura.',
        horario: cada(60 * MIN),
        ...billing('generar'),
        manual: true,
        permisos: [EJECUTAR, 'facturas.generar'],
        accion: 'facturas.generar',
        contadores: [
            c('factura emitida', 'facturas emitidas', 'generadas'),
            c('periodo bonificado', 'periodos bonificados', 'bonificadas'),
            c('bloqueada por el libro', 'bloqueadas por el libro', 'bloqueados'),
        ],
        errores: ['errores'],
    },
    {
        clave: 'billing.vencer',
        nombre: 'Vencimiento y mora',
        modulo: 'facturacion',
        descripcion: 'Marca vencidas las facturas que pasaron su fecha y aplica la mora de la plantilla.',
        horario: cada(60 * MIN),
        ...billing('vencer'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'facturas.vencer_pendientes',
        contadores: [
            c('factura vencida', 'facturas vencidas', 'vencidas'),
            c('mora aplicada', 'moras aplicadas', 'moras'),
            c('bloqueada por el libro', 'bloqueadas por el libro', 'bloqueados'),
        ],
        errores: ['errores'],
    },
    {
        clave: 'billing.corte',
        nombre: 'Corte por hora',
        modulo: 'cobranza',
        descripcion:
            'A cada hora de corte de las plantillas, limita o suspende los servicios con facturas vencidas.',
        horario: cada(MIN),
        ...billing('corte'),
        manual: true,
        permisos: [EJECUTAR, 'servicios.suspender'],
        accion: 'servicios.corte',
        contadores: [
            c('servicio cambió de estado', 'servicios cambiaron de estado', 'cambiados'),
            c('hora de corte procesada', 'horas de corte procesadas', 'horas'),
            c('factura vencida', 'facturas vencidas', 'vencimiento.vencidas'),
        ],
        errores: ['errores'],
    },
    {
        clave: 'billing.promesas',
        nombre: 'Promesas vencidas',
        modulo: 'cobranza',
        descripcion: 'Cierra las promesas de pago vencidas: cumplidas si se pagó, incumplidas si no.',
        horario: cada(MIN),
        ...billing('promesas'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'promesas.incumplir_vencidas',
        contadores: [
            c('promesa incumplida', 'promesas incumplidas', 'incumplidas'),
            c('promesa cumplida', 'promesas cumplidas', 'cumplidas'),
            c('promesa cancelada', 'promesas canceladas', 'canceladas'),
        ],
        errores: ['errores'],
    },
    {
        clave: 'billing.pausas',
        nombre: 'Pausas terminadas',
        modulo: 'cobranza',
        descripcion: 'Termina las pausas sin cobro que llegaron a su fin y reactiva esos servicios.',
        horario: cada(5 * MIN),
        ...billing('pausas'),
        manual: true,
        permisos: [EJECUTAR],
        accion: null,
        contadores: [c('pausa terminada', 'pausas terminadas', 'terminadas')],
        errores: ['errores'],
    },
    {
        clave: 'billing.conciliar',
        nombre: 'Conciliar pasarela de pago',
        modulo: 'cobranza',
        descripcion: 'Compara los cobros en línea de ayer con el reporte del proveedor de pagos.',
        horario: () => GT('06:30'),
        ...billing('conciliar'),
        manual: true,
        permisos: [EJECUTAR, 'cobros.liquidar'],
        accion: 'pasarela.conciliar',
        contadores: [
            c('cobro conciliado', 'cobros conciliados', 'conciliados'),
            c('diferencia', 'diferencias', 'diferencias'),
        ],
    },
    {
        clave: 'billing.reportes',
        nombre: 'Reportes programados',
        modulo: 'facturacion',
        descripcion: 'Envía por correo los reportes programados cuya hora ya llegó.',
        horario: cada(5 * MIN),
        ...billing('reportes'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'reportes.ejecutar_envio',
        contadores: [c('reporte enviado', 'reportes enviados', 'enviados')],
        errores: ['errores'],
    },
    // ── Contabilidad ───────────────────────────────────────────────────────────────────────────
    {
        clave: 'billing.sellar',
        nombre: 'Sellar el libro',
        modulo: 'contabilidad',
        descripcion: 'Encadena con su huella (hash) los asientos nuevos para que nadie pueda alterarlos.',
        horario: cada(MIN),
        ...billing('sellar'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'libro.sellar',
        contadores: [c('asiento sellado', 'asientos sellados', 'sellados')],
    },
    {
        clave: 'billing.integridad',
        nombre: 'Verificar integridad del libro',
        modulo: 'contabilidad',
        descripcion: 'Recalcula la cadena de sellos del libro y avisa si algún asiento fue alterado.',
        horario: () => GT('02:15'),
        ...billing('integridad'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'libro.verificar_integridad',
        contadores: [c('empresa verificada', 'empresas verificadas', 'data')],
    },
    {
        clave: 'billing.depreciar',
        nombre: 'Depreciar activos fijos',
        modulo: 'contabilidad',
        descripcion: 'Registra las cuotas de depreciación de los activos hasta el mes anterior.',
        horario: () => GT('02:30'),
        ...billing('depreciar'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'activos.depreciar',
        contadores: [c('cuota registrada', 'cuotas registradas', 'cuotas')],
    },
    {
        clave: 'billing.diferir',
        nombre: 'Amortizar gastos diferidos',
        modulo: 'contabilidad',
        descripcion: 'Registra las cuotas de los gastos diferidos hasta el mes anterior.',
        horario: () => GT('02:40'),
        ...billing('diferir'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'libro.amortizar_diferidos',
        contadores: [c('cuota registrada', 'cuotas registradas', 'cuotas')],
    },
    // ── Lealtad (agendados por billing:worker) ────────────────────────────────────────────────
    {
        clave: 'lealtad.antiguedad',
        nombre: 'Puntos por antigüedad',
        modulo: 'lealtad',
        descripcion: 'Da los puntos de aniversario a los clientes que cumplieron otro año de servicio.',
        horario: () => GT('03:05'),
        ...billing('lealtad:antiguedad'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'lealtad.otorgar_antiguedad',
        contadores: [c('aniversario premiado', 'aniversarios premiados', 'otorgados')],
        errores: ['fallidas'],
    },
    {
        clave: 'lealtad.vencer',
        nombre: 'Vencer puntos de lealtad',
        modulo: 'lealtad',
        descripcion: 'Vence los puntos que llegaron a su fecha y avisa de los que vencen pronto.',
        horario: () => GT('03:20'),
        ...billing('lealtad:vencer'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'lealtad.vencer',
        contadores: [
            c('lote vencido', 'lotes vencidos', 'vencidos'),
            c('aviso de vencimiento', 'avisos de vencimiento', 'avisados'),
        ],
        errores: ['fallidas'],
    },
    // ── Fiscal (fiscal:worker; usa el lock de los crons de billing) ──────────────────────────
    {
        clave: 'fiscal.fel',
        nombre: 'Cola de facturación electrónica',
        modulo: 'fiscal',
        descripcion: 'Certifica los DTE pendientes, reintenta los que fallaron y envía las anulaciones.',
        horario: cada(MIN),
        proceso: 'fiscal:worker',
        bullmq: { cola: 'fel-cron', job: 'fel' },
        lock: { tipo: 'postgres', espacio: 4004, nombre: 'fel' },
        manual: true,
        permisos: [EJECUTAR, 'fel.certificar'],
        accion: null,
        contadores: [
            c('certificación pedida', 'certificaciones pedidas', 'solicitados'),
            c('DTE enviado', 'DTE enviados', 'enviados'),
            c('DTE anulado', 'DTE anulados', 'anulados'),
        ],
        errores: ['errores'],
    },
    {
        clave: 'fiscal.calendario',
        nombre: 'Calendario fiscal',
        modulo: 'fiscal',
        descripcion:
            'Genera el calendario de obligaciones y avisa de vencimientos y del límite de pequeño contribuyente.',
        horario: cada(60 * MIN),
        proceso: 'fiscal:worker',
        bullmq: { cola: 'fel-cron', job: 'calendario' },
        lock: { tipo: 'postgres', espacio: 4004, nombre: 'fiscal:calendario' },
        manual: true,
        permisos: [EJECUTAR],
        accion: 'fiscal.generar_calendario',
        contadores: [
            c('obligación nueva', 'obligaciones nuevas', 'calendario.creadas'),
            c('obligación actualizada', 'obligaciones actualizadas', 'calendario.actualizadas'),
            c('aviso de vencimiento', 'avisos de vencimiento', 'alertas.vencimientos'),
            c('aviso de límite', 'avisos de límite', 'alertas.limite_pc'),
        ],
        errores: ['calendario.errores', 'alertas.errores'],
    },
    // ── Clientes y servicios (eventos:relay, cola core-cron) ─────────────────────────────────
    {
        clave: 'core.planes_temporales',
        nombre: 'Planes temporales',
        modulo: 'nucleo',
        descripcion: 'Inicia los planes temporales programados y devuelve a su plan los que terminaron.',
        horario: cada(MIN),
        ...core('planes_temporales'),
        manual: true,
        permisos: [EJECUTAR],
        accion: null,
        contadores: [
            c('plan iniciado', 'planes iniciados', 'iniciados'),
            c('plan terminado', 'planes terminados', 'terminados'),
        ],
        errores: ['fallidos'],
    },
    {
        clave: 'core.promociones_velocidad',
        nombre: 'Promociones de velocidad',
        modulo: 'nucleo',
        descripcion: 'Cierra los tramos de promociones de velocidad que terminaron y abre los que tocan ahora.',
        horario: cada(MIN),
        ...core('promociones_velocidad'),
        manual: true,
        permisos: [EJECUTAR],
        accion: null,
        contadores: [
            c('tramo abierto', 'tramos abiertos', 'abiertos'),
            c('tramo cerrado', 'tramos cerrados', 'cerrados'),
        ],
        errores: ['fallidos'],
    },
    {
        clave: 'core.fallas_generales',
        nombre: 'Fallas generales de red',
        modulo: 'red',
        descripcion: 'Abre, amplía y cierra los incidentes de falla general según los servicios caídos.',
        horario: cada(MIN),
        ...core('fallas_generales'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'incidentes_red.evaluar',
        contadores: [
            c('incidente abierto', 'incidentes abiertos', 'abiertos'),
            c('incidente ampliado', 'incidentes ampliados', 'ampliados'),
            c('incidente cerrado', 'incidentes cerrados', 'cerrados'),
        ],
    },
    {
        clave: 'core.reservas_ip_vencidas',
        nombre: 'Reservas de IP vencidas',
        modulo: 'nucleo',
        descripcion: 'Libera la IP reservada de los servicios que siguen sin instalar 30 días después.',
        horario: cada(60 * MIN),
        ...core('reservas_ip_vencidas'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'servicios.vencer_reserva_ip',
        contadores: [c('reserva liberada', 'reservas liberadas', 'liberadas')],
        errores: ['fallidas'],
    },
    {
        clave: 'core.identidades_vencidas',
        nombre: 'Identidades vencidas',
        modulo: 'nucleo',
        descripcion: 'Borra la foto y el documento de los clientes retirados hace más de 12 meses.',
        horario: cada(24 * 60 * MIN),
        ...core('identidades_vencidas'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'clientes.borrar_identidades',
        contadores: [c('identidad borrada', 'identidades borradas', 'clientes')],
    },
    {
        clave: 'core.iris_canjes_sin_uso',
        nombre: 'Canje del conector Iris',
        modulo: 'integraciones',
        descripcion: 'Confirma el canje del token de Iris ya usado y revoca el que lleva 24 h sin uso.',
        horario: cada(5 * MIN),
        ...core('iris_canjes_sin_uso'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'iris.vencer_canje',
        contadores: [c('canje revisado', 'canjes revisados', '$')],
    },
    // ── Red (routeros:worker y sesiones:worker) ───────────────────────────────────────────────
    {
        clave: 'routeros.recuperar',
        nombre: 'Recuperar routers que fallaron',
        modulo: 'red',
        descripcion: 'Vuelve a probar los routers que fallaron y, cuando responden, los reconcilia.',
        horario: () => siPositivo(env.get('ROUTEROS_RECUPERAR_CADA_MS') ?? 30_000),
        ...routeros('recuperar'),
        manual: true,
        permisos: [EJECUTAR, 'routers.reconciliar'],
        accion: null,
        contadores: [
            c('router recuperado', 'routers recuperados', '[]'),
            c('corrección', 'correcciones', '[].correcciones'),
        ],
        errores: ['[].error'],
    },
    {
        clave: 'routeros.reconciliar',
        nombre: 'Reconciliar RouterOS',
        modulo: 'red',
        descripcion:
            'Revisa que cada router tenga la configuración que Argos espera (colas, corte, secrets) y la corrige.',
        horario: () => siPositivo(env.get('ROUTEROS_RECONCILIAR_CADA_MS') ?? 15 * MIN),
        ...routeros('reconciliar'),
        manual: true,
        permisos: [EJECUTAR, 'routers.reconciliar'],
        accion: 'routeros.reconciliar',
        contadores: [c('corrección', 'correcciones', '[].correcciones')],
        errores: ['[].error'],
    },
    {
        clave: 'routeros.sondear',
        nombre: 'Sondeo de routers',
        modulo: 'red',
        descripcion: 'Pregunta a los routers sin contacto reciente si siguen en línea.',
        horario: () => siPositivo(sondeoRouterOS()),
        ...routeros('sondear'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'routeros.sondear',
        contadores: [
            c('router sondeado', 'routers sondeados', '[].sondeados'),
            c('router sin respuesta', 'routers sin respuesta', '[].sin_respuesta'),
        ],
    },
    {
        clave: 'routeros.sesiones_ppp',
        nombre: 'Sondeo de PPPoE sin RADIUS',
        modulo: 'red',
        descripcion: 'Lee las sesiones PPPoE de los routers sin RADIUS y abre o cierra las conexiones.',
        horario: () => siPositivo(env.get('ROUTEROS_SESIONES_PPP_CADA_MS') ?? MIN),
        ...routeros('sesiones_ppp'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'sesiones.sondear_ppp',
        contadores: [
            c('sesión abierta', 'sesiones abiertas', '[].abiertas'),
            c('sesión cerrada', 'sesiones cerradas', '[].cerradas'),
        ],
        errores: ['[].error'],
    },
    {
        clave: 'sesiones.colgadas',
        nombre: 'Sesiones colgadas',
        modulo: 'red',
        descripcion: 'Cierra las sesiones que dejaron de reportar consumo (sin Stop ni Interim-Update).',
        horario: () => siPositivo(env.get('SESIONES_COLGADAS_CADA_MS') ?? 5 * MIN),
        proceso: 'sesiones:worker',
        bullmq: { cola: 'sesiones-cron', job: 'cerrar_colgadas' },
        lock: { tipo: 'postgres', espacio: 4104, nombre: 'cerrar_colgadas' },
        manual: true,
        permisos: [EJECUTAR],
        accion: 'sesiones.cerrar_colgadas',
        contadores: [c('sesión cerrada', 'sesiones cerradas', 'cerradas')],
    },
    // ── Notificaciones y sistema (notify:worker, cola notify-cron) ────────────────────────────
    {
        clave: 'notify.recordatorios',
        nombre: 'Envíos programados',
        modulo: 'notificaciones',
        descripcion: 'Programa los recordatorios de pago antes y después del vencimiento a su hora.',
        horario: cada(MIN),
        ...notifyCron('recordatorios'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'notificaciones.recordatorios',
        contadores: [c('recordatorio programado', 'recordatorios programados', 'nuevos')],
        errores: ['errores'],
    },
    {
        clave: 'notify.vigilancia',
        nombre: 'Vigilancia de crons',
        modulo: 'sistema',
        descripcion:
            'Avisa al equipo por Telegram cuando una tarea no corrió a su hora y cuando se recupera.',
        horario: cada(5 * MIN),
        ...notifyCron('vigilancia-crons'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'notificaciones.vigilar_crons',
        contadores: [
            c('tarea atrasada', 'tareas atrasadas', 'atrasados'),
            c('tarea recuperada', 'tareas recuperadas', 'recuperados'),
        ],
    },
    {
        clave: 'notify.particiones',
        nombre: 'Particiones de la bitácora',
        modulo: 'sistema',
        descripcion: 'Crea por adelantado las particiones mensuales de la bitácora de los próximos 12 meses.',
        // `7 6 1 * *` UTC = día 1 a las 00:07 de Guatemala
        horario: () => ({ tipo: 'mensual', dia: 1, hora: '00:07' }),
        ...notifyCron('particiones'),
        manual: true,
        permisos: [EJECUTAR],
        accion: 'auditoria.crear_particiones',
        contadores: [c('partición creada', 'particiones creadas', 'creadas')],
    },
    {
        clave: 'monitoreo.almacenamiento',
        nombre: 'Calcular almacenamiento',
        modulo: 'sistema',
        descripcion: 'Mide cuánto ocupan los archivos, la base de datos y Redis, y cuánto disco queda.',
        // `23 4 * * *` UTC = 22:23 de Guatemala
        horario: () => GT('22:23'),
        proceso: 'notify:worker',
        bullmq: { cola: 'notify-cron', job: 'almacenamiento' },
        lock: { tipo: 'postgres', espacio: null, nombre: 'monitoreo:almacenamiento' },
        manual: true,
        permisos: [EJECUTAR, 'sistema.recalcular_almacenamiento'],
        accion: 'sistema.recalcular_almacenamiento',
        contadores: [c('medición guardada', 'mediciones guardadas', '$')],
    },
    // ── Procesos continuos (no son jobs de BullMQ; no se ejecutan a mano) ─────────────────────
    {
        clave: 'sistema.relay_outbox',
        nombre: 'Relay de eventos',
        modulo: 'sistema',
        descripcion: 'Publica los eventos guardados en la base para que los demás procesos se enteren.',
        horario: () => ({ tipo: 'continuo', ms: 250 }),
        proceso: 'eventos:relay',
        bullmq: null,
        lock: { tipo: 'redis', sufijo: 'eventos-relay' },
        manual: false,
        permisos: [],
        accion: null,
    },
    {
        clave: 'red.vigia_aaa',
        nombre: 'Vigía de RADIUS',
        modulo: 'red',
        descripcion: 'Revisa cada pocos segundos que los nodos RADIUS respondan y avisa si se caen.',
        horario: () => ({ tipo: 'continuo', ms: env.get('AAA_SALUD_CADA_MS') ?? 5000 }),
        proceso: 'aaa:vigilar',
        bullmq: null,
        lock: { tipo: 'redis', sufijo: 'aaa-vigia' },
        manual: false,
        permisos: [],
        accion: null,
    },
    {
        clave: 'iris.pendientes',
        nombre: 'Pendientes de Iris',
        modulo: 'integraciones',
        descripcion:
            'Entrega a Iris los avisos, permisos de contacto y prospectos pendientes, con reintentos.',
        horario: () => ({ tipo: 'continuo', ms: 5000 }),
        proceso: 'iris:worker',
        bullmq: null,
        lock: null,
        manual: false,
        permisos: [],
        accion: null,
    },
    {
        clave: 'iris.conciliar_avisos',
        nombre: 'Conciliar avisos de Iris',
        modulo: 'integraciones',
        descripcion: 'Revisa los avisos de WhatsApp que esperan respuesta de Iris hace más de 24 horas.',
        horario: () => ({ tipo: 'cada', ms: 60 * MIN }),
        proceso: 'iris:worker',
        bullmq: null,
        lock: null,
        manual: false,
        permisos: [],
        accion: 'notificaciones.conciliar_avisos_iris',
        canalAuditoria: 'worker',
    },
    {
        clave: 'horus.pendientes',
        nombre: 'Pendientes de Horus',
        modulo: 'integraciones',
        descripcion: 'Entrega a Horus Flow los avisos pendientes, firmados y con reintentos.',
        horario: () => ({ tipo: 'continuo', ms: 5000 }),
        proceso: 'horus:worker',
        bullmq: null,
        lock: null,
        manual: false,
        permisos: [],
        accion: null,
    },
    {
        clave: 'equipos.pendientes',
        nombre: 'Equipos pendientes',
        modulo: 'integraciones',
        descripcion:
            'Reintenta los aprovisionamientos de ONT (SmartOLT) y los cambios de Wi-Fi (GenieACS) en proceso.',
        // `EQUIPOS_PENDIENTES_CADA_MS` (30 s por defecto); job scheduler propio de la cola `equipos`
        horario: () => ({ tipo: 'cada', ms: Number(process.env.EQUIPOS_PENDIENTES_CADA_MS ?? 30_000) }),
        proceso: 'equipos:worker',
        bullmq: null,
        lock: null,
        manual: false,
        permisos: [],
        accion: null,
    },
    {
        clave: 'aaa.espejo',
        nombre: 'Espejo de RADIUS sin conexión',
        modulo: 'red',
        descripcion:
            'En cada nodo RADIUS, copia las cuentas a su respaldo local para seguir autorizando si Argos no responde.',
        // `AAA_DEGRADADO_ESPEJO_S` del servicio aaa (300 s por defecto), solo con el modo degradado `aceptar`
        horario: () => ({ tipo: 'continuo', ms: 300_000 }),
        proceso: 'services/aaa',
        bullmq: null,
        lock: null,
        manual: false,
        permisos: [],
        accion: null,
    },
]

const porClave = new Map(CATALOGO_CRONS.map((cron) => [cron.clave, cron]))

export function buscarCron(clave: string): CronCatalogo | undefined {
    return porClave.get(clave)
}

/** El cron del catálogo que atiende `job` en `cola` (los jobs a pedido, como `cambiar_control`, no son crons). */
export function cronDeJob(cola: string, job: string): CronCatalogo | undefined {
    return CATALOGO_CRONS.find((cron) => cron.bullmq?.cola === cola && cron.bullmq.job === job)
}

/** Colas de BullMQ con crons del catálogo. */
export function colasDeCrons(): string[] {
    return [...new Set(CATALOGO_CRONS.flatMap((cron) => (cron.bullmq ? [cron.bullmq.cola] : [])))]
}
