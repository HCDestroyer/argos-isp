import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verRouter } from '#network/consultas/routers'
import {
    TIPOS_CONEXION,
    capasCambiadas,
    estrategiaEfectiva,
    leerExcepcion,
    type Capa,
    type EstrategiasRouter,
    type ExcepcionEstrategia,
} from '#network/estrategia_velocidad'
import { vistaPreviaEstrategia, type VistaPreviaEstrategia } from '#network/routeros/cambio_control'

/**
 * Modo de velocidad único por router (`contratos/control-velocidad.md` §11): qué planes del router
 * tienen excepción, qué cambia al unificarlos y cuántas sesiones reconectan. No escribe ni lee el
 * router (la vista previa de A2 se calcula con Postgres).
 */

export interface PlanConExcepcion {
    plan_id: number
    nombre: string
    implementacion_id: number
    version: number
    excepcion: ExcepcionEstrategia
    capas: Capa[]
    de: EstrategiasRouter
    a: EstrategiasRouter
    servicios: number
    sesiones_abiertas: number
}

export interface VistaPreviaUnificarVelocidad {
    router_id: number
    router_version: number
    planes: PlanConExcepcion[]
    vista_previa: VistaPreviaEstrategia
}

/** Implementaciones del router con excepción de estrategia (orden por plan). */
export async function excepcionesDelRouter(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<
    Array<{ id: number; plan_id: number; nombre: string; version: number; excepcion: ExcepcionEstrategia }>
> {
    const filas = (await cliente
        .from('network.planes_routers as pr')
        .join('network.planes as p', 'p.id', 'pr.plan_id')
        .where('pr.router_id', routerId)
        .whereNotNull('pr.estrategia_velocidad')
        .orderBy('pr.plan_id')
        .select('pr.id', 'pr.plan_id', 'p.nombre', 'pr.version', 'pr.estrategia_velocidad')) as Array<{
        id: number
        plan_id: number
        nombre: string
        version: number
        estrategia_velocidad: unknown
    }>
    const salida = []
    for (const f of filas) {
        const excepcion = leerExcepcion(f.estrategia_velocidad)
        if (!excepcion || Object.keys(excepcion).length === 0) continue
        salida.push({
            id: Number(f.id),
            plan_id: Number(f.plan_id),
            nombre: f.nombre,
            version: Number(f.version),
            excepcion,
        })
    }
    return salida
}

export async function vistaPreviaUnificarVelocidad(
    routerId: number,
    reconectar = false,
): Promise<VistaPreviaUnificarVelocidad> {
    const router = await verRouter(routerId)
    const excepciones = await excepcionesDelRouter(routerId)
    const planes: PlanConExcepcion[] = []
    for (const e of excepciones) {
        const de = Object.fromEntries(
            TIPOS_CONEXION.map((tipo) => [
                tipo,
                estrategiaEfectiva(router.estrategia_velocidad, e.excepcion, tipo),
            ]),
        ) as EstrategiasRouter
        const [conteo] = (await db
            .from('core.servicios as s')
            .where('s.router_id', routerId)
            .where('s.plan_id', e.plan_id)
            .whereNot('s.estado', 'retirado')
            .select(
                db.raw('count(*)::int AS servicios'),
                db.raw(
                    `(SELECT count(*)::int FROM network.sesiones x JOIN core.servicios y ON y.id = x.servicio_id
                       WHERE x.fin IS NULL AND y.router_id = ? AND y.plan_id = ?) AS sesiones`,
                    [routerId, e.plan_id],
                ),
            )) as Array<{ servicios: number; sesiones: number }>
        planes.push({
            plan_id: e.plan_id,
            nombre: e.nombre,
            implementacion_id: e.id,
            version: e.version,
            excepcion: e.excepcion,
            capas: capasCambiadas(de, router.estrategia_velocidad),
            de,
            a: router.estrategia_velocidad,
            servicios: Number(conteo?.servicios ?? 0),
            sesiones_abiertas: Number(conteo?.sesiones ?? 0),
        })
    }
    const vista = await vistaPreviaEstrategia(routerId, {
        planes: Object.fromEntries(excepciones.map((e) => [e.plan_id, null])),
        reconectar,
    })
    return { router_id: routerId, router_version: router.version, planes, vista_previa: vista }
}
