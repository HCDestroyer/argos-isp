import hash from '@adonisjs/core/services/hash'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { usuarioDelActor } from '#shared/contexto'
import {
    asignacionesActuales,
    describirAsignaciones,
    reemplazarAsignaciones,
    type AsignacionRolEntrada,
} from '#core/asignaciones_rol'
import { verUsuario, type UsuarioVista } from '#core/consultas/acl'

export interface EntradaEditarUsuario {
    id: number
    version: number
    nombre?: string
    email?: string
    password?: string
    activo?: boolean
    roles?: AsignacionRolEntrada[]
}

/**
 * Edita datos, contraseña, estado y roles de un usuario. Control optimista por `version` (409).
 * Desactivar o cambiar la contraseña revoca sus sesiones de login abiertas.
 */
export default class EditarUsuario extends DomainAction<EntradaEditarUsuario, UsuarioVista> {
    readonly nombre = 'usuarios.editar'

    protected async handle(input: EntradaEditarUsuario, t: Transaccion): Promise<UsuarioVista> {
        t.fijarEntidad('usuario', input.id)
        if (input.activo === false && usuarioDelActor(t.ctx.actor) === input.id) {
            throw new ReglaNegocio('No puedes desactivar tu propio usuario', 'autodesactivacion')
        }

        const antes = await verUsuario(input.id, t.trx)
        const cambios: Record<string, unknown> = {}
        if (input.nombre !== undefined) cambios.nombre = input.nombre
        if (input.activo !== undefined) cambios.activo = input.activo
        if (input.email !== undefined) {
            const email = input.email.toLowerCase()
            const repetido = await t.trx
                .from('core.usuarios')
                .whereRaw('lower(email) = ?', [email])
                .whereNot('id', input.id)
                .first()
            if (repetido) {
                throw new Conflicto(`Ya existe un usuario con el correo ${email}`, 'email_duplicado')
            }
            cambios.email = email
        }
        if (input.password !== undefined) {
            cambios.password_hash = await hash.use('scrypt').make(input.password)
        }

        // La versión se verifica (y se incrementa) aunque solo cambien los roles.
        await actualizarConVersion(t.trx, 'core.usuarios', input.id, input.version, cambios)

        const rolesAntes = await asignacionesActuales(t.trx, input.id)
        if (input.roles !== undefined) await reemplazarAsignaciones(t.trx, input.id, input.roles)

        if (input.password !== undefined || input.activo === false) {
            await t.trx.from('core.auth_access_tokens').where('tokenable_id', input.id).delete()
        }

        const despues = await verUsuario(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'usuario', id: input.id },
            {
                nombre: antes.nombre,
                email: antes.email,
                activo: antes.activo,
                roles: rolesAntes,
            },
            {
                nombre: despues.nombre,
                email: despues.email,
                activo: despues.activo,
                roles: describirAsignaciones(despues.roles),
                // la contraseña nunca se audita; solo que cambió
                ...(input.password !== undefined ? { clave_cambiada: true } : {}),
            },
        )
        return despues
    }
}
