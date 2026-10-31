import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * El técnico y su bodega (fase D, `contratos/inventario.md` D.6; `contratos/iris.md` §3.3, 0.5.0). La
 * bodega de un técnico es la bodega `tecnico` activa con `usuario_id` = su usuario de Argos, una por
 * usuario y empresa.
 *
 * - `tecnico` es `{ id_externo }` (el id del usuario de Argos; Iris lo toma de `GET /inventario/tecnicos`)
 *   o `{ correo }` (sin distinguir mayúsculas; solo si coincide con un único usuario activo, si no 422
 *   `tecnico_ambiguo`). Si llegan los dos, manda `id_externo`.
 * - La bodega es la de la empresa de la operación: la del servicio; sin servicio, la empresa activa
 *   (`X-Empresa-Id`); sin ninguna y con bodegas en varias empresas, 422 `empresa_requerida`.
 * - Los errores llevan su código en `type` (y en `errors[].rule`): `tecnico_no_encontrado`,
 *   `tecnico_ambiguo`, `tecnico_sin_bodega` (422 en escrituras, 404 en `mi-bodega`) y `empresa_requerida`.
 */

export interface TecnicoExterno {
    id_externo?: string | number | null
    correo?: string | null
}

export function errorTecnico(
    status: number,
    codigo: 'tecnico_no_encontrado' | 'tecnico_ambiguo' | 'tecnico_sin_bodega' | 'empresa_requerida',
    detalle: string,
    campo = 'tecnico',
): Problema {
    const titulos = {
        tecnico_no_encontrado: 'Técnico no encontrado',
        tecnico_ambiguo: 'Técnico ambiguo',
        tecnico_sin_bodega: 'Técnico sin bodega',
        empresa_requerida: 'Empresa requerida',
    }
    return new Problema(status, codigo, titulos[codigo], detalle, [
        { field: campo, message: detalle, rule: codigo },
    ])
}

/** Usuario de Argos del técnico; 422 `tecnico_no_encontrado` o `tecnico_ambiguo` (en `campo`). */
export async function resolverTecnico(
    t: Transaccion | { trx: QueryClientContract },
    tecnico: TecnicoExterno,
    campo = 'tecnico',
): Promise<number> {
    const idTexto =
        tecnico.id_externo === null || tecnico.id_externo === undefined
            ? ''
            : String(tecnico.id_externo).trim()
    const correo = (tecnico.correo ?? '').trim()
    if (!idTexto && !correo) {
        throw errorTecnico(
            422,
            'tecnico_no_encontrado',
            'Identifica al técnico con id_externo o correo',
            campo,
        )
    }
    if (idTexto) {
        const fila = /^\d{1,18}$/.test(idTexto)
            ? await t.trx
                  .from('core.usuarios')
                  .where({ id: Number(idTexto), activo: true })
                  .select('id')
                  .first()
            : null
        if (!fila) {
            throw errorTecnico(
                422,
                'tecnico_no_encontrado',
                `El usuario ${idTexto} no existe o está inactivo`,
                campo,
            )
        }
        return Number(fila.id)
    }
    const filas = (await t.trx
        .from('core.usuarios')
        .whereRaw('lower(email) = lower(?)', [correo])
        .where('activo', true)
        .select('id')
        .limit(2)) as Array<{ id: number }>
    if (filas.length === 0) {
        throw errorTecnico(
            422,
            'tecnico_no_encontrado',
            `No hay un usuario activo con el correo ${correo}`,
            campo,
        )
    }
    if (filas.length > 1) {
        throw errorTecnico(
            422,
            'tecnico_ambiguo',
            `El correo ${correo} es de más de un usuario activo: usa id_externo`,
            campo,
        )
    }
    return Number(filas[0]!.id)
}

/** Bodegas activas de técnico del usuario: `{ id, empresa_id }` en orden de empresa. */
export async function bodegasDelUsuario(
    cliente: QueryClientContract,
    usuarioId: number,
    empresas: number[] | null,
): Promise<Array<{ id: number; empresa_id: number }>> {
    const q = cliente
        .from('inventario.bodegas')
        .where({ usuario_id: usuarioId, tipo: 'tecnico', activo: true })
        .orderBy('empresa_id')
        .select('id', 'empresa_id')
    if (empresas) q.whereIn('empresa_id', empresas)
    const filas = (await q) as Array<{ id: number; empresa_id: number }>
    return filas.map((f) => ({ id: Number(f.id), empresa_id: Number(f.empresa_id) }))
}

