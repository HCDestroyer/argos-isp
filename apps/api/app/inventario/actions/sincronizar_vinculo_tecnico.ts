import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { empresaEnAlcanceIris, validarTecnicoDeEmpresa } from '#inventario/vinculos_iris'

/**
 * `inventario.sincronizar_vinculo_tecnico`: aplica el vínculo de un técnico de Iris con su usuario de
 * Argos (contrato Iris 0.14.0 §6.6, R-10, T-6, N-2, N-3). Lo llaman el receptor de webhooks de Iris
 * (`tecnico.argos_vinculado` / `tecnico.argos_desvinculado`, origen `webhook`) y la conciliación con
 * `GET <iris>/…/tecnicos/:usuario_id` (origen `conciliacion`), con el actor `sistema` o el de la persona
 * que concilia desde el panel.
 *
 * - Una fila por usuario de Iris y empresa. El webhook solo aplica una `version` **mayor** que la guardada
 *   (`version_vieja`); la conciliación aplica también la misma versión (vuelve a validar lo mismo que dice
 *   Iris: así se reevalúa un rechazo cuando cambió algo en Argos).
 * - `activo: true` (vinculado): el `id_externo` debe ser un usuario activo, técnico de la empresa (bodega o
 *   rol `tecnico` con la empresa en su alcance), y no puede estar vinculado a otro usuario de Iris (en
 *   ninguna empresa: `id_externo_en_uso`). Si no, queda `rechazado` con su motivo (`vinculo_rechazado` en
 *   el panel).
 * - `activo: false` (desvinculado o `activo: false` de la conciliación): queda `desvinculado` con el motivo
 *   de Iris (`desactivado`). Si liberó un `id_externo`, los rechazados por `id_externo_en_uso` sobre ese
 *   mismo id quedan para reevaluar (`reevaluar_en`): el worker los concilia con Iris (N-2).
 * - Fuera del alcance de empresas del usuario técnico Iris: `fuera_de_alcance`, sin cambios.
 * - Cada cambio deja su diff en `audit.cambios` y emite `inventario.vinculo_tecnico_cambiado`.
 */

export interface EntradaSincronizarVinculoTecnico {
    empresa_id: number
    /** usuario de Iris del técnico */
    usuario_id: string | number
    tecnico_id?: string | number | null
    id_externo?: string | number | null
    version: number
    activo: boolean
    /** motivo de Iris al desvincular (`desactivado`) */
    motivo?: string | null
    origen: 'webhook' | 'conciliacion'
}

export interface ResultadoSincronizarVinculoTecnico {
    aplicado: boolean
    /** sin aplicar: `version_vieja`, `fuera_de_alcance`, `empresa_inexistente` */
    ignorado: string | null
    vinculo_id: number | null
    estado: 'vinculado' | 'rechazado' | 'desvinculado' | null
    motivo: string | null
    /** rechazados que quedaron para reevaluar porque este desvínculo liberó su `id_externo` */
    reevaluar: number
}

const ID_IRIS = /^[A-Za-z0-9_-]{1,64}$/
const MOTIVO = /^[a-z_]{1,40}$/

function textoId(valor: unknown): string | null {
    if (valor === null || valor === undefined) return null
    const t = String(valor).trim()
    return t === '' ? null : t.slice(0, 100)
}

interface FilaVinculo {
    id: number
    iris_tecnico_id: string | null
    id_externo: string | null
    usuario_id: number | null
    estado: 'vinculado' | 'rechazado' | 'desvinculado'
    motivo: string | null
    version: number
    reevaluar_en: Date | null
}

export default class SincronizarVinculoTecnico extends DomainAction<
    EntradaSincronizarVinculoTecnico,
    ResultadoSincronizarVinculoTecnico
