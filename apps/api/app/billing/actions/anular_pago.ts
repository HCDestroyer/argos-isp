import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import type { MetodoPago } from '#shared/eventos'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import {
    aplicarAnticipos,
    bloquearClientes,
    clientesDelPago,
    serviciosDe,
    sumarAPagado,
    type FacturaPendiente,
} from '#billing/cobros'
import { verPago, type PagoVista } from '#billing/pagos'
import AnularNotaCredito from '#billing/actions/anular_nota_credito'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import type { ResultadoRegistrarPago } from '#billing/actions/registrar_pago'

/**
 * `pagos.anular` (`POST /pagos/:id/anular`, permiso `pagos.anular`, con motivo).
 *
 * - El pago pasa a `anulado` (con quién, cuándo y por qué); nunca se borra ni se edita su monto.
 * - Cada asiento del pago (el del cobro y los de aplicación de su anticipo) se revierte con
 *   `RevertirAsiento` (asiento espejo con `reversa_de`).
 * - Lo aplicado se descuenta de cada factura y su estado se recalcula (`vencida` si ya había
 *   vencido). Las filas de `pagos_aplicaciones` quedan como historia del pago anulado.
 * - Pago de terceros: revierte también los auxiliares CxC de los dueños de las facturas (el
 *   reverso es espejo del asiento) y re-evalúa sus servicios.
 * - Multiempresa: anula solo ESTE pago (de una empresa); los demás pagos de su cobro siguen
 *   vigentes. 403 `empresa_no_permitida` si el pago es de una empresa fuera del alcance.
 * - Evento `pago.anulado` (con `clientes`); luego aplica los anticipos que tengan el pagador y
 *   cada dueño de las facturas cubiertas (sus facturas vuelven a deber: no puede quedar saldo a
 *   favor con deuda) y re-evalúa cada servicio afectado (puede volver a limitar o cortar,
 *   respetando la hora de corte).
 */

export interface EntradaAnularPago {
    pago_id: number
    motivo: string
}

/** El pago anulado y cómo quedó cada servicio re-evaluado (puede volver a limitarse o cortarse). */
export type ResultadoAnularPago = PagoVista & Pick<ResultadoRegistrarPago, 'servicios'>

export default class AnularPago extends DomainAction<EntradaAnularPago, ResultadoAnularPago> {
    readonly nombre = 'pagos.anular'

