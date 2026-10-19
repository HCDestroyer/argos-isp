import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { bloquearCliente, sumarAPagado, type FacturaPendiente } from '#billing/cobros'
import { verNotaCredito } from '#billing/notas_credito'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { dteVigente, ultimoDte } from '#fiscal/fel/dte'
import { DteEnProceso } from '#fiscal/fel/errores'

/**
 * `facturas.anular_nota_credito` (`POST /notas-credito/:id/anular { motivo }`): anula una nota de
 * crédito cuya **NCRE la SAT rechazó en definitivo** (condición del líder para la NCRE inmediata en
 * FEL obligatoria, contrato §17). La nota existe en el libro desde que se emitió; si su DTE no se
 * puede certificar, se deshace:
 *
 * - Reverso espejo del asiento de la nota (`RevertirAsiento`), fila en
 *   `billing.notas_credito_anulaciones` (una sola por nota) y el monto vuelve al saldo de la factura
 *   (`pagado − monto`, estado recalculado). Reevalúa el servicio. Evento `nota_credito.anulada`.
 * - (B) La diferencia de cobro ya no es una nota (es gasto `5.3.05 / CxC`): `notas_credito_anulaciones.pago_id`
 *   queda solo como historia del esquema anterior (H13) y esta acción no la escribe.
 * - 409 `nota_anulada` (ya lo estaba), `ncre_certificada` (una NCRE certificada no se anula aquí),
 *   `dte_en_proceso` (aún en cola), `nota_sin_ncre_rechazada` (una nota interna o sin rechazo
 *   definitivo de la SAT no se anula: se corrige con otra nota o un cargo).
 */

export interface EntradaAnularNotaCredito {
    nota_id: number
    motivo: string
}

export default class AnularNotaCredito extends DomainAction<
    EntradaAnularNotaCredito,
    Awaited<ReturnType<typeof verNotaCredito>>
> {
    readonly nombre = 'facturas.anular_nota_credito'

    protected async handle(input: EntradaAnularNotaCredito, t: Transaccion) {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        t.fijarEntidad('nota_credito', input.nota_id)
        const nota = (await t.trx
            .from('billing.notas_credito')
            .where('id', input.nota_id)
            .select('id', 'empresa_id', 'factura_id', 'cliente_id', 'monto')
            .first()) as {
            id: number
            empresa_id: number
            factura_id: number
            cliente_id: number
            monto: string
        } | null
        if (!nota) throw new NoEncontrado(`La nota de crédito ${input.nota_id} no existe`)
        const empresaId = Number(nota.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const factura = (await t.trx
            .from('billing.facturas')
            .where('id', nota.factura_id)
            .select('cliente_id')
            .firstOrFail()) as { cliente_id: number }
        await bloquearCliente(t.trx, factura.cliente_id)

        const anulada = await t.trx
            .from('billing.notas_credito_anulaciones')
            .where('nota_id', nota.id)
            .first()
        if (anulada) throw new Conflicto(`La nota ${nota.id} ya está anulada`, 'nota_anulada', 'Nota anulada')
        const aFavor = (await t.trx
            .from('billing.notas_credito')
            .where('id', nota.id)
            .select('a_favor')
            .first()) as {
            a_favor: string
        }
        if (Number(aFavor.a_favor) > 0) {
            // su excedente ya es crédito del cliente (y pudo pagar otras facturas): no se deshace aquí
            throw new Conflicto(
                `La nota ${nota.id} dejó saldo a favor del cliente: no se anula con esta acción`,
                'nota_con_saldo_a_favor',
                'Nota con saldo a favor',
            )
        }
        const vigente = await dteVigente(t.trx, 'nota_credito', nota.id, true)
        if (vigente?.estado === 'certificado' || vigente?.estado === 'anulado') {
            throw new Conflicto(
                `La NCRE de la nota ${nota.id} está ${vigente.estado}: no se anula con esta acción`,
                'ncre_certificada',
                'NCRE certificada',
            )
        }
        if (vigente) throw new DteEnProceso(vigente.id, vigente.estado)
        const ultimo = await ultimoDte(t.trx, 'nota_credito', nota.id)
        if (!ultimo || ultimo.estado !== 'rechazado' || !ultimo.definitivo) {
            throw new Conflicto(
                `La nota ${nota.id} no tiene una NCRE rechazada en definitivo por la SAT: corrígela con otra nota o un cargo`,
                'nota_sin_ncre_rechazada',
                'Nota sin NCRE rechazada',
            )
        }

        const asiento = (await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'nota_credito')
            .where('a.origen_id', nota.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .select('a.id')
            .firstOrFail()) as { id: number }
        const reverso = await new RevertirAsiento().execute(
            {
                asiento_id: asiento.id,
                motivo: `anulación de la nota ${nota.id}: ${motivo}`,
                por_anulacion: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('billing.notas_credito_anulaciones')
            .insert({
                empresa_id: empresaId,
                nota_id: nota.id,
                asiento_id: reverso.id,
                dte_id: ultimo.id,
                motivo,
                anulado_por: usuarioDelActor(t.ctx.actor),
            })

        const f = (await t.trx
            .from('billing.facturas')
            .where('id', nota.factura_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'total',
                'pagado',
                'vencida_en',
                'estado',
            )
            .firstOrFail()) as FacturaPendiente & { estado: string }
        const antes = { estado: f.estado, pagado: f.pagado }
        const estado = await sumarAPagado(t.trx, f, dec(nota.monto).negated())
        await t.registrarCambios({ tipo: 'factura', id: f.id }, antes, { estado, pagado: f.pagado })
        await t.emit('nota_credito.anulada', {
            nota_credito_id: nota.id,
            empresa_id: empresaId,
            factura_id: f.id,
            cliente_id: nota.cliente_id,
            monto: nota.monto,
            motivo,
        })
        if (f.servicio_id) {
            await new EvaluarEstadoServicio().execute({ servicio_id: f.servicio_id }, t.ctx, { trx: t.trx })
        }
        return verNotaCredito(nota.id, t.trx)
    }
}
