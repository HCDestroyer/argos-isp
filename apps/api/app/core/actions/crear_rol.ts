import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { verRol, type RolVista } from '#core/consultas/acl'
import { reemplazarPermisosRol } from '#core/actions/editar_rol'

export interface EntradaCrearRol {
    nombre: string
    descripcion?: string | null
    permisos: string[]
}

/** Crea un rol propio del ISP con su lista de permisos. */
export default class CrearRol extends DomainAction<EntradaCrearRol, RolVista> {
    readonly nombre = 'roles.crear'

    protected async handle(input: EntradaCrearRol, t: Transaccion): Promise<RolVista> {
        const repetido = await t.trx.from('core.roles').where('nombre', input.nombre).first()
        if (repetido) throw new Conflicto(`Ya existe el rol ${input.nombre}`, 'rol_duplicado')

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.roles')
            .insert({ nombre: input.nombre, descripcion: input.descripcion ?? null })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('rol', id)
        await reemplazarPermisosRol(t, id, input.permisos)

        const rol = await verRol(id, t.trx)
        await t.registrarCambios({ tipo: 'rol', id }, null, {
            nombre: rol.nombre,
            descripcion: rol.descripcion,
            permisos: rol.permisos,
        })
        return rol
    }
}
