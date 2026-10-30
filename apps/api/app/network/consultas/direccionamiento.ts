import db from '@adonisjs/lucid/services/db'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aBigInt, capacidad, formatoCorto, separarPrefijo, subprefijoCorto } from '#network/ipv6'
import { listarRedesIpv4, verRouter, type RedIpv4Vista } from '#network/consultas/routers'
import { listarBloques, listarPoolsDeRouter, type BloqueVista, type PoolVista } from '#network/consultas/ipv6'
import { planesDisponiblesEnRouter } from '#network/actions/obtener_implementacion_plan'
import {
    entregaPoolV6,
    sumarOcupaciones,
    type EntregaPoolV6,
    type Ocupacion,
    type TipoPoolV6,
} from '#network/ocupacion'

/**
 * Lo que el panel necesita para explicar el direccionamiento de un router (`contratos/pools.md`
 * §2 y §4): ocupación de cada pool, qué recibe cada servicio de cada plan y vistas previas de
 * bloques y pools IPv6 antes de crearlos.
 */

/** 422 si el prefijo trae bits de host; devuelve el prefijo en forma corta. */
function prefijoV6Normalizado(texto: string, campo = 'prefijo'): { prefijo: string; largo: number } {
    const [direccion] = texto.split('/') as [string]
    let valor: bigint
    try {
        valor = aBigInt(direccion)
    } catch {
        throw new ValidacionFallida([
            {
                field: campo,
                message: 'No es un prefijo IPv6 válido, por ejemplo 2001:db8:100::/40',
                rule: 'cidr',
            },
        ])
    }
    const { red, largo } = separarPrefijo(texto)
    const prefijo = `${formatoCorto(red)}/${largo}`
    if (red !== valor) {
        throw new ValidacionFallida([
            { field: campo, message: `Escríbelo como ${prefijo} (sin bits de host)`, rule: 'cidr' },
        ])
    }
    return { prefijo, largo }
}

async function traslape(tabla: 'network.ipv6_bloques' | 'network.ipv6_pools', prefijo: string) {
    const fila = (await db
        .from(tabla)
        .whereRaw('prefijo && ?::cidr', [prefijo])
        .select(db.raw('prefijo::text AS prefijo'))
        .first()) as { prefijo: string } | null
    return fila?.prefijo ?? null
}

export interface VistaPreviaPoolIpv6 extends EntregaPoolV6 {
    prefijo: string
    tipo: TipoPoolV6
    tamano_entrega: number
    /** pool existente con el que se traslaparía (no se podría crear); null si no hay */
    traslapa_con: string | null
}

