import { descifrar } from '#shared/cifrado'
import type { ModoSeguridad } from '#network/modo_seguridad'
import { rateLimitServicio } from '#network/velocidad'
import {
    familia,
    nombreTipoHoja,
    padreCliente,
    velocidadConExtras,
    type Estrategia,
} from '#network/estrategia_velocidad'
import type { ClienteRouterOS, ContextoRed, ObjetoRouterOS, Propiedades } from '#network/routeros/cliente'
import { diferencias } from '#network/routeros/normalizar'
import { RouterOSSolicitud } from '#network/routeros/errores'
import { configCorte, estadoCorteRouter } from '#network/routeros/corte_router'
import { perfilSuspendido } from '#network/routeros/dispatcher'
import { idSesionSondeo } from '#network/sesiones/sesiones'
import {
    commentServicio,
    servicioDeComment,
    type PerfilSuspendidoRed,
    type ServicioRed,
} from '#network/routeros/estado_deseado'
import {
    claveTexto,
    commentPlan,
    listaPlan,
    nombrePerfil,
    type ObjetoVelocidad,
    type PlanRouter,
} from '#network/routeros/velocidad_router'

/**
 * PPPoE sin RADIUS (`.claude/integration/contratos/pppoe-local.md`): en un router con
 * `modo_seguridad = 'api'` cada servicio `pppoe` es un `/ppp/secret` local que ArgosIsp administra
 * por la API REST, y la velocidad vive en los perfiles `plan-<id>` / `plan-<id>-limitado`.
 *
 * Funciones puras (estado deseado del secret y de los perfiles) y la aplicación idempotente del
 * secret de un servicio, con la desconexión de su sesión cuando cambia lo que solo se toma al
 * conectar (perfil, direcciones, nombre).
 */

export type { ModoSeguridad }

/** Perfil limitado del plan: `plan-<id>-limitado`. */
export function nombrePerfilLimitado(planId: number): string {
    return `${nombrePerfil(planId)}-limitado`
}

export function commentPerfilLimitado(planId: number): string {
    return `${commentPlan(planId)}:limitado`
}

/**
 * Estrategia PPPoE efectiva en un router sin RADIUS (`contratos/pppoe-local.md` §5): sin RADIUS no hay
 * `Mikrotik-Rate-Limit` ni CoA, así que `radius_rate_limit` (el valor por defecto de un router) se
 * aplica como `perfil_ppp` con el mismo padre, tipo de cola y extras. `pcq_plan` también: su cola PCQ
 * necesita las direcciones de la sesión al conectar, y sin accounting llegarían recién con el sondeo
 * (la API la rechaza en un router `api`; esto cubre datos de antes del cambio de modo).
 */
export function estrategiaLocal(e: Estrategia): Estrategia {
    if (e.aplicacion !== 'radius_rate_limit' && e.aplicacion !== 'pcq_plan') return e
    return {
        ...e,
        aplicacion: 'perfil_ppp',
        tipo_cola: e.tipo_cola === 'pcq' ? 'default' : e.tipo_cola,
        extras: { ...e.extras },
    }
}

/** Pools del plan en el router (`network.planes_routers`): van en el perfil (un secret no los admite). */
export interface PoolsPlan {
    ipv4: string | null
    enlace: string | null
    delegado: string | null
}

/**
 * Perfiles `plan-<id>` y `plan-<id>-limitado` de los planes con PPPoE en un router sin RADIUS:
 *
 * | Familia | `plan-<id>` | `plan-<id>-limitado` |
 * | --- | --- | --- |
 * | colas simples (`perfil_ppp`) | `rate-limit` activo, `parent-queue`, `queue-type` | `rate-limit` limitado, mismo padre |
 * | árbol (`arbol_pcq`) | `address-list = argosisp-plan-<id>` | `address-list = argosisp-plan-<id>-limitado` |
 *
 * Los dos copian pools, DNS e IPv6 del perfil `default` (`base`) y ponen los pools del plan en el
 * router si los tiene. Un perfil que el control de velocidad conserva (regla de oro incumplida) se
 * conserva también en su variante limitada.
 */
