import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { conTimeout } from '#monitoreo/salud'
import {
    TOLERANCIA_POR_DEFECTO_MIN,
    evaluarAtraso,
    ultimoDespliegue,
    type CronVigilado,
} from '#notify/actions/vigilar_crons'
import {
    CATALOGO_CRONS,
    MODULOS_CRON,
    buscarCron,
    colasDeCrons,
    type CronCatalogo,
    type Horario,
} from '#monitoreo/crons/catalogo'
import { colaCron, estadoLock, type EstadoLock } from '#monitoreo/crons/locks'
import { MENSAJE_INTERRUMPIDA, corridaViva } from '#monitoreo/crons/corridas'

/**
 * Estado de las tareas programadas (`GET /sistema/crons` y `GET /sistema/crons/:clave/corridas`).
 * Solo lee; se calcula al pedirlo. Fuentes:
 *
 * - `core.cron_corridas`: cada corrida (inicio, fin, duración, resultado, resumen, instancia).
 * - `audit.acciones` (canal `cron`): la última corrida de los crons que aún no tienen filas en
 *   `core.cron_corridas` (antes de esta versión), marcada `fuente: auditoria`.
 * - `audit.outbox`: lo publicado y lo pendiente del relay de eventos.
 * - BullMQ: la próxima corrida de cada job scheduler (`getJobSchedulers`) y los jobs activos.
 * - `pg_locks` y Redis: quién tiene el lock (`locks.ts`).
 *
 * Atraso: la misma regla que `notificaciones.vigilar_crons` (`evaluarAtraso`), con
 * `NOTIFY_CRON_TOLERANCIA_MIN` de tolerancia. Redis caído no tumba la pantalla: la próxima corrida se
 * calcula del horario y sale un aviso.
 */

export type EstadoCron = 'en_curso' | 'error' | 'atrasada' | 'ok' | 'sin_cambios' | 'sin_datos' | 'apagada'
export type EstadoCorridaApi = 'en_curso' | 'ok' | 'sin_cambios' | 'error' | 'omitido'

export interface CorridaApi {
    id: number | null
    clave: string
    origen: 'programado' | 'manual'
    estado: EstadoCorridaApi
    /** inicio de la última repetición (la corrida más reciente de la fila) */
    inicio: string
    /** inicio de la primera repetición agrupada (igual a `inicio` sin repeticiones) */
    primera: string
    fin: string | null
    duracion_ms: number | null
    repeticiones: number
    resumen: string | null
    error: string | null
    instancia: string | null
    usuario_id: number | null
    fuente: 'corridas' | 'auditoria'
}

export interface HorarioApi {
    tipo: Horario['tipo']
    cada_segundos: number | null
    hora: string | null
    dia: number | null
    zona: string
    texto: string
}

export interface CronApi {
    clave: string
    nombre: string
    modulo: string
    modulo_nombre: string
    descripcion: string
    proceso: string
    horario: HorarioApi | null
    activo: boolean
    manual: boolean
    permisos: string[]
    estado: EstadoCron
    ultima: CorridaApi | null
    ultima_correcta: string | null
    proxima: string | null
    proxima_fuente: 'bullmq' | 'calculada' | null
    atrasada: boolean
    en_curso: { corrida_id: number; desde: string; instancia: string; origen: 'programado' | 'manual' } | null
    lock: (EstadoLock & { instancia: string | null }) | null
    nota: string | null
}

export interface ListaCrons {
    data: CronApi[]
    avisos: string[]
    generado_en: string
}

const ZONA = 'America/Guatemala'
const TIEMPO_REDIS_MS = 1500

