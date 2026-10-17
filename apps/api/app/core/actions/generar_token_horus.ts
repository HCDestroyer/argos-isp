import { randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import CrearRol from '#core/actions/crear_rol'
import { reemplazarPermisosRol } from '#core/actions/editar_rol'
import CrearUsuario from '#core/actions/crear_usuario'
import CrearTokenApi, { type SalidaCrearTokenApi } from '#core/actions/crear_token_api'
import {
    EMAIL_USUARIO_HORUS,
    NOMBRE_USUARIO_HORUS,
    PERMISOS_HORUS,
    ROL_HORUS,
    usuarioHorus,
} from '#core/integraciones_horus'

export interface EntradaGenerarTokenHorus {
    /** nombre del token (por defecto `Horus Flow`) */
    nombre?: string
    /** solo IPs de servicios de estos routers (opcional) */
    routers?: number[]
    /** solo IPs de clientes de estas zonas (opcional) */
    zonas?: number[]
}

export interface SalidaGenerarTokenHorus extends SalidaCrearTokenApi {
    usuario_id: number
}

/**
 * Genera el token `atk_` que Horus usa para leer de Argos (contrato Horus §1.2, pedido A5).
 *
 * - La primera vez crea el rol `integracion_horus` (`ip.resolver`, `clientes.ver`,
 *   `servicios.ver`) y el usuario técnico "Horus" con ese rol y una contraseña aleatoria que nadie
 *   conoce (no inicia sesión en el panel). Las siguientes, los reutiliza.
 * - El token lleva `alcances.permisos` = esos tres permisos (aunque alguien amplíe el rol) y,
 *   opcionalmente, `routers`/`zonas`. Las empresas son las del usuario Horus: alcance global si
 *   lo crea alguien con alcance global; se ajustan con `PUT /usuarios/:id/empresas`.
 * - El valor se devuelve una sola vez. Generar otro no revoca los anteriores (rotación sin
 *   cortar a Horus); se revocan con `integraciones.revocar_token`.
 * - 409 `usuario_horus_inactivo` si alguien desactivó al usuario técnico.
 */
export default class GenerarTokenHorus extends DomainAction<
    EntradaGenerarTokenHorus,
    SalidaGenerarTokenHorus
> {
    readonly nombre = 'integraciones.generar_token'

    protected async handle(
        input: EntradaGenerarTokenHorus,
        t: Transaccion,
    ): Promise<SalidaGenerarTokenHorus> {
        // serializa dos generaciones simultáneas (el usuario y el rol se crean una sola vez)
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('integraciones:horus'))`)

        let usuarioId = await usuarioHorus(t.trx)
        if (usuarioId === null) {
            const rolExistente = (await t.trx
                .from('core.roles')
                .where('nombre', ROL_HORUS)
                .select('id')
                .first()) as {
                id: number
            } | null
            let roleId = rolExistente?.id
            if (roleId === undefined) {
                const rol = await new CrearRol().execute(
                    {
                        nombre: ROL_HORUS,
                        descripcion: 'Integración Horus Flow: resolver IPs y leer clientes y servicios',
                        permisos: [...PERMISOS_HORUS],
                    },
                    t.ctx,
                    { trx: t.trx },
                )
                roleId = rol.id
            }
            const usuario = await new CrearUsuario().execute(
                {
                    nombre: NOMBRE_USUARIO_HORUS,
                    email: EMAIL_USUARIO_HORUS,
                    password: randomBytes(32).toString('base64url'),
                    roles: [{ role_id: Number(roleId) }],
                },
                t.ctx,
                { trx: t.trx },
            )
            usuarioId = usuario.id
        } else {
            const fila = (await t.trx
                .from('core.usuarios')
                .where('id', usuarioId)
                .select('activo')
                .first()) as {
                activo: boolean
            }
            if (!fila.activo) {
                throw new Conflicto(
                    'El usuario técnico Horus está desactivado; reactívalo antes de generar un token',
                    'usuario_horus_inactivo',
                )
            }
        }

        await asegurarPermisosRolHorus(t)
        const creado = await new CrearTokenApi().execute(
            {
                usuario_id: usuarioId,
                nombre: input.nombre ?? 'Horus Flow',
                alcances: {
                    permisos: [...PERMISOS_HORUS],
                    ...(input.routers && input.routers.length > 0 ? { routers: input.routers } : {}),
                    ...(input.zonas && input.zonas.length > 0 ? { zonas: input.zonas } : {}),
                },
            },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('token_api', creado.datos.id)
        return { ...creado, usuario_id: usuarioId }
    }
}

/**
 * Un rol `integracion_horus` creado antes de que existiera un permiso de la integración (p. ej.
 * `sso.emitir`) recibe los que le faltan; nunca se le quitan los que un administrador agregó.
 */
async function asegurarPermisosRolHorus(t: Transaccion) {
    const rol = (await t.trx.from('core.roles').where('nombre', ROL_HORUS).select('id').first()) as {
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
    const faltan = PERMISOS_HORUS.filter((p) => !actuales.includes(p))
    if (faltan.length === 0) return
    await reemplazarPermisosRol(t, rol.id, [...actuales, ...faltan])
    await t.registrarCambios(
        { tipo: 'rol', id: rol.id },
        { permisos: actuales.toSorted() },
        { permisos: [...actuales, ...faltan].toSorted() },
    )
}
