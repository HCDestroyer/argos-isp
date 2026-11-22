import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    agregarAfectados,
    alcanceExiste,
    bloquearIncidente,
    emitirPorEmpresa,
    serviciosDelAlcance,
    verIncidente,
    type AlcanceIncidente,
    type IncidenteRedVista,
} from '#network/incidentes_red'

export interface EntradaAbrirIncidenteRed {
    alcance: AlcanceIncidente
    alcance_id: number
    motivo: string
    ahora?: Date
}

/**
 * Abre a mano un incidente de falla general (`incidentes_red.abrir`, contrato Iris 0.13.0): registra el
 * actor y el motivo (obligatorio) y lo audita. Afectados = los servicios activos o limitados del alcance.
 * Quien lo abre debe tener acceso a todas las empresas afectadas (403). 409 `incidente_abierto` si ya hay
 * uno abierto en ese alcance. Emite `red.falla_general_abierta` uno por empresa.
 */
export default class AbrirIncidenteRed extends DomainAction<EntradaAbrirIncidenteRed, IncidenteRedVista> {
    readonly nombre = 'incidentes_red.abrir'

    protected async handle(input: EntradaAbrirIncidenteRed, t: Transaccion): Promise<IncidenteRedVista> {
        const ahora = input.ahora ?? new Date()
        if (!(await alcanceExiste(t.trx, input.alcance, input.alcance_id))) {
            throw new ValidacionFallida(
                [{ field: 'alcance_id', message: `No existe ese ${input.alcance}`, rule: 'existe' }],
                `No existe ese ${input.alcance}`,
            )
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(4120, 0)')
        const abierto = await t.trx
            .from('network.incidentes_red')
            .where({ alcance: input.alcance, alcance_id: input.alcance_id, estado: 'abierto' })
            .first()
        if (abierto) {
            throw new Conflicto('Ya hay un incidente abierto en ese alcance', 'incidente_abierto')
        }
        const afectados = await serviciosDelAlcance(t.trx, input.alcance, input.alcance_id)
        if (afectados.length === 0) {
            throw new ReglaNegocio('El alcance no tiene servicios activos', 'alcance_sin_servicios')
        }
        const empresas = [...new Set(afectados.map((a) => a.empresa_id))]
        for (const empresaId of empresas) exigirAccesoEmpresa(t.ctx, empresaId)

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.incidentes_red')
            .insert({
                alcance: input.alcance,
                alcance_id: input.alcance_id,
                origen: 'manual',
                motivo: input.motivo,
                abierto_por: usuarioDelActor(t.ctx.actor),
                desde: ahora,
                base: afectados.length,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('incidente_red', id)
        t.fijarEmpresa(empresas.length === 1 ? empresas[0]! : null)
        await agregarAfectados(t, id, afectados)
        await t.registrarCambios({ tipo: 'incidente_red', id }, null, {
            alcance: input.alcance,
            alcance_id: input.alcance_id,
            estado: 'abierto',
            origen: 'manual',
            motivo: input.motivo,
            servicios_afectados: afectados.length,
        })
        await emitirPorEmpresa(t, await bloquearIncidente(t, id), 'abierta')
        return verIncidente(id, null, t.trx)
    }
}