interface FilaCorrida {
    id: number | string
    clave: string
    origen: 'programado' | 'manual'
    estado: EstadoCorridaApi
    inicio: Date
    ultimo_inicio: Date
    fin: Date | null
    duracion_ms: number | null
    repeticiones: number
    resumen: string | null
    error: string | null
    instancia: string
    usuario_id: number | string | null
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

/** Una fila `en_curso` sin quién la corra sale como error «se interrumpió». */
export function corridaDeFila(fila: FilaCorrida, lockTomado: boolean | null, ahora = Date.now()): CorridaApi {
    const muerta = fila.estado === 'en_curso' && !corridaViva(new Date(fila.ultimo_inicio), lockTomado, ahora)
    return {
        id: Number(fila.id),
        clave: fila.clave,
        origen: fila.origen,
        estado: muerta ? 'error' : fila.estado,
        inicio: iso(fila.ultimo_inicio)!,
        primera: iso(fila.inicio)!,
        fin: iso(fila.fin),
        duracion_ms: fila.duracion_ms === null ? null : Number(fila.duracion_ms),
        repeticiones: Number(fila.repeticiones),
        resumen: fila.resumen,
        error: muerta ? MENSAJE_INTERRUMPIDA : fila.error,
        instancia: fila.instancia,
        usuario_id: fila.usuario_id === null ? null : Number(fila.usuario_id),
        fuente: 'corridas',
    }
}

function textoCada(ms: number): string {
    if (ms < 60_000) return `Cada ${Math.round(ms / 1000)} s`
    if (ms === 3_600_000) return 'Cada hora'
    if (ms < 3_600_000) return ms === 60_000 ? 'Cada minuto' : `Cada ${Math.round(ms / 60_000)} min`
    return `Cada ${Math.round(ms / 3_600_000)} horas`
}

export function horarioApi(h: Horario): HorarioApi {
    const base = { tipo: h.tipo, cada_segundos: null, hora: null, dia: null, zona: ZONA }
    switch (h.tipo) {
        case 'cada':
            return { ...base, cada_segundos: Math.round(h.ms / 1000), texto: textoCada(h.ms) }
        case 'continuo':
            return {
                ...base,
                cada_segundos: Math.max(1, Math.round(h.ms / 1000)),
                texto: `Siempre activo (revisa ${textoCada(h.ms).toLowerCase()})`,
            }
        case 'diario':
            return { ...base, hora: h.hora, texto: `Todos los días a las ${h.hora}` }
        case 'mensual':
            return { ...base, hora: h.hora, dia: h.dia, texto: `El día ${h.dia} de cada mes a las ${h.hora}` }
    }
}

function vigilable(cron: CronCatalogo, h: Horario): CronVigilado | null {
    const base = { accion: cron.clave, descripcion: cron.nombre }
    if (h.tipo === 'cada') return { ...base, cadaMin: h.ms / 60_000 }
    if (h.tipo === 'diario') return { ...base, diario: h.hora }
    if (h.tipo === 'mensual') return { ...base, mensual: { dia: h.dia, hora: h.hora } }
    return null
}

/** Próxima corrida según el horario (sin BullMQ). */
export function proximaCalculada(
    h: Horario,
    ahora: DateTime,
    ultimoInicio: DateTime | null,
): DateTime | null {
    if (h.tipo === 'continuo') return null
    if (h.tipo === 'cada') {
        if (!ultimoInicio) return null
        const siguiente = ultimoInicio.plus({ milliseconds: h.ms })
        return siguiente < ahora ? ahora : siguiente
    }
    const [hora, minuto] = h.hora.split(':').map(Number) as [number, number]
    const local = ahora.setZone(ZONA)
    if (h.tipo === 'diario') {
        let s = local.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 })
        if (s <= local) s = s.plus({ days: 1 })
        return s.toUTC()
    }
    let s = local.set({ day: h.dia, hour: hora, minute: minuto, second: 0, millisecond: 0 })
    if (s <= local) s = s.plus({ months: 1 }).set({ day: h.dia })
    return s.toUTC()
}

async function seguro<T>(promesa: () => Promise<T>, siFalla: T, avisos: string[], aviso: string): Promise<T> {
    try {
        return await conTimeout(promesa(), TIEMPO_REDIS_MS)
    } catch {
        if (!avisos.includes(aviso)) avisos.push(aviso)
        return siFalla
    }
}

