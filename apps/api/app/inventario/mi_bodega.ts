import db from '@adonisjs/lucid/services/db'
import { verBodega, type AccesoBodegas } from '#inventario/bodegas'
import { listarExistencias, listarKardex } from '#inventario/kardex'
import { listarUnidades } from '#inventario/unidades'
import { listarOrdenesTraslado } from '#inventario/ordenes_traslado'
import { bodegaDelUsuario, resolverTecnico, type TecnicoExterno } from '#inventario/tecnicos'

/**
 * `GET /inventario/mi-bodega` (fase D, `contratos/inventario.md` D.6): la bodega del técnico con sus
 * existencias, sus unidades (disponibles o en reparación), las órdenes de traslado que vienen hacia ella
 * y la primera página de su kardex (el resto con `GET /inventario/movimientos?bodega_id=`). Del usuario
 * que pregunta o, con `usuario_id`, `id_externo` o `correo` (la ruta exige alcance global), de otro
 * técnico. Sin bodega: 404 `sin_bodega`.
 */

export interface ConsultaMiBodega {
    usuario_id?: number
    id_externo?: string
    correo?: string
}

const LIMITE = 500

export async function miBodega(
    consulta: ConsultaMiBodega,
    usuarioActor: number,
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
    const bodegaId = await bodegaDelUsuario(cliente, usuarioId, empresas)
    const bodega = await verBodega(bodegaId)
    const [existencias, unidades, pendientes, kardex] = await Promise.all([
        listarExistencias({ bodega_id: bodegaId, limit: LIMITE }, empresas, acceso),
        listarUnidades({ bodega_id: bodegaId, limit: LIMITE }, empresas, acceso),
        listarOrdenesTraslado({ bodega_id: bodegaId, estado: 'en_transito', limit: 100 }, empresas, acceso),
        listarKardex({ bodega_id: bodegaId, limit: 50 }, empresas, acceso),
    ])
    return {
        bodega,
        existencias: existencias.data,
        unidades: unidades.data,
        traslados_pendientes: pendientes.data.filter((o) => o.bodega_destino_id === bodegaId),
        kardex,
    }
}
