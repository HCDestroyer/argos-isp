import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import type { VelocidadPlan } from '#network/velocidad'
import type { Transaccion } from '#shared/domain_action'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { registrarTramo } from '#network/historial'

/**
 * Promociones de velocidad (decisión del PM 18, 21 nov 2026): «promoción para gamers», duplicar el plan
 * por días o en horas específicas durante un tiempo.
 *
 * - **Definición** (`core.promociones_velocidad`): `multiplicador` (x2) o `plan_destino` (su velocidad);
 *   modo `dias` (todo el periodo `inicio`–`fin`) o `franja` (cada día de `franja_inicio` a `franja_fin`,
 *   hora de Guatemala, con `dias_semana` opcional: 1 = lunes … 7 = domingo; una franja que cruza la
 *   medianoche termina el día siguiente). Nunca cambia el precio, salvo `precio` (lo factura A3).
 * - **Tramos** (`core.promociones_velocidad_tramos`): cada intervalo en que la velocidad sube. El cron
 *   `promociones_velocidad` (cada minuto, con lock) cierra los vencidos y abre el que corresponde a
 *   ahora; la clave única `(promocion_id, servicio_id, inicio)` hace que repetir la corrida no duplique.
 * - **Velocidad efectiva**: mientras un tramo está abierto, `velocidadConPromocion` se aplica sobre la
 *   del plan (con las excepciones del router) en `aaa:user:*` (RADIUS), en el estado deseado de RouterOS
 *   (cola simple) y en el CoA de velocidad (`sesion.velocidad_solicitada`). No cambia `plan_id`: un plan
 *   temporal y una promoción conviven (la promoción se aplica sobre el plan vigente).
 * - Respeta el control de velocidad del router. Con velocidad por servicio (`radius_rate_limit`,
 *   `perfil_ppp`, `cola_simple`) sube la velocidad como se describe arriba. Con velocidad por plan
 *   (`pcq_plan`, `arbol_pcq`: la cola es del plan, compartida) **cambia el plan** del servicio al plan
 *   destino mientras dura el tramo y lo devuelve al cerrarlo (decisión del PM 34, mecánica de los planes
 *   temporales: `servicio.config_cambiada` con `campos: ['plan']` y `motivo: 'promocion_velocidad'`, sin
 *   cortar la sesión). Ahí un multiplicador no sirve: 422 `promocion_requiere_plan_destino`. En un
 *   router sin RADIUS con PPPoE, 422 `promocion_estrategia_incompatible` (cambiar el perfil del secret
 *   corta la sesión). La velocidad resultante no supera la capacidad del router (422
 *   `promocion_supera_capacidad`).
 * - Precio: el cambio de plan de la promoción no cambia el precio, salvo `precio`. Mientras el tramo
 *   está abierto, `plan_id` es el destino y el plan que se factura es `plan_original_id` del tramo
 *   (`sqlPlanFacturablePromocion`, para A3).
 */

export const ZONA_GUATEMALA = 'America/Guatemala'
export const TIPOS_VELOCIDAD_PROMOCION = ['multiplicador', 'plan_destino'] as const
export type TipoVelocidadPromocion = (typeof TIPOS_VELOCIDAD_PROMOCION)[number]
export const MODOS_PROMOCION = ['dias', 'franja'] as const
export type ModoPromocion = (typeof MODOS_PROMOCION)[number]

/** Lo que necesita la velocidad efectiva de un servicio con un tramo abierto. */
export interface PromocionVigente {
    tramo_id: number
    promocion_id: number
    multiplicador: number | null
    bajada_kbps: number | null
    subida_kbps: number | null
    rafaga_bajada_kbps: number | null
    rafaga_subida_kbps: number | null
}

/**
 * Subconsulta (columna `promocion`) con el tramo abierto del servicio `alias`: la usan `aaa` y el
 * estado deseado de RouterOS, así la velocidad sale de una sola regla.
 */
export function sqlPromocionVigente(alias: string): string {
    return `(SELECT json_build_object(
                'tramo_id', tr.id, 'promocion_id', pv.id,
                'multiplicador', pv.multiplicador::float8,
                'bajada_kbps', pd.bajada_kbps, 'subida_kbps', pd.subida_kbps,
                'rafaga_bajada_kbps', pd.rafaga_bajada_kbps, 'rafaga_subida_kbps', pd.rafaga_subida_kbps)
               FROM core.promociones_velocidad_tramos tr
               JOIN core.promociones_velocidad pv ON pv.id = tr.promocion_id
               LEFT JOIN network.planes pd ON pd.id = pv.plan_destino_id
              WHERE tr.servicio_id = ${alias}.id AND tr.estado = 'abierto' AND NOT tr.cambia_plan
              LIMIT 1)`
}

