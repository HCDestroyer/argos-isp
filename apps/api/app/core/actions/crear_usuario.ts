import hash from '@adonisjs/core/services/hash'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    describirAsignaciones,
    reemplazarAsignaciones,
    type AsignacionRolEntrada,
} from '#core/asignaciones_rol'
import { verUsuario, type UsuarioVista } from '#core/consultas/acl'

export interface EntradaCrearUsuario {
    nombre: string
    email: string
    password: string
    activo?: boolean
    roles?: AsignacionRolEntrada[]
}

/**
 * Crea un usuario del panel (o la identidad de un token de API) con sus roles y alcances.
 *
 * Multiempresa: lo crea con alcance global (como siempre) si quien lo crea lo tiene; si no, queda
 * acotado a la empresa activa de quien lo crea (o a todas las de su alcance). Después se ajusta con
 * `usuarios.asignar_empresas`.
 */
export default class CrearUsuario extends DomainAction<EntradaCrearUsuario, UsuarioVista> {
    readonly nombre = 'usuarios.crear'

    protected async handle(input: EntradaCrearUsuario, t: Transaccion): Promise<UsuarioVista> {
        const email = input.email.toLowerCase()
        const repetido = await t.trx.from('core.usuarios').whereRaw('lower(email) = ?', [email]).first()
        if (repetido) throw new Conflicto(`Ya existe un usuario con el correo ${email}`, 'email_duplicado')
        const permitidas = t.ctx.empresasPermitidas
        const acotadas =
            permitidas === null || permitidas === undefined
                ? null
                : t.ctx.empresaId
                  ? [t.ctx.empresaId]
                  : permitidas

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.usuarios')
            .insert({
                nombre: input.nombre,
                email,
                password_hash: await hash.use('scrypt').make(input.password),
                activo: input.activo ?? true,
                alcance_global: acotadas === null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('usuario', id)
        if (acotadas && acotadas.length > 0) {
            await t.trx
                .insertQuery()
                .table('core.usuarios_empresas')
                .multiInsert(acotadas.map((empresaId) => ({ usuario_id: id, empresa_id: empresaId })))
        }

        await reemplazarAsignaciones(t.trx, id, input.roles ?? [])
        const usuario = await verUsuario(id, t.trx)
        await t.registrarCambios({ tipo: 'usuario', id }, null, {
            nombre: usuario.nombre,
            email: usuario.email,
            activo: usuario.activo,
            roles: describirAsignaciones(usuario.roles),
            alcance_global: usuario.alcance_global,
            empresas: usuario.empresas,
        })
        return usuario
    }
}
