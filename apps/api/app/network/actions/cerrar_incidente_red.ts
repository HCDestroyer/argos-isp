import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    bloquearIncidente,
    emitirPorEmpresa,
    verIncidente,
    type IncidenteRedVista,
} from '#network/incidentes_red'

export interface EntradaCerrarIncidenteRed {
    id: number
    motivo: string
    ahora?: Date
}

/**
 * Cierra un incidente de falla general (`incidentes_red.cerrar`): a mano (con motivo) o el sistema cuando
 * los servicios volvieron (`incidentes_red.evaluar`). Emite `red.falla_general_cerrada` uno por empresa,
 * con `hasta`. 422 `incidente_cerrado` si ya estaba cerrado.
 */
export default class CerrarIncidenteRed extends DomainAction<EntradaCerrarIncidenteRed, IncidenteRedVista> {
    readonly nombre = 'incidentes_red.cerrar'

    protected async handle(input: EntradaCerrarIncidenteRed, t: Transaccion): Promise<IncidenteRedVista> {
        const ahora = input.ahora ?? new Date()
        const incidente = await bloquearIncidente(t, input.id)
        t.fijarEntidad('incidente_red', incidente.id)
        if (incidente.estado !== 'abierto') {
            throw new ReglaNegocio('El incidente ya está cerrado', 'incidente_cerrado')
        }
        const empresas = (
            (await t.trx
                .from('network.incidentes_red_servicios')
                .where('incidente_id', incidente.id)
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
        ).map((e) => Number(e.empresa_id))
        for (const empresaId of empresas) exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresas.length === 1 ? empresas[0]! : null)
        await t.trx
            .from('network.incidentes_red')
            .where('id', incidente.id)
            .update({
                estado: 'cerrado',
                hasta: ahora,
                cerrado_por: usuarioDelActor(t.ctx.actor),
                motivo_cierre: input.motivo,
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'incidente_red', id: incidente.id },
            { estado: 'abierto', motivo_cierre: null },
            { estado: 'cerrado', motivo_cierre: input.motivo },
        )
        await emitirPorEmpresa(t, await bloquearIncidente(t, incidente.id), 'cerrada')
        return verIncidente(incidente.id, null, t.trx)
    }
}
