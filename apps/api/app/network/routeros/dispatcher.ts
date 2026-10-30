import db from '@adonisjs/lucid/services/db'
import type { Transaccion } from '#shared/domain_action'
import env from '#start/env'
import { prefijoColas, redis } from '#shared/redis'
import { claveDesdeTexto } from '#shared/cifrado'
import type {
    Bitacora,
    ClienteRouterOS,
    ContextoRed,
    FilaRouterOS,
    ObjetoRouterOS,
} from '#network/routeros/cliente'
import { clienteDeRouter, type RouterApi } from '#network/routeros/router'
import { contactoRouterOS } from '#network/sesiones/contacto'
import { limpiarCredenciales } from '#network/sesiones/eventos_red'
import { diferencias } from '#network/routeros/normalizar'
import type { PredeterminadosRed } from '#network/routeros/consultas'
import type { EstadoDeseado, PerfilSuspendidoRed, RutaServicio } from '#network/routeros/estado_deseado'
import type { RutaRouterOS } from '#network/routeros/cliente'
import { RUTAS_ORDENADAS, type Propiedades } from '#network/routeros/cliente'
import {
    movimientos,
    normalizarDireccion,
    ordenDeseado,
    type EstadoCorte,
    type ResolverIPv4,
} from '#network/routeros/corte_router'
import type { Estrategia } from '#network/estrategia_velocidad'
import {
    claveTexto,
    MENUS_VELOCIDAD,
    sobrantesVelocidad,
    type EstadoVelocidad,
    type LecturaVelocidad,
} from '#network/routeros/velocidad_router'

/**
 * Piezas comunes del dispatcher de RouterOS (servicios sin PPPoE): auditoría en `audit.red`,
 * fábrica de clientes por router, perfil de suspendido, routers pendientes de reconciliar y la
 * aplicación idempotente de un `EstadoDeseado`.
 */

/**
 * Cada escritura en el router queda en `audit.red` en el acto, fuera de la transacción de la
 * acción: la escritura ya ocurrió en el equipo aunque la acción se revierta después.
 *
 * Credenciales como `***` antes de escribir (`limpiarCredenciales`): el `password` de un
 * `/ppp/secret` (PPPoE sin RADIUS, `contratos/pppoe-local.md` §8) viaja en las propiedades del PUT o
 * del PATCH, en el objeto que devuelve el router y en `antes`; nunca llega a `audit.red`.
 */
export const bitacoraRed: Bitacora = {
    async registrar(fila: FilaRouterOS) {
        await db.table('audit.red').insert({
            tipo: fila.tipo,
            router_id: fila.router_id,
            servicio_id: fila.servicio_id,
            comando: JSON.stringify(limpiarCredenciales(fila.comando)),
            respuesta: JSON.stringify(limpiarCredenciales(fila.respuesta)),
            ok: fila.ok,
        })
    },
}

/**
 * Fila final de `audit.red` cuando una operación no pudo completarse (router inalcanzable,
 * credenciales, 400): el cliente ya registró cada escritura intentada, pero un fallo en una
 * lectura (router caído) no dejaría rastro del intento.
 */
export async function registrarFallo(datos: {
    router_id: number
    servicio_id: number | null
    operacion: 'aplicar' | 'reconciliar' | 'cambiar_control'
    evento_id: string | null
    request_id: string
    error: Error
}): Promise<void> {
    const e = datos.error as Error & { tipo?: string; status?: number | null; codigo?: string | null }
    await bitacoraRed.registrar({
        tipo: 'routeros',
        router_id: datos.router_id,
        servicio_id: datos.servicio_id,
        comando: {
            operacion: datos.operacion,
            evento_id: datos.evento_id,
            request_id: datos.request_id,
            final: true,
        },
        respuesta: {
            error: e.message,
            tipo_error: e.tipo ?? 'credenciales',
            status: e.status ?? null,
            codigo: e.codigo ?? null,
            final: true,
        },
        ok: false,
    })
}

/**
 * `opciones.sinContacto`: el llamador anota el contacto él mismo (el sondeo, con fuente `sondeo`).
 * Las fábricas de prueba pueden ignorarlo.
 */
export type FabricaClientes = (router: RouterApi, opciones?: { sinContacto?: boolean }) => ClienteRouterOS

