import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { bloquearPromocion, verPromocion, type PromocionVelocidadVista } from '#core/promociones_velocidad'
import { cerrarTramosAbiertos } from '#core/actions/quitar_promocion_velocidad'

export interface EntradaCancelarPromocionVelocidad {
    id: number
    version: number
    motivo: string
}

/**
 * Cancela una promoción de velocidad (`promociones_velocidad.cancelar`): estado `cancelada`, cierra sus
 * tramos abiertos (CoA de vuelta a la velocidad del plan) y el cron ya no abre más. Con `version` (409).
 * Emite `promocion_velocidad.cambiada` (`accion: cancelada`). 422 `promocion_cerrada` si ya estaba
 * cancelada.
 */
export default class CancelarPromocionVelocidad extends DomainAction<
    EntradaCancelarPromocionVelocidad,
    PromocionVelocidadVista
> {
    readonly nombre = 'promociones_velocidad.cancelar'

    protected async handle(
        input: EntradaCancelarPromocionVelocidad,
        t: Transaccion,
    ): Promise<PromocionVelocidadVista> {
        const promocion = await bloquearPromocion(t.trx, input.id)
        t.fijarEmpresa(promocion.empresa_id)
        t.fijarEntidad('promocion_velocidad', promocion.id)
        exigirAccesoEmpresa(t.ctx, promocion.empresa_id)
        if (promocion.version !== input.version) {
            throw new ConflictoVersion('promocion_velocidad', promocion.id)
        }
        if (promocion.estado !== 'activa') {
            throw new ReglaNegocio('La promoción ya está cancelada', 'promocion_cerrada')
        }
        await t.trx
            .from('core.promociones_velocidad')
            .where('id', promocion.id)
            .update({
                estado: 'cancelada',
                motivo_cancelacion: input.motivo,
                cancelada_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'promocion_velocidad', id: promocion.id },
            { estado: 'activa', motivo_cancelacion: null },
            { estado: 'cancelada', motivo_cancelacion: input.motivo },
        )
        const servicios = (await t.trx
            .from('core.promociones_velocidad_servicios')
            .where({ promocion_id: promocion.id, estado: 'vigente' })
            .orderBy('servicio_id')
            .select('servicio_id')) as Array<{ servicio_id: number }>
        await cerrarTramosAbiertos(t, { promocionId: promocion.id }, 'cancelada')
        await t.emit('promocion_velocidad.cambiada', {
            promocion_id: promocion.id,
            empresa_id: promocion.empresa_id,
            accion: 'cancelada',
            servicios: servicios.map((s) => Number(s.servicio_id)),
        })
        return verPromocion(promocion.id, t.trx)
    }
}