/**
 * Plan que se factura del servicio `alias` (interfaz para A3, decisión del PM 34): con un tramo de
 * promoción abierto que cambió el plan (`cambia_plan`) y el servicio todavía en el plan destino, el
 * plan original del tramo; si no, `plan_id`. La promoción no cambia el precio salvo `precio`.
 */
export function sqlPlanFacturablePromocion(alias: string): string {
    return `coalesce((SELECT tr.plan_original_id
                        FROM core.promociones_velocidad_tramos tr
                       WHERE tr.servicio_id = ${alias}.id AND tr.estado = 'abierto' AND tr.cambia_plan
                         AND tr.plan_destino_id = ${alias}.plan_id
                       LIMIT 1), ${alias}.plan_id)`
}

export function leerPromocion(valor: unknown): PromocionVigente | null {
    if (!valor || typeof valor !== 'object') return null
    const v = valor as Record<string, unknown>
    const n = (x: unknown) => (x === null || x === undefined ? null : Number(x))
    return {
        tramo_id: Number(v.tramo_id),
        promocion_id: Number(v.promocion_id),
        multiplicador: n(v.multiplicador),
        bajada_kbps: n(v.bajada_kbps),
        subida_kbps: n(v.subida_kbps),
        rafaga_bajada_kbps: n(v.rafaga_bajada_kbps),
        rafaga_subida_kbps: n(v.rafaga_subida_kbps),
    }
}

/**
 * Velocidad con la promoción: multiplica MIR y ráfagas (redondeado a kbps enteros) o toma las del plan
 * destino. Solo cambia la velocidad del estado `activo`: la de `limitado` sigue siendo la del plan. La
 * cadena fija del router (`rate_limit_override`) se deja de usar mientras dure (no se puede multiplicar).
 */
export function velocidadConPromocion(v: VelocidadPlan, p: PromocionVigente | null): VelocidadPlan {
    if (!p) return v
    if (p.multiplicador !== null) {
        const m = p.multiplicador
        const por = (x: number | null) => (x === null ? null : Math.round(x * m))
        return {
            ...v,
            bajada_kbps: Math.round(v.bajada_kbps * m),
            subida_kbps: Math.round(v.subida_kbps * m),
            rafaga_bajada_kbps: por(v.rafaga_bajada_kbps),
            rafaga_subida_kbps: por(v.rafaga_subida_kbps),
            rate_limit_override: null,
        }
    }
    if (p.bajada_kbps === null || p.subida_kbps === null) return v
    return {
        ...v,
        bajada_kbps: p.bajada_kbps,
        subida_kbps: p.subida_kbps,
        rafaga_bajada_kbps: p.rafaga_bajada_kbps,
        rafaga_subida_kbps: p.rafaga_subida_kbps,
        rate_limit_override: null,
    }
}

/*
|--------------------------------------------------------------------------
| Tramos
|--------------------------------------------------------------------------
*/

export interface DefinicionTiempo {
    modo: ModoPromocion
    inicio: Date
    fin: Date
    /** `HH:MM` o `HH:MM:SS`, hora de Guatemala */
    franja_inicio: string | null
    franja_fin: string | null
    /** 1 = lunes … 7 = domingo (ISO); null = todos */
    dias_semana: number[] | null
}

export interface Tramo {
    inicio: Date
    fin: Date
}

function horaMinuto(texto: string): { hour: number; minute: number } {
    const [h, m] = texto.split(':').map(Number)
    return { hour: h ?? 0, minute: m ?? 0 }
}

/**
 * Tramo que contiene `ahora` (inicio ≤ ahora < fin), o null. En `franja` mira la franja que empezó hoy y
 * la de ayer (si cruza la medianoche), en hora de Guatemala, recortadas a `inicio`–`fin`.
 */
export function tramoEn(def: DefinicionTiempo, ahora: Date): Tramo | null {
    if (ahora < def.inicio || ahora >= def.fin) return null
    if (def.modo === 'dias') return { inicio: def.inicio, fin: def.fin }
    const desde = horaMinuto(def.franja_inicio!)
    const hasta = horaMinuto(def.franja_fin!)
    const cruza = hasta.hour * 60 + hasta.minute <= desde.hour * 60 + desde.minute
    const local = DateTime.fromJSDate(ahora, { zone: ZONA_GUATEMALA }).startOf('day')
    for (const dia of [local, local.minus({ days: 1 })]) {
        if (def.dias_semana && !def.dias_semana.includes(dia.weekday)) continue
        const ini = dia.set({ ...desde, second: 0, millisecond: 0 })
        const fin = (cruza ? dia.plus({ days: 1 }) : dia).set({ ...hasta, second: 0, millisecond: 0 })
        const tramo = {
            inicio: new Date(Math.max(ini.toMillis(), def.inicio.getTime())),
            fin: new Date(Math.min(fin.toMillis(), def.fin.getTime())),
        }
        if (tramo.inicio <= ahora && ahora < tramo.fin) return tramo
    }
    return null
}

