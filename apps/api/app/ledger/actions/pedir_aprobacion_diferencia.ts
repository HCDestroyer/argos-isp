import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import {
    aprobadoresDe,
    verDiferencia,
    type DiferenciaConciliacionVista,
} from '#ledger/diferencias_conciliacion'
import {
    insertarDiferencia,
    prepararConciliacion,
    type EntradaConciliarLinea,
} from '#ledger/actions/conciliar_linea'

/**
 * `bancos.pedir_aprobacion_diferencia` (`POST /bancos/diferencias`, permiso `bancos.conciliar`; plan
 * de contabilidad §5.8, B3): la diferencia pasa del tope de quien concilia o su motivo siempre pide
 * aprobación. Valida igual que `bancos.conciliar` (lo emparejado, los motivos y sus límites) y deja
 * la diferencia **esperando aprobación**, con la explicación obligatoria. **No toca el libro**: no
 * hay asiento ni conciliación hasta que otro usuario la apruebe. La línea queda apartada (409
 * `diferencia_pendiente` si se intenta conciliar) pero no bloquea el resto del extracto.
 *
 * 422 `aprobacion_innecesaria` si la diferencia está dentro del tope (se concilia directo).
 * Evento `banco.diferencia_pendiente` con los aprobadores posibles.
 */

export interface EntradaPedirAprobacion extends EntradaConciliarLinea {
    explicacion: string
}

export default class PedirAprobacionDiferencia extends DomainAction<
    EntradaPedirAprobacion,
    DiferenciaConciliacionVista
> {
    readonly nombre = 'bancos.pedir_aprobacion_diferencia'

    protected async handle(
        input: EntradaPedirAprobacion,
        t: Transaccion,
    ): Promise<DiferenciaConciliacionVista> {
        const explicacion = input.explicacion?.trim() ?? ''
        if (explicacion.length < 5) {
            throw new ValidacionFallida([
                { field: 'explicacion', message: 'Explica qué pasó con la diferencia', rule: 'required' },
            ])
        }
        if ((input.diferencias ?? []).length === 0) {
            throw new ValidacionFallida([
                { field: 'diferencias', message: 'Indica el motivo de la diferencia', rule: 'required' },
            ])
        }
        const p = await prepararConciliacion(t, { ...input, regla_id: null, diferencia_aprobada: null })
        if (p.razones.length === 0) {
            throw new Problema(
                422,
                'aprobacion_innecesaria',
                'No necesita aprobación',
                'La diferencia está dentro de lo que puedes aceptar: concíliala directo (POST /bancos/conciliaciones)',
            )
        }
        const id = await insertarDiferencia(t, p, explicacion)
        t.fijarEntidad('diferencia_conciliacion', id)
        const posibles = await aprobadoresDe(p.empresa_id, t.trx)
        const aprobadores = posibles.map((a) => a.usuario_id)
        await t.emit('banco.diferencia_pendiente', {
            diferencia_id: id,
            empresa_id: p.empresa_id,
            cuenta_id: Number(p.linea.cuenta_id),
            linea_id: p.linea.id,
            sentido: p.sentido,
            monto: aTexto(p.diferencia.abs()),
            razones: p.razones,
            solicitado_por: usuarioDelActor(t.ctx.actor),
            aprobadores,
        })
        return verDiferencia(id, t.trx)
    }
}
