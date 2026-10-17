import { DomainAction, type Transaccion } from '#shared/domain_action'
import { configHorus } from '#integraciones/horus/configuracion'
import { ErrorHorus, llamarHorus, reintentarEnDe } from '#integraciones/horus/cliente'
import { ConectorNoDisponible, HorusRespondioError } from '#integraciones/horus/errores'
import { usuarioDelActor } from '#shared/contexto'

export const RUTA_TICKETS_HORUS = '/api/v1/integrations/argosisp/sso/tickets'
export const TIPOS_DESTINO = ['cliente', 'servicio', 'router', 'hallazgo'] as const
export type TipoDestino = (typeof TIPOS_DESTINO)[number]

export interface EntradaAbrirEnHorus {
    destino: { tipo: TipoDestino; id_externo: string }
}

export interface SalidaAbrirEnHorus {
    /** `https://<horus>/sso/entrar#<ticket>`: el panel la abre; un solo uso, 60 s */
    url: string
    expira_en: string | null
}

/**
 * `horus.abrir`: "Ver en Horus" (§1.5, paso 1, Argos es el origen). El **servidor**
 * de Argos pide el ticket a Horus con el `hf_pat_` (scope `sso.issue`), con el usuario de la
 * sesión (`id_externo` = `u-<id>`, correo y nombre) y el destino, y devuelve al panel solo la URL.
 * El navegador nunca pide el ticket. Horus aplica su propio ACL al entrar.
 *
 * Auditada (quién, a qué recurso). La URL devuelta debe ser de la misma URL base de Horus
 * configurada (no se abre otra cosa).
 */
export default class AbrirEnHorus extends DomainAction<EntradaAbrirEnHorus, SalidaAbrirEnHorus> {
    readonly nombre = 'horus.abrir'

    protected async handle(input: EntradaAbrirEnHorus, t: Transaccion): Promise<SalidaAbrirEnHorus> {
        const config = await configHorus()
        if (!config.activo || !config.urlBase || !config.token) throw new ConectorNoDisponible()
        const usuarioId = usuarioDelActor(t.ctx.actor)
        if (!usuarioId) throw new ConectorNoDisponible('"Ver en Horus" necesita un usuario con sesión')
        const usuario = (await t.trx
            .from('core.usuarios')
            .where('id', usuarioId)
            .select('nombre', 'email')
            .first()) as { nombre: string; email: string } | null
        if (input.destino.tipo === 'servicio') t.fijarEntidad('servicio', Number(input.destino.id_externo))
        else if (input.destino.tipo === 'cliente') t.fijarEntidad('cliente', Number(input.destino.id_externo))

        let datos: { url?: string; expira_en?: string }
        try {
            const respuesta = await llamarHorus<{ url?: string; expira_en?: string }>(
                config,
                'POST',
                RUTA_TICKETS_HORUS,
                {
                    usuario: {
                        id_externo: `u-${usuarioId}`,
                        correo: usuario?.email ?? null,
                        nombre: usuario?.nombre ?? null,
                    },
                    destino: { tipo: input.destino.tipo, id_externo: String(input.destino.id_externo) },
                },
            )
            datos = respuesta.datos ?? {}
        } catch (error) {
            throw new HorusRespondioError(
                error instanceof ErrorHorus ? error.message : String(error),
                reintentarEnDe(error),
            )
        }
        if (!datos.url || !datos.url.startsWith(`${config.urlBase}/`)) {
            throw new HorusRespondioError('Horus devolvió una URL de ticket que no es de su URL base')
        }
        return { url: datos.url, expira_en: datos.expira_en ?? null }
    }
}