/** Próximo tramo que empieza después de `desde` (para la vista), o null. Mira hasta 400 días. */
export function proximoTramo(def: DefinicionTiempo, desde: Date): Tramo | null {
    if (desde >= def.fin) return null
    if (def.modo === 'dias') return def.inicio > desde ? { inicio: def.inicio, fin: def.fin } : null
    const desdeH = horaMinuto(def.franja_inicio!)
    const hastaH = horaMinuto(def.franja_fin!)
    const cruza = hastaH.hour * 60 + hastaH.minute <= desdeH.hour * 60 + desdeH.minute
    let dia = DateTime.fromJSDate(desde > def.inicio ? desde : def.inicio, { zone: ZONA_GUATEMALA }).startOf(
        'day',
    )
    for (let i = 0; i < 400; i++, dia = dia.plus({ days: 1 })) {
        if (def.dias_semana && !def.dias_semana.includes(dia.weekday)) continue
        const ini = dia.set({ ...desdeH, second: 0, millisecond: 0 }).toJSDate()
        if (ini >= def.fin) return null
        if (ini <= desde || ini < def.inicio) continue
        const fin = (cruza ? dia.plus({ days: 1 }) : dia).set({ ...hastaH, second: 0, millisecond: 0 })
        return { inicio: ini, fin: new Date(Math.min(fin.toMillis(), def.fin.getTime())) }
    }
    return null
}

/*
|--------------------------------------------------------------------------
| Vistas
|--------------------------------------------------------------------------
*/

export interface PromocionVelocidadVista {
    id: number
    empresa_id: number
    nombre: string
    descripcion: string | null
    tipo_velocidad: TipoVelocidadPromocion
    multiplicador: string | null
    plan_destino_id: number | null
    plan_destino_nombre: string | null
    modo: ModoPromocion
    inicio: string
    fin: string
    franja_inicio: string | null
    franja_fin: string | null
    dias_semana: number[] | null
    precio: string | null
    estado: 'activa' | 'cancelada'
    /** pestaña del tablero, calculada con las fechas en UTC (`vigenciaPromocion`) */
    vigencia: VigenciaPromocion
    /** tramo en curso según el horario (hora de Guatemala); null fuera de horario o si no está vigente */
    tramo_actual: { inicio: string; fin: string } | null
    /** siguiente tramo que empieza después de ahora; null si no hay otro */
    proximo_tramo: { inicio: string; fin: string } | null
    motivo_cancelacion: string | null
    cancelada_en: string | null
    creado_por: number | null
    servicios: number
    version: number
    created_at: string
    updated_at: string
}

/**
 * Pestañas del tablero de promociones: `cancelada` (estado), y de las activas `programada`
 * (`inicio` > ahora), `vigente` (`inicio` ≤ ahora < `fin`) o `terminada` (`fin` ≤ ahora). `inicio` y `fin`
 * son instantes (timestamptz), así que se comparan en UTC; la hora de Guatemala solo cuenta para la
 * franja diaria (`tramo_actual`, `proximo_tramo`).
 */
export const VIGENCIAS_PROMOCION = ['vigente', 'programada', 'terminada', 'cancelada'] as const
export type VigenciaPromocion = (typeof VIGENCIAS_PROMOCION)[number]

export function vigenciaPromocion(
    p: { estado: 'activa' | 'cancelada'; inicio: Date; fin: Date },
    ahora: Date,
): VigenciaPromocion {
    if (p.estado === 'cancelada') return 'cancelada'
    if (ahora < p.inicio) return 'programada'
    if (ahora >= p.fin) return 'terminada'
    return 'vigente'
}

/** Condición SQL de cada vigencia sobre `p` (con `?` = ahora, timestamptz). */
const SQL_VIGENCIA: Record<VigenciaPromocion, string> = {
    cancelada: `p.estado = 'cancelada'`,
    programada: `p.estado = 'activa' AND p.inicio > ?::timestamptz`,
    vigente: `p.estado = 'activa' AND p.inicio <= ?::timestamptz AND p.fin > ?::timestamptz`,
    terminada: `p.estado = 'activa' AND p.fin <= ?::timestamptz`,
}

function valoresVigencia(vigencia: VigenciaPromocion, ahora: Date): string[] {
    const n = (SQL_VIGENCIA[vigencia].match(/\?/g) ?? []).length
    return Array.from({ length: n }, () => ahora.toISOString())
}

export type ConteosVigencia = Record<VigenciaPromocion, number>

const instante = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null))
const hora = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : null)

