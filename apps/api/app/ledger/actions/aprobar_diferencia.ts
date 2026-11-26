import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verDiferencia, type DiferenciaConciliacionVista } from '#ledger/diferencias_conciliacion'
import ConciliarLinea from '#ledger/actions/conciliar_linea'

/**
 * `bancos.aprobar_diferencia` (`POST /bancos/diferencias/:id/aprobar`; plan de contabilidad §5.8,
 * B3): concilia la línea con lo que se pidió y la diferencia tal como se aprobó (asiento de origen
 * `diferencia_conciliacion` y conciliación, con `bancos.conciliar` anidada en la misma transacción).
 * **Quien la pidió no puede aprobarla** (403 `autoaprobacion`). Una diferencia se decide una vez (409
 * `diferencia_decidida`). Si la línea o lo emparejado ya se conciliaron por otro camino, responde ese
 * error y la diferencia sigue pendiente (se rechaza). Evento `banco.diferencia_aprobada`.
 */

/** Toma la diferencia con lock y exige que siga pendiente. */
export async function bloquearDiferenciaPendiente(
    t: Transaccion,
    id: number,
): Promise<DiferenciaConciliacionVista> {
    // sin FOR UPDATE: la tabla es de solo inserción (la app no tiene UPDATE); la PK de la decisión
    // impide además decidir dos veces
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3032, ?::int)', [id])
    const diferencia = await verDiferencia(id, t.trx)
    exigirAccesoEmpresa(t.ctx, diferencia.empresa_id)
    t.fijarEmpresa(diferencia.empresa_id)
    t.fijarEntidad('diferencia_conciliacion', diferencia.id)
    if (diferencia.estado !== 'pendiente') {
        throw new Conflicto(
            `La diferencia ${id} ya no espera aprobación (${diferencia.estado})`,
            'diferencia_decidida',
            'Diferencia decidida',
        )
    }
    return diferencia
}

export default class AprobarDiferencia extends DomainAction<
    { diferencia_id: number },
    DiferenciaConciliacionVista
> {
    readonly nombre = 'bancos.aprobar_diferencia'

    protected async handle(
        input: { diferencia_id: number },
        t: Transaccion,
    ): Promise<DiferenciaConciliacionVista> {
        const diferencia = await bloquearDiferenciaPendiente(t, input.diferencia_id)
        const aprobador = usuarioDelActor(t.ctx.actor)
        if (aprobador === null || aprobador === diferencia.solicitado_por) {
            throw new Problema(
                403,
                'autoaprobacion',
                'No puedes aprobar tu propia diferencia',
                'Quien pide la aprobación de una diferencia no puede aprobarla: la aprueba otro usuario con bancos.aprobar_diferencia',
            )
        }
        const conciliacion = await new ConciliarLinea().execute(
            {
                linea_id: diferencia.linea_id,
                ...diferencia.solicitud,
                diferencia_aprobada: diferencia,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx.insertQuery().table('billing.diferencias_conciliacion_decisiones').insert({
            diferencia_id: diferencia.id,
            decision: 'aprobada',
            decidido_por: aprobador,
        })
        t.fijarEntidad('diferencia_conciliacion', diferencia.id)
        await t.emit('banco.diferencia_aprobada', {
            diferencia_id: diferencia.id,
            empresa_id: diferencia.empresa_id,
            cuenta_id: diferencia.cuenta_id,
            linea_id: diferencia.linea_id,
            conciliacion_id: conciliacion.id,
            monto: diferencia.monto,
            solicitado_por: diferencia.solicitado_por,
            aprobado_por: aprobador,
        })
        return verDiferencia(diferencia.id, t.trx)
    }
}
