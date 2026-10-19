import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { valorParametro } from '#fiscal/parametros'
import { bloquearCliente, serviciosDe, sumarAPagado, type FacturaPendiente } from '#billing/cobros'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * `pagos.cerrar_diferencia` (`POST /pagos/:id/cerrar-diferencia`): cierra el saldo pequeño que dejó
 * un pago en las facturas a las que se aplicó, hasta `diferencia_cobro_tope` (parámetro de la
 * empresa, Q1.00 por defecto; contrato de localización fiscal §10.9, el _Post Difference In_ de Odoo).
 *
 * Decisión del líder (B): la diferencia es un **gasto por centavos no cobrados**, nunca una nota de
 * crédito. Por cada factura del pago que quedó con saldo:
 *
 * - Asiento `diferencia_cobro` (origen = la fila de `billing.diferencias_cobro`): `5.3.05 Diferencias
 *   de cobro / CxC` del dueño de la factura. No toca IVA ni DTE: el DTE va siempre por el total (un
 *   aviso con `certificar_al = pagar` queda cubierto y se certifica por el total).
 * - `pagado` no cambia (es solo dinero cobrado, decisión g): la factura queda `pagada` porque
 *   `pagado + Σ diferencias vigentes = total` (`sumarAPagado`).
 * - Evento `pago.diferencia_cerrada` y reevaluación de cada servicio (puede reactivar).
 * - Σ saldos > tope → 422 `diferencia_sobre_tope`; sin saldo que cerrar → 409 `sin_diferencia`;
 *   pago anulado → 409 `pago_anulado`; DTE de una factura en anulación → 409 `anulacion_en_proceso`.
 *   Una vez por pago y factura. Anular el pago revierte el asiento en espejo (`pagos.anular`).
 */

export interface EntradaCerrarDiferencia {
    pago_id: number
    motivo?: string | null
}

export interface DiferenciaCerrada {
    factura_id: number
    diferencia_id: number
    monto: string
    asiento_id: number
}

export interface ResultadoCerrarDiferencia {
    pago_id: number
    empresa_id: number
    monto: string
    tope: string
    diferencias: DiferenciaCerrada[]
}

type FacturaConSaldo = FacturaPendiente & { pendiente: string }

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
        const consulta = () =>
            t.trx
                .from('billing.facturas as f')
                .whereIn('f.id', (q) =>
                    q
                        .from('billing.pagos_aplicaciones as a')
                        .where('a.pago_id', pago.id)
                        .select('a.factura_id'),
                )
                .whereIn('f.estado', ['emitida', 'parcial', 'vencida'])
                .whereRaw('f.total > f.pagado')
                .whereNotExists((q) =>
                    q
                        .from('billing.diferencias_cobro as d')
                        .where('d.pago_id', pago.id)
                        .whereRaw('d.factura_id = f.id'),
                )
        const clientes = (await consulta().distinct('f.cliente_id')) as Array<{ cliente_id: number }>
        if (clientes.length === 0) {
            throw new Conflicto(
                `El pago ${pago.id} no dejó saldo pendiente en sus facturas`,
                'sin_diferencia',
                'Sin diferencia',
            )
        }
        for (const id of clientes.map((c) => Number(c.cliente_id)).sort((a, b) => a - b)) {
            await bloquearCliente(t.trx, id)
        }
        // releída con los clientes bloqueados
        const facturas = (await consulta()
            .orderBy('f.id')
            .forUpdate()
            .select(
                'f.id',
                'f.empresa_id',
                'f.cliente_id',
                'f.servicio_id',
                'f.total',
                'f.pagado',
                'f.vencida_en',
                t.trx.raw('(f.total - f.pagado)::text as pendiente'),
            )) as FacturaConSaldo[]
        if (facturas.length === 0) {
            throw new Conflicto(
                `El pago ${pago.id} no dejó saldo pendiente en sus facturas`,
                'sin_diferencia',
                'Sin diferencia',
            )
        }
        const enAnulacion = (await t.trx
            .from('fiscal.dte')
            .whereIn('documento_tipo', ['factura', 'nota_debito'])
            .whereIn(
                'documento_id',
                facturas.map((f) => f.id),
            )
            .where('estado', 'anulacion_pendiente')
            .select('documento_id')) as Array<{ documento_id: number }>
        if (enAnulacion.length > 0) {
            throw new Conflicto(
                `La anulación del DTE de las facturas ${enAnulacion.map((d) => d.documento_id).join(', ')} está pendiente con el certificador`,
                'anulacion_en_proceso',
                'Anulación en proceso',
            )
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
        const diferencias: DiferenciaCerrada[] = []
        for (const f of facturas) {
            // el asiento lleva como origen la fila de la diferencia: se reserva su id antes
            const { rows } = (await t.trx.rawQuery(
                `SELECT nextval(pg_get_serial_sequence('billing.diferencias_cobro', 'id'))::bigint AS id`,
            )) as { rows: Array<{ id: string }> }
            const diferenciaId = Number(rows[0]!.id)
            const monto = aTexto(f.pendiente)
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    descripcion: `Diferencia de cobro del pago ${pago.id} en la factura ${f.id} · ${motivo}`,
                    origen_tipo: 'diferencia_cobro',
                    origen_id: diferenciaId,
                    movimientos: [
                        { cuenta: CUENTAS_GT.DIFERENCIAS_COBRO, debe: monto },
                        { cuenta: CUENTAS.CXC_CLIENTES, haber: monto, cliente_id: Number(f.cliente_id) },
                    ],
                },
                t.ctx,
                { trx: t.trx },
            )
            await t.trx.rawQuery(
                `INSERT INTO billing.diferencias_cobro
                        (id, empresa_id, pago_id, factura_id, monto, asiento_id, registrado_por)
                 OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, 0))`,
                [
                    diferenciaId,
                    empresaId,
                    pago.id,
                    f.id,
                    monto,
                    asiento.id,
                    usuarioDelActor(t.ctx.actor) ?? 0,
                ],
            )
            const antes = { estado: await estadoDe(t, f.id) }
            const estado = await sumarAPagado(t.trx, f, CERO)
            await t.registrarCambios({ tipo: 'factura', id: f.id }, antes, { estado })
            diferencias.push({ factura_id: f.id, diferencia_id: diferenciaId, monto, asiento_id: asiento.id })
        }
        t.fijarEntidad('pago', pago.id)
        await t.emit('pago.diferencia_cerrada', {
            pago_id: pago.id,
            empresa_id: empresaId,
            cliente_id: pago.cliente_id,
            facturas: diferencias.map((d) => d.factura_id),
            monto: aTexto(total),
        })
        for (const servicioId of serviciosDe(facturas)) {
            await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, { trx: t.trx })
        }
        return {
            pago_id: pago.id,
            empresa_id: empresaId,
            monto: aTexto(total),
            tope: aTexto(tope),
            diferencias,
        }
    }
}

async function estadoDe(t: Transaccion, facturaId: number): Promise<string> {
    const fila = (await t.trx
        .from('billing.facturas')
        .where('id', facturaId)
        .select('estado')
        .firstOrFail()) as {
        estado: string
    }
    return fila.estado
}