/** Lo que se puede inyectar en las acciones del dispatcher (pruebas, laboratorio). */
export interface OpcionesDispatcher {
    clientes?: FabricaClientes
    red?: PredeterminadosRed
    /** DNS para el FQDN del portal (`configCorteResuelta`); por defecto `getaddrinfo` */
    resolver?: ResolverIPv4
}

export const fabricaPorDefecto: FabricaClientes = (router, opciones = {}) =>
    clienteDeRouter(router, {
        clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
        bitacora: bitacoraRed,
        contacto: opciones.sinContacto ? null : contactoRouterOS,
        timeoutMs: env.get('ROUTEROS_TIMEOUT_MS'),
        reintentos: env.get('ROUTEROS_REINTENTOS'),
        esperaMs: env.get('ROUTEROS_ESPERA_MS'),
    })

export function perfilSuspendido(): PerfilSuspendidoRed {
    return {
        rateLimit: env.get('ROUTEROS_SUSPENDIDO_RATE_LIMIT') ?? '256k/256k',
        addressList: env.get('ROUTEROS_SUSPENDIDO_ADDRESS_LIST') ?? 'suspendidos',
        // El mismo perfil de corte que crea el reconciliador (`corte_router.ts`) y que manda `aaa`.
        perfil: process.env.AAA_SUSPENDIDO_GRUPO?.trim() || 'suspendido',
    }
}

/**
 * Routers que fallaron y esperan reconciliarse cuando vuelvan (`SADD`). No es una caché: es la
 * lista de trabajo del job `recuperar` (si se pierde, la reconciliación periódica lo cubre).
 */
export function clavePendientes(): string {
    return `${prefijoColas()}:routeros:pendientes`
}

export async function marcarPendiente(routerId: number): Promise<void> {
    await redis().sadd(clavePendientes(), String(routerId))
}

export async function quitarPendiente(routerId: number): Promise<void> {
    await redis().srem(clavePendientes(), String(routerId))
}

export async function routersPendientes(): Promise<number[]> {
    const ids = await redis().smembers(clavePendientes())
    return ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * Router en cambio de modo de control (`router.control_cambiado`, `cambio_control.ts`): mientras
 * dura, los eventos y el reconciliador no borran los objetos del modo anterior (los servicios que
 * faltan migrar todavía cuelgan de ellos); la limpieza la hace el último paso del cambio. Es un
 * candado de trabajo, no una caché: vence en una hora por si el worker muere a mitad.
 */
export function claveTransicion(routerId: number): string {
    return `${prefijoColas()}:routeros:transicion:${routerId}`
}

export async function marcarTransicion(routerId: number): Promise<void> {
    await redis().set(claveTransicion(routerId), String(Date.now()), 'EX', 3600)
}

export async function quitarTransicion(routerId: number): Promise<void> {
    await redis().del(claveTransicion(routerId))
}

export async function enTransicion(routerId: number): Promise<boolean> {
    return (await redis().exists(claveTransicion(routerId))) === 1
}

export interface Cambio {
    /** `/ppp/active`: una sesión quitada para que tome el secret o el perfil nuevo (PPPoE sin RADIUS) */
    ruta: RutaRouterOS | '/ppp/active'
    comment: string
    accion: 'creado' | 'actualizado' | 'borrado' | 'movido' | 'desconectado'
    /** Objetos duplicados borrados además del cambio */
    duplicados?: number
    /** `/ppp/active` quitada (PPPoE sin RADIUS): su `acct_session_id` de sondeo */
    acct_session_id?: string
}

/**
 * Aplica un estado deseado: `asegurar` cada objeto presente y `borrar` el comment en los menús
 * ausentes. `actuales` (opcional, del reconciliador) evita la lectura por objeto: lo que ya está
 * igual no se toca. Devuelve solo lo que cambió.
 */
export async function aplicarEstado(
    cliente: ClienteRouterOS,
    estado: EstadoDeseado,
    ctx: ContextoRed,
    actuales?: Map<RutaServicio, Map<string, ObjetoRouterOS[]>>,
): Promise<Cambio[]> {
    const cambios: Cambio[] = []
    for (const objeto of estado.presentes) {
        const existentes = actuales?.get(objeto.ruta)?.get(objeto.comment)
        if (
            existentes?.length === 1 &&
            Object.keys(diferencias(objeto.propiedades, existentes[0]!)).length === 0
        ) {
            continue
        }
        const r = await cliente.asegurar(objeto.ruta, objeto.comment, objeto.propiedades, ctx)
        if (r.accion !== 'sin_cambios' || r.duplicados > 0) {
            cambios.push({
                ruta: objeto.ruta,
                comment: objeto.comment,
                accion: r.accion === 'sin_cambios' ? 'actualizado' : r.accion,
                ...(r.duplicados > 0 ? { duplicados: r.duplicados } : {}),
            })
        }
    }
    for (const { ruta, comment } of estado.ausentes) {
        if (actuales && !actuales.get(ruta)?.has(comment)) continue
        const borrados = await cliente.borrar(ruta, comment, ctx)
        if (borrados > 0) cambios.push({ ruta, comment, accion: 'borrado' })
    }
    return cambios
}

/**
 * Reglas de oro que el router no cumpliría (`EstadoVelocidad.errores`): una fila en `audit.red` y
 * `routeros.fallido` por cada una, con el detalle. El objeto afectado no se escribió.
 */
export async function reportarReglasOro(
    t: Transaccion,
    datos: { router_id: number; servicio_id: number | null; evento_id: string | null },
    estado: EstadoVelocidad,
): Promise<string[]> {
    for (const e of estado.errores) {
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: datos.router_id,
            servicio_id: datos.servicio_id,
            comando: {
                operacion: 'validar_velocidad',
                regla: e.regla,
                plan_id: e.plan_id,
                evento_id: datos.evento_id,
                request_id: t.ctx.requestId,
            },
            respuesta: { error: e.detalle, final: true },
            ok: false,
        })
        await t.emit('routeros.fallido', {
            servicio_id: datos.servicio_id,
            router_id: datos.router_id,
            operacion: `validar velocidad (${e.regla})`,
            error: e.detalle,
        })
    }
    return estado.errores.map((e) => e.detalle)
}