const AVISO_REDIS =
    'No se pudo leer Redis: la próxima corrida se calcula del horario y no se sabe quién tiene los locks de Redis ni qué jobs están activos.'

/** `GET /sistema/crons`. */
export async function listarCrons(opciones: { ahora?: Date } = {}): Promise<ListaCrons> {
    const ahoraJs = opciones.ahora ?? new Date()
    const ahora = DateTime.fromJSDate(ahoraJs).toUTC()
    const avisos: string[] = []
    const tolerancia = env.get('NOTIFY_CRON_TOLERANCIA_MIN') ?? TOLERANCIA_POR_DEFECTO_MIN

    const [ultimas, enCurso, correctas, auditoria, despliegue, outbox] = await Promise.all([
        db.rawQuery(
            `SELECT DISTINCT ON (clave) * FROM core.cron_corridas
             WHERE estado <> 'en_curso' ORDER BY clave, id DESC`,
        ),
        db.rawQuery(
            `SELECT DISTINCT ON (clave) * FROM core.cron_corridas
             WHERE estado = 'en_curso' ORDER BY clave, id DESC`,
        ),
        db.rawQuery(
            `SELECT clave, max(fin) AS fin FROM core.cron_corridas
             WHERE estado IN ('ok', 'sin_cambios') GROUP BY clave`,
        ),
        ultimasDeAuditoria(ahora),
        ultimoDespliegue(db.connection()),
        estadoOutbox(),
    ])
    const porClave = <T extends { clave: string }>(r: { rows: T[] }) =>
        new Map(r.rows.map((f) => [f.clave, f]))
    const ultimaPorClave = porClave(ultimas as { rows: FilaCorrida[] })
    const enCursoPorClave = porClave(enCurso as { rows: FilaCorrida[] })
    const correctaPorClave = porClave(correctas as { rows: Array<{ clave: string; fin: Date | null }> })

    // Próxima corrida de cada job scheduler, por cola (una lectura por cola).
    const proximas = new Map<string, number>()
    const agendados = new Set<string>()
    let redisLeido = true
    for (const cola of colasDeCrons()) {
        const schedulers = await seguro(
            () => colaCron(cola).getJobSchedulers(0, -1, true),
            null,
            avisos,
            AVISO_REDIS,
        )
        if (schedulers === null) {
            redisLeido = false
            continue
        }
        for (const s of schedulers) {
            agendados.add(`${cola}|${s.key}`)
            if (s.next) proximas.set(`${cola}|${s.key}`, Number(s.next))
        }
    }

    const data: CronApi[] = []
    for (const cron of CATALOGO_CRONS) {
        const h = cron.horario()
        const lock = await seguro(
            () => estadoLock(cron),
            null,
            avisos,
            cron.lock?.tipo === 'postgres' ? 'No se pudieron leer los locks de Postgres.' : AVISO_REDIS,
        )
        const filaEnCurso = enCursoPorClave.get(cron.clave)
        const tomado = lock ? lock.tomado : null
        const vivo =
            filaEnCurso && corridaViva(new Date(filaEnCurso.ultimo_inicio), tomado, ahoraJs.getTime())
                ? filaEnCurso
                : null

        // Última corrida: la más reciente entre la terminada y una `en_curso` interrumpida.
        let ultima: CorridaApi | null = null
        const fila = ultimaPorClave.get(cron.clave)
        if (fila) ultima = corridaDeFila(fila, tomado, ahoraJs.getTime())
        if (filaEnCurso && !vivo && (!fila || Number(filaEnCurso.id) > Number(fila.id))) {
            ultima = corridaDeFila(filaEnCurso, tomado, ahoraJs.getTime())
        }
        let ultimaCorrecta = correctaPorClave.get(cron.clave)?.fin ?? null
        const audit = cron.accion ? auditoria.get(cron.accion) : undefined
        if (!ultima && audit) {
            ultima = {
                id: null,
                clave: cron.clave,
                origen: 'programado',
                estado: audit.resultado === 'ok' ? 'ok' : 'error',
                inicio: iso(audit.ultima)!,
                primera: iso(audit.ultima)!,
                fin: iso(audit.ultima),
                duracion_ms: null,
                repeticiones: 1,
                resumen: null,
                error: audit.error,
                instancia: null,
                usuario_id: null,
                fuente: 'auditoria',
            }
        }
        if (audit?.ultima_ok && (!ultimaCorrecta || audit.ultima_ok > ultimaCorrecta)) {
            ultimaCorrecta = audit.ultima_ok
        }
        let nota: string | null = null
        if (cron.clave === 'sistema.relay_outbox') {
            if (outbox.publicado) {
                ultima = {
                    id: null,
                    clave: cron.clave,
                    origen: 'programado',
                    estado: 'ok',
                    inicio: iso(outbox.publicado)!,
                    primera: iso(outbox.publicado)!,
                    fin: iso(outbox.publicado),
                    duracion_ms: null,
                    repeticiones: 1,
                    resumen: 'Último evento publicado',
                    error: null,
                    instancia: null,
                    usuario_id: null,
                    fuente: 'auditoria',
                }
                ultimaCorrecta = outbox.publicado
            }
            nota =
                outbox.pendientes > 0
                    ? `${outbox.pendientes} eventos esperan publicarse`
                    : 'Sin eventos pendientes'
        }

        // Próxima corrida
        let proxima: string | null = null
        let proximaFuente: CronApi['proxima_fuente'] = null
        const llave = cron.bullmq ? `${cron.bullmq.cola}|${cron.bullmq.job}` : null
        if (h && llave && proximas.has(llave)) {
            proxima = new Date(proximas.get(llave)!).toISOString()
            proximaFuente = 'bullmq'
        } else if (h) {
            const ultimoInicio = ultima ? DateTime.fromISO(ultima.inicio) : null
            proxima = proximaCalculada(h, ahora, ultimoInicio)?.toISO() ?? null
            proximaFuente = proxima ? 'calculada' : null
        }
        if (h && llave && redisLeido && !agendados.has(llave)) {
            nota = `No está agendada en Redis: revisa que corra \`node ace ${cron.proceso}\`.`
        }

        // Atraso (regla de vigilar_crons)
        let atrasada = false
        if (h && cron.bullmq) {
            const v = vigilable(cron, h)
            if (v) {
                const correcta = ultimaCorrecta ? DateTime.fromJSDate(new Date(ultimaCorrecta)) : null
                atrasada = evaluarAtraso(v, ahora, correcta, despliegue, tolerancia).estado === 'atrasado'
            }
        } else if (cron.clave === 'sistema.relay_outbox' && outbox.viejo) {
            atrasada = ahoraJs.getTime() - outbox.viejo.getTime() > 5 * 60_000
        }

        let estado: EstadoCron
        if (!h) estado = 'apagada'
        else if (vivo) estado = 'en_curso'
        else if (ultima?.estado === 'error') estado = 'error'
        else if (atrasada) estado = 'atrasada'
        else if (ultima?.estado === 'ok' || ultima?.estado === 'sin_cambios') estado = ultima.estado
        else if (lock?.tipo === 'redis' && lock.tomado) estado = 'ok'
        else estado = 'sin_datos'

        if (!h) nota = 'Apagada por configuración (su periodo está en 0).'

        data.push({
            clave: cron.clave,
            nombre: cron.nombre,
            modulo: cron.modulo,
            modulo_nombre: MODULOS_CRON[cron.modulo],
            descripcion: cron.descripcion,
            proceso: cron.proceso,
            horario: h ? horarioApi(h) : null,
            activo: h !== null,
            manual: cron.manual,
            permisos: cron.permisos,
            estado,
            ultima,
            ultima_correcta: iso(ultimaCorrecta),
            proxima,
            proxima_fuente: proximaFuente,
            atrasada,
            en_curso: vivo
                ? {
                      corrida_id: Number(vivo.id),
                      desde: iso(vivo.ultimo_inicio)!,
                      instancia: vivo.instancia,
                      origen: vivo.origen,
                  }
                : null,
            lock: lock ? { ...lock, instancia: lock.tomado ? (vivo?.instancia ?? null) : null } : null,
            nota,
        })
    }
    return { data, avisos, generado_en: ahora.toISO()! }
}