    protected async handle(input: EntradaAnularPago, t: Transaccion): Promise<ResultadoAnularPago> {
        t.fijarEntidad('pago', input.pago_id)
        const previo = await t.trx
            .from('billing.pagos')
            .where('id', input.pago_id)
            .select('cliente_id')
            .first()
        if (!previo) throw new NoEncontrado(`El pago ${input.pago_id} no existe`)
        // pago de terceros: también los dueños de las facturas a las que se aplicó
        const duenos = (await t.trx
            .from('billing.pagos_aplicaciones as a')
            .join('billing.facturas as f', 'f.id', 'a.factura_id')
            .where('a.pago_id', input.pago_id)
            .distinct('f.cliente_id')) as Array<{ cliente_id: number }>
        await bloquearClientes(t.trx, [previo.cliente_id, ...duenos.map((d) => d.cliente_id)])

        const pago = (await t.trx
            .from('billing.pagos')
            .where('id', input.pago_id)
            .forUpdate()
            .select('id', 'empresa_id', 'cobro_id', 'cliente_id', 'metodo', 'monto', 'estado')
            .firstOrFail()) as {
            id: number
            empresa_id: number
            cobro_id: number | null
            cliente_id: number
            metodo: MetodoPago
            monto: string
            estado: string
        }
        const empresaId = Number(pago.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (pago.estado === 'anulado') {
            throw new ReglaNegocio(`El pago ${pago.id} ya está anulado`, 'pago_anulado')
        }

        const aplicaciones = (await t.trx
            .from('billing.pagos_aplicaciones')
            .where('pago_id', pago.id)
            .groupBy('factura_id')
            .select('factura_id', t.trx.raw('sum(monto)::text as monto'))) as Array<{
            factura_id: number
            monto: string
        }>
        const facturas = (await t.trx
            .from('billing.facturas')
            .whereIn(
                'id',
                aplicaciones.map((a) => a.factura_id),
            )
            .orderBy('id', 'asc')
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'total',
                'pagado',
                'vencida_en',
            )) as FacturaPendiente[]
        const castigadas = (await t.trx
            .from('ledger.castigos_facturas')
            .whereIn(
                'factura_id',
                facturas.map((f) => f.id),
            )
            .select('factura_id')) as Array<{ factura_id: number }>
        if (castigadas.length > 0) {
            throw new Conflicto(
                `El pago ${pago.id} se aplicó a facturas ya castigadas (${castigadas.map((c) => c.factura_id).join(', ')}): ` +
                    'el castigo cerró su saldo; corrige con un asiento de ajuste',
                'factura_castigada',
                'Factura castigada',
            )
        }
        for (const factura of facturas) {
            const aplicado = aplicaciones.find((a) => a.factura_id === factura.id)!
            await sumarAPagado(t.trx, factura, dec(aplicado.monto).negated())
        }

        const asientos = (await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'pago')
            .where('a.origen_id', pago.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .orderBy('a.id', 'asc')
            .select('a.id')) as Array<{ id: number }>
        for (const asiento of asientos) {
            await new RevertirAsiento().execute(
                {
                    asiento_id: asiento.id,
                    motivo: `anulación del pago ${pago.id}: ${input.motivo}`,
                    por_anulacion: true,
                },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.trx
            .from('billing.pagos')
            .where('id', pago.id)
            .update({
                estado: 'anulado',
                anulado_en: t.trx.knexRawQuery('now()'),
                anulado_por: usuarioDelActor(t.ctx.actor),
                motivo_anulacion: input.motivo.trim(),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)

        // H13: la diferencia de cobro que este pago cerró se justificaba con él; su nota interna se anula
        // (reverso espejo). Una NCRE ya enviada a la SAT no se deshace aquí (contrato §18)
        const diferencias = (await t.trx
            .from('billing.diferencias_cobro as d')
            .where('d.pago_id', pago.id)
            .whereNotExists((q) =>
                q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = d.nota_credito_id'),
            )
            .whereNotExists((q) =>
                q
                    .from('fiscal.dte as e')
                    .whereRaw("e.documento_tipo = 'nota_credito' AND e.documento_id = d.nota_credito_id"),
            )
            // con el documento ya en la SAT (o en camino) la nota quedó en su neto: no se toca
            .whereNotExists((q) =>
                q
                    .from('fiscal.dte as e')
                    .join('billing.notas_credito as n', 'n.id', 'd.nota_credito_id')
                    .whereRaw(
                        "e.documento_tipo IN ('factura', 'nota_debito') AND e.documento_id = n.factura_id AND e.estado IN ('pendiente', 'error_temporal', 'contingencia', 'certificado', 'anulacion_pendiente')",
                    ),
            )
            .orderBy('d.id')
            .select('d.nota_credito_id')) as Array<{ nota_credito_id: number }>
        for (const d of diferencias) {
            await new AnularNotaCredito().execute(
                {
                    nota_id: Number(d.nota_credito_id),
                    motivo: `anulación del pago ${pago.id}: ${input.motivo}`,
                    pago_id: pago.id,
                },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.emit('pago.anulado', {
            pago_id: pago.id,
            empresa_id: empresaId,
            cobro_id: pago.cobro_id === null ? null : Number(pago.cobro_id),
            cliente_id: pago.cliente_id,
            monto: pago.monto,
            metodo: pago.metodo,
            facturas: aplicaciones.map((a) => a.factura_id),
            clientes: clientesDelPago(pago.cliente_id, facturas),
        })

        // anticipos que vuelven a tener deuda contra la cual aplicarse: los del pagador y los de
        // cada dueño de las facturas que el pago cubría (pago de terceros). Cada aplicación deja
        // su asiento `Anticipos / CxC` (RegistrarAsiento, auditado) y su fila en pagos_aplicaciones.
        const otras: Awaited<ReturnType<typeof aplicarAnticipos>> = []
        for (const clienteId of clientesDelPago(pago.cliente_id, facturas)) {
            otras.push(...(await aplicarAnticipos(t, clienteId, empresaId)))
        }
        const servicios: ResultadoAnularPago['servicios'] = []
        for (const servicioId of serviciosDe([...facturas, ...otras])) {
            const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, {
                trx: t.trx,
            })
            servicios.push({
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            })
        }
        return { ...(await verPago(pago.id, t.trx)), servicios }
    }
}
