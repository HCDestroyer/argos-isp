import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Historial de asignaciones de un servicio (`network.asignaciones_historial`, tarea 12).
 *
 * Cada tramo es una foto de (router, plan, IPv4, /64 de enlace, prefijo delegado) con `inicio` y
 * `fin`; el vigente tiene `fin IS NULL` (uno por servicio, índice único). Lo alimentan
 * `crearServicio`, `editarServicio` y `retirarServicio` dentro de su transacción con
 * `registrarTramo`: si la foto cambió, cierra el tramo abierto y abre otro. Las IPs y prefijos
 * individuales siguen además en `ipv4_asignaciones` e `ipv6_asignaciones` (lo que usa el IPAM y
 * `GET /ip/{ip}`); esta tabla es la vista por servicio que muestra la ficha.
 *
 * Usa `now()` de la transacción: el `fin` de un tramo y el `inicio` del siguiente coinciden.
 */

export interface TramoAsignacion {
    id: number
    servicio_id: number
    router_id: number | null
    router_nombre: string | null
    plan_id: number | null
    plan_nombre: string | null
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
    inicio: string
    fin: string | null
    motivo: string | null
}

interface Foto {
    router_id: number | null
    plan_id: number | null
    ipv4: string | null
    prefijo_enlace_v6: string | null
    prefijo_delegado_v6: string | null
}

const CAMPOS_FOTO: Array<keyof Foto> = [
    'router_id',
    'plan_id',
    'ipv4',
    'prefijo_enlace_v6',
    'prefijo_delegado_v6',
]

async function fotoActual(trx: TransactionClientContract, servicioId: number): Promise<Foto | null> {
    const { rows } = (await trx.rawQuery(
        `SELECT s.router_id, s.plan_id, s.estado,
                (SELECT host(a.ip) FROM network.ipv4_asignaciones a
                  WHERE a.servicio_id = s.id AND a.fin IS NULL LIMIT 1) AS ipv4,
                (SELECT a.prefijo::text FROM network.ipv6_asignaciones a
                  WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'enlace' LIMIT 1) AS prefijo_enlace_v6,
                (SELECT a.prefijo::text FROM network.ipv6_asignaciones a
                  WHERE a.servicio_id = s.id AND a.fin IS NULL AND a.tipo = 'delegacion' LIMIT 1) AS prefijo_delegado_v6
           FROM core.servicios s WHERE s.id = ?`,
        [servicioId],
    )) as { rows: Array<Foto & { estado: string }> }
    const fila = rows[0]
    if (!fila || fila.estado === 'retirado') return null
    return {
        router_id: Number(fila.router_id),
        plan_id: Number(fila.plan_id),
        ipv4: fila.ipv4,
        prefijo_enlace_v6: fila.prefijo_enlace_v6,
        prefijo_delegado_v6: fila.prefijo_delegado_v6,
    }
}

/**
 * Lleva el historial a lo vigente del servicio. Si nada cambió no escribe; si cambió, cierra el
 * tramo abierto y abre uno nuevo con `motivo`. Un servicio retirado solo cierra su tramo.
 * Devuelve true si escribió algo.
 */
export async function registrarTramo(
    trx: TransactionClientContract,
    servicioId: number,
    motivo: string,
): Promise<boolean> {
    const foto = await fotoActual(trx, servicioId)
    const abierto = (await trx
        .from('network.asignaciones_historial')
        .where('servicio_id', servicioId)
        .whereNull('fin')
        .forUpdate()
        .select(
            'id',
            'router_id',
            'plan_id',
            trx.raw('host(ipv4) AS ipv4'),
            trx.raw('prefijo_enlace_v6::text AS prefijo_enlace_v6'),
            trx.raw('prefijo_v6::text AS prefijo_delegado_v6'),
        )
        .first()) as (Foto & { id: number }) | null

    if (abierto && foto) {
        const igual = CAMPOS_FOTO.every((campo) => {
            const a = abierto[campo]
            const b = foto[campo]
            return (a === null ? null : String(a)) === (b === null ? null : String(b))
        })
        if (igual) return false
    }
    if (!abierto && !foto) return false

    if (abierto) {
        await trx
            .from('network.asignaciones_historial')
            .where('id', abierto.id)
            .update({ fin: trx.knexRawQuery('now()') } as Record<string, unknown>)
    }
    if (foto) {
        await trx.insertQuery().table('network.asignaciones_historial').insert({
            servicio_id: servicioId,
            router_id: foto.router_id,
            plan_id: foto.plan_id,
            ipv4: foto.ipv4,
            prefijo_enlace_v6: foto.prefijo_enlace_v6,
            prefijo_v6: foto.prefijo_delegado_v6,
            motivo,
        })
    }
    return true
}

/** `GET /servicios/:id/asignaciones`: tramos del más reciente al más viejo, por cursor. */
export async function listarTramos(
    servicioId: number,
    opciones: OpcionesPaginacion,
    cliente: QueryClientContract = db.connection(),
): Promise<Pagina<TramoAsignacion>> {
    const consulta = cliente
        .from('network.asignaciones_historial as h')
        .leftJoin('network.routers as r', 'r.id', 'h.router_id')
        .leftJoin('network.planes as p', 'p.id', 'h.plan_id')
        .where('h.servicio_id', servicioId)
        .select(
            'h.id',
            'h.servicio_id',
            'h.router_id',
            'r.nombre as router_nombre',
            'h.plan_id',
            'p.nombre as plan_nombre',
            cliente.raw('host(h.ipv4) AS ipv4'),
            cliente.raw('h.prefijo_enlace_v6::text AS prefijo_enlace_v6'),
            cliente.raw('h.prefijo_v6::text AS prefijo_delegado_v6'),
            'h.inicio',
            'h.fin',
            'h.motivo',
        )
    return paginar<TramoAsignacion>(consulta, opciones, { columna: 'h.id' })
}
