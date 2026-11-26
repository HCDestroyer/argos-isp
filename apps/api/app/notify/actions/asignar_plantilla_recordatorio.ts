import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { empresaDeSuscripcion, obtenerPlantillaRecordatorio } from '#notify/plantillas_recordatorio'

export interface EntradaAsignarPlantillaRecordatorio {
    /** uno de los dos */
    servicio_id?: number | null
    suscripcion_id?: number | null
    /** null = vuelve a la por defecto de la empresa */
    plantilla_id: number | null
}

export interface ResultadoAsignacionRecordatorio {
    empresa_id: number
    servicio_id: number | null
    suscripcion_id: number | null
    /** la asignada después del cambio (null = la por defecto) */
    plantilla_id: number | null
    cambio: boolean
}

/**
 * `recordatorios.asignar` (`POST /servicios/:id/recordatorios/asignar`,
 * `POST /suscripciones/:id/recordatorios/asignar`): fija la plantilla de recordatorio de un servicio o
 * de una suscripción (`notify.recordatorios_asignaciones`, sin tocar `core.servicios` ni
 * `billing.suscripciones`); `plantilla_id: null` borra la asignación y vuelve a la por defecto.
 *
 * - Solo plantillas de la empresa del servicio o la suscripción: otra empresa, 422
 *   `plantilla_de_otra_empresa`; la personalizada de un servicio no se asigna, 422
 *   `plantilla_personalizada`; retirada, 409 `plantilla_retirada`; inexistente, 404.
 * - La personalizada del servicio, si tiene, sigue mandando: la asignación queda debajo.
 * - Idempotente: si no cambia nada no escribe ni emite. Si cambia, diff en `audit.cambios` (campo
 *   `plantilla_recordatorio_id` del servicio o la suscripción) y `recordatorios.asignacion_cambiada`.
 */
export default class AsignarPlantillaRecordatorio extends DomainAction<
    EntradaAsignarPlantillaRecordatorio,
    ResultadoAsignacionRecordatorio
> {
    readonly nombre = 'recordatorios.asignar'

    protected async handle(input: EntradaAsignarPlantillaRecordatorio, t: Transaccion) {
        const servicioId = input.servicio_id ?? null
        const suscripcionId = input.suscripcion_id ?? null
        if ((servicioId === null) === (suscripcionId === null)) {
            throw new ReglaNegocio('Indica un servicio o una suscripción, no los dos', 'destino_invalido')
        }
        let empresaId: number
        if (servicioId !== null) {
            t.fijarEntidad('servicio', servicioId)
            const fila = (await t.trx
                .from('core.servicios')
                .where('id', servicioId)
                .forShare()
                .select('empresa_id')
                .first()) as { empresa_id: number } | null
            if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
            empresaId = Number(fila.empresa_id)
        } else {
            t.fijarEntidad('suscripcion', suscripcionId!)
            empresaId = await empresaDeSuscripcion(suscripcionId!, t.trx)
        }
        t.fijarEmpresa(empresaId)
        exigirAccesoEmpresa(t.ctx, empresaId)

        if (input.plantilla_id !== null) {
            await t.trx
                .from('notify.plantillas_recordatorio')
                .where('id', input.plantilla_id)
                .forShare()
                .select('id')
            const plantilla = await obtenerPlantillaRecordatorio(input.plantilla_id, t.trx)
            if (plantilla.servicio_id !== null) {
                throw new ReglaNegocio(
                    `La plantilla ${plantilla.id} es la personalizada de un servicio: no se asigna a otros`,
                    'plantilla_personalizada',
                )
            }
            if (plantilla.empresa_id !== empresaId) {
                throw new ReglaNegocio(
                    `La plantilla «${plantilla.nombre}» es de otra empresa`,
                    'plantilla_de_otra_empresa',
                )
            }
            if (plantilla.retirada_en !== null) {
                throw new Conflicto(
                    `La plantilla «${plantilla.nombre}» está retirada: no se asigna`,
                    'plantilla_retirada',
                    'Plantilla retirada',
                )
            }
        }

        const columna = servicioId !== null ? 'servicio_id' : 'suscripcion_id'
        const destinoId = (servicioId ?? suscripcionId)!
        const actual = (await t.trx
            .from('notify.recordatorios_asignaciones')
            .where(columna, destinoId)
            .forUpdate()
            .select('id', 'plantilla_id')
            .first()) as { id: number; plantilla_id: number } | null
        const anterior = actual ? Number(actual.plantilla_id) : null
        const resultado: ResultadoAsignacionRecordatorio = {
            empresa_id: empresaId,
            servicio_id: servicioId,
            suscripcion_id: suscripcionId,
            plantilla_id: input.plantilla_id,
            cambio: anterior !== input.plantilla_id,
        }
        if (!resultado.cambio) return resultado

        if (input.plantilla_id === null) {
            await t.trx.from('notify.recordatorios_asignaciones').where('id', actual!.id).delete()
        } else if (actual) {
            await t.trx
                .from('notify.recordatorios_asignaciones')
                .where('id', actual.id)
                .update({
                    plantilla_id: input.plantilla_id,
                    asignada_por: usuarioDelActor(t.ctx.actor),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            await t.trx
                .insertQuery()
                .table('notify.recordatorios_asignaciones')
                .insert({
                    empresa_id: empresaId,
                    plantilla_id: input.plantilla_id,
                    [columna]: destinoId,
                    asignada_por: usuarioDelActor(t.ctx.actor),
                })
        }
        await t.registrarCambios(
            { tipo: servicioId !== null ? 'servicio' : 'suscripcion', id: destinoId },
            { plantilla_recordatorio_id: anterior },
            { plantilla_recordatorio_id: input.plantilla_id },
        )
        const personalizada =
            servicioId !== null &&
            Boolean(
                await t.trx
                    .from('notify.plantillas_recordatorio')
                    .where({ servicio_id: servicioId, empresa_id: empresaId })
                    .select('id')
                    .first(),
            )
        await t.emit('recordatorios.asignacion_cambiada', {
            empresa_id: empresaId,
            servicio_id: servicioId,
            suscripcion_id: suscripcionId,
            plantilla_id: input.plantilla_id,
            personalizada,
        })
        return resultado
    }
}
