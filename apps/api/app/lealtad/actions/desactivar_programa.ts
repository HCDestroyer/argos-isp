import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { camposAuditables, verPrograma, type ProgramaVista } from '#lealtad/programas'

/**
 * `lealtad.desactivar_programa` (`POST /lealtad/programas/:id/desactivar { motivo }`, permiso
 * `lealtad.configurar`). Deja de otorgar puntos; los lotes existentes conservan su vencimiento y su
 * valor (el cron `lealtad:vencer` los sigue venciendo) y los reversos por pagos o facturas anuladas
 * se siguen aplicando. 409 `programa_inactivo_ya` si ya estaba inactivo.
 */
export default class DesactivarPrograma extends DomainAction<{ id: number; motivo: string }, ProgramaVista> {
    readonly nombre = 'lealtad.desactivar_programa'

    protected async handle(input: { id: number; motivo: string }, t: Transaccion): Promise<ProgramaVista> {
        t.fijarEntidad('programa_lealtad', input.id)
        const actual = await verPrograma(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        if (!actual.activo) {
            throw new Conflicto(
                `El programa ${actual.id} ya está inactivo`,
                'programa_inactivo_ya',
                'Programa ya inactivo',
            )
        }
        await t.trx
            .from('lealtad.programas')
            .where('id', actual.id)
            .update({
                activo: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const desactivado = await verPrograma(actual.id, t.trx)
        await t.registrarCambios(
            { tipo: 'programa_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(desactivado),
        )
        await t.emit('lealtad.programa_cambiado', {
            programa_id: actual.id,
            empresa_id: actual.empresa_id,
            campos: ['activo'],
        })
        return desactivado
    }
}