export function perfilesLocales(
    planes: PlanRouter[],
    base: Propiedades,
    conservados: Set<string>,
): { presentes: ObjetoVelocidad[]; conservar: string[] } {
    const presentes: ObjetoVelocidad[] = []
    const conservar: string[] = []
    const vistos = new Set<number>()
    for (const plan of [...planes].sort((a, b) => a.plan_id - b.plan_id)) {
        const e = plan.perfil
        if (!e || vistos.has(plan.plan_id)) continue
        vistos.add(plan.plan_id)
        const id = plan.plan_id
        const claveBase = `/ppp/profile|${claveTexto({ comment: commentPlan(id) })}`
        const claveLimitado = `/ppp/profile|${claveTexto({ comment: commentPerfilLimitado(id) })}`
        if (conservados.has(claveBase)) {
            conservar.push(claveBase, claveLimitado)
            continue
        }
        const pools = plan.pools ?? null
        const comun: Propiedades = {
            ...base,
            ...(pools?.ipv4 ? { 'remote-address': pools.ipv4 } : {}),
            ...(pools?.enlace ? { 'remote-ipv6-prefix-pool': pools.enlace } : {}),
            ...(pools?.delegado ? { 'dhcpv6-pd-pool': pools.delegado } : {}),
        }
        for (const limitado of [false, true]) {
            const nombre = limitado ? nombrePerfilLimitado(id) : nombrePerfil(id)
            const comment = limitado ? commentPerfilLimitado(id) : commentPlan(id)
            let propiedades: Propiedades
            if (familia(e.aplicacion) === 'arbol') {
                // El router mete la IPv4 de la sesión en la lista del plan al conectar (dinámica);
                // el mangle del árbol la marca. El IPv6 lo agrega el sondeo (estado_deseado.ts).
                propiedades = { ...comun, name: nombre, 'address-list': listaPlan(id, limitado) }
            } else {
                const vp = velocidadConExtras(plan.velocidad, e.extras)
                const padre = padreCliente(e, id, vp.reuso)
                const tipo = nombreTipoHoja(e.tipo_cola)
                propiedades = {
                    ...comun,
                    name: nombre,
                    ...(padre !== 'none' ? { 'parent-queue': padre } : {}),
                    ...(tipo ? { 'queue-type': tipo } : {}),
                    'rate-limit': rateLimitServicio(vp, limitado ? 'limitado' : 'activo'),
                }
            }
            presentes.push({ ruta: '/ppp/profile', clave: { comment }, propiedades })
        }
    }
    return { presentes, conservar }
}

/** `comment` del secret de un servicio (el mismo de todos sus objetos). */
export function commentSecret(servicioId: number): string {
    return commentServicio(servicioId)
}

/** Estados con secret (el pendiente de instalación no navega; el retirado no existe). */
const ESTADOS_CON_SECRET = new Set(['activo', 'limitado', 'suspendido'])

/** Lo que se compara del secret, sin la contraseña (el router puede no devolverla). */
export interface SecretDeseado {
    comment: string
    propiedades: Propiedades
}

/**
 * Secret deseado de un servicio en su router (`contratos/pppoe-local.md` §2), o null si no debe
 * haber ninguno (no es PPPoE, router con RADIUS, retirado, pendiente o sin credenciales).
 *
 * - `name` = `user_ppp`, `password` = la clave PPP descifrada, `service = pppoe`.
 * - `profile`: `plan-<id>` (activo), `plan-<id>-limitado` (limitado) o el perfil de corte
 *   (`suspendido`: `address-list = suspendidos` y rate-limit mínimo, lo crea el reconciliador).
 * - `remote-address` = la IPv4 fija si la hay (si no, la da el pool del perfil).
 * - `remote-ipv6-prefix` = el /64 de enlace del servicio (modo `radius_servicio`). El /56 delegado
 *   no tiene atributo en `/ppp/secret`: sale del `dhcpv6-pd-pool` del perfil.
 */
