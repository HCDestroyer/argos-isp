import { randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import CrearRol from '#core/actions/crear_rol'
import { reemplazarPermisosRol } from '#core/actions/editar_rol'
import CrearUsuario from '#core/actions/crear_usuario'
import { NOMBRES_PERMISOS, type Permiso } from '#core/permisos'
import type { TokenApiVista } from '#core/consultas/acl'

/**
 * Usuario técnico de una integración (Horus, Iris): un usuario con un rol propio y tokens `atk_` de
 * alcance mínimo. Nadie inicia sesión con él (contraseña aleatoria que nadie conoce). Lo comparten
 * `GenerarTokenHorus` y `GenerarTokenIris`.
 */
export interface DefinicionUsuarioTecnico {
    /** sistema, para el candado y los mensajes (`horus`, `iris`) */
    sistema: string
    /** nombre visible (`Horus`, `Iris`) */
    nombre: string
    /** correo del usuario técnico (no es un buzón) */
    email: string
    /** rol propio (`integracion_horus`) */
    rol: string
    descripcionRol: string
    /** permisos del rol y del token */
    permisos: readonly Permiso[]
}

/** Id del usuario técnico, o null si nunca se creó. */
export async function usuarioTecnico(
    email: string,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = (await cliente
        .from('core.usuarios')
        .whereRaw('lower(email) = ?', [email.toLowerCase()])
        .select('id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/** Tokens del usuario técnico (vigentes y revocados), los más nuevos primero; nunca su valor. */
export async function tokensUsuarioTecnico(
    email: string,
    cliente: QueryClientContract = db.connection(),
): Promise<TokenApiVista[]> {
    const usuarioId = await usuarioTecnico(email, cliente)
    if (usuarioId === null) return []
    return (await cliente
        .from('core.tokens_api')
        .where('usuario_id', usuarioId)
        .select('id', 'usuario_id', 'nombre', 'alcances', 'ultimo_uso', 'revocado_en', 'created_at')
        .orderBy('id', 'desc')) as TokenApiVista[]
}

/** Solo los permisos que existen en el catálogo (`permisos.ts`), sin repetir. */
export function permisosExistentes(permisos: readonly string[]): Permiso[] {
    const catalogo = new Set<string>(NOMBRES_PERMISOS)
    return [...new Set(permisos)].filter((p): p is Permiso => catalogo.has(p))
}

/**
 * Devuelve el id del usuario técnico; la primera vez crea el rol (con sus permisos) y el usuario
 * (acciones anidadas: auditoría y rollback juntos). Las siguientes, completa los permisos que le
 * falten al rol (nunca quita los que agregó un administrador). 409 `usuario_<sistema>_inactivo` si
 * alguien desactivó al usuario. Serializa con un candado por sistema.
 */
export async function asegurarUsuarioTecnico(t: Transaccion, def: DefinicionUsuarioTecnico): Promise<number> {
    await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`integraciones:${def.sistema}`])

    let usuarioId = await usuarioTecnico(def.email, t.trx)
    if (usuarioId === null) {
        const rolExistente = (await t.trx
            .from('core.roles')
            .where('nombre', def.rol)
            .select('id')
            .first()) as {
            id: number
        } | null
        let roleId = rolExistente?.id
        if (roleId === undefined) {
            const rol = await new CrearRol().execute(
                { nombre: def.rol, descripcion: def.descripcionRol, permisos: [...def.permisos] },
                t.ctx,
                { trx: t.trx },
            )
            roleId = rol.id
        }
        const usuario = await new CrearUsuario().execute(
            {
                nombre: def.nombre,
                email: def.email,
                password: randomBytes(32).toString('base64url'),
                roles: [{ role_id: Number(roleId) }],
            },
            t.ctx,
            { trx: t.trx },
        )
        usuarioId = usuario.id
    } else {
        const fila = (await t.trx.from('core.usuarios').where('id', usuarioId).select('activo').first()) as {
            activo: boolean
        }
        if (!fila.activo) {
            throw new Conflicto(
                `El usuario técnico ${def.nombre} está desactivado; reactívalo antes de generar un token`,
                `usuario_${def.sistema}_inactivo`,
            )
        }
    }
    await asegurarPermisosRol(t, def.rol, def.permisos)
    return usuarioId
}

/**
 * Un rol de integración creado antes de que existiera alguno de sus permisos recibe los que le
 * faltan; nunca se le quitan los que un administrador agregó.
 */
async function asegurarPermisosRol(t: Transaccion, nombreRol: string, permisos: readonly Permiso[]) {
    const rol = (await t.trx.from('core.roles').where('nombre', nombreRol).select('id').first()) as {
        id: number
    } | null
    if (!rol) return
    const actuales = (
        (await t.trx
            .from('core.roles_permisos as rp')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('rp.role_id', rol.id)
            .select('p.nombre')) as Array<{ nombre: string }>
    ).map((f) => f.nombre)
    const faltan = permisos.filter((p) => !actuales.includes(p))
    if (faltan.length === 0) return
    await reemplazarPermisosRol(t, rol.id, [...actuales, ...faltan])
    await t.registrarCambios(
        { tipo: 'rol', id: rol.id },
        { permisos: actuales.toSorted() },
        { permisos: [...actuales, ...faltan].toSorted() },
    )
}
