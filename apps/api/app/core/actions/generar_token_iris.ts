import { DomainAction, type Transaccion } from '#shared/domain_action'
import CrearTokenApi, { type SalidaCrearTokenApi } from '#core/actions/crear_token_api'
import { PERMISOS_IRIS, USUARIO_TECNICO_IRIS } from '#core/integraciones_iris'
import { asegurarUsuarioTecnico } from '#core/usuario_tecnico'
import { exigirRolesSinAlcanceDeRed } from '#core/alcance_usuario_tecnico'

export interface EntradaGenerarTokenIris {
    /** nombre del token (por defecto `Iris`) */
    nombre?: string
    /** no se admite: el usuario técnico Iris solo tiene alcance por empresas (422) */
    routers?: number[]
    /** no se admite: el usuario técnico Iris solo tiene alcance por empresas (422) */
    zonas?: number[]
}

export interface SalidaGenerarTokenIris extends SalidaCrearTokenApi {
    usuario_id: number
}

/**
 * Genera el token `atk_` con el que Iris lee y escribe en Argos (contrato Iris §1.1, pedido A2).
 *
 * - La primera vez crea el rol `integracion_iris` con `PERMISOS_IRIS` y el usuario técnico «Iris»
 *   (`asegurarUsuarioTecnico`, igual que Horus). Las siguientes los reutiliza y completa los
 *   permisos que falten al rol.
 * - El token lleva `alcances.permisos = PERMISOS_IRIS` (aunque alguien amplíe el rol) y,
 *   nunca `routers`/`zonas`: el alcance son las empresas del usuario Iris (o global), contrato Iris
 *   0.3.1 §1. Pedirlos, o que el usuario tenga roles con alcance por zona o router, responde 422
 *   `usuario_tecnico_solo_empresas` (`#core/alcance_usuario_tecnico`); el canje del enlace tampoco
 *   emite un token así.
 * - El valor se devuelve una sola vez. Generar otro no revoca los anteriores; el canje del enlace
 *   sí revoca el de su canje anterior.
 * - 409 `usuario_iris_inactivo` si alguien desactivó al usuario técnico.
 */
export default class GenerarTokenIris extends DomainAction<EntradaGenerarTokenIris, SalidaGenerarTokenIris> {
    readonly nombre = 'iris.generar_token'

    protected async handle(input: EntradaGenerarTokenIris, t: Transaccion): Promise<SalidaGenerarTokenIris> {
        const usuarioId = await asegurarUsuarioTecnico(t, USUARIO_TECNICO_IRIS)
        await exigirRolesSinAlcanceDeRed(t.trx, usuarioId)
        const creado = await new CrearTokenApi().execute(
            {
                usuario_id: usuarioId,
                nombre: input.nombre ?? 'Iris',
                alcances: {
                    permisos: [...PERMISOS_IRIS],
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