export function secretDeseado(
    servicio: ServicioRed,
    suspendido: PerfilSuspendidoRed,
    password: string,
): SecretDeseado {
    const perfil =
        servicio.estado === 'suspendido'
            ? (suspendido.perfil ?? 'suspendido')
            : servicio.estado === 'limitado'
              ? nombrePerfilLimitado(servicio.plan_id)
              : nombrePerfil(servicio.plan_id)
    return {
        comment: commentSecret(servicio.servicio_id),
        propiedades: {
            name: servicio.user_ppp!,
            password,
            service: 'pppoe',
            profile: perfil,
            ...(servicio.ipv4 ? { 'remote-address': servicio.ipv4 } : {}),
            ...(servicio.prefijo_enlace ? { 'remote-ipv6-prefix': servicio.prefijo_enlace } : {}),
            disabled: 'no',
        },
    }
}

/** ¿El servicio debe tener secret en el router `routerId` (modo `modo`)? */
export function llevaSecret(servicio: ServicioRed | null, routerId: number, modo: ModoSeguridad): boolean {
    return (
        servicio !== null &&
        modo === 'api' &&
        servicio.router_id === routerId &&
        servicio.tipo_conexion === 'pppoe' &&
        ESTADOS_CON_SECRET.has(servicio.estado) &&
        Boolean(servicio.user_ppp) &&
        Boolean(servicio.pass_ppp)
    )
}

/** Propiedades que el router solo toma al conectar: si cambian, se quita la sesión activa. */
const AL_CONECTAR = ['name', 'profile', 'remote-address', 'remote-ipv6-prefix', 'service', 'disabled']

/** Propiedades que no se pueden «quitar» con un PATCH: si sobran, el secret se vuelve a crear. */
const SIN_PATCH = ['remote-address', 'remote-ipv6-prefix']

const vacio = (v: string | undefined) => v === undefined || v === '' || v === '0.0.0.0' || v === '::/0'

export interface CambioSecret {
    ruta: '/ppp/secret' | '/ppp/active' | '/ppp/profile'
    comment: string
    accion: 'creado' | 'actualizado' | 'borrado' | 'desconectado'
    /** `/ppp/active` quitada: su `acct_session_id` de sondeo (para cerrar la fila en el acto) */
    acct_session_id?: string
}

/** `acct_session_id` de las sesiones quitadas en una lista de cambios. */
export function sesionesQuitadas(cambios: Array<{ acct_session_id?: string }>): string[] {
    return cambios.flatMap((c) => (c.acct_session_id ? [c.acct_session_id] : []))
}

/** Quita las sesiones activas de esos usuarios (`/ppp active remove`). */
export async function desconectarUsuarios(
    cliente: ClienteRouterOS,
    nombres: string[],
    ctx: ContextoRed,
    comment: string,
): Promise<CambioSecret[]> {
    const cambios: CambioSecret[] = []
    for (const nombre of [...new Set(nombres)].filter((n) => n !== '')) {
        for (const activa of await cliente.listar('/ppp/active', { name: nombre })) {
            await cliente.desconectarPpp(activa['.id'], ctx)
            cambios.push({
                ruta: '/ppp/active',
                comment,
                accion: 'desconectado',
                acct_session_id: idSesionSondeo(activa),
            })
        }
    }
    return cambios
}

/**
 * Deja el secret del servicio como dice `deseado` (null = que no exista), idempotente y por
 * `comment`; nunca toca un secret sin el comment de ArgosIsp (uno ajeno con el mismo `name` hace
 * fallar el PUT con 400, y eso llega como `routeros.fallido`).
 *
 * - La contraseña solo se compara si el router la devuelve (el usuario de la API necesita la política
 *   `sensitive`); si no, se escribe al crear y en cada cambio del secret.
 * - Si cambió algo que el router solo toma al conectar (perfil, direcciones, nombre), o se borró el
 *   secret, se quita la sesión activa (`desconectar`, por defecto sí): el cliente reconecta con lo
 *   nuevo. Un cambio solo de contraseña no la quita.
 * - `actuales`: lo que el reconciliador ya leyó con ese comment (evita otra lectura).
 */