function columnas(cliente: QueryClientContract) {
    return [
        'p.id',
        'p.empresa_id',
        'p.nombre',
        'p.descripcion',
        'p.tipo_velocidad',
        cliente.raw('p.multiplicador::text AS multiplicador'),
        'p.plan_destino_id',
        cliente.raw(
            '(SELECT pl.nombre FROM network.planes pl WHERE pl.id = p.plan_destino_id) AS plan_destino_nombre',
        ),
        'p.modo',
        'p.inicio',
        'p.fin',
        cliente.raw('p.franja_inicio::text AS franja_inicio'),
        cliente.raw('p.franja_fin::text AS franja_fin'),
        'p.dias_semana',
        cliente.raw('p.precio::text AS precio'),
        'p.estado',
        'p.motivo_cancelacion',
        'p.cancelada_en',
        'p.creado_por',
        cliente.raw(
            `(SELECT count(*)::int FROM core.promociones_velocidad_servicios ps
               WHERE ps.promocion_id = p.id AND ps.estado = 'vigente') AS servicios`,
        ),
        'p.version',
        'p.created_at',
        'p.updated_at',
    ]
}

function normalizar(f: Record<string, unknown>, ahora: Date = new Date()): PromocionVelocidadVista {
    const estado = f.estado as 'activa' | 'cancelada'
    const def: DefinicionTiempo = {
        modo: f.modo as ModoPromocion,
        inicio: new Date(f.inicio as Date | string),
        fin: new Date(f.fin as Date | string),
        franja_inicio: hora(f.franja_inicio),
        franja_fin: hora(f.franja_fin),
        dias_semana: Array.isArray(f.dias_semana) ? (f.dias_semana as unknown[]).map(Number) : null,
    }
    const vigencia = vigenciaPromocion({ estado, inicio: def.inicio, fin: def.fin }, ahora)
    const iso = (t: Tramo | null) => (t ? { inicio: t.inicio.toISOString(), fin: t.fin.toISOString() } : null)
    const activa = vigencia === 'vigente' || vigencia === 'programada'
    return {
        ...(f as unknown as PromocionVelocidadVista),
        vigencia,
        tramo_actual: vigencia === 'vigente' ? iso(tramoEn(def, ahora)) : null,
        proximo_tramo: activa ? iso(proximoTramo(def, ahora)) : null,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        plan_destino_id: f.plan_destino_id === null ? null : Number(f.plan_destino_id),
        creado_por: f.creado_por === null ? null : Number(f.creado_por),
        dias_semana: Array.isArray(f.dias_semana) ? (f.dias_semana as unknown[]).map(Number) : null,
        franja_inicio: hora(f.franja_inicio),
        franja_fin: hora(f.franja_fin),
        servicios: Number(f.servicios),
        version: Number(f.version),
        inicio: instante(f.inicio)!,
        fin: instante(f.fin)!,
        cancelada_en: instante(f.cancelada_en),
        created_at: instante(f.created_at)!,
        updated_at: instante(f.updated_at)!,
    }
}

export async function verPromocion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PromocionVelocidadVista> {
    const fila = (await cliente
        .from('core.promociones_velocidad as p')
        .where('p.id', id)
        .select(columnas(cliente))
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`La promoción de velocidad ${id} no existe`)
    return normalizar(fila)
}

/**
 * `GET /promociones-velocidad`: página por cursor (`p.id` descendente) filtrable por `estado` y por
 * `vigencia` (pestaña del tablero), con `conteos` por pestaña en la misma respuesta. Los conteos respetan
 * las empresas y la búsqueda `q`, no `estado` ni `vigencia` (son los números de las cuatro pestañas).
 */