/** Bodega activa del técnico en la empresa; `tecnico_sin_bodega` (422, o el status dado) si no tiene. */
export async function bodegaDelTecnico(
    cliente: QueryClientContract,
    usuarioId: number,
    empresaId: number,
    campo = 'tecnico',
    status = 422,
): Promise<number> {
    const [bodega] = await bodegasDelUsuario(cliente, usuarioId, [empresaId])
    if (!bodega) {
        throw errorTecnico(
            status,
            'tecnico_sin_bodega',
            `El usuario ${usuarioId} no tiene bodega de técnico activa en la empresa ${empresaId}`,
            campo,
        )
    }
    return bodega.id
}

/**
 * Empresa de una operación del técnico sin servicio: la activa (`X-Empresa-Id`) o, si el técnico tiene
 * bodegas en una sola empresa, esa. Con varias y sin empresa: 422 `empresa_requerida`.
 */
export async function empresaDelTecnico(
    cliente: QueryClientContract,
    usuarioId: number,
    empresaActiva: number | null | undefined,
    empresas: number[] | null,
    campo = 'tecnico',
): Promise<number> {
    if (empresaActiva) return empresaActiva
    const bodegas = await bodegasDelUsuario(cliente, usuarioId, empresas)
    const distintas = [...new Set(bodegas.map((b) => b.empresa_id))]
    if (distintas.length === 1) return distintas[0]!
    if (distintas.length === 0) {
        throw errorTecnico(
            422,
            'tecnico_sin_bodega',
            `El usuario ${usuarioId} no tiene bodega de técnico activa`,
            campo,
        )
    }
    throw errorTecnico(
        422,
        'empresa_requerida',
        'El técnico tiene bodegas en varias empresas: indica la empresa (X-Empresa-Id o el servicio)',
        'empresa_id',
    )
}

export interface TecnicoVista {
    id_externo: string
    correo: string
    nombre: string
    bodegas: Array<{ id: number; empresa_id: number; activa: boolean }>
}

/**
 * `GET /inventario/tecnicos` (0.5.0): usuarios con al menos una bodega `tecnico` en las empresas
 * visibles, con sus bodegas (activas o no). `id_externo` = el id del usuario de Argos, como texto.
 */
export async function listarTecnicos(filtros: OpcionesPaginacion, empresas: number[] | null) {
    const q = db
        .from('core.usuarios as u')
        .whereExists((e) => {
            e.from('inventario.bodegas as b').whereRaw('b.usuario_id = u.id').where('b.tipo', 'tecnico')
            if (empresas) e.whereIn('b.empresa_id', empresas)
        })
        .select('u.id', 'u.email', 'u.nombre')
    const pagina = await paginar<{ id: number; email: string; nombre: string }>(q, filtros, {
        columna: 'u.id',
        direccion: 'asc',
    })
    const ids = pagina.data.map((u) => Number(u.id))
    const bodegas = ids.length
        ? ((await db
              .from('inventario.bodegas')
              .whereIn('usuario_id', ids)
              .where('tipo', 'tecnico')
              .if(empresas !== null, (c) => c.whereIn('empresa_id', empresas!))
              .orderBy('id')
              .select('id', 'empresa_id', 'usuario_id', 'activo')) as Array<{
              id: number
              empresa_id: number
              usuario_id: number
              activo: boolean
          }>)
        : []
    return {
        data: pagina.data.map((u): TecnicoVista => ({
            id_externo: String(u.id),
            correo: u.email,
            nombre: u.nombre,
            bodegas: bodegas
                .filter((b) => Number(b.usuario_id) === Number(u.id))
                .map((b) => ({
                    id: Number(b.id),
                    empresa_id: Number(b.empresa_id),
                    activa: Boolean(b.activo),
                })),
        })),
        nextCursor: pagina.nextCursor,
    }
}

/** `{ id_externo, correo }` de un usuario (payload de los eventos de traslado); null sin usuario. */
export async function tecnicoDeUsuario(
    cliente: QueryClientContract,
    usuarioId: number | null,
): Promise<{ id_externo: string; correo: string } | null> {
    if (!usuarioId) return null
    const fila = await cliente.from('core.usuarios').where('id', usuarioId).select('id', 'email').first()
    return fila ? { id_externo: String(fila.id), correo: String(fila.email) } : null
}
