import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { valorParametro } from '#fiscal/parametros'
import { bloquearCliente } from '#billing/cobros'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'

/**
 * `pagos.cerrar_diferencia` (`POST /pagos/:id/cerrar-diferencia`): cierra el saldo pequeño que dejó
 * un pago en las facturas a las que se aplicó, hasta `diferencia_cobro_tope` (parámetro de la
 * empresa, Q1.00 por defecto; contrato de localización fiscal §10.9, el _Post Difference In_ de Odoo).
 *
 * - Por cada factura del pago que quedó con saldo: una nota de crédito por ese saldo
 *   (`facturas.nota_credito` anidada, con su auditoría, evento y reevaluación del servicio). Si la
 *   factura tiene DTE certificado es una **NCRE** (reduce la venta); si es un aviso sin DTE, una nota
 *   interna proporcional cuya base va a `5.3.05 Diferencias de cobro` y su IVA sale de 2.1.11.
 * - Σ saldos > tope → 422 `diferencia_sobre_tope`; sin saldo que cerrar → 409 `sin_diferencia`;
 *   pago anulado → 409 `pago_anulado`. Una vez por pago y factura (`billing.diferencias_cobro`).
 */

export interface EntradaCerrarDiferencia {
    pago_id: number
    motivo?: string | null
}

export interface ResultadoCerrarDiferencia {
    pago_id: number
    empresa_id: number
    monto: string
    tope: string
    notas: Array<{ factura_id: number; nota_credito_id: number; monto: string; ncre: boolean }>
}

export default class CerrarDiferenciaPago extends DomainAction<
    EntradaCerrarDiferencia,
    ResultadoCerrarDiferencia
> {
    readonly nombre = 'pagos.cerrar_diferencia'

    protected async handle(
        input: EntradaCerrarDiferencia,
        t: Transaccion,
    ): Promise<ResultadoCerrarDiferencia> {
        t.fijarEntidad('pago', input.pago_id)
        const pago = (await t.trx
            .from('billing.pagos')
            .where('id', input.pago_id)
            .select('id', 'empresa_id', 'cliente_id', 'estado')
            .first()) as { id: number; empresa_id: number; cliente_id: number; estado: string } | null
        if (!pago) throw new NoEncontrado(`El pago ${input.pago_id} no existe`)
        const empresaId = Number(pago.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (pago.estado !== 'registrado') {
            throw new Conflicto(`El pago ${pago.id} está ${pago.estado}`, 'pago_anulado', 'Pago no vigente')
        }
        const facturas = (await t.trx
            .from('billing.pagos_aplicaciones as a')
            .join('billing.facturas as f', 'f.id', 'a.factura_id')
            .where('a.pago_id', pago.id)
            .whereIn('f.estado', ['emitida', 'parcial', 'vencida'])
            .whereRaw('f.total > f.pagado')
            .whereNotExists((q) =>
                q
                    .from('billing.diferencias_cobro as d')
                    .whereRaw('d.pago_id = a.pago_id AND d.factura_id = f.id'),
            )
            .groupBy('f.id', 'f.cliente_id', 'f.total', 'f.pagado')
            .orderBy('f.id')
            .select('f.id', 'f.cliente_id', t.trx.raw('(f.total - f.pagado)::text as pendiente'))) as Array<{
            id: number
            cliente_id: number
            pendiente: string
        }>
        if (facturas.length === 0) {
            throw new Conflicto(
                `El pago ${pago.id} no dejó saldo pendiente en sus facturas`,
                'sin_diferencia',
                'Sin diferencia',
            )
        }
        for (const id of [...new Set(facturas.map((f) => Number(f.cliente_id)))].sort((a, b) => a - b)) {
            await bloquearCliente(t.trx, id)
        }
        const total = facturas.reduce((s, f) => s.plus(f.pendiente), CERO)
        const tope = dec(
            String(await valorParametro<string>(empresaId, 'diferencia_cobro_tope', hoyGuatemala(), t.trx)),
        )
        if (total.gt(tope)) {
            throw new Problema(
                422,
                'diferencia_sobre_tope',
                'Diferencia sobre el tope',
                `El pago ${pago.id} deja Q${aTexto(total)} pendientes y el tope de la empresa es Q${aTexto(tope)}`,
                [
                    {
                        field: 'pago_id',
                        message: `Diferencia Q${aTexto(total)} > tope Q${aTexto(tope)}`,
                        rule: 'diferencia_sobre_tope',
                    },
                ],
            )
        }
        const motivo = input.motivo?.trim() || `Diferencia de cobro del pago ${pago.id}`
        const notas: ResultadoCerrarDiferencia['notas'] = []
        for (const f of facturas) {
            const nota = await new EmitirNotaCredito().execute(
                {
                    factura_id: Number(f.id),
                    monto: f.pendiente,
                    motivo,
                    cuenta_base: CUENTAS_GT.DIFERENCIAS_COBRO,
                },
                t.ctx,
                { trx: t.trx },
            )
            await t.trx
                .insertQuery()
                .table('billing.diferencias_cobro')
                .insert({
                    empresa_id: empresaId,
                    pago_id: pago.id,
                    factura_id: Number(f.id),
                    nota_credito_id: nota.id,
                    monto: f.pendiente,
                    registrado_por: usuarioDelActor(t.ctx.actor),
                })
            const ncre = await t.trx
                .from('fiscal.dte')
                .where({ documento_tipo: 'nota_credito', documento_id: nota.id })
                .select('id')
                .first()
            notas.push({
                factura_id: Number(f.id),
                nota_credito_id: nota.id,
                monto: aTexto(f.pendiente),
                ncre: Boolean(ncre),
            })
        }
        return { pago_id: pago.id, empresa_id: empresaId, monto: aTexto(total), tope: aTexto(tope), notas }
    }
}
