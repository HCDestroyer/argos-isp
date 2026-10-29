import { DomainAction, type Transaccion } from '#shared/domain_action'
import CrearTokenApi, { type SalidaCrearTokenApi } from '#core/actions/crear_token_api'
import { PERMISOS_HORUS, USUARIO_TECNICO_HORUS } from '#core/integraciones_horus'
import { asegurarUsuarioTecnico } from '#core/usuario_tecnico'

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
 *   cortar a Horus); se revocan con `horus.revocar_token`.
 * - 409 `usuario_horus_inactivo` si alguien desactivó al usuario técnico.
 */
export default class GenerarTokenHorus extends DomainAction<
    EntradaGenerarTokenHorus,
    SalidaGenerarTokenHorus
> {
    readonly nombre = 'horus.generar_token'

    protected async handle(
        input: EntradaGenerarTokenHorus,
        t: Transaccion,
    ): Promise<SalidaGenerarTokenHorus> {
        const usuarioId = await asegurarUsuarioTecnico(t, USUARIO_TECNICO_HORUS)
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
