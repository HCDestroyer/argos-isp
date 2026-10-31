import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verBodega, type AccesoBodegas, type BodegaVista } from '#inventario/bodegas'
import { listarExistencias, verMovimiento, type MovimientoVista } from '#inventario/kardex'
import { listarUnidades } from '#inventario/unidades'
import { listarOrdenesTraslado } from '#inventario/ordenes_traslado'
import {
    bodegaDelTecnico,
    bodegasDelUsuario,
    errorTecnico,
    resolverTecnico,
    type TecnicoExterno,
} from '#inventario/tecnicos'

/**
 * `GET /inventario/mi-bodega` (fase D, `contratos/inventario.md` D.6; `contratos/iris.md` §3.3): la bodega
 * del técnico en una empresa con sus existencias, sus unidades (disponibles o en reparación) y las órdenes
 * de traslado que vienen hacia ella, completas, y los últimos 50 movimientos de su kardex (el resto con
 * `GET /inventario/movimientos?bodega_id=`). Del usuario que pregunta o, con `usuario_id`, `id_externo` o
 * `correo` (la ruta exige alcance global), de otro técnico.
 *
 * - Empresa: `empresa_id` o la activa (`X-Empresa-Id`). Sin ninguna y con bodegas en varias empresas
 *   responde `{ bodegas: [...] }` (una por empresa) para que se elija.
 * - Sin bodega: 404 `tecnico_sin_bodega`.
 */

export interface ConsultaMiBodega {
    empresa_id?: number
    usuario_id?: number
    id_externo?: string
    correo?: string
}

/** Todas las páginas de una lista por cursor. */
async function todas<T>(
    leer: (cursor?: string) => Promise<{ data: T[]; nextCursor: string | null }>,
): Promise<T[]> {
    const salida: T[] = []
    let cursor: string | undefined
    for (;;) {
        const pagina = await leer(cursor)
        salida.push(...pagina.data)
        if (!pagina.nextCursor) return salida
        cursor = pagina.nextCursor
    }
}

/** Los últimos `n` movimientos de la bodega (los más recientes primero), con su saldo corrido. */
async function ultimosMovimientos(cliente: QueryClientContract, bodegaId: number, n: number) {
    const ids = (await cliente
        .from('inventario.movimientos')
        .where('bodega_id', bodegaId)
        .orderBy('id', 'desc')
        .limit(n)
        .select('id')) as Array<{ id: number }>
    const movimientos: MovimientoVista[] = []
    for (const { id } of ids) movimientos.push(await verMovimiento(Number(id), cliente))
    return movimientos
}

export async function miBodega(
    consulta: ConsultaMiBodega,
    usuarioActor: number,
    empresaActiva: number | null,
    empresas: number[] | null,
    acceso: AccesoBodegas,
) {
    const cliente = db.connection()
    let usuarioId = usuarioActor
    if (consulta.usuario_id) usuarioId = consulta.usuario_id
    else if (consulta.id_externo || consulta.correo) {
        const tecnico: TecnicoExterno = { id_externo: consulta.id_externo, correo: consulta.correo }
        usuarioId = await resolverTecnico({ trx: cliente }, tecnico)
    }
    const empresaId = consulta.empresa_id ?? empresaActiva ?? null
    let bodegaId: number
    if (empresaId) {
        bodegaId = await bodegaDelTecnico(cliente, usuarioId, empresaId, 'tecnico', 404)
    } else {
        const bodegas = await bodegasDelUsuario(cliente, usuarioId, empresas)
        if (bodegas.length === 0) {
            throw errorTecnico(
                404,
                'tecnico_sin_bodega',
                `El usuario ${usuarioId} no tiene bodega de técnico activa`,
            )
        }
        if (bodegas.length > 1) {
            const vistas: BodegaVista[] = []
            for (const b of bodegas) vistas.push(await verBodega(b.id))
            return { bodegas: vistas }
        }
        bodegaId = bodegas[0]!.id
    }
    const bodega = await verBodega(bodegaId)
    const [existencias, unidades, pendientes, kardex] = await Promise.all([
        todas((cursor) => listarExistencias({ bodega_id: bodegaId, limit: 100, cursor }, empresas, acceso)),
        todas((cursor) => listarUnidades({ bodega_id: bodegaId, limit: 100, cursor }, empresas, acceso)),
        todas((cursor) =>
            listarOrdenesTraslado(
                { bodega_id: bodegaId, estado: 'en_transito', limit: 100, cursor },
                empresas,
                acceso,
            ),
        ),
        ultimosMovimientos(cliente, bodegaId, 50),
    ])
    return {
        bodega,
        existencias,
        unidades,
        traslados_pendientes: pendientes.filter((o) => o.bodega_destino_id === bodegaId),
        kardex,
    }
}