export async function listarPromociones(
    filtro: {
        empresas: number[] | null
        estado?: 'activa' | 'cancelada'
        vigencia?: VigenciaPromocion
        q?: string
    },
    opciones: OpcionesPaginacion,
    ahora: Date = new Date(),
): Promise<Pagina<PromocionVelocidadVista> & { conteos: ConteosVigencia }> {
    const base = () => {
        const q = db.from('core.promociones_velocidad as p')
        if (filtro.empresas) q.whereIn('p.empresa_id', filtro.empresas)
        if (filtro.q) {
            const patron = `%${filtro.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
            q.where((w) => w.whereILike('p.nombre', patron).orWhereILike('p.descripcion', patron))
        }
        return q
    }
    const consulta = base().select(columnas(db.connection()))
    if (filtro.estado) consulta.where('p.estado', filtro.estado)
    if (filtro.vigencia) {
        consulta.whereRaw(SQL_VIGENCIA[filtro.vigencia], valoresVigencia(filtro.vigencia, ahora))
    }

    const conteo = base().select(
        ...VIGENCIAS_PROMOCION.map((v) =>
            db.raw(`count(*) FILTER (WHERE ${SQL_VIGENCIA[v]})::int AS ${v}`, valoresVigencia(v, ahora)),
        ),
    )
    const [pagina, filaConteo] = await Promise.all([
        paginar<Record<string, unknown>>(consulta, opciones, { columna: 'p.id', clave: (f) => Number(f.id) }),
        conteo.first() as Promise<Record<VigenciaPromocion, number> | null>,
    ])
    const conteos = Object.fromEntries(
        VIGENCIAS_PROMOCION.map((v) => [v, Number(filaConteo?.[v] ?? 0)]),
    ) as ConteosVigencia
    return { ...pagina, data: pagina.data.map((f) => normalizar(f, ahora)), conteos }
}

export interface PromocionServicioVista {
    id: number
    promocion_id: number
    promocion_nombre: string
    servicio_id: number
    empresa_id: number
    estado: 'vigente' | 'quitada'
    agregada_por: number | null
    quitada_en: string | null
    motivo: string | null
    created_at: string
    /** tramo abierto ahora (la velocidad de la promoción está aplicada), o null */
    tramo_abierto: { id: number; inicio: string; fin: string } | null
}

/** Asignaciones de un servicio (vigentes primero) o de una promoción. */
export async function listarAsignacionesPromocion(
    filtro: { servicio_id?: number; promocion_id?: number },
    opciones: OpcionesPaginacion,
): Promise<Pagina<PromocionServicioVista>> {
    const consulta = db
        .from('core.promociones_velocidad_servicios as a')
        .join('core.promociones_velocidad as p', 'p.id', 'a.promocion_id')
        .select(
            'a.id',
            'a.promocion_id',
            'p.nombre as promocion_nombre',
            'a.servicio_id',
            'a.empresa_id',
            'a.estado',
            'a.agregada_por',
            'a.quitada_en',
            'a.motivo',
            'a.created_at',
            db.raw(
                `(SELECT json_build_object('id', tr.id, 'inicio', tr.inicio, 'fin', tr.fin)
                    FROM core.promociones_velocidad_tramos tr
                   WHERE tr.promocion_id = a.promocion_id AND tr.servicio_id = a.servicio_id
                     AND tr.estado = 'abierto' LIMIT 1) AS tramo_abierto`,
            ),
        )
    if (filtro.servicio_id) consulta.where('a.servicio_id', filtro.servicio_id)
    if (filtro.promocion_id) consulta.where('a.promocion_id', filtro.promocion_id)
    const pagina = await paginar<Record<string, unknown>>(consulta, opciones, {
        columna: 'a.id',
        clave: (f) => Number(f.id),
    })
    return {
        ...pagina,
        data: pagina.data.map((f) => {
            const tramo = f.tramo_abierto as { id: number; inicio: string; fin: string } | null
            return {
                ...(f as unknown as PromocionServicioVista),
                id: Number(f.id),
                promocion_id: Number(f.promocion_id),
                servicio_id: Number(f.servicio_id),
                empresa_id: Number(f.empresa_id),
                agregada_por: f.agregada_por === null ? null : Number(f.agregada_por),
                quitada_en: instante(f.quitada_en),
                created_at: instante(f.created_at)!,
                tramo_abierto: tramo
                    ? {
                          id: Number(tramo.id),
                          inicio: new Date(tramo.inicio).toISOString(),
                          fin: new Date(tramo.fin).toISOString(),
                      }
                    : null,
            }
        }),
    }
}

/*
|--------------------------------------------------------------------------
| Reglas de asignación
|--------------------------------------------------------------------------
*/

export interface FilaPromocion {
    id: number
    empresa_id: number
    tipo_velocidad: TipoVelocidadPromocion
    multiplicador: string | null
    plan_destino_id: number | null
    modo: ModoPromocion
    inicio: Date
    fin: Date
    franja_inicio: string | null
    franja_fin: string | null
    dias_semana: number[] | null
    precio: string | null
    estado: 'activa' | 'cancelada'
    version: number
}

export async function bloquearPromocion(trx: TransactionClientContract, id: number): Promise<FilaPromocion> {
    const fila = (await trx
        .from('core.promociones_velocidad')
        .where('id', id)
        .forUpdate()
        .select(
            'id',
            'empresa_id',
            'tipo_velocidad',
            trx.raw('multiplicador::text AS multiplicador'),
            'plan_destino_id',
            'modo',
            'inicio',
            'fin',
            trx.raw('franja_inicio::text AS franja_inicio'),
            trx.raw('franja_fin::text AS franja_fin'),
            'dias_semana',
            trx.raw('precio::text AS precio'),
            'estado',
            'version',
        )
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`La promoción de velocidad ${id} no existe`)
    return {
        ...(fila as unknown as FilaPromocion),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        plan_destino_id: fila.plan_destino_id === null ? null : Number(fila.plan_destino_id),
        dias_semana: Array.isArray(fila.dias_semana) ? (fila.dias_semana as unknown[]).map(Number) : null,
        version: Number(fila.version),
    }
}

export function definicionTiempo(p: FilaPromocion): DefinicionTiempo {
    return {
        modo: p.modo,
        inicio: new Date(p.inicio),
        fin: new Date(p.fin),
        franja_inicio: p.franja_inicio,
        franja_fin: p.franja_fin,
        dias_semana: p.dias_semana,
    }
}

/** Promoción con la forma que `velocidadConPromocion` necesita (para validar antes de abrir). */
export async function promocionComoVigente(
    trx: QueryClientContract,
    p: Pick<FilaPromocion, 'id' | 'multiplicador' | 'plan_destino_id'>,
): Promise<PromocionVigente> {
    let destino: Record<string, unknown> | null = null
    if (p.plan_destino_id !== null) {
        destino = (await trx
            .from('network.planes')
            .where('id', p.plan_destino_id)
            .select('bajada_kbps', 'subida_kbps', 'rafaga_bajada_kbps', 'rafaga_subida_kbps')
            .first()) as Record<string, unknown> | null
    }
    return leerPromocion({
        tramo_id: 0,
        promocion_id: p.id,
        multiplicador: p.multiplicador === null ? null : Number(p.multiplicador),
        ...(destino ?? {}),
    })!
}

/** Solo estas estrategias tienen velocidad propia por servicio (`contratos/control-velocidad.md` §7). */
export const APLICACIONES_CON_PROMOCION = ['radius_rate_limit', 'perfil_ppp', 'cola_simple'] as const
/** Velocidad del plan (PCQ o árbol): la promoción cambia el plan del servicio (decisión del PM 34). */
export const APLICACIONES_POR_PLAN = ['pcq_plan', 'arbol_pcq'] as const

export interface Aplicabilidad {
    velocidad: VelocidadPlan
    /** true: router con velocidad por plan, el tramo cambia el plan del servicio al plan destino */
    cambia_plan: boolean
}

/**
 * Exige que la promoción se pueda aplicar al servicio sin romper el control de velocidad del router
 * (422 `promocion_estrategia_incompatible`, o `promocion_requiere_plan_destino` en un router con
 * velocidad por plan y una promoción con multiplicador) ni pasar su capacidad (422
 * `promocion_supera_capacidad`). Dice además si el tramo debe cambiar el plan.
 */
export function exigirPromocionAplicable(
    servicio: {
        servicio_id: number
        tipo_conexion: string
        aplicacion: string
        router_sin_radius: boolean
        estado: string
        velocidad: VelocidadPlan
        capacidad_bajada_kbps: number | null
        capacidad_subida_kbps: number | null
    },
    promocion: PromocionVigente,
    planDestinoId: number | null,
): Aplicabilidad {
    if (servicio.estado === 'retirado') {
        throw new ReglaNegocio(`El servicio ${servicio.servicio_id} está retirado`, 'servicio_retirado')
    }
    const porServicio = (APLICACIONES_CON_PROMOCION as readonly string[]).includes(servicio.aplicacion)
    const porPlan = (APLICACIONES_POR_PLAN as readonly string[]).includes(servicio.aplicacion)
    if ((!porServicio && !porPlan) || (servicio.tipo_conexion === 'pppoe' && servicio.router_sin_radius)) {
        throw new ReglaNegocio(
            `El servicio ${servicio.servicio_id} usa una velocidad que no es por servicio ` +
                `(${servicio.router_sin_radius ? 'router sin RADIUS' : servicio.aplicacion}): la promoción ` +
                'no se puede aplicar sin cambiar el control de velocidad del router',
            'promocion_estrategia_incompatible',
            [
                {
                    field: 'servicio_ids',
                    message: 'Control de velocidad del router incompatible',
                    rule: 'estrategia',
                },
            ],
        )
    }
    if (porPlan && planDestinoId === null) {
        throw new ReglaNegocio(
            `El router del servicio ${servicio.servicio_id} controla la velocidad por plan ` +
                `(${servicio.aplicacion}): un multiplicador no se puede aplicar. Usa una promoción con ` +
                '«plan destino»: el servicio pasa a ese plan mientras dura la promoción',
            'promocion_requiere_plan_destino',
            [
                {
                    field: 'plan_destino_id',
                    message: 'Indica el plan destino: el router controla la velocidad por plan (PCQ)',
                    rule: 'requerido',
                },
            ],
        )
    }
    const resultado = velocidadConPromocion(servicio.velocidad, promocion)
    const pasa =
        (servicio.capacidad_bajada_kbps !== null && resultado.bajada_kbps > servicio.capacidad_bajada_kbps) ||
        (servicio.capacidad_subida_kbps !== null && resultado.subida_kbps > servicio.capacidad_subida_kbps)
    if (pasa) {
        throw new ReglaNegocio(
            `Con la promoción, el servicio ${servicio.servicio_id} tendría ${resultado.bajada_kbps}/` +
                `${resultado.subida_kbps} kbps (bajada/subida), más que la capacidad del router ` +
                `(${servicio.capacidad_bajada_kbps ?? '—'}/${servicio.capacidad_subida_kbps ?? '—'} kbps)`,
            'promocion_supera_capacidad',
            [{ field: 'servicio_ids', message: 'Supera la capacidad del router', rule: 'capacidad' }],
        )
    }
    return { velocidad: resultado, cambia_plan: porPlan }
}

/**
 * Con `cambia_plan` (decisión del PM 34): el plan destino debe estar activo, disponible en el router
 * del servicio y ser compatible con el plan actual (mismo `dual_stack` y tamaño del prefijo
 * delegado: el cambio no mueve IPs ni prefijos, no corta la sesión), y el servicio no puede tener un
 * plan temporal programado o activo (los dos cambian `plan_id`). 422 `promocion_plan_incompatible` o
 * `promocion_con_plan_temporal`.
 */
export async function exigirPlanDestinoAplicable(
    trx: QueryClientContract,
    servicio: { servicio_id: number; router_id: number; plan_id: number },
    planDestinoId: number,
): Promise<void> {
    const { obtenerImplementacionPlan } = await import('#network/actions/obtener_implementacion_plan')
    const campo = [
        { field: 'servicio_ids', message: `Servicio ${servicio.servicio_id}`, rule: 'plan_destino' },
    ]
    const temporal = (await trx
        .from('core.servicios_planes_temporales')
        .where('servicio_id', servicio.servicio_id)
        .whereIn('estado', ['programado', 'activo'])
        .select('id')
        .first()) as { id: number } | null
    if (temporal) {
        throw new ReglaNegocio(
            `El servicio ${servicio.servicio_id} tiene el plan temporal ${temporal.id}: en un router con ` +
                'velocidad por plan, la promoción y el plan temporal no pueden cambiar el plan a la vez',
            'promocion_con_plan_temporal',
            campo,
        )
    }
    if (planDestinoId === servicio.plan_id) return
    const destino = await obtenerImplementacionPlan(planDestinoId, servicio.router_id, trx)
    if (!destino.activo) {
        throw new ReglaNegocio(`El plan ${destino.nombre} está inactivo`, 'plan_inactivo', campo)
    }
    const actual = await obtenerImplementacionPlan(servicio.plan_id, servicio.router_id, trx, {
        aunqueNoDisponible: true,
    })
    if (
        actual.dual_stack !== destino.dual_stack ||
        Number(actual.tamano_prefijo_delegado) !== Number(destino.tamano_prefijo_delegado)
    ) {
        throw new ReglaNegocio(
            `El plan destino ${destino.nombre} cambia IPv4/IPv6 o el tamaño del prefijo delegado del ` +
                `servicio ${servicio.servicio_id}: la promoción solo puede cambiar la velocidad`,
            'promocion_plan_incompatible',
            campo,
        )
    }
}

/*
|--------------------------------------------------------------------------
| Servicio, aplicación y cron
|--------------------------------------------------------------------------
*/

/** Datos del servicio para `exigirPromocionAplicable` (velocidad y estrategia de RouterOS). */
export async function datosServicioPromocion(trx: QueryClientContract, servicioId: number) {
    const { servicioRed } = await import('#network/routeros/consultas')
    const servicio = await servicioRed(servicioId, trx)
    if (!servicio) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    const router = (await trx
        .from('network.routers')
        .where('id', servicio.router_id)
        .select('modo_seguridad', 'capacidad_bajada_kbps', 'capacidad_subida_kbps')
        .first()) as {
        modo_seguridad: string
        capacidad_bajada_kbps: number | null
        capacidad_subida_kbps: number | null
    }
    const capacidad = (v: unknown) => (v === null || v === undefined || Number(v) <= 0 ? null : Number(v))
    return {
        servicio,
        datos: {
            servicio_id: servicio.servicio_id,
            router_id: servicio.router_id,
            plan_id: servicio.plan_id,
            tipo_conexion: servicio.tipo_conexion,
            aplicacion: servicio.estrategia.aplicacion,
            router_sin_radius: router.modo_seguridad === 'api',
            estado: servicio.estado,
            velocidad: servicio.velocidad,
            capacidad_bajada_kbps: capacidad(router.capacidad_bajada_kbps),
            capacidad_subida_kbps: capacidad(router.capacidad_subida_kbps),
        },
    }
}

export interface TramoPendiente {
    promocion_id: number
    servicio_id: number
    inicio: Date
    fin: Date
}

/**
 * Lo pendiente hasta `ahora` (cron `promociones_velocidad`): tramos abiertos cuyo `fin` ya pasó y, de
 * cada asignación vigente de una promoción activa, el tramo de ahora que todavía no se abrió (la clave
 * `(promocion_id, servicio_id, inicio)` no existe). Un tramo que se perdió entero (cron detenido) no se
 * abre: la velocidad no se aplica hacia atrás.
 */
export async function promocionesPendientes(
    ahora: Date,
    cliente: QueryClientContract = db.connection(),
): Promise<{ porCerrar: number[]; porAbrir: TramoPendiente[] }> {
    const porCerrar = (
        (await cliente
            .from('core.promociones_velocidad_tramos')
            .where('estado', 'abierto')
            .where('fin', '<=', ahora)
            .orderBy('fin')
            .orderBy('id')
            .select('id')) as Array<{ id: number }>
    ).map((f) => Number(f.id))

    const candidatos = (await cliente
        .from('core.promociones_velocidad_servicios as a')
        .join('core.promociones_velocidad as p', 'p.id', 'a.promocion_id')
        .join('core.servicios as s', 's.id', 'a.servicio_id')
        .where('a.estado', 'vigente')
        .where('p.estado', 'activa')
        .where('p.inicio', '<=', ahora)
        .where('p.fin', '>', ahora)
        .whereNot('s.estado', 'retirado')
        .orderBy('a.id')
        .select(
            'a.promocion_id',
            'a.servicio_id',
            'p.modo',
            'p.inicio',
            'p.fin',
            cliente.raw('p.franja_inicio::text AS franja_inicio'),
            cliente.raw('p.franja_fin::text AS franja_fin'),
            'p.dias_semana',
        )) as Array<Record<string, unknown>>
    const porAbrir: TramoPendiente[] = []
    for (const c of candidatos) {
        const tramo = tramoEn(
            {
                modo: c.modo as ModoPromocion,
                inicio: new Date(c.inicio as Date),
                fin: new Date(c.fin as Date),
                franja_inicio: c.franja_inicio as string | null,
                franja_fin: c.franja_fin as string | null,
                dias_semana: Array.isArray(c.dias_semana) ? (c.dias_semana as unknown[]).map(Number) : null,
            },
            ahora,
        )
        if (tramo && tramo.fin > ahora) {
            porAbrir.push({
                promocion_id: Number(c.promocion_id),
                servicio_id: Number(c.servicio_id),
                ...tramo,
            })
        }
    }
    if (porAbrir.length === 0) return { porCerrar, porAbrir }
    const { rows } = (await cliente.rawQuery(
        `SELECT t.promocion_id, t.servicio_id, t.inicio
           FROM core.promociones_velocidad_tramos t
           JOIN unnest(?::bigint[], ?::bigint[], ?::timestamptz[]) AS q (p, s, i)
             ON t.promocion_id = q.p AND t.servicio_id = q.s AND t.inicio = q.i`,
        [
            porAbrir.map((p) => p.promocion_id),
            porAbrir.map((p) => p.servicio_id),
            porAbrir.map((p) => p.inicio.toISOString()),
        ],
    )) as { rows: Array<{ promocion_id: number; servicio_id: number; inicio: Date }> }
    const existentes = new Set(
        rows.map((r) => `${r.promocion_id}:${r.servicio_id}:${new Date(r.inicio).getTime()}`),
    )
    return {
        porCerrar,
        porAbrir: porAbrir.filter(
            (p) => !existentes.has(`${p.promocion_id}:${p.servicio_id}:${p.inicio.getTime()}`),
        ),
    }
}

/**
 * Cambia `core.servicios.plan_id` de `de` a `a` por un tramo de promoción en un router con velocidad
 * por plan (decisión del PM 34), con la mecánica de los planes temporales: diff del servicio, tramo
 * del historial de asignaciones, `servicio.config_cambiada` (`campos: ['plan']`, `motivo:
 * 'promocion_velocidad'`, `promocion_id`, `tramo_id`; nunca `precio`: la promoción no lo cambia salvo
 * su `precio`, que factura A3) y `aaa:user:*` al confirmar. `coa` y RouterOS lo aplican como cualquier
 * cambio de plan, sin cortar la sesión. Con `silencioso` (retiro) solo devuelve el plan, sin evento.
 */
export async function cambiarPlanPorPromocion(
    t: Transaccion,
    datos: {
        servicioId: number
        empresaId: number
        de: number
        a: number
        promocionId: number
        tramoId: number
        tramo: string
        silencioso?: boolean
    },
): Promise<boolean> {
    if (datos.de === datos.a) return false
    await t.trx
        .from('core.servicios')
        .where('id', datos.servicioId)
        .update(
            (datos.silencioso
                ? { plan_id: datos.a }
                : {
                      plan_id: datos.a,
                      version: t.trx.knexRawQuery('version + 1'),
                      updated_at: t.trx.knexRawQuery('now()'),
                  }) as Record<string, unknown>,
        )
    await t.registrarCambios(
        { tipo: 'servicio', id: datos.servicioId },
        { plan_id: datos.de },
        { plan_id: datos.a },
    )
    if (datos.silencioso) return true
    await registrarTramo(t.trx, datos.servicioId, datos.tramo)
    await t.emit('servicio.config_cambiada', {
        servicio_id: datos.servicioId,
        empresa_id: datos.empresaId,
        campos: ['plan'],
        motivo: 'promocion_velocidad',
        promocion_id: datos.promocionId,
        tramo_id: datos.tramoId,
    })
    refrescarAaaAlConfirmar(t, { servicioId: datos.servicioId })
    return true
}
