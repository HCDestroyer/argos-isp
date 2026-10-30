import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { prefijoColas, redis } from '#shared/redis'
import { codificarCursor, decodificarCursor, type Pagina } from '#shared/paginacion'
import type { Transaccion } from '#shared/domain_action'
import type { ModoIpv6 } from '#core/consultas/servicios'
import {
    leerVelocidad,
    rateLimitServicio,
    velocidadEfectiva,
    type ControlVelocidad,
} from '#network/velocidad'
import {
    estrategiaEfectiva,
    estrategiasDeFila,
    leerExcepcion,
    velocidadAaa,
    velocidadConExtras,
    type VelocidadAaa,
} from '#network/estrategia_velocidad'

/**
 * Registro de autorización RADIUS de un `user_ppp` (tarea 9). Contrato con A2 en
 * `.claude/integration/contratos/aaa.md`; validador del lado de `aaa` en `services/aaa/src/servicio.ts`.
 *
 * - `construirRegistroAaa` arma el JSON desde Postgres (lo devuelve `GET /internal/aaa/servicio`).
 * - `publicarAaa(servicioIds)` lo escribe en Redis `aaa:user:<user_ppp>` (write-through, SIN TTL).
 *   Un servicio retirado se escribe como lápida. La escritura compara `version`: nunca pisa un
 *   registro del mismo servicio con `version` mayor (un gancho atrasado no deja datos viejos).
 * - `refrescarAaaAlConfirmar(t, ...)` agenda la publicación después del COMMIT de la acción.
 */

export interface PlanAaa {
    id: number
    subida_kbps: number
    bajada_kbps: number
    subida_limitada_kbps: number
    bajada_limitada_kbps: number
    rate_limit_override: string | null
    profile_ppp: string | null
    /**
     * `Mikrotik-Rate-Limit` completo en estado activo (semana 2, `contratos/velocidad.md`):
     * `rateLimitServicio(planEfectivo, 'activo')`; si hay `rate_limit_override`, es esa cadena
     */
    rate_limit: string
    /** `Mikrotik-Rate-Limit` completo en estado limitado: `rateLimitServicio(planEfectivo, 'limitado')` */
    rate_limit_limitado: string
    /** reuso efectivo 1:N en el router (con reuso > 1 en modo `simple`, `Mikrotik-Group = plan-<id>`) */
    reuso: number
}

export type Ipv4Aaa = { modo: 'estatico'; ip: string } | { modo: 'pool'; pool: string } | null

export type Ipv6Aaa =
    | { modo: 'radius_servicio'; prefijo_enlace: string | null; prefijo_delegado: string | null }
    | { modo: 'radius_pool'; pool_enlace: string | null; pool_delegacion: string | null }
    | { modo: 'duid' | 'estatico' | 'ninguno' }

export interface RegistroAaa {
    servicio_id: number
    version: number
    user_ppp: string
    /** cifrada v1 tal como está en `core.servicios.pass_ppp`; nunca en claro */
    pass_ppp: string
    estado: EstadoServicioConPendiente
    router_id: number
    /** `network.routers.control_velocidad` del router del servicio (derivado, obsoleto) */
    control_velocidad: ControlVelocidad
    /**
     * Cómo se limita el servicio según la estrategia PPPoE del router y del plan
     * (`contratos/control-velocidad.md` §7): perfil (`Mikrotik-Group`) y si va `Mikrotik-Rate-Limit`.
     */
    velocidad: VelocidadAaa
    plan: PlanAaa
    ipv4: Ipv4Aaa
    ipv6: Ipv6Aaa
}

/**
 * Lápida del contrato (`eliminado`, `user_ppp`). Lleva además `servicio_id` y `version` para
 * que una escritura atrasada no la reemplace; `aaa` ignora esos dos campos.
 */
export interface LapidaAaa {
    eliminado: true
    user_ppp: string
    servicio_id: number
    version: number
}

/** Prefijo de las claves. Producción: `aaa:user:` (contrato). Pruebas: con el prefijo de colas. */
export function prefijoAaa(): string {
    const configurado = env.get('AAA_REDIS_PREFIJO')
    if (configurado) return configurado
    return env.get('NODE_ENV') === 'test' ? `${prefijoColas()}:aaa:user:` : 'aaa:user:'
}

export function claveAaa(userPpp: string): string {
    return `${prefijoAaa()}${userPpp}`
}

