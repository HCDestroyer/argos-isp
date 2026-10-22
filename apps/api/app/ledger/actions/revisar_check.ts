import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { LOCK_CIERRES } from '#ledger/cierres'
import { verCheck, type CheckVista } from '#ledger/checks'

/**
 * `cierres.revisar_check` (`POST /libro/cierres/checks/:id/revisar { estado, nota }`, permiso
 * `libro.cerrar_periodo`; contrato §10.5): una persona supervisa un check en anomalía
 * (`supervisado`, con nota obligatoria) o retira su supervisión (`anomalia`). Fila nueva en
 * `ledger.cierres_checks` con los mismos esperado y obtenido: el resultado nunca se escribe a mano.
 *
 * - 409 `check_desactualizado` si la fila no es la vigente de su clave (se volvió a verificar).
 * - 422 `check_en_orden` si el check está `ok` (no hay nada que supervisar).
 */

export interface EntradaRevisarCheck {
    check_id: number
    estado: 'supervisado' | 'anomalia'
    nota: string
}

export default class RevisarCheck extends DomainAction<EntradaRevisarCheck, CheckVista> {
    readonly nombre = 'cierres.revisar_check'

    protected async handle(input: EntradaRevisarCheck, t: Transaccion): Promise<CheckVista> {
        const nota = input.nota?.trim() ?? ''
        if (nota.length < 3) {
            throw new ValidacionFallida([
                { field: 'nota', message: 'La nota es obligatoria al revisar un check', rule: 'required' },
            ])
        }
        const check = await verCheck(input.check_id, t.trx)
        if (!check) throw new NoEncontrado(`El check ${input.check_id} no existe`)
        exigirAccesoEmpresa(t.ctx, check.empresa_id)
        t.fijarEmpresa(check.empresa_id)
        t.fijarEntidad('cierre_check', check.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, check.empresa_id])

        const ultimo = (await t.trx
            .from('ledger.cierres_checks')
            .where({
                empresa_id: check.empresa_id,
                tipo: check.tipo,
                periodo: check.periodo,
                clave: check.clave,
            })
            .max('id as id')
            .first()) as { id: number }
        if (Number(ultimo.id) !== check.id) {
            throw new Conflicto(
                `El check ${check.clave} se volvió a verificar: revisa la fila vigente (${ultimo.id})`,
                'check_desactualizado',
                'Check desactualizado',
            )
        }
        if (check.resultado === 'ok') {
            throw new Problema(
                422,
                'check_en_orden',
                'Check en orden',
                `El check ${check.clave} está en orden`,
                [
                    {
                        field: 'estado',
                        message: 'Solo un check en anomalía se supervisa',
                        rule: 'check_en_orden',
                    },
                ],
            )
        }
        if (check.estado === input.estado) {
            throw new Conflicto(
                `El check ${check.clave} ya está ${input.estado}`,
                'check_sin_cambio',
                'Sin cambio',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cierres_checks')
            .insert({
                empresa_id: check.empresa_id,
                tipo: check.tipo,
                periodo: check.periodo,
                clave: check.clave,
                automatico: false,
                valor_esperado: check.esperado,
                valor_obtenido: check.obtenido,
                resultado: check.resultado,
                estado: input.estado,
                nota,
                detalle: check.detalle ? JSON.stringify(check.detalle) : null,
                revisado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        return (await verCheck(Number(fila!.id), t.trx))!
    }
}
