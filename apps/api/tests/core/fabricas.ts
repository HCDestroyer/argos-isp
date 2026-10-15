import db from '@adonisjs/lucid/services/db'
import { unico } from '#tests/ayudas'

/**
 * Filas de prueba insertadas directo en la base (sin pasar por acciones) para preparar
 * escenarios. Los datos llevan sufijos únicos: las pruebas no truncan tablas.
 */

let contadorIp = 0

/** IPv4 única por corrida para nas_ip (10.200.x.y). */
export function ipUnica(): string {
    contadorIp += 1
    const base = (process.pid % 200) * 300 + contadorIp
    return `10.${200 + (Math.floor(base / 65536) % 50)}.${Math.floor(base / 256) % 256}.${base % 256}`
}

let contadorRed = 0

/** Red /24 única por corrida (las redes IPv4 no pueden traslaparse entre routers). */
export function redUnica(): string {
    contadorRed += 1
    return `100.${64 + Math.floor(contadorRed / 256)}.${contadorRed % 256}.0/24`
}

let contadorV6 = 0

/** Bloque /40 único por corrida dentro de 2001:db8::/32. */
export function bloqueV6Unico(): string {
    contadorV6 += 1
    return `2001:db8:${contadorV6.toString(16)}00::/40`
}

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<number> {
    const [r] = (await db.table(tabla).insert(fila).returning('id')) as Array<{ id: number }>
    return r!.id
}

export function crearZonaFila(): Promise<number> {
    return insertar('core.zonas', { nombre: unico('Zona') })
}

export function crearClienteFila(datos: Record<string, unknown> = {}): Promise<number> {
    return insertar('core.clientes', { nombre: unico('Cliente'), ...datos })
}

export function crearRouterFila(datos: Record<string, unknown> = {}): Promise<number> {
    return insertar('network.routers', {
        nombre: unico('Router'),
        host: '192.0.2.1',
        nas_ip: ipUnica(),
        ...datos,
    })
}

export function crearPlanFila(datos: Record<string, unknown> = {}): Promise<number> {
    return insertar('network.planes', {
        nombre: unico('Plan'),
        precio: '150.00',
        bajada_kbps: 20000,
        subida_kbps: 5000,
        ...datos,
    })
}

export async function crearServicioFila(datos: {
    cliente_id: number
    router_id?: number
    plan_id?: number
    [k: string]: unknown
}): Promise<number> {
    return insertar('core.servicios', {
        router_id: datos.router_id ?? (await crearRouterFila()),
        plan_id: datos.plan_id ?? (await crearPlanFila()),
        user_ppp: unico('ppp'),
        pass_ppp: 'cifrada',
        ...datos,
    })
}

/**
 * Router con una red IPv4 /24 (gateway .1) y un bloque IPv6 /40 con pools de enlace (/48 → /64)
 * y de delegación (/44 → /56 y /44 → /48). Devuelve la base IPv4 (`100.64.x`) y la raíz IPv6.
 */
export async function crearEscenarioRouter() {
    const routerId = await crearRouterFila()
    const cidr = redUnica()
    const base = cidr.replace('.0/24', '')
    await db
        .table('network.redes_ipv4')
        .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo: 'estatico' })
    const bloque = bloqueV6Unico()
    const raiz = bloque.replace('00::/40', '')
    const [b] = (await db
        .table('network.ipv6_bloques')
        .insert({ router_id: routerId, prefijo: bloque })
        .returning('id')) as Array<{ id: number }>
    await db.table('network.ipv6_pools').multiInsert([
        { bloque_id: b!.id, prefijo: `${raiz}00::/48`, tipo: 'enlace', tamano_entrega: 64 },
        { bloque_id: b!.id, prefijo: `${raiz}10::/44`, tipo: 'delegacion', tamano_entrega: 56 },
        { bloque_id: b!.id, prefijo: `${raiz}20::/44`, tipo: 'delegacion', tamano_entrega: 48 },
    ])
    return { routerId, base, raiz }
}