interface UltimaAuditoria {
    ultima: Date
    resultado: 'ok' | 'error'
    error: string | null
    ultima_ok: Date | null
}

/** Última fila (y última correcta) de cada acción de cron en `audit.acciones`, últimos 35 días. */
async function ultimasDeAuditoria(ahora: DateTime): Promise<Map<string, UltimaAuditoria>> {
    const conAccion = CATALOGO_CRONS.filter((c) => c.accion)
    const resultado = new Map<string, UltimaAuditoria>()
    if (conAccion.length === 0) return resultado
    const desde = ahora.minus({ days: 35 }).toJSDate()
    const { rows } = (await db.rawQuery(
        `SELECT DISTINCT ON (a.accion) a.accion, a.created_at AS ultima, a.resultado, a.error,
                (SELECT max(o.created_at) FROM audit.acciones o
                  WHERE o.accion = a.accion AND o.canal = a.canal AND o.resultado = 'ok'
                    AND o.created_at > ?) AS ultima_ok
           FROM audit.acciones a
           JOIN unnest(?::text[], ?::text[]) AS c(accion, canal) ON c.accion = a.accion AND c.canal = a.canal
          WHERE a.created_at > ?
          ORDER BY a.accion, a.created_at DESC`,
        [desde, conAccion.map((c) => c.accion!), conAccion.map((c) => c.canalAuditoria ?? 'cron'), desde],
    )) as { rows: Array<UltimaAuditoria & { accion: string }> }
    for (const fila of rows) resultado.set(fila.accion, fila)
    return resultado
}

