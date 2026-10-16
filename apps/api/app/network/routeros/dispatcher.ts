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
import { diferencias } from '#network/routeros/normalizar'
import type { PredeterminadosRed } from '#network/routeros/consultas'
import type { EstadoDeseado, PerfilSuspendidoRed, RutaServicio } from '#network/routeros/estado_deseado'
import type { RutaRouterOS } from '#network/routeros/cliente'
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
 */
export const bitacoraRed: Bitacora = {
    async registrar(fila: FilaRouterOS) {
        await db.table('audit.red').insert({
            tipo: fila.tipo,
            router_id: fila.router_id,
            servicio_id: fila.servicio_id,
            comando: JSON.stringify(fila.comando),
            respuesta: JSON.stringify(fila.respuesta),
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

export type FabricaClientes = (router: RouterApi) => ClienteRouterOS

/** Lo que se puede inyectar en las acciones del dispatcher (pruebas, laboratorio). */
export interface OpcionesDispatcher {
    clientes?: FabricaClientes
    red?: PredeterminadosRed
}

export const fabricaPorDefecto: FabricaClientes = (router) =>
    clienteDeRouter(router, {
        clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
        bitacora: bitacoraRed,
        verificarTls: env.get('ROUTEROS_TLS_VERIFICAR') ?? true,
        timeoutMs: env.get('ROUTEROS_TIMEOUT_MS'),
        reintentos: env.get('ROUTEROS_REINTENTOS'),
        esperaMs: env.get('ROUTEROS_ESPERA_MS'),
    })

export function perfilSuspendido(): PerfilSuspendidoRed {
    return {
        rateLimit: env.get('ROUTEROS_SUSPENDIDO_RATE_LIMIT') ?? '256k/256k',
        addressList: env.get('ROUTEROS_SUSPENDIDO_ADDRESS_LIST') ?? 'suspendidos',
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
    ruta: RutaRouterOS
    comment: string
    accion: 'creado' | 'actualizado' | 'borrado'
    /** Objetos duplicados borrados además del cambio */
    duplicados?: number
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
