import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { bloquearPromocion, verPromocion, type PromocionVelocidadVista } from '#core/promociones_velocidad'
import CerrarTramoPromocion from '#core/actions/cerrar_tramo_promocion'

export interface EntradaQuitarPromocionVelocidad {
    promocion_id: number
    servicio_id: number
    motivo?: string | null
}

/**
 * Quita una promoción de velocidad de un servicio (`promociones_velocidad.quitar`): la asignación pasa a
 * `quitada` y, si tenía un tramo abierto, se cierra (vuelve la velocidad del plan por CoA). Emite
 * `promocion_velocidad.cambiada` (`accion: quitada`). 404 si el servicio no la tiene.
 */
export default class QuitarPromocionVelocidad extends DomainAction<
    EntradaQuitarPromocionVelocidad,
    PromocionVelocidadVista
> {
    readonly nombre = 'promociones_velocidad.quitar'

    protected async handle(
        input: EntradaQuitarPromocionVelocidad,
        t: Transaccion,
    ): Promise<PromocionVelocidadVista> {
        const promocion = await bloquearPromocion(t.trx, input.promocion_id)
        t.fijarEmpresa(promocion.empresa_id)
        t.fijarEntidad('servicio', input.servicio_id)
        exigirAccesoEmpresa(t.ctx, promocion.empresa_id)
        const asignacion = (await t.trx
            .from('core.promociones_velocidad_servicios')
            .where({ promocion_id: promocion.id, servicio_id: input.servicio_id, estado: 'vigente' })
            .forUpdate()
            .select('id')
            .first()) as { id: number } | null
        if (!asignacion) {
            throw new NoEncontrado(`El servicio ${input.servicio_id} no tiene la promoción ${promocion.id}`)
        }
        await t.trx
            .from('core.promociones_velocidad_servicios')
            .where('id', asignacion.id)
            .update({
                estado: 'quitada',
                quitada_en: t.trx.knexRawQuery('now()'),
                motivo: input.motivo ?? null,
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'promocion_servicio', id: Number(asignacion.id) },
            { estado: 'vigente' },
            { estado: 'quitada' },
        )
        await cerrarTramosAbiertos(t, { promocionId: promocion.id, servicioId: input.servicio_id }, 'quitada')
        await t.emit('promocion_velocidad.cambiada', {
            promocion_id: promocion.id,
            empresa_id: promocion.empresa_id,
            accion: 'quitada',
            servicios: [input.servicio_id],
        })
        return verPromocion(promocion.id, t.trx)
    }
}

/** Cierra (acción anidada) los tramos abiertos de una promoción, de un servicio o de ambos. */
export async function cerrarTramosAbiertos(
    t: Transaccion,
    filtro: { promocionId?: number; servicioId?: number },
    motivo: string,
): Promise<number[]> {
    const consulta = t.trx.from('core.promociones_velocidad_tramos').where('estado', 'abierto')
    if (filtro.promocionId) consulta.where('promocion_id', filtro.promocionId)
    if (filtro.servicioId) consulta.where('servicio_id', filtro.servicioId)
    const tramos = (await consulta.orderBy('id').select('id', 'servicio_id')) as Array<{
        id: number
        servicio_id: number
    }>
    for (const tramo of tramos) {
        await new CerrarTramoPromocion().execute({ tramo_id: Number(tramo.id), motivo }, t.ctx, {
            trx: t.trx,
        })
    }
    return tramos.map((tr) => Number(tr.servicio_id))
}