interface FilaAaa {
    servicio_id: number
    version: number
    user_ppp: string
    pass_ppp: string
    estado: EstadoServicioConPendiente
    router_id: number
    ipv6_modo: ModoIpv6 | null
    plan_id: number
    subida_kbps: number
    bajada_kbps: number
    subida_limitada_kbps: number
    bajada_limitada_kbps: number
    rate_limit_override: string | null
    profile_ppp: string | null
    control_velocidad: ControlVelocidad
    estrategia_velocidad: unknown
    pr_estrategia_velocidad: unknown
    reuso: number
    garantizado_pct: number | null
    rafaga_bajada_kbps: number | null
    rafaga_subida_kbps: number | null
    rafaga_umbral_pct: number
    rafaga_segundos: number
    prioridad: number
    pr_reuso: number | null
    pr_garantizado_pct: number | null
    pr_rafaga_bajada_kbps: number | null
    pr_rafaga_subida_kbps: number | null
    pr_rafaga_umbral_pct: number | null
    pr_rafaga_segundos: number | null
    pr_prioridad: number | null
    pool_ipv4: string | null
    pool_ipv6_enlace: string | null
    pool_ipv6_delegacion: string | null
    ipv4: string | null
    prefijo_enlace: string | null
    prefijo_delegado: string | null
}

/**
 * Solo servicios `pppoe`: un servicio sin PPPoE (`ip_estatica`, `dhcp_fija`) no pasa por RADIUS,
 * así que para `aaa` es inexistente (404 en el endpoint, nada en Redis). Al dejar de ser PPPoE,
 * `EditarServicio` escribe la lápida (sin credenciales) en la clave del `user_ppp` viejo.
 */
function consultaBase(cliente: QueryClientContract) {
    return cliente
        .from('core.servicios as s')
        .where('s.tipo_conexion', 'pppoe')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .join('network.routers as r', 'r.id', 's.router_id')
        .leftJoin('network.planes_routers as pr', (j) =>
            j.on('pr.plan_id', '=', 's.plan_id').andOn('pr.router_id', '=', 's.router_id'),
        )
        .select(
            's.id as servicio_id',
            's.version',
            's.user_ppp',
            's.pass_ppp',
            's.estado',
            's.router_id',
            's.ipv6_modo',
            'p.id as plan_id',
            'p.subida_kbps',
            'p.bajada_kbps',
            'p.subida_limitada_kbps',
            'p.bajada_limitada_kbps',
            'pr.rate_limit_override',
            'pr.profile_ppp',
            'r.control_velocidad',
            'r.estrategia_velocidad',
            'pr.estrategia_velocidad as pr_estrategia_velocidad',
            'p.reuso',
            cliente.raw('p.garantizado_pct::float8 AS garantizado_pct'),
            'p.rafaga_bajada_kbps',
            'p.rafaga_subida_kbps',
            'p.rafaga_umbral_pct',
            'p.rafaga_segundos',
            'p.prioridad',
            'pr.reuso as pr_reuso',
            cliente.raw('pr.garantizado_pct::float8 AS pr_garantizado_pct'),
            'pr.rafaga_bajada_kbps as pr_rafaga_bajada_kbps',
            'pr.rafaga_subida_kbps as pr_rafaga_subida_kbps',
            'pr.rafaga_umbral_pct as pr_rafaga_umbral_pct',
            'pr.rafaga_segundos as pr_rafaga_segundos',
            'pr.prioridad as pr_prioridad',
            'pr.pool_ipv4',
            'pr.pool_ipv6_enlace',
            'pr.pool_ipv6_delegacion',
            cliente.raw(
                `(SELECT host(a.ip) FROM network.ipv4_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL ORDER BY a.id DESC LIMIT 1) AS ipv4`,
            ),
            cliente.raw(
                `(SELECT a.prefijo::text FROM network.ipv6_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'enlace' LIMIT 1) AS prefijo_enlace`,
            ),
            cliente.raw(
                `(SELECT a.prefijo::text FROM network.ipv6_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'delegacion' LIMIT 1) AS prefijo_delegado`,
            ),
        )
}

const nulo = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : v)