> {
    readonly nombre = 'inventario.sincronizar_vinculo_tecnico'

    protected async handle(
        input: EntradaSincronizarVinculoTecnico,
        t: Transaccion,
    ): Promise<ResultadoSincronizarVinculoTecnico> {
        const irisUsuario = textoId(input.usuario_id)
        if (!irisUsuario || !ID_IRIS.test(irisUsuario)) {
            throw new ValidacionFallida([{ field: 'usuario_id', message: 'Id inválido', rule: 'formato' }])
        }
        if (!Number.isSafeInteger(input.version) || input.version < 1) {
            throw new ValidacionFallida([{ field: 'version', message: 'Entero ≥ 1', rule: 'version' }])
        }
        const empresaId = Number(input.empresa_id)
        t.fijarEmpresa(empresaId)
        const nada = (
            ignorado: string,
            fila: FilaVinculo | null = null,
        ): ResultadoSincronizarVinculoTecnico => ({
            aplicado: false,
            ignorado,
            vinculo_id: fila ? Number(fila.id) : null,
            estado: fila?.estado ?? null,
            motivo: fila?.motivo ?? null,
            reevaluar: 0,
        })
        const empresa = await t.trx.from('core.empresas').where('id', empresaId).select('id').first()
        if (!empresa) return nada('empresa_inexistente')
        if (!(await empresaEnAlcanceIris(t.trx, empresaId))) return nada('fuera_de_alcance')

        const idExterno = textoId(input.id_externo)
        // serializa por usuario de Iris y por id_externo (varias instancias, dos webhooks a la vez)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
            `inventario:vinculo:${empresaId}:${irisUsuario}`,
        ])
        if (idExterno) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
                `inventario:id_externo:${idExterno}`,
            ])
        }
        const antes = (await t.trx
            .from('inventario.tecnicos_iris')
            .where({ empresa_id: empresaId, iris_usuario_id: irisUsuario })
            .forUpdate()
            .select(
                'id',
                'iris_tecnico_id',
                'id_externo',
                'usuario_id',
                'estado',
                'motivo',
                'version',
                'reevaluar_en',
            )
            .first()) as FilaVinculo | null
        if (antes) {
            const guardada = Number(antes.version)
            const vieja = input.origen === 'webhook' ? input.version <= guardada : input.version < guardada
            if (vieja) return nada('version_vieja', antes)
        }

        let estado: FilaVinculo['estado']
        let motivo: string | null
        let usuarioId: number | null
        if (!input.activo) {
            estado = 'desvinculado'
            const m = input.motivo?.trim() ?? null
            motivo = m && MOTIVO.test(m) ? m : null
            usuarioId =
                antes?.usuario_id === null || antes?.usuario_id === undefined
                    ? null
                    : Number(antes.usuario_id)
        } else {
            const v = await validarTecnicoDeEmpresa(t.trx, idExterno, empresaId)
            usuarioId = v.usuarioId
            motivo = v.motivo
            if (!motivo && usuarioId !== null) {
                const otro = await t.trx
                    .from('inventario.tecnicos_iris')
                    .where({ usuario_id: usuarioId, estado: 'vinculado' })
                    .whereNot('iris_usuario_id', irisUsuario)
                    .select('id')
                    .first()
                if (otro) motivo = 'id_externo_en_uso'
            }
            estado = motivo ? 'rechazado' : 'vinculado'
        }

        const datos = {
            iris_tecnico_id: textoId(input.tecnico_id),
            id_externo: idExterno,
            usuario_id: usuarioId,
            estado,
            motivo,
            version: input.version,
            origen: input.origen,
            reevaluar_en: null,
            updated_at: t.trx.knexRawQuery('now()'),
        }
        let id: number
        if (antes) {
            await t.trx
                .from('inventario.tecnicos_iris')
                .where('id', antes.id)
                .update(datos as Record<string, unknown>)
            id = Number(antes.id)
        } else {
            const [fila] = (await t.trx
                .insertQuery()
                .table('inventario.tecnicos_iris')
                .insert({ ...datos, empresa_id: empresaId, iris_usuario_id: irisUsuario })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        }
        t.fijarEntidad('vinculo_tecnico_iris', id)

        // N-2: un desvínculo que libera un id_externo reevalúa los rechazados por unicidad sobre ese id
        let reevaluar = 0
        const liberado = antes?.estado === 'vinculado' && estado !== 'vinculado' ? antes.usuario_id : null
        if (liberado !== null && liberado !== undefined) {
            reevaluar = Number(
                await t.trx
                    .from('inventario.tecnicos_iris')
                    .where({ estado: 'rechazado', motivo: 'id_externo_en_uso', usuario_id: Number(liberado) })
                    .update({
                        reevaluar_en: t.trx.knexRawQuery('now()'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    }),
            )
        }

        const plano = (f: Partial<FilaVinculo> | null) =>
            f
                ? {
                      id_externo: f.id_externo ?? null,
                      usuario_id:
                          f.usuario_id === null || f.usuario_id === undefined ? null : Number(f.usuario_id),
                      estado: f.estado ?? null,
                      motivo: f.motivo ?? null,
                      version: f.version === undefined ? null : Number(f.version),
                  }
                : null
        const despues = plano({
            id_externo: idExterno,
            usuario_id: usuarioId,
            estado,
            motivo,
            version: input.version,
        })
        await t.registrarCambios({ tipo: 'vinculo_tecnico_iris', id }, plano(antes), despues)
        const cambio =
            !antes ||
            antes.estado !== estado ||
            Number(antes.usuario_id ?? 0) !== Number(usuarioId ?? 0) ||
            antes.motivo !== motivo
        if (cambio) {
            await t.emit('inventario.vinculo_tecnico_cambiado', {
                vinculo_id: id,
                empresa_id: empresaId,
                iris_usuario_id: irisUsuario,
                usuario_id: usuarioId,
                estado,
                anterior: antes?.estado ?? null,
                motivo,
                version: input.version,
                origen: input.origen,
            })
        }
        return { aplicado: true, ignorado: null, vinculo_id: id, estado, motivo, reevaluar }
    }
}
