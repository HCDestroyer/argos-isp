import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { actualizarConVersion } from '#shared/version'
import { verUsuario, type UsuarioVista } from '#core/consultas/acl'

export interface EntradaAsignarEmpresasUsuario {
    id: number
    version: number
    /** true = todas las empresas (y los consolidados); la lista se vacía */
    alcance_global: boolean
    /** empresas que puede operar sin alcance global (al menos una) */
    empresas?: number[]
}

/**
 * Define en qué empresas trabaja un usuario (`usuarios.asignar_empresas`): alcance global o una
 * lista de empresas activas (`core.usuarios_empresas`). Control optimista por `version` (409).
 *
 * - Sin alcance global hace falta al menos una empresa (422 en `empresas`); una empresa que no
 *   existe o está desactivada: 422 en `empresas.<i>`.
 * - Quien asigna solo reparte lo que tiene: dar alcance global exige tenerlo (403) y cada empresa
 *   de la lista debe estar en su alcance (403 `empresa_no_permitida`).
 * - Diff en `audit.cambios` (`alcance_global` y `empresas`). Las sesiones abiertas toman el nuevo
 *   alcance en la siguiente petición.
 */
export default class AsignarEmpresasUsuario extends DomainAction<
    EntradaAsignarEmpresasUsuario,
    UsuarioVista
> {
    readonly nombre = 'usuarios.asignar_empresas'

    protected async handle(input: EntradaAsignarEmpresasUsuario, t: Transaccion): Promise<UsuarioVista> {
        t.fijarEntidad('usuario', input.id)
        const antes = await verUsuario(input.id, t.trx)
        const empresas = input.alcance_global ? [] : [...new Set(input.empresas ?? [])].sort((a, b) => a - b)

        if (input.alcance_global) {
            const actor = t.ctx.empresasPermitidas
            if (actor !== null && actor !== undefined) {
                throw new Prohibido('Solo un usuario con alcance global puede dar alcance global')
            }
        } else {
            if (empresas.length === 0) {
                throw new ValidacionFallida([
                    {
                        field: 'empresas',
                        message: 'Sin alcance global hace falta al menos una empresa',
                        rule: 'required',
                    },
                ])
            }
            const activas = (await t.trx
                .from('core.empresas')
                .whereIn('id', empresas)
                .where('activa', true)
                .select('id')) as Array<{ id: number }>
            const ids = new Set(activas.map((e) => Number(e.id)))
            // el índice es el de la lista enviada
            const errores = (input.empresas ?? [])
                .map((id, i) => ({ id, i }))
                .filter(({ id }) => !ids.has(id))
                .map(({ i }) => ({
                    field: `empresas.${i}`,
                    message: 'La empresa no existe o está desactivada',
                    rule: 'exists',
                }))
            if (errores.length > 0) throw new ValidacionFallida(errores)
            for (const id of empresas) exigirAccesoEmpresa(t.ctx, id)
        }

        await actualizarConVersion(t.trx, 'core.usuarios', input.id, input.version, {
            alcance_global: input.alcance_global,
        })
        await t.trx.from('core.usuarios_empresas').where('usuario_id', input.id).delete()
        if (empresas.length > 0) {
            await t.trx
                .insertQuery()
                .table('core.usuarios_empresas')
                .multiInsert(empresas.map((empresaId) => ({ usuario_id: input.id, empresa_id: empresaId })))
        }

        const despues = await verUsuario(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'usuario', id: input.id },
            { alcance_global: antes.alcance_global, empresas: antes.empresas },
            { alcance_global: despues.alcance_global, empresas: despues.empresas },
        )
        return despues
    }
}