export async function asegurarSecret(
    cliente: ClienteRouterOS,
    servicioId: number,
    deseado: SecretDeseado | null,
    ctx: ContextoRed,
    opciones: { actuales?: ObjetoRouterOS[]; desconectar?: boolean } = {},
): Promise<CambioSecret[]> {
    const comment = commentSecret(servicioId)
    const desconectar = opciones.desconectar ?? true
    const existentes = opciones.actuales ?? (await cliente.buscar('/ppp/secret', comment))
    const cambios: CambioSecret[] = []
    const quitarTodos = async () => {
        for (const o of existentes) {
            await cliente.borrarPorId('/ppp/secret', o['.id'], ctx)
            cambios.push({ ruta: '/ppp/secret', comment, accion: 'borrado' })
        }
    }
    if (!deseado) {
        await quitarTodos()
        if (desconectar) {
            cambios.push(
                ...(await desconectarUsuarios(
                    cliente,
                    existentes.map((o) => o.name ?? ''),
                    ctx,
                    comment,
                )),
            )
        }
        return cambios
    }
    const [actual] = existentes
    const recrear =
        existentes.length > 1 ||
        (actual !== undefined && SIN_PATCH.some((k) => !vacio(actual[k]) && vacio(deseado.propiedades[k])))
    if (!actual || recrear) {
        await quitarTodos()
        await cliente.asegurar('/ppp/secret', comment, deseado.propiedades, ctx)
        cambios.push({ ruta: '/ppp/secret', comment, accion: 'creado' })
        if (actual && desconectar) {
            cambios.push(
                ...(await desconectarUsuarios(
                    cliente,
                    existentes.map((o) => o.name ?? ''),
                    ctx,
                    comment,
                )),
            )
        }
        return cambios
    }
    const comparables: Propiedades = { ...deseado.propiedades }
    if (!('password' in actual)) delete comparables.password
    const dif = diferencias(comparables, actual)
    if (Object.keys(dif).length === 0) return cambios
    // Sin `password` legible, se escribe junto con el cambio (así nunca queda una vieja).
    await cliente.asegurar('/ppp/secret', comment, { ...dif, password: deseado.propiedades.password! }, ctx)
    cambios.push({ ruta: '/ppp/secret', comment, accion: 'actualizado' })
    if (desconectar && Object.keys(dif).some((k) => AL_CONECTAR.includes(k))) {
        cambios.push(...(await desconectarUsuarios(cliente, [actual.name ?? ''], ctx, comment)))
    }
    return cambios
}

/** Contraseña PPP en claro, o el error (va a los avisos, nunca a un log con el valor). */
export function passwordDe(servicio: ServicioRed): { clave: string } | { error: string } {
    try {
        return { clave: descifrar(servicio.pass_ppp!) }
    } catch (error) {
        return { error: `no se pudo descifrar la contraseña PPP: ${(error as Error).message}` }
    }
}

/**
 * El perfil de corte (`suspendido`) y su lista de interfaces existen en todo router con API desde la
 * primera reconciliación (`corte_router.ts`). Si un suspendido llega antes (router recién dado de
 * alta), se crean aquí igual que los deja el reconciliador, para que el secret pueda apuntar a él.
 */
export async function asegurarPerfilCorte(
    cliente: ClienteRouterOS,
    perfiles: ObjetoRouterOS[],
    ctx: ContextoRed,
): Promise<CambioSecret[]> {
    const corte = estadoCorteRouter(configCorte(), { fasttrack: false, redes_v4: [] }, perfiles)
    const perfil = corte.nombrados.find((n) => n.ruta === '/ppp/profile')
    if (!perfil || perfiles.some((p) => p.name === perfil.name)) return []
    for (const n of corte.nombrados) await cliente.asegurarPor(n.ruta, { name: n.name }, n.propiedades, ctx)
    return [{ ruta: '/ppp/profile', comment: perfil.name, accion: 'creado' }]
}

