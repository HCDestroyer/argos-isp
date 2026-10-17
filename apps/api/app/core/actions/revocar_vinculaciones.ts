import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'

export interface EntradaRevocarVinculaciones {
    /** solo las de este usuario local; sin él, todas */
    usuario_id?: number
    /** solo las de este conector (`horus`); sin él, todos */
    conector?: string
}

export interface SalidaRevocarVinculaciones {
    revocadas: number
}

/**
 * Un administrador revoca las vinculaciones de autologin vigentes (todas, de un usuario o de un
 * conector): `POST /vinculaciones/revocar`. Cada fila revocada deja su cambio en `audit.cambios`
 * (regla 9: nada de actualizaciones masivas sin registro por fila).
 */
export default class RevocarVinculaciones extends DomainAction<
    EntradaRevocarVinculaciones,
    SalidaRevocarVinculaciones
> {
    readonly nombre = 'vinculaciones.revocar'

    protected async handle(
        input: EntradaRevocarVinculaciones,
        t: Transaccion,
    ): Promise<SalidaRevocarVinculaciones> {
        const consulta = t.trx.from('core.vinculaciones_externas').whereNull('revocada_en')
        if (input.usuario_id) consulta.where('usuario_id', input.usuario_id)
        if (input.conector) consulta.where('conector', input.conector)
        const filas = (await consulta.forUpdate().select('id')) as Array<{ id: number }>
        const actor = usuarioDelActor(t.ctx.actor)
        for (const { id } of filas) {
            const [fila] = (await t.trx
                .from('core.vinculaciones_externas')
                .where('id', id)
                .update({
                    revocada_en: t.trx.knexRawQuery('now()'),
                    revocada_por: actor,
                    updated_at: t.trx.knexRawQuery('now()'),
                })
                .returning('revocada_en')) as Array<{ revocada_en: Date }>
            await t.registrarCambios(
                { tipo: 'vinculacion_externa', id },
                { revocada_en: null },
                { revocada_en: fila!.revocada_en },
            )
        }
        return { revocadas: filas.length }
    }
}
