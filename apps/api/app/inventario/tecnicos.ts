import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'

/**
 * El técnico y su bodega (fase D, `contratos/inventario.md` D.6). La bodega de un técnico es la bodega
 * `tecnico` activa con `usuario_id` = su usuario de Argos (una por usuario y empresa).
 *
 * Desde Iris el técnico llega como `{ id_externo }` (el id de su usuario de Argos: el mismo
 * `usuario.id_externo` que Argos manda en el autologin hacia Iris y que Iris guarda en el vínculo) o
 * `{ correo }` (el de su usuario de Argos, sin distinguir mayúsculas). `id_externo` tiene prioridad.
 */

export interface TecnicoExterno {
    id_externo?: string | number | null
    correo?: string | null
}

/** Usuario de Argos del técnico; 422 en `campo` si no existe o está inactivo. */
export async function resolverTecnico(
    t: Transaccion | { trx: QueryClientContract },
    tecnico: TecnicoExterno,
    campo = 'tecnico',
): Promise<number> {
    const noEncontrado = (detalle: string) =>
        new ValidacionFallida([{ field: campo, message: detalle, rule: 'tecnico_no_encontrado' }])
    const idTexto =
        tecnico.id_externo === null || tecnico.id_externo === undefined
            ? ''
            : String(tecnico.id_externo).trim()
    const correo = (tecnico.correo ?? '').trim()
    if (!idTexto && !correo) {
        throw new ValidacionFallida([
            { field: campo, message: 'Identifica al técnico con id_externo o correo', rule: 'required' },
        ])
    }
    if (idTexto) {
        if (!/^\d{1,18}$/.test(idTexto)) throw noEncontrado(`id_externo ${idTexto} no es un usuario de Argos`)
        const fila = await t.trx
            .from('core.usuarios')
            .where({ id: Number(idTexto), activo: true })
            .select('id')
            .first()
        if (!fila) throw noEncontrado(`El usuario ${idTexto} no existe o está inactivo`)
        return Number(fila.id)
    }
    const fila = await t.trx
        .from('core.usuarios')
        .whereRaw('lower(email) = lower(?)', [correo])
        .where('activo', true)
        .select('id')
        .first()
    if (!fila) throw noEncontrado(`No hay un usuario activo con el correo ${correo}`)
    return Number(fila.id)
}

/** Bodega activa del técnico en la empresa; 422 `tecnico_sin_bodega` (en `campo`) si no tiene. */
export async function bodegaDelTecnico(
    cliente: QueryClientContract,
    usuarioId: number,
    empresaId: number,
    campo = 'tecnico',
): Promise<number> {
    const fila = await cliente
        .from('inventario.bodegas')
        .where({ empresa_id: empresaId, usuario_id: usuarioId, tipo: 'tecnico', activo: true })
        .select('id')
        .first()
    if (!fila) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: `El usuario ${usuarioId} no tiene bodega de técnico activa en la empresa ${empresaId}`,
                rule: 'tecnico_sin_bodega',
            },
        ])
    }
    return Number(fila.id)
}

/** Bodega del técnico para lecturas (`GET /inventario/mi-bodega`): 404 `sin_bodega` si no tiene. */
export async function bodegaDelUsuario(
    cliente: QueryClientContract,
    usuarioId: number,
    empresas: number[] | null,
): Promise<number> {
    const q = cliente
        .from('inventario.bodegas')
        .where({ usuario_id: usuarioId, tipo: 'tecnico', activo: true })
        .orderBy('id')
        .select('id')
    if (empresas) q.whereIn('empresa_id', empresas)
    const fila = await q.first()
    if (!fila) {
        throw new Problema(
            404,
            'sin_bodega',
            'Sin bodega',
            `El usuario ${usuarioId} no tiene bodega de técnico activa`,
        )
    }
    return Number(fila.id)
}