/** Lee los menús del control de velocidad (un `listar` por menú). */
export async function leerVelocidadRouter(cliente: ClienteRouterOS): Promise<LecturaVelocidad> {
    const lectura: LecturaVelocidad = new Map()
    for (const ruta of MENUS_VELOCIDAD) lectura.set(ruta, await cliente.listar(ruta))
    return lectura
}

function comentarioDe(clave: Record<string, string>): string {
    return clave.comment ?? clave.name ?? claveTexto(clave)
}

/**
 * Crea o corrige los objetos de velocidad del router (padres, perfiles, árbol), en orden: padres
 * antes que lo que cuelga de ellos. Lo que ya está igual en `lectura` no se toca.
 */
export async function asegurarVelocidad(
    cliente: ClienteRouterOS,
    estado: EstadoVelocidad,
    lectura: LecturaVelocidad,
    ctx: ContextoRed,
): Promise<Cambio[]> {
    const cambios: Cambio[] = []
    for (const objeto of estado.presentes) {
        const existentes = (lectura.get(objeto.ruta as never) ?? []).filter((o: ObjetoRouterOS) =>
            Object.entries(objeto.clave).every(([k, v]) => o[k] === v),
        )
        if (
            existentes.length === 1 &&
            Object.keys(diferencias(objeto.propiedades, existentes[0]!)).length === 0
        ) {
            continue
        }
        const r = await cliente.asegurarPor(objeto.ruta, objeto.clave, objeto.propiedades, ctx)
        if (r.accion !== 'sin_cambios' || r.duplicados > 0) {
            cambios.push({
                ruta: objeto.ruta,
                comment: comentarioDe(objeto.clave),
                accion: r.accion === 'sin_cambios' ? 'actualizado' : r.accion,
                ...(r.duplicados > 0 ? { duplicados: r.duplicados } : {}),
            })
        }
    }
    return cambios
}