/** Qué entregaría un pool IPv6 a cada servicio, sin guardarlo. */
export async function vistaPreviaPoolIpv6(entrada: {
    prefijo: string
    tipo: TipoPoolV6
    tamano_entrega: number
}): Promise<VistaPreviaPoolIpv6> {
    const { prefijo, largo } = prefijoV6Normalizado(entrada.prefijo)
    const errores: ErrorCampo[] = []
    if (entrada.tipo === 'enlace' && entrada.tamano_entrega !== 64) {
        errores.push({
            field: 'tamano_entrega',
            message: 'Un pool de enlace entrega /64: es la red de la conexión PPPoE de cada cliente',
            rule: 'enlace',
        })
    }
    if (largo > entrada.tamano_entrega) {
        errores.push({
            field: 'prefijo',
            message: `El pool /${largo} es más chico que el /${entrada.tamano_entrega} que entrega a cada cliente`,
            rule: 'tamano',
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, errores[0]!.message)
    return {
        prefijo,
        tipo: entrada.tipo,
        tamano_entrega: entrada.tamano_entrega,
        ...entregaPoolV6(prefijo, entrada.tipo, entrada.tamano_entrega),
        traslapa_con: await traslape('network.ipv6_pools', prefijo),
    }
}

export interface VistaPreviaBloqueIpv6 {
    prefijo: string
    tamano_delegado: number
    /** servicios que caben con la división sugerida (cada uno recibe un /64 de enlace y un delegado) */
    clientes: number
    /** /64 que cada cliente puede usar en su LAN con el delegado */
    redes_lan_por_cliente: number
    /** división sugerida: la primera mitad para enlace (lo que hace falta) y la segunda para delegación */
    pools_sugeridos: Array<{ tipo: TipoPoolV6; prefijo: string; tamano_entrega: number; clientes: number }>
    /** lo que recibirían los dos primeros servicios */
    ejemplos: Array<{ servicio: number; prefijo_enlace: string; prefijo_delegado: string }>
    /** bloque existente con el que se traslaparía (no se podría crear); null si no hay */
    traslapa_con: string | null
}

/**
 * Cómo repartir un bloque IPv6 entre enlace y delegación: la segunda mitad del bloque para el pool
 * de delegación (un prefijo de `tamano_delegado` por cliente) y, al inicio de la primera mitad, el
 * pool de enlace justo para la misma cantidad de clientes (un /64 cada uno). El resto de la
 * primera mitad queda libre para crecer.
 */
export async function vistaPreviaBloqueIpv6(entrada: {
    prefijo: string
    tamano_delegado: number
}): Promise<VistaPreviaBloqueIpv6> {
    const { prefijo, largo } = prefijoV6Normalizado(entrada.prefijo)
    const tamano = entrada.tamano_delegado
    if (largo + 1 > tamano || largo >= 64) {
        throw new ValidacionFallida([
            {
                field: 'prefijo',
                message:
                    `Un /${largo} es muy chico para entregar un /${tamano} a cada cliente y además sus /64 de enlace: ` +
                    `usa un bloque de /${Math.min(tamano, 64) - 1} o más grande`,
                rule: 'tamano',
            },
        ])
    }
    const mitad = largo + 1
    const delegacion = subprefijoCorto(prefijo, mitad, 1n)
    const clientes = capacidad(delegacion, tamano)
    const largoEnlace = 64 - (tamano - mitad)
    const enlace = subprefijoCorto(prefijo, largoEnlace, 0n)
    return {
        prefijo,
        tamano_delegado: tamano,
        clientes: Number(clientes),
        redes_lan_por_cliente: 2 ** (64 - tamano),
        pools_sugeridos: [
            { tipo: 'enlace', prefijo: enlace, tamano_entrega: 64, clientes: Number(clientes) },
            { tipo: 'delegacion', prefijo: delegacion, tamano_entrega: tamano, clientes: Number(clientes) },
        ],
        ejemplos: [0n, 1n]
            .filter((i) => i < clientes)
            .map((i) => ({
                servicio: Number(i) + 1,
                prefijo_enlace: subprefijoCorto(enlace, 64, i),
                prefijo_delegado: subprefijoCorto(delegacion, tamano, i),
            })),
        traslapa_con: await traslape('network.ipv6_bloques', prefijo),
    }
}

export interface AvisoDireccionamiento {
    codigo:
        | 'sin_ipv4'
        | 'sin_ipv4_libres'
        | 'sin_pool_enlace'
        | 'sin_pool_delegacion'
        | 'sin_prefijos_enlace_libres'
        | 'sin_prefijos_delegados_libres'
    mensaje: string
}

export interface PlanDireccionamiento {
    plan_id: number
    nombre: string
    dual_stack: 'ambos' | 'v4' | 'v6'
    /** de dónde sale la IPv4: redes del sistema, pool del router (Framed-Pool) o ninguna */
    ipv4: { origen: 'redes' | 'pool_router' | 'ninguna'; pool: string | null; libres: number | null }
    /** con el modo IPv6 por defecto (`radius_servicio`); null si el plan es solo IPv4 */
    ipv6: {
        prefijo_enlace: 64
        prefijo_delegado: number
        redes_lan_por_cliente: number
        enlaces_libres: number
        delegados_libres: number
    } | null
    avisos: AvisoDireccionamiento[]
}

export interface DireccionamientoRouter {
    router_id: number
    redes_ipv4: RedIpv4Vista[]
    bloques_ipv6: Array<BloqueVista & { pools: PoolVista[] }>
    ocupacion: {
        ipv4: Ocupacion
        ipv6: Array<{ tipo: TipoPoolV6; tamano_entrega: number; ocupacion: Ocupacion }>
    }
    planes: PlanDireccionamiento[]
}

/** Resumen por router: pools con ocupación y qué recibe un servicio nuevo de cada plan. */
export async function direccionamientoRouter(routerId: number): Promise<DireccionamientoRouter> {
    await verRouter(routerId)
    const [redes, bloques, pools, planes] = await Promise.all([
        listarRedesIpv4(routerId),
        listarBloques(routerId),
        listarPoolsDeRouter(routerId),
        planesDisponiblesEnRouter(routerId),
    ])

    const grupos = new Map<string, { tipo: TipoPoolV6; tamano_entrega: number; lista: Ocupacion[] }>()
    for (const pool of pools) {
        const clave = `${pool.tipo}/${pool.tamano_entrega}`
        const grupo = grupos.get(clave) ?? { tipo: pool.tipo, tamano_entrega: pool.tamano_entrega, lista: [] }
        grupo.lista.push(pool.ocupacion)
        grupos.set(clave, grupo)
    }
    const ipv6 = [...grupos.values()]
        .sort((a, b) => a.tipo.localeCompare(b.tipo) || b.tamano_entrega - a.tamano_entrega)
        .map((g) => ({
            tipo: g.tipo,
            tamano_entrega: g.tamano_entrega,
            ocupacion: sumarOcupaciones(g.lista),
        }))
    const libresV6 = (tipo: TipoPoolV6, tamano: number) =>
        pools
            .filter((p) => p.tipo === tipo && p.tamano_entrega === tamano)
            .reduce((acc, p) => acc + p.ocupacion.libres, 0)
    const hayPool = (tipo: TipoPoolV6, tamano: number) =>
        pools.some((p) => p.tipo === tipo && p.tamano_entrega === tamano)
    const ipv4 = sumarOcupaciones(redes.map((r) => r.ocupacion))

    return {
        router_id: routerId,
        redes_ipv4: redes,
        bloques_ipv6: bloques.map((b) => ({ ...b, pools: pools.filter((p) => p.bloque_id === b.id) })),
        ocupacion: { ipv4, ipv6 },
        planes: planes.map((plan) => {
            const avisos: AvisoDireccionamiento[] = []
            let origenV4: PlanDireccionamiento['ipv4'] = { origen: 'ninguna', pool: null, libres: null }
            if (plan.dual_stack !== 'v6') {
                if (redes.length > 0) {
                    origenV4 = { origen: 'redes', pool: null, libres: ipv4.libres }
                    if (ipv4.libres === 0) {
                        avisos.push({
                            codigo: 'sin_ipv4_libres',
                            mensaje:
                                'Las redes IPv4 del router están llenas: un servicio nuevo no recibiría IPv4',
                        })
                    }
                } else if (plan.pool_ipv4) {
                    origenV4 = { origen: 'pool_router', pool: plan.pool_ipv4, libres: null }
                } else {
                    avisos.push({
                        codigo: 'sin_ipv4',
                        mensaje:
                            'El router no tiene redes IPv4 y el plan no indica pool en este router: no se podría crear el servicio',
                    })
                }
            }
            let datosV6: PlanDireccionamiento['ipv6'] = null
            if (plan.dual_stack !== 'v4') {
                const tamano = plan.tamano_prefijo_delegado
                datosV6 = {
                    prefijo_enlace: 64,
                    prefijo_delegado: tamano,
                    redes_lan_por_cliente: 2 ** (64 - tamano),
                    enlaces_libres: libresV6('enlace', 64),
                    delegados_libres: libresV6('delegacion', tamano),
                }
                if (!hayPool('enlace', 64)) {
                    avisos.push({
                        codigo: 'sin_pool_enlace',
                        mensaje:
                            'El router no tiene pool IPv6 de enlace /64: crea uno para entregar IPv6 por RADIUS',
                    })
                } else if (datosV6.enlaces_libres === 0) {
                    avisos.push({
                        codigo: 'sin_prefijos_enlace_libres',
                        mensaje: 'Los pools de enlace /64 del router están llenos',
                    })
                }
                if (!hayPool('delegacion', tamano)) {
                    avisos.push({
                        codigo: 'sin_pool_delegacion',
                        mensaje: `El plan delega /${tamano} y el router no tiene pool de delegación /${tamano}`,
                    })
                } else if (datosV6.delegados_libres === 0) {
                    avisos.push({
                        codigo: 'sin_prefijos_delegados_libres',
                        mensaje: `Los pools de delegación /${tamano} del router están llenos`,
                    })
                }
            }
            return {
                plan_id: plan.id,
                nombre: plan.nombre,
                dual_stack: plan.dual_stack,
                ipv4: origenV4,
                ipv6: datosV6,
                avisos,
            }
        }),
    }
}
