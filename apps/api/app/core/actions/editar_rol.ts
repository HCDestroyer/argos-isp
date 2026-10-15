import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verRol, type RolVista } from '#core/consultas/acl'
import { ROLES_BASE } from '#core/permisos'

export interface EntradaEditarRol {
    id: number
    version: number
    descripcion?: string | null
    permisos?: string[]
}

/** Reemplaza los permisos de un rol (los nombres se validan contra `core.permisos`). */
export async function reemplazarPermisosRol(t: Transaccion, roleId: number, permisos: string[]) {
    const unicos = [...new Set(permisos)]
    const filas = (await t.trx
        .from('core.permisos')
        .whereIn('nombre', unicos)
        .select('id', 'nombre')) as Array<{
        id: number
        nombre: string
    }>
    if (filas.length !== unicos.length) {
        const conocidos = new Set(filas.map((f) => f.nombre))
        throw new ValidacionFallida(
            unicos
                .filter((p) => !conocidos.has(p))
                .map((p) => ({ field: 'permisos', message: `Permiso desconocido: ${p}`, rule: 'exists' })),
        )
    }
    await t.trx.from('core.roles_permisos').where('role_id', roleId).delete()
    if (filas.length > 0) {
        await t.trx
            .insertQuery()
            .table('core.roles_permisos')
            .multiInsert(filas.map((f) => ({ role_id: roleId, permiso_id: f.id })))
    }
}

/**
 * Edita la descripción y los permisos de un rol. Los permisos de los roles base (`admin`,
 * `cajero`…) se definen en código (`app/core/permisos.ts`) y el seed los sincroniza: aquí no se
 * cambian; para otra combinación se crea un rol propio.
 */
export default class EditarRol extends DomainAction<EntradaEditarRol, RolVista> {
    readonly nombre = 'roles.editar'

    protected async handle(input: EntradaEditarRol, t: Transaccion): Promise<RolVista> {
        t.fijarEntidad('rol', input.id)
        const antes = await verRol(input.id, t.trx)
        if (input.permisos !== undefined && Object.hasOwn(ROLES_BASE, antes.nombre)) {
            throw new ReglaNegocio(
                `Los permisos del rol base ${antes.nombre} se definen en código; crea un rol propio`,
                'rol_base',
            )
        }

        const cambios: Record<string, unknown> = {}
        if (input.descripcion !== undefined) cambios.descripcion = input.descripcion
        await actualizarConVersion(t.trx, 'core.roles', input.id, input.version, cambios)
        if (input.permisos !== undefined) await reemplazarPermisosRol(t, input.id, input.permisos)

        const despues = await verRol(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'rol', id: input.id },
            { descripcion: antes.descripcion, permisos: antes.permisos },
            { descripcion: despues.descripcion, permisos: despues.permisos },
        )
        return despues
    }
}
