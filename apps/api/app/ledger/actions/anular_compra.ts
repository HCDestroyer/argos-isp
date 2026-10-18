import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verCompra, type CompraVista } from '#ledger/compras'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { anularAltasDeLaCompra } from '#ledger/altas_compra'

/**
 * `compras.anular` (`POST /compras/:id/anular`, con motivo): revierte el asiento de la compra (con
 * las etiquetas de impuesto en signo contrario, para que el libro de compras reste la anulación en
 * su mes) y deja la fila en `ledger.compras_anulaciones`. La compra nunca se edita ni se borra.
 *
 * - Al contado: el egreso que la pagó queda anulado con el mismo reverso (`egresos_anulaciones`).
 * - Desde un egreso: solo se revierte la reclasificación; el egreso sigue vigente (y se puede
 *   volver a registrar como compra).
 * - 409 `compra_anulada` (dos veces), `compra_con_notas` (NCRE vigentes que la corrigen),
 *   `compra_con_pagos` (pagos a proveedor vigentes aplicados), `compra_con_constancia` (constancia
 *   de retención emitida) y las de sus activos o diferidos con cuotas (`#ledger/altas_compra`).
 * - Emite `compra.anulada`.
 */

export interface EntradaAnularCompra {
    compra_id: number
    motivo: string
}

export default class AnularCompra extends DomainAction<EntradaAnularCompra, CompraVista> {
    readonly nombre = 'compras.anular'

    protected async handle(input: EntradaAnularCompra, t: Transaccion): Promise<CompraVista> {
        t.fijarEntidad('compra', input.compra_id)
        const compra = (await t.trx
            .from('ledger.compras')
            .where('id', input.compra_id)
            .select(
                'id',
                'empresa_id',
                'proveedor_id',
                'total',
                'iva',
                t.trx.raw(`to_char(periodo_iva, 'YYYY-MM') as periodo_iva`),
            )
            .first()) as {
            id: number
            empresa_id: number
            proveedor_id: number
            total: string
            iva: string
            periodo_iva: string
        } | null
        if (!compra) throw new NoEncontrado(`La compra ${input.compra_id} no existe`)
        const empresaId = Number(compra.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        // una compra se anula una vez; un pago a proveedor simultáneo espera (mismo lock)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3012, compra.id])
        const previa = await t.trx.from('ledger.compras_anulaciones').where('compra_id', compra.id).first()
        if (previa) {
            throw new Conflicto(`La compra ${compra.id} ya está anulada`, 'compra_anulada', 'Compra anulada')
        }

        const nota = await t.trx
            .from('ledger.compras as n')
            .where('n.compra_referencia_id', compra.id)
            .where('n.tipo_documento', 'NCRE')
            .whereNotExists((q) => q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = n.id'))
            .select('n.id')
            .first()
        if (nota) {
            throw new Conflicto(
                `La compra ${compra.id} tiene la NCRE vigente ${nota.id}: anúlala primero`,
                'compra_con_notas',
                'Compra con notas de crédito',
            )
        }
        const pago = await t.trx
            .from('ledger.pagos_proveedores_aplicaciones as ap')
            .where('ap.compra_id', compra.id)
            .whereNotExists((q) =>
                q.from('ledger.pagos_proveedores_anulaciones as x').whereRaw('x.pago_id = ap.pago_id'),
            )
            .select('ap.pago_id')
            .first()
        if (pago) {
            throw new Conflicto(
                `La compra ${compra.id} tiene aplicado el pago a proveedor ${pago.pago_id}: anúlalo primero`,
                'compra_con_pagos',
                'Compra con pagos',
            )
        }
        const constancia = await t.trx
            .from('ledger.constancias_retencion')
            .where('compra_id', compra.id)
            .select('numero')
            .first()
        if (constancia) {
            throw new Conflicto(
                `La compra ${compra.id} tiene la constancia de retención ${constancia.numero} emitida: anúlala ante la SAT y registra el ajuste`,
                'compra_con_constancia',
                'Compra con constancia emitida',
            )
        }
        const motivo = input.motivo.trim()
        await anularAltasDeLaCompra(t, compra.id, motivo)

        const asiento = await t.trx
            .from('ledger.asientos')
            .where({ origen_tipo: 'compra', origen_id: compra.id })
            .whereNull('reversa_de')
            .select('id')
            .first()
        const reverso = asiento
            ? await new RevertirAsiento().execute(
                  {
                      asiento_id: Number(asiento.id),
                      motivo: `anulación de la compra ${compra.id}: ${motivo}`,
                      por_anulacion: true,
                      invertir_etiquetas: true,
                  },
                  t.ctx,
                  { trx: t.trx },
              )
            : null
        const anuladoPor = usuarioDelActor(t.ctx.actor)
        await t.trx
            .insertQuery()
            .table('ledger.compras_anulaciones')
            .insert({
                compra_id: compra.id,
                asiento_id: reverso?.id ?? null,
                motivo,
                anulado_por: anuladoPor,
            })
        const egreso = await t.trx.from('ledger.egresos').where('compra_id', compra.id).select('id').first()
        if (egreso && reverso) {
            await t.trx
                .insertQuery()
                .table('ledger.egresos_anulaciones')
                .insert({
                    egreso_id: egreso.id,
                    asiento_id: reverso.id,
                    motivo: `anulación de la compra ${compra.id}: ${motivo}`,
                    anulado_por: anuladoPor,
                })
        }
        await t.emit('compra.anulada', {
            compra_id: compra.id,
            empresa_id: empresaId,
            proveedor_id: Number(compra.proveedor_id),
            total: compra.total,
            iva: compra.iva,
            periodo_iva: compra.periodo_iva,
        })
        return verCompra(compra.id, t.trx)
    }
}
