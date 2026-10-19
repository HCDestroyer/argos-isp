import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirCuentasLealtad } from '#lealtad/comun'
import { ProgramaActivoExistente } from '#lealtad/errores'
import { camposAuditables, programaActivo, verPrograma, type ProgramaVista } from '#lealtad/programas'

/**
 * `lealtad.activar_programa` (`POST /lealtad/programas/:id/activar`, permiso `lealtad.configurar`).
 * Uno activo por empresa: 409 `programa_activo_existente` si ya hay otro; 409
 * `programa_ya_activo` si es este. Con diferimiento revisa las cuentas del pasivo. Desde aquí el
 * consumidor `lealtad` otorga por los eventos nuevos (los anteriores a `vigente_desde` no cuentan).
 */
export default class ActivarPrograma extends DomainAction<{ id: number }, ProgramaVista> {
    readonly nombre = 'lealtad.activar_programa'

    protected async handle(input: { id: number }, t: Transaccion): Promise<ProgramaVista> {
        t.fijarEntidad('programa_lealtad', input.id)
        const actual = await verPrograma(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        // un cambio de programa activo a la vez por empresa
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(5102, ?::int)', [actual.empresa_id])
        if (actual.activo) {
            throw new Conflicto(
                `El programa ${actual.id} ya está activo`,
                'programa_ya_activo',
                'Programa ya activo',
            )
        }
        const otro = await programaActivo(actual.empresa_id, t.trx)
        if (otro) throw new ProgramaActivoExistente(actual.empresa_id, otro.id)
        if (actual.diferimiento) await exigirCuentasLealtad(t.trx)

        await t.trx
            .from('lealtad.programas')
            .where('id', actual.id)
            .update({
                activo: true,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const activado = await verPrograma(actual.id, t.trx)
        await t.registrarCambios(
            { tipo: 'programa_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(activado),
        )
        await t.emit('lealtad.programa_cambiado', {
            programa_id: actual.id,
            empresa_id: actual.empresa_id,
            campos: ['activo'],
        })
        return activado
    }
}