function aRegistro(f: FilaAaa): RegistroAaa {
    let ipv4: Ipv4Aaa = null
    if (f.ipv4) ipv4 = { modo: 'estatico', ip: f.ipv4 }
    else if (nulo(f.pool_ipv4)) ipv4 = { modo: 'pool', pool: f.pool_ipv4! }

    const modo: ModoIpv6 = f.ipv6_modo ?? 'ninguno'
    let ipv6: Ipv6Aaa
    if (modo === 'radius_servicio') {
        ipv6 = {
            modo,
            prefijo_enlace: nulo(f.prefijo_enlace),
            prefijo_delegado: nulo(f.prefijo_delegado),
        }
    } else if (modo === 'radius_pool') {
        ipv6 = {
            modo,
            pool_enlace: nulo(f.pool_ipv6_enlace),
            pool_delegacion: nulo(f.pool_ipv6_delegacion),
        }
    } else {
        ipv6 = { modo }
    }

    const velocidad = velocidadEfectiva(leerVelocidad(f as unknown as Record<string, unknown>), {
        reuso: f.pr_reuso,
        garantizado_pct: f.pr_garantizado_pct,
        rafaga_bajada_kbps: f.pr_rafaga_bajada_kbps,
        rafaga_subida_kbps: f.pr_rafaga_subida_kbps,
        rafaga_umbral_pct: f.pr_rafaga_umbral_pct,
        rafaga_segundos: f.pr_rafaga_segundos,
        prioridad: f.pr_prioridad,
    })

    // Estrategia PPPoE del router y del plan (`contratos/control-velocidad.md`): los extras apagados
    // quitan ráfaga, prioridad o garantizado de la cadena; `velocidad` dice qué atributos manda `aaa`.
    const estrategias = estrategiasDeFila(f.estrategia_velocidad, f.control_velocidad)
    const estrategia = estrategiaEfectiva(estrategias, leerExcepcion(f.pr_estrategia_velocidad), 'pppoe')
    const conExtras = velocidadConExtras(velocidad, estrategia.extras)

    return {
        servicio_id: Number(f.servicio_id),
        version: Number(f.version),
        user_ppp: f.user_ppp,
        pass_ppp: f.pass_ppp,
        estado: f.estado,
        router_id: Number(f.router_id),
        control_velocidad: estrategia.aplicacion === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
        velocidad: velocidadAaa(estrategia, Number(f.plan_id), velocidad.reuso, nulo(f.profile_ppp)),
        plan: {
            id: Number(f.plan_id),
            subida_kbps: f.subida_kbps,
            bajada_kbps: f.bajada_kbps,
            subida_limitada_kbps: f.subida_limitada_kbps,
            bajada_limitada_kbps: f.bajada_limitada_kbps,
            rate_limit_override: nulo(f.rate_limit_override),
            profile_ppp: nulo(f.profile_ppp),
            rate_limit: rateLimitServicio(conExtras, 'activo'),
            rate_limit_limitado: rateLimitServicio(conExtras, 'limitado'),
            reuso: velocidad.reuso,
        },
        ipv4,
        ipv6,
    }
}

/** Registro de un `user_ppp` (null si no existe). Un retirado se devuelve con `estado: retirado`. */
export async function construirRegistroAaa(
    userPpp: string,
    cliente: QueryClientContract = db.connection(),
): Promise<RegistroAaa | null> {
    const fila = (await consultaBase(cliente).where('s.user_ppp', userPpp).first()) as FilaAaa | null
    return fila ? aRegistro(fila) : null
}

