import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    bloquearPromocion,
    datosServicioPromocion,
    exigirPromocionAplicable,
    promocionComoVigente,
    verPromocion,
    type PromocionVelocidadVista,
} from '#core/promociones_velocidad'
import AbrirTramoPromocion from '#core/actions/abrir_tramo_promocion'

export interface EntradaAsignarPromocionVelocidad {
    promocion_id: number
    servicio_ids: number[]
    ahora?: Date
}

/**
 * Asigna una promoción de velocidad a uno o varios servicios (`promociones_velocidad.asignar`).
 *
 * - Todo o nada: si un servicio no puede (otra empresa, retirado, control de velocidad del router
 *   incompatible, capacidad del router o se solapa con otra promoción vigente), 422 y no se asigna
 *   ninguno. Un servicio que ya la tiene se deja igual (idempotente).
 * - Solapadas: un servicio no tiene dos promociones activas con periodos (`inicio`–`fin`) que se
 *   crucen (422 `promocion_solapada`), aunque sus franjas no coincidan: así la velocidad efectiva es
 *   siempre de una sola promoción.
 * - Si el tramo de ahora ya empezó, lo abre en la misma petición (`promociones_velocidad.abrir_tramo`).
 * - Emite `promocion_velocidad.cambiada` (`accion: asignada`) con los servicios nuevos.
 */
export default class AsignarPromocionVelocidad extends DomainAction<
    EntradaAsignarPromocionVelocidad,
    PromocionVelocidadVista
> {
    readonly nombre = 'promociones_velocidad.asignar'

    protected async handle(
        input: EntradaAsignarPromocionVelocidad,
        t: Transaccion,
    ): Promise<PromocionVelocidadVista> {
        const ahora = input.ahora ?? new Date()
        const promocion = await bloquearPromocion(t.trx, input.promocion_id)
        t.fijarEmpresa(promocion.empresa_id)
        t.fijarEntidad('promocion_velocidad', promocion.id)
        exigirAccesoEmpresa(t.ctx, promocion.empresa_id)
        if (promocion.estado !== 'activa' || new Date(promocion.fin) <= ahora) {
            throw new ReglaNegocio(
                'La promoción está cancelada o ya terminó: no se puede asignar',
                'promocion_cerrada',
            )
        }
        const comoVigente = await promocionComoVigente(t.trx, promocion)
        const nuevos: number[] = []
        for (const servicioId of [...new Set(input.servicio_ids)].sort((a, b) => a - b)) {
            const servicio = (await t.trx
                .from('core.servicios')
                .where('id', servicioId)
                .forUpdate()
                .select('empresa_id', 'estado')
                .first()) as { empresa_id: number; estado: string } | null
            const campo = [{ field: 'servicio_ids', message: `Servicio ${servicioId}`, rule: 'servicio' }]
            if (!servicio) {
                throw new ReglaNegocio(`El servicio ${servicioId} no existe`, 'servicio_inexistente', campo)
            }
            if (Number(servicio.empresa_id) !== promocion.empresa_id) {
                throw new ReglaNegocio(
                    `El servicio ${servicioId} es de otra empresa que la promoción`,
                    'servicio_de_otra_empresa',
                    campo,
                )
            }
            const ya = await t.trx
                .from('core.promociones_velocidad_servicios')
                .where({ promocion_id: promocion.id, servicio_id: servicioId, estado: 'vigente' })
                .first()
            if (ya) continue
            const solapada = (await t.trx
                .from('core.promociones_velocidad_servicios as a')
                .join('core.promociones_velocidad as p', 'p.id', 'a.promocion_id')
                .where('a.servicio_id', servicioId)
                .where('a.estado', 'vigente')
                .where('p.estado', 'activa')
                .whereNot('p.id', promocion.id)
                .where('p.inicio', '<', promocion.fin)
                .where('p.fin', '>', promocion.inicio)
                .select('p.id', 'p.nombre')
                .first()) as { id: number; nombre: string } | null
            if (solapada) {
                throw new ReglaNegocio(
                    `El servicio ${servicioId} ya tiene la promoción «${solapada.nombre}» en esas fechas`,
                    'promocion_solapada',
                    campo,
                )
            }
            const { datos } = await datosServicioPromocion(t.trx, servicioId)
            exigirPromocionAplicable(datos, comoVigente)

            const [fila] = (await t.trx
                .insertQuery()
                .table('core.promociones_velocidad_servicios')
                .insert({
                    promocion_id: promocion.id,
                    servicio_id: servicioId,
                    empresa_id: promocion.empresa_id,
                    agregada_por: usuarioDelActor(t.ctx.actor),
                })
                .returning('id')) as Array<{ id: number }>
            await t.registrarCambios({ tipo: 'promocion_servicio', id: Number(fila!.id) }, null, {
                promocion_id: promocion.id,
                servicio_id: servicioId,
                estado: 'vigente',
            })
            nuevos.push(servicioId)
        }
        if (nuevos.length > 0) {
            await t.emit('promocion_velocidad.cambiada', {
                promocion_id: promocion.id,
                empresa_id: promocion.empresa_id,
                accion: 'asignada',
                servicios: nuevos,
            })
            for (const servicioId of nuevos) {
                await new AbrirTramoPromocion().execute(
                    { promocion_id: promocion.id, servicio_id: servicioId, ahora },
                    t.ctx,
                    { trx: t.trx },
                )
            }
        }
        return verPromocion(promocion.id, t.trx)
    }
}
