import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verBodega, type AccesoBodegas } from '#inventario/bodegas'
import { cuadrillasDelTecnico } from '#inventario/cuadrillas'
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
 * - Bodega de cuadrilla (Iris 0.11.0 §3.9): con empresa, `bodegas[]` trae primero las cuadrillas de las
 *   que es miembro (`cuadrilla: true`, con su `jefe { id_externo, nombre }` o null) y después la personal,
 *   cada una con su contenido; arriba queda la personal (o la primera cuadrilla si no tiene personal).
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
    if (empresaId) {
        // A47 (Iris 0.11.0 §3.9): primero sus cuadrillas en esa empresa, después la personal
        const cuadrillas = await cuadrillasDelTecnico(cliente, usuarioId, empresaId)
        const [personal] = await bodegasDelUsuario(cliente, usuarioId, [empresaId])
        const ids = [...cuadrillas, ...(personal ? [personal.id] : [])]
        if (ids.length === 0) await bodegaDelTecnico(cliente, usuarioId, empresaId, 'tecnico', 404)
        const bodegas = []
        for (const id of ids) bodegas.push(await contenidoDeBodega(cliente, id, empresas, acceso))
        const principal = bodegas.find((b) => b.bodega.id === personal?.id) ?? bodegas[0]!
        return { ...principal, bodegas }
    }
    const bodegas = await bodegasDelUsuario(cliente, usuarioId, empresas)
    if (bodegas.length === 0) {
        throw errorTecnico(
            404,
            'tecnico_sin_bodega',
            `El usuario ${usuarioId} no tiene bodega de técnico activa`,
        )
    }
    if (bodegas.length > 1) {
        const vistas = []
        for (const b of bodegas) vistas.push({ ...(await verBodega(b.id)), cuadrilla: false, jefe: null })
        return { bodegas: vistas }
    }
    const unica = await contenidoDeBodega(cliente, bodegas[0]!.id, empresas, acceso)
    return { ...unica, bodegas: [unica] }
}

/** Una bodega del técnico con todo lo suyo (y, si es de cuadrilla, su jefe). */
async function contenidoDeBodega(
    cliente: QueryClientContract,
    bodegaId: number,
    empresas: number[] | null,
    acceso: AccesoBodegas,
) {
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
    const esCuadrilla = bodega.tipo === 'cuadrilla'
    let jefe: { id_externo: string; nombre: string } | null = null
    if (esCuadrilla && bodega.jefe_id !== null) {
        const fila = await cliente.from('core.usuarios').where('id', bodega.jefe_id).select('nombre').first()
        jefe = { id_externo: String(bodega.jefe_id), nombre: String(fila?.nombre ?? '') }
    }
    return {
        id: bodega.id,
        empresa_id: bodega.empresa_id,
        nombre: bodega.nombre,
        bodega,
        cuadrilla: esCuadrilla,
        jefe,
        existencias,
        unidades,
        traslados_pendientes: pendientes.filter((o) => o.bodega_destino_id === bodegaId),
        kardex,
    }
}
