import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { tieneAccesoEmpresa } from '#shared/empresa_activa'
import {
    TABLA_OLTS,
    empresaQueMira,
    instanciaAdministrable,
    instanciaDesdeFila,
    vistaInstancia,
    type FilaOltSmartOlt,
    type VistaOltSmartOlt,
} from '#integraciones/equipos/smartolt_instancias'

/**
 * `smartolt.vincular_olt` (`POST /integraciones/smartolt/olts/:id/vincular`, §5.1): liga una OLT de
 * SmartOLT con la OLT de la red de acceso de Argos donde está (de ahí sale la instancia de un servicio,
 * §4.2 paso 2). `olt_id: null` la desvincula.
 *
 * - Una OLT de Argos va con una sola OLT de SmartOLT: `409 olt_ya_vinculada`.
 * - La OLT de Argos debe ser compartida o de la empresa de la instancia (en una instancia compartida,
 *   de una empresa a la que el actor tenga acceso): si no, `422 olt_de_otra_empresa`.
 * - Emite `equipos.config_cambiada` (`accion: olt_vinculada`).
 */
export default class VincularOltSmartOlt extends DomainAction<
    { id: number; olt_id: number | null },
    VistaOltSmartOlt
> {
    readonly nombre = 'smartolt.vincular_olt'

    protected async handle(input: { id: number; olt_id: number | null }, t: Transaccion) {
        const olt = (await t.trx
            .from(TABLA_OLTS)
            .where('id', input.id)
            .forUpdate()
            .first()) as FilaOltSmartOlt | null
        if (!olt) throw new NoEncontrado(`La OLT ${input.id} de SmartOLT no existe`)
        const instancia = await instanciaAdministrable(t.trx, t.ctx, Number(olt.instancia_id))
        t.fijarEntidad('olt_smartolt', input.id)
        t.fijarEmpresa(instancia.empresa_id === null ? null : Number(instancia.empresa_id))

        if (input.olt_id !== null) {
            const argos = (await t.trx
                .from('network.olts')
                .where('id', input.olt_id)
                .select('id', 'empresa_id')
                .first()) as { id: number; empresa_id: number | null } | null
            if (!argos) throw new NoEncontrado(`La OLT ${input.olt_id} de Argos no existe`)
            const empresaOlt = argos.empresa_id === null ? null : Number(argos.empresa_id)
            const permitida =
                empresaOlt === null ||
                (instancia.empresa_id === null
                    ? tieneAccesoEmpresa(t.ctx, empresaOlt)
                    : empresaOlt === Number(instancia.empresa_id))
            if (!permitida) {
                throw new ReglaNegocio(
                    'Esa OLT de Argos es de otra empresa que la instancia de SmartOLT',
                    'olt_de_otra_empresa',
                )
            }
            const otra = await t.trx
                .from(TABLA_OLTS)
                .where('olt_id', input.olt_id)
                .whereNot('id', input.id)
                .select('id')
                .first()
            if (otra) {
                throw new Conflicto(
                    'Esa OLT de Argos ya está ligada a otra OLT de SmartOLT',
                    'olt_ya_vinculada',
                    'OLT ya ligada',
                )
            }
        }
        const antes = olt.olt_id === null ? null : Number(olt.olt_id)
        if (antes !== input.olt_id) {
            await t.trx.from(TABLA_OLTS).where('id', input.id).update({ olt_id: input.olt_id })
            await t.registrarCambios(
                { tipo: 'olt_smartolt', id: input.id },
                { olt_id: antes },
                { olt_id: input.olt_id },
            )
            await t.emit('equipos.config_cambiada', {
                sistema: 'smartolt',
                empresa_id: instancia.empresa_id === null ? null : Number(instancia.empresa_id),
                instancia_id: Number(instancia.id),
                accion: 'olt_vinculada',
                campos: ['olt_id'],
                operativa: instanciaDesdeFila(instancia).operativa,
            })
        }
        const vista = await vistaInstancia(instancia, t.trx, empresaQueMira(t.ctx))
        return vista.olts.find((o) => o.id === input.id)!
    }
}