/** Borra los objetos de velocidad que sobran (hijas antes que padres; `sobrantesVelocidad`). */
export async function limpiarVelocidad(
    cliente: ClienteRouterOS,
    estado: EstadoVelocidad,
    lectura: LecturaVelocidad,
    ctx: ContextoRed,
): Promise<Cambio[]> {
    const cambios: Cambio[] = []
    for (const { ruta, objeto } of sobrantesVelocidad(estado, lectura)) {
        const clave: Record<string, string> = objeto.comment
            ? { comment: objeto.comment }
            : { name: objeto.name ?? '' }
        await cliente.borrarPor(ruta, clave, ctx)
        cambios.push({ ruta, comment: objeto.comment ?? objeto.name ?? objeto['.id'], accion: 'borrado' })
    }
    return cambios
}

/** Espacio de los advisory locks por router (`pg_advisory_xact_lock(LOCK_ROUTEROS, router_id)`). */
export const LOCK_ROUTEROS = 4102

/*
|--------------------------------------------------------------------------
| Corte y FastTrack (objetos de nivel router, `corte_router.ts`)
|--------------------------------------------------------------------------
*/

/** Lo que se leyó del router para el corte (un `listar` por menú). */
export type LecturaCorte = Map<RutaRouterOS, ObjetoRouterOS[]>

export const MENUS_CORTE = [
    '/interface/list',
    '/ppp/profile',
    '/ip/firewall/address-list',
    '/ipv6/firewall/address-list',
    ...RUTAS_ORDENADAS,
] as const satisfies readonly RutaRouterOS[]

export async function leerCorteRouter(cliente: ClienteRouterOS): Promise<LecturaCorte> {
    const lectura: LecturaCorte = new Map()
    for (const ruta of MENUS_CORTE) lectura.set(ruta, await cliente.listar(ruta))
    return lectura
}

/** Un cambio pendiente del corte (vista previa) o hecho (con `aplicarCorte`). */
export interface CambioCorte {
    ruta: RutaRouterOS
    clave: string
    accion: 'crear' | 'actualizar' | 'borrar' | 'mover'
    propiedades?: Propiedades
    id?: string
    destino?: string
}

const esLabEntrada = (o: ObjetoRouterOS) => (o.comment ?? '').startsWith('argosisp: ')

/**
 * Qué falta, qué difiere y qué sobra del corte en el router, sin escribir (lo usa la vista previa y el
 * diagnóstico). El orden de las reglas se calcula como si lo que falta ya estuviera al final.
 */
