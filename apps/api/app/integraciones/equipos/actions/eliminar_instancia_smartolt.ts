import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    TABLA_INSTANCIAS,
    instanciaAdministrable,
    instanciaSinSecretos,
} from '#integraciones/equipos/smartolt_instancias'

/**
 * `smartolt.eliminar_instancia` (`DELETE /integraciones/smartolt/instancias/:id`, §4.3 y §5.1).
 *
 * - `409 instancia_en_uso` si un equipo gestionado (`equipos_servicio`) o un aprovisionamiento
 *   `en_proceso` la usan: hay que apagarla (los pedidos fallan reintentables) o esperar.
 * - Sin uso: se borra con sus OLT y sus perfiles. Los pedidos ya terminados conservan su historia
 *   (`smartolt_instancia_id` queda null). Emite `equipos.config_cambiada` (`accion: eliminada`).
 */
export default class EliminarInstanciaSmartOlt extends DomainAction<{ id: number }, null> {
    readonly nombre = 'smartolt.eliminar_instancia'

    protected async handle(input: { id: number }, t: Transaccion): Promise<null> {
        const fila = await instanciaAdministrable(t.trx, t.ctx, input.id)
        t.fijarEntidad('instancia_smartolt', input.id)
        t.fijarEmpresa(fila.empresa_id === null ? null : Number(fila.empresa_id))
        const equipo = await t.trx
            .from('integraciones.equipos_servicio')
            .where('smartolt_instancia_id', input.id)
            .select('servicio_id')
            .first()
        const pedido = await t.trx
            .from('integraciones.aprovisionamientos')
            .where('smartolt_instancia_id', input.id)
            .where('estado', 'en_proceso')
            .select('id')
            .first()
        if (equipo || pedido) {
            throw new Conflicto(
                'La instancia tiene equipos gestionados o aprovisionamientos en curso: apágala en vez de eliminarla',
                'instancia_en_uso',
                'Instancia en uso',
            )
        }
        await t.trx.from(TABLA_INSTANCIAS).where('id', input.id).delete()
        await t.registrarCambios(
            { tipo: 'instancia_smartolt', id: input.id },
            instanciaSinSecretos(fila),
            null,
        )
        await t.emit('equipos.config_cambiada', {
            sistema: 'smartolt',
            empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
            instancia_id: input.id,
            accion: 'eliminada',
            campos: [],
            operativa: false,
        })
        return null
    }
}