export async function registrosAaaPorServicio(
    servicioIds: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<RegistroAaa[]> {
    if (servicioIds.length === 0) return []
    const filas = (await consultaBase(cliente).whereIn('s.id', servicioIds)) as FilaAaa[]
    return filas.map(aRegistro)
}

/** Registros de varios `user_ppp` (los inexistentes se omiten), en el orden pedido. */
export async function registrosAaaPorUserPpp(
    usuarios: string[],
    cliente: QueryClientContract = db.connection(),
): Promise<RegistroAaa[]> {
    const unicos = [...new Set(usuarios)]
    if (unicos.length === 0) return []
    const filas = (await consultaBase(cliente).whereIn('s.user_ppp', unicos)) as FilaAaa[]
    const porUsuario = new Map(filas.map((f) => [f.user_ppp, aRegistro(f)]))
    return unicos.flatMap((u) => porUsuario.get(u) ?? [])
}

/**
 * Página de registros de todos los servicios `pppoe` (también retirados), por `servicio_id`
 * ascendente: base de `POST /internal/aaa/servicios` sin lista y de `node ace aaa:repoblar`.
 */
export async function paginaRegistrosAaa(
    opciones: { cursor?: string | null; limit: number },
    cliente: QueryClientContract = db.connection(),
): Promise<Pagina<RegistroAaa>> {
    const consulta = consultaBase(cliente)
    if (opciones.cursor) consulta.where('s.id', '>', decodificarCursor(opciones.cursor))
    const filas = (await consulta.orderBy('s.id', 'asc').limit(opciones.limit + 1)) as FilaAaa[]
    const hayMas = filas.length > opciones.limit
    const data = (hayMas ? filas.slice(0, opciones.limit) : filas).map(aRegistro)
    const ultimo = data.at(-1)
    return { data, nextCursor: hayMas && ultimo ? codificarCursor(ultimo.servicio_id) : null }
}

/**
 * SET condicionado: no reemplaza un registro (o lápida) del MISMO servicio con `version` mayor.
 * KEYS[1] = clave; ARGV = json, servicio_id, version.
 */
const SCRIPT_SET = `
local actual = redis.call('GET', KEYS[1])
if actual then
    local ok, previo = pcall(cjson.decode, actual)
    if ok and type(previo) == 'table' and tonumber(previo['servicio_id']) == tonumber(ARGV[2])
        and tonumber(previo['version']) ~= nil and tonumber(previo['version']) > tonumber(ARGV[3]) then
        return 0
    end
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`

/** Lo que se guarda en Redis para el registro: el JSON del contrato o la lápida si está retirado. */
export function valorRedis(registro: RegistroAaa): RegistroAaa | LapidaAaa {
    if (registro.estado === 'retirado') {
        return {
            eliminado: true,
            user_ppp: registro.user_ppp,
            servicio_id: registro.servicio_id,
            version: registro.version,
        }
    }
    return registro
}

export interface ResultadoEscritura {
    /** claves escritas */
    escritos: number
    /** no escritas porque Redis ya tenía una `version` mayor del mismo servicio */
    omitidos: number
}

/**
 * SET condicionado por `version` de cada valor (ver `SCRIPT_SET`). Con `forzar`, SET simple:
 * solo para repoblar tras restaurar la base desde un respaldo (las versiones en Redis podrían ser
 * mayores que las de Postgres).
 */
export async function escribirRegistrosAaa(
    valores: Array<RegistroAaa | LapidaAaa>,
    opciones: { forzar?: boolean } = {},
): Promise<ResultadoEscritura> {
    if (valores.length === 0) return { escritos: 0, omitidos: 0 }
    const conexion = redis()
    const tuberia = conexion.pipeline()
    for (const valor of valores) {
        if (opciones.forzar) {
            tuberia.set(claveAaa(valor.user_ppp), JSON.stringify(valor))
            continue
        }
        tuberia.eval(
            SCRIPT_SET,
            1,
            claveAaa(valor.user_ppp),
            JSON.stringify(valor),
            String(valor.servicio_id),
            String(valor.version),
        )
    }
    const resultados = (await tuberia.exec()) ?? []
    const error = resultados.find(([e]) => e)?.[0]
    if (error) throw error
    const escritos = resultados.filter(([, r]) => r === 1 || r === 'OK').length
    return { escritos, omitidos: valores.length - escritos }
}

export interface ResumenRepoblado {
    /** servicios `pppoe` leídos de Postgres (incluye retirados) */
    servicios: number
    /** de ellos, retirados (se escriben como lápida) */
    lapidas: number
    escritos: number
    /** no escritos: Redis tenía una `version` mayor (cambio posterior a la lectura) */
    omitidos: number
    lotes: number
    /** claves `aaa:user:*` sin servicio `pppoe` con ese `user_ppp` que no son lápida (solo se informan) */
    huerfanas: string[]
    duracion_ms: number
}

/**
 * Reescribe en Redis todas las claves `aaa:user:*` desde Postgres, por lotes de `lote` servicios
 * (`node ace aaa:repoblar`). Idempotente: usa el mismo SET condicionado que el write-through, así
 * que puede correr con la API atendiendo (nunca deja un dato más viejo que el que había). Al
 * final busca claves huérfanas (sin servicio y que no son lápida) y las informa sin borrarlas.
 */
export async function repoblarAaa(
    opciones: { lote?: number; forzar?: boolean; alAvanzar?: (resumen: ResumenRepoblado) => void } = {},
): Promise<ResumenRepoblado> {
    const inicio = Date.now()
    const lote = opciones.lote ?? 500
    const resumen: ResumenRepoblado = {
        servicios: 0,
        lapidas: 0,
        escritos: 0,
        omitidos: 0,
        lotes: 0,
        huerfanas: [],
        duracion_ms: 0,
    }
    const usuarios = new Set<string>()
    let cursor: string | null = null
    do {
        const pagina: Pagina<RegistroAaa> = await paginaRegistrosAaa({ cursor, limit: lote })
        const valores = pagina.data.map(valorRedis)
        const resultado = await escribirRegistrosAaa(valores, { forzar: opciones.forzar })
        for (const r of pagina.data) usuarios.add(r.user_ppp)
        resumen.servicios += pagina.data.length
        resumen.lapidas += valores.filter((v) => 'eliminado' in v).length
        resumen.escritos += resultado.escritos
        resumen.omitidos += resultado.omitidos
        resumen.lotes++
        opciones.alAvanzar?.(resumen)
        cursor = pagina.nextCursor
    } while (cursor)

    resumen.huerfanas = await clavesHuerfanas(usuarios)
    resumen.duracion_ms = Date.now() - inicio
    return resumen
}

/** `user_ppp` de claves `aaa:user:*` que no están en `conocidos` y no son lápida. */
async function clavesHuerfanas(conocidos: Set<string>): Promise<string[]> {
    const conexion = redis()
    const prefijo = prefijoAaa()
    const patron = `${prefijo.replace(/[*?[\]\\]/g, '\\$&')}*`
    const huerfanas: string[] = []
    let cursor = '0'
    do {
        const [siguiente, claves] = await conexion.scan(cursor, 'MATCH', patron, 'COUNT', 1000)
        cursor = siguiente
        const candidatas = claves.filter((c) => !conocidos.has(c.slice(prefijo.length)))
        if (candidatas.length === 0) continue
        const valores = await conexion.mget(...candidatas)
        candidatas.forEach((clave, i) => {
            const valor = valores[i]
            if (valor === null || valor === undefined) return
            try {
                if ((JSON.parse(valor) as { eliminado?: boolean }).eliminado === true) return
            } catch {
                // un valor que no es JSON también es huérfano
            }
            huerfanas.push(clave.slice(prefijo.length))
        })
    } while (cursor !== '0')
    return huerfanas.sort()
}

/** Lee de Postgres y escribe en Redis los registros de esos servicios (write-through). */
export async function publicarAaa(servicioIds: Iterable<number>): Promise<void> {
    const ids = [...new Set(servicioIds)]
    const LOTE = 500
    for (let i = 0; i < ids.length; i += LOTE) {
        const registros = await registrosAaaPorServicio(ids.slice(i, i + LOTE))
        await escribirRegistrosAaa(registros.map(valorRedis))
    }
}

/** Lápida en la clave de un `user_ppp` que dejó de existir (borrado o renombrado). */
export async function escribirLapidaAaa(userPpp: string, servicioId: number, version: number) {
    await escribirRegistrosAaa([{ eliminado: true, user_ppp: userPpp, servicio_id: servicioId, version }])
}

export type ObjetivoAaa =
    | { servicioId: number }
    | { planId: number; routerId?: number }
    /** Todos los servicios de un router (cambió su estrategia de control de velocidad) */
    | { routerId: number }
    | { lapida: { userPpp: string; servicioId: number; version: number } }

async function idsDeObjetivo(objetivo: ObjetivoAaa): Promise<number[]> {
    if ('servicioId' in objetivo) return [objetivo.servicioId]
    if (!('planId' in objetivo) && 'routerId' in objetivo) {
        const filas = (await db
            .from('core.servicios')
            .where('router_id', objetivo.routerId)
            .whereNot('estado', 'retirado')
            .select('id')) as Array<{ id: number }>
        return filas.map((f) => Number(f.id))
    }
    if ('planId' in objetivo) {
        const filas = (await db
            .from('core.servicios')
            .where('plan_id', objetivo.planId)
            .if(objetivo.routerId !== undefined, (q) => q.where('router_id', objetivo.routerId!))
            .whereNot('estado', 'retirado')
            .select('id')) as Array<{ id: number }>
        return filas.map((f) => Number(f.id))
    }
    return []
}

/** Publica en Redis lo que afecta el objetivo. Los errores se registran: el cambio ya se confirmó. */
export async function refrescarAaa(objetivos: ObjetivoAaa[]): Promise<void> {
    const ids = new Set<number>()
    for (const objetivo of objetivos) {
        if ('lapida' in objetivo) {
            const { userPpp, servicioId, version } = objetivo.lapida
            await escribirLapidaAaa(userPpp, servicioId, version)
            continue
        }
        for (const id of await idsDeObjetivo(objetivo)) ids.add(id)
    }
    await publicarAaa(ids)
}

/**
 * Agenda `refrescarAaa` para después del COMMIT. Si Redis falla, el consumidor del grupo
 * `aaa-cache` (eventos `servicio.*` y `asignacion.cambiada`) vuelve a escribir la clave.
 */
export function refrescarAaaAlConfirmar(t: Transaccion, ...objetivos: ObjetivoAaa[]): void {
    t.alConfirmar(async () => {
        try {
            await refrescarAaa(objetivos)
        } catch (error) {
            logger.warn({ err: error, objetivos }, 'No se pudo escribir aaa:user:* en Redis')
            throw error
        }
    })
}