/**
 * Reconciliador de secrets de un router (`contratos/pppoe-local.md` §7): lee `/ppp/secret` una vez y
 * deja un secret por servicio PPPoE vigente (router `api`), corrige los distintos y borra los
 * sobrantes con `comment = argosisp:servicio:<id>` (servicio retirado, eliminado, movido o router
 * pasado a `radius`). Un secret sin ese comment (puesto a mano, o los de emergencia
 * `argosisp-emergencia`) nunca se toca.
 *
 * Sobrante en un router que pasó a `radius` con su servicio PPPoE todavía ahí: se borra sin quitar la
 * sesión (reconecta por RADIUS cuando se caiga). Cualquier otro sobrante sí se desconecta.
 */
export async function reconciliarSecrets(
    cliente: ClienteRouterOS,
    routerId: number,
    modo: ModoSeguridad,
    servicios: ServicioRed[],
    ctx: (servicioId: number) => ContextoRed,
): Promise<{
    correcciones: CambioSecret[]
    avisos: string[]
    /** Secrets que el router rechazó (400, p. ej. un secret ajeno con el mismo `name`): `routeros.fallido` */
    fallidos: Array<{ servicio_id: number; operacion: string; error: string }>
}> {
    const correcciones: CambioSecret[] = []
    const avisos: string[] = []
    const fallidos: Array<{ servicio_id: number; operacion: string; error: string }> = []
    const porServicio = new Map<number, ObjetoRouterOS[]>()
    for (const objeto of await cliente.listar('/ppp/secret')) {
        const id = servicioDeComment(objeto.comment)
        // Solo el comment exacto del servicio (`argosisp:servicio:<id>`).
        if (id === null || objeto.comment !== commentSecret(id)) continue
        porServicio.set(id, [...(porServicio.get(id) ?? []), objeto])
    }
    const suspendido = perfilSuspendido()
    const deseados = new Set<number>()
    for (const s of servicios) {
        if (!llevaSecret(s, routerId, modo)) continue
        const clave = passwordDe(s)
        if ('error' in clave) {
            avisos.push(`servicio ${s.servicio_id}: ${clave.error}`)
            deseados.add(s.servicio_id) // no se borra lo que haya: falta la clave, no el servicio
            continue
        }
        deseados.add(s.servicio_id)
        try {
            correcciones.push(
                ...(await asegurarSecret(
                    cliente,
                    s.servicio_id,
                    secretDeseado(s, suspendido, clave.clave),
                    ctx(s.servicio_id),
                    { actuales: porServicio.get(s.servicio_id) ?? [] },
                )),
            )
        } catch (error) {
            // Un 400 de un secret no detiene la reconciliación del resto (reintentar no lo arregla).
            if (!(error instanceof RouterOSSolicitud)) throw error
            fallidos.push({
                servicio_id: s.servicio_id,
                operacion: error.operacion ?? 'ppp/secret add',
                error: error.message,
            })
            avisos.push(`servicio ${s.servicio_id}: el router rechazó el secret (${error.message})`)
        }
    }
    const pppoeAqui = new Set(
        servicios
            .filter((s) => s.tipo_conexion === 'pppoe' && s.router_id === routerId)
            .map((s) => s.servicio_id),
    )
    for (const [id, actuales] of [...porServicio].sort((a, b) => a[0] - b[0])) {
        if (deseados.has(id)) continue
        correcciones.push(
            ...(await asegurarSecret(cliente, id, null, ctx(id), {
                actuales,
                desconectar: !(modo === 'radius' && pppoeAqui.has(id)),
            })),
        )
    }
    return { correcciones, avisos, fallidos }
}