async function estadoOutbox(): Promise<{ publicado: Date | null; pendientes: number; viejo: Date | null }> {
    const [publicado, pendientes] = await Promise.all([
        db
            .from('audit.outbox')
            .whereNotNull('publicado_en')
            .orderBy('id', 'desc')
            .select('publicado_en')
            .first() as Promise<{ publicado_en: Date } | null>,
        db
            .from('audit.outbox')
            .whereNull('publicado_en')
            .count('* as n')
            .min('created_at as viejo')
            .first() as Promise<{ n: string | number; viejo: Date | null }>,
    ])
    return {
        publicado: publicado?.publicado_en ?? null,
        pendientes: Number(pendientes?.n ?? 0),
        viejo: pendientes?.viejo ? new Date(pendientes.viejo) : null,
    }
}

/** `GET /sistema/crons/:clave/corridas`: historial de corridas, de la más nueva a la más vieja. */
export async function corridasDeCron(
    clave: string,
    opciones: OpcionesPaginacion,
): Promise<Pagina<CorridaApi>> {
    const cron = buscarCron(clave)
    if (!cron) throw new NoEncontrado('No existe esa tarea programada')
    const pagina = await paginar<FilaCorrida>(
        db.from('core.cron_corridas').where('clave', clave).select('*'),
        opciones,
        { clave: (f) => Number(f.id) },
    )
    let tomado: boolean | null = null
    if (pagina.data.some((f) => f.estado === 'en_curso')) {
        try {
            const lock = await estadoLock(cron)
            tomado = lock?.tomado ?? null
        } catch {
            tomado = null
        }
    }
    return { data: pagina.data.map((f) => corridaDeFila(f, tomado)), nextCursor: pagina.nextCursor }
}