export function planCorte(estado: EstadoCorte, lectura: LecturaCorte): CambioCorte[] {
    const cambios: CambioCorte[] = []
    for (const n of estado.nombrados) {
        const actual = (lectura.get(n.ruta) ?? []).find((o) => o.name === n.name && o.dynamic !== 'true')
        if (!actual) {
            cambios.push({ ruta: n.ruta, clave: n.name, accion: 'crear', propiedades: n.propiedades })
        } else if (Object.keys(diferencias(n.propiedades, actual)).length > 0) {
            cambios.push({
                ruta: n.ruta,
                clave: n.name,
                accion: 'actualizar',
                propiedades: n.propiedades,
                id: actual['.id'],
            })
        }
    }
    for (const ruta of ['/ip/firewall/address-list', '/ipv6/firewall/address-list'] as const) {
        const tabla = (lectura.get(ruta) ?? []).filter((o) => o.dynamic !== 'true')
        const deseadas = estado.entradas.filter((e) => e.ruta === ruta)
        const clave = (list: string, address: string) => `${list}|${normalizarDireccion(address)}`
        const existentes = new Map(tabla.map((o) => [clave(o.list ?? '', o.address ?? ''), o]))
        for (const e of deseadas) {
            const actual = existentes.get(clave(e.list, e.address))
            const props = { list: e.list, address: e.address, comment: e.comment, disabled: 'no' }
            if (!actual) {
                cambios.push({ ruta, clave: `${e.list} ${e.address}`, accion: 'crear', propiedades: props })
            } else if (esLabEntrada(actual) && (actual.comment !== e.comment || actual.disabled === 'true')) {
                cambios.push({
                    ruta,
                    clave: `${e.list} ${e.address}`,
                    accion: 'actualizar',
                    propiedades: { comment: e.comment, disabled: 'no' },
                    id: actual['.id'],
                })
            }
        }
        const quedan = new Set(deseadas.map((e) => clave(e.list, e.address)))
        for (const o of tabla) {
            const delGrupo = estado.grupos.some(
                (g) => g.ruta === ruta && g.list === o.list && g.comment === o.comment,
            )
            if (delGrupo && !quedan.has(clave(o.list ?? '', o.address ?? ''))) {
                cambios.push({ ruta, clave: `${o.list} ${o.address}`, accion: 'borrar', id: o['.id'] })
            }
        }
    }
    for (const ruta of RUTAS_ORDENADAS) {
        const tabla = (lectura.get(ruta) ?? []).filter((o) => o.dynamic !== 'true')
        const reglas = estado.reglas.filter((r) => r.ruta === ruta)
        const porComment = new Map(tabla.map((o) => [o.comment ?? '', o]))
        const simulada = [...tabla]
        let n = 0
        for (const r of reglas) {
            const actual = porComment.get(r.comment)
            if (!actual) {
                cambios.push({
                    ruta,
                    clave: r.comment,
                    accion: 'crear',
                    propiedades: { ...r.propiedades, comment: r.comment },
                })
                simulada.push({ '.id': `nueva-${n++}`, comment: r.comment, ...r.propiedades })
            } else if (Object.keys(diferencias(r.propiedades, actual)).length > 0) {
                cambios.push({
                    ruta,
                    clave: r.comment,
                    accion: 'actualizar',
                    propiedades: r.propiedades,
                    id: actual['.id'],
                })
            }
        }
        const deseadas = new Set(reglas.map((r) => r.comment))
        const propias = estado.propias.get(ruta) ?? new Set<string>()
        const sobran = tabla.filter(
            (o) =>
                propias.has(o.comment ?? '') &&
                !deseadas.has(o.comment ?? '') &&
                !estado.conservar.has(o.comment ?? ''),
        )
        const sinSobrantes = simulada.filter((o) => !sobran.includes(o))
        for (const m of movimientos(sinSobrantes, ordenDeseado(sinSobrantes, reglas))) {
            const comment = sinSobrantes.find((o) => o['.id'] === m.id)?.comment ?? m.id
            cambios.push({ ruta, clave: comment, accion: 'mover', id: m.id, destino: m.destino })
        }
        for (const o of sobran) {
            cambios.push({ ruta, clave: o.comment ?? o['.id'], accion: 'borrar', id: o['.id'] })
        }
    }
    return cambios
}

/**
 * Deja el corte como pide `estado`, en orden seguro: crea y corrige (la lista de interfaces y el
 * perfil antes que las reglas que los usan), mueve las reglas a su lugar (los saltos `argosisp:top`
 * antes de FastTrack y de `accept established,related`) y al final borra lo que sobra. Cada comando
 * queda en `audit.red`.
 */
export async function aplicarCorte(
    cliente: ClienteRouterOS,
    estado: EstadoCorte,
    lectura: LecturaCorte,
    ctx: ContextoRed,
): Promise<Cambio[]> {
    const hechos: Cambio[] = []
    const plan = planCorte(estado, lectura)
    const cambio = (c: CambioCorte, accion: Cambio['accion']) =>
        hechos.push({ ruta: c.ruta, comment: c.clave, accion })
    for (const c of plan.filter((x) => x.accion === 'crear' || x.accion === 'actualizar')) {
        if (c.ruta === '/interface/list' || c.ruta === '/ppp/profile') {
            await cliente.asegurarPor(c.ruta, { name: c.clave }, c.propiedades!, ctx)
        } else if (c.accion === 'crear') {
            await cliente.crear(c.ruta, c.propiedades!, ctx)
        } else {
            await cliente.actualizar(c.ruta, c.id!, c.propiedades!, ctx)
        }
        cambio(c, c.accion === 'crear' ? 'creado' : 'actualizado')
    }
    // Orden: se vuelve a leer cada tabla con las reglas nuevas (ya con su `.id`).
    for (const ruta of RUTAS_ORDENADAS) {
        const reglas = estado.reglas.filter((r) => r.ruta === ruta)
        const propias = estado.propias.get(ruta) ?? new Set<string>()
        const deseadas = new Set(reglas.map((r) => r.comment))
        const leida = await cliente.listar(ruta)
        const tabla = leida.filter(
            (o) =>
                !(
                    propias.has(o.comment ?? '') &&
                    !deseadas.has(o.comment ?? '') &&
                    !estado.conservar.has(o.comment ?? '')
                ),
        )
        for (const m of movimientos(tabla, ordenDeseado(tabla, reglas))) {
            await cliente.mover(ruta, m.id, m.destino, ctx)
            hechos.push({
                ruta,
                comment: tabla.find((o) => o['.id'] === m.id)?.comment ?? m.id,
                accion: 'movido',
            })
        }
    }
    for (const c of plan.filter((x) => x.accion === 'borrar')) {
        await cliente.borrarPorId(c.ruta, c.id!, ctx)
        cambio(c, 'borrado')
    }
    return hechos
}

/** ¿Alguna estrategia del router (o de un plan en él) pide excluir de FastTrack a los clientes? */
export function pideFasttrack(estrategias: Estrategia[]): boolean {
    return estrategias.some((e) => e.extras.excluir_fasttrack)
}

/*
|--------------------------------------------------------------------------
| Verificación de QoS por clases (`contratos/qos.md` §6)
|--------------------------------------------------------------------------
*/

/** ¿Es un objeto de QoS por clases (clasificación, cadena o salto del plan, hoja o PCQ de una clase)? */
export function esObjetoQos(ruta: string, clave: Record<string, string | undefined>): boolean {
    if (ruta === '/queue/type') return /-q\d+$/.test(clave.name ?? '')
    const comment = clave.comment ?? ''
    return comment.startsWith('argosisp:qos:') || /:qos(?::\d+)?$/.test(comment)
}

export interface VerificacionQos {
    ok: boolean
    /** objetos deseados que no están (`ruta clave`) */
    faltan: string[]
    /** objetos que están pero con propiedades distintas, con las que difieren */
    distintos: Array<{ objeto: string; propiedades: string[] }>
}

/** Compara lo de QoS del estado deseado con lo que se volvió a leer del router. null = no hay QoS. */
export function verificarQos(estado: EstadoVelocidad, lectura: LecturaVelocidad): VerificacionQos | null {
    const deseados = estado.presentes.filter((o) => esObjetoQos(o.ruta, o.clave))
    if (deseados.length === 0) return null
    const faltan: string[] = []
    const distintos: VerificacionQos['distintos'] = []
    for (const o of deseados) {
        const nombre = `${o.ruta} ${comentarioDe(o.clave)}`
        const actual = (lectura.get(o.ruta as never) ?? []).find((x: ObjetoRouterOS) =>
            Object.entries(o.clave).every(([k, v]) => x[k] === v),
        )
        if (!actual) {
            faltan.push(nombre)
            continue
        }
        const dif = Object.keys(diferencias(o.propiedades, actual))
        if (dif.length > 0) distintos.push({ objeto: nombre, propiedades: dif })
    }
    return { ok: faltan.length === 0 && distintos.length === 0, faltan, distintos }
}

/**
 * Fila `verificar_qos` en `audit.red` cuando la pasada tocó algo de QoS o la verificación falló; si
 * falló, además `routeros.fallido`. Devuelve el error (o null).
 */
export async function registrarVerificacionQos(
    t: Transaccion,
    datos: { router_id: number; evento_id: string | null; cambiosQos: number },
    verificacion: VerificacionQos | null,
): Promise<string | null> {
    if (!verificacion || (verificacion.ok && datos.cambiosQos === 0)) return null
    await bitacoraRed.registrar({
        tipo: 'routeros',
        router_id: datos.router_id,
        servicio_id: null,
        comando: {
            operacion: 'verificar_qos',
            evento_id: datos.evento_id,
            request_id: t.ctx.requestId,
            cambios: datos.cambiosQos,
        },
        respuesta: { faltan: verificacion.faltan, distintos: verificacion.distintos, final: true },
        ok: verificacion.ok,
    })
    if (verificacion.ok) return null
    const error =
        `QoS incompleto en el router: faltan ${verificacion.faltan.length} y difieren ` +
        `${verificacion.distintos.length} objetos (${[...verificacion.faltan, ...verificacion.distintos.map((d) => d.objeto)].slice(0, 3).join('; ')})`
    await t.emit('routeros.fallido', {
        servicio_id: null,
        router_id: datos.router_id,
        operacion: 'verificar qos',
        error,
    })
    return error
}
