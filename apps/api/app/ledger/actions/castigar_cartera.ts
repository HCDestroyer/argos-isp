import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, D as Decimal, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { dteVigente } from '#fiscal/fel/dte'
import { bloquearCliente, type FacturaPendiente } from '#billing/cobros'
import { ESTADOS_PENDIENTES, pendienteDe, type EstadoFactura } from '#billing/facturas'
import { verCastigo, type CastigoVista } from '#ledger/cartera'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * `cartera.castigar` (`POST /cartera/castigos`): castigo de facturas incobrables de **un** cliente
 * (contrato de localización fiscal §10.9 y §10.1; LAT art. 21.20).
 *
 * - Motivo y evidencia de la gestión de cobro obligatorios (422 `castigo_sin_evidencia`).
 * - Cada factura: su saldo pendiente. En un **aviso sin DTE** el IVA de ese saldo nunca se causó y
 *   sale de `2.1.11` (proporcional a lo que el aviso tiene por certificar; todo, si nada se pagó).
 *   En una factura con DTE (o con FEL desactivada) el IVA ya es débito: no se recupera aquí (solo con
 *   NCRE; contador).
 * - El resto, primero contra la estimación `1.1.12` disponible y lo que falte a `5.3.02`:
 *   `2.1.11 + 1.1.12 (o 5.3.02) / CxC`, origen `castigo`.
 * - La factura queda **`castigada`** (decisión g del líder): sale de cartera, de la antigüedad y del
 *   corte; `pagado` no cambia (solo dinero cobrado) y lo castigado se lee de `castigos_facturas`. No se
 *   certifica; el servicio se reevalúa. Lo que el cliente pague después es **recuperación**
 *   (`4.2.03`, `pagos.registrar`). Una factura se castiga una vez. Evento `cartera.castigada`.
 */

export interface EntradaCastigarCartera {
    facturas: number[]
    motivo: string
    evidencia: string
}

interface FacturaCastigo extends FacturaPendiente {
    tipo: 'servicio' | 'mora'
    estado: EstadoFactura
    aviso_cobro: boolean
    iva: string
}

export default class CastigarCartera extends DomainAction<EntradaCastigarCartera, CastigoVista> {
    readonly nombre = 'cartera.castigar'

    protected async handle(input: EntradaCastigarCartera, t: Transaccion): Promise<CastigoVista> {
        const motivo = input.motivo?.trim() ?? ''
        const evidencia = input.evidencia?.trim() ?? ''
        if (motivo.length < 3 || evidencia.length < 3) {
            throw new Problema(
                422,
                'castigo_sin_evidencia',
                'Castigo sin evidencia',
                'El castigo exige motivo y la evidencia de la gestión de cobro (LAT art. 21.20)',
                [
                    ...(motivo.length < 3
                        ? [{ field: 'motivo', message: 'Obligatorio', rule: 'castigo_sin_evidencia' }]
                        : []),
                    ...(evidencia.length < 3
                        ? [{ field: 'evidencia', message: 'Obligatoria', rule: 'castigo_sin_evidencia' }]
                        : []),
                ],
            )
        }
        const ids = [...new Set(input.facturas ?? [])]
        if (ids.length === 0) {
            throw new ValidacionFallida([
                { field: 'facturas', message: 'Indica las facturas', rule: 'required' },
            ])
        }
        const duenos = (await t.trx
            .from('billing.facturas')
            .whereIn('id', ids)
            .distinct('cliente_id')) as Array<{
            cliente_id: number
        }>
        for (const d of duenos.map((x) => Number(x.cliente_id)).sort((a, b) => a - b)) {
            await bloquearCliente(t.trx, d)
        }

        const filas = (await t.trx
            .from('billing.facturas')
            .whereIn('id', ids)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                'iva',
                'vencida_en',
                'aviso_cobro',
            )) as FacturaCastigo[]
        const porId = new Map(filas.map((f) => [Number(f.id), f]))
        const errores: ErrorCampo[] = []
        ids.forEach((id, i) => {
            const f = porId.get(id)
            if (!f) {
                errores.push({
                    field: `facturas.${i}`,
                    message: `La factura ${id} no existe`,
                    rule: 'exists',
                })
            } else if (!ESTADOS_PENDIENTES.includes(f.estado) || pendienteDe(f).lte(0)) {
                errores.push({
                    field: `facturas.${i}`,
                    message: `La factura ${id} no tiene saldo pendiente`,
                    rule: 'sin_saldo',
                })
            }
        })
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const primera = porId.get(ids[0]!)!
        const empresaId = Number(primera.empresa_id)
        const clienteId = Number(primera.cliente_id)
        if (filas.some((f) => Number(f.empresa_id) !== empresaId || Number(f.cliente_id) !== clienteId)) {
            throw new ValidacionFallida([
                {
                    field: 'facturas',
                    message: 'Un castigo es de un solo cliente y una sola empresa',
                    rule: 'un_cliente',
                },
            ])
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const partes: Array<{ factura: FacturaCastigo; monto: Dec; iva: Dec }> = []
        for (const id of ids) {
            const f = porId.get(id)!
            const dte = await dteVigente(t.trx, f.tipo === 'mora' ? 'nota_debito' : 'factura', f.id)
            if (dte && dte.estado !== 'certificado') {
                throw new Conflicto(
                    `La factura ${f.id} tiene su DTE ${dte.estado}: espera a que el certificador responda`,
                    'dte_en_proceso',
                    'DTE en proceso',
                )
            }
            const monto = pendienteDe(f)
            let iva = CERO
            if (f.aviso_cobro && !dte) {
                const notas = (await t.trx
                    .from('billing.notas_credito as n')
                    .where('n.factura_id', f.id)
                    .whereNotExists((q) =>
                        q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'),
                    )
                    .select(
                        t.trx.raw('coalesce(sum(n.monto), 0)::text as monto'),
                        t.trx.raw('coalesce(sum(n.iva), 0)::text as iva'),
                    )
                    .first()) as { monto: string; iva: string }
                const ivaRestante = dec(f.iva).minus(notas.iva)
                const netoRestante = dec(f.total).minus(notas.monto)
                iva = monto.equals(netoRestante)
                    ? ivaRestante
                    : Decimal.min(ivaRestante, redondear(monto.times(ivaRestante).div(netoRestante)))
            }
            partes.push({ factura: f, monto, iva })
        }
        const total = partes.reduce((s, p) => s.plus(p.monto), CERO)
        const iva = partes.reduce((s, p) => s.plus(p.iva), CERO)
        const base = total.minus(iva)
        const disponible = (await t.trx.rawQuery(
            `SELECT coalesce(sum(m.haber - m.debe), 0)::text AS saldo
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.cuentas c ON c.id = m.cuenta_id
              WHERE c.codigo = ? AND a.empresa_id = ?`,
            [CUENTAS_GT.ESTIMACION_INCOBRABLES, empresaId],
        )) as { rows: Array<{ saldo: string }> }
        const estimacionDisponible = Decimal.max(CERO, dec(disponible.rows[0]!.saldo))
        const estimacion = Decimal.min(base, estimacionDisponible)
        const gasto = base.minus(estimacion)
        const fecha = hoyGuatemala()

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.castigos')
            .insert({
                empresa_id: empresaId,
                cliente_id: clienteId,
                fecha,
                motivo,
                evidencia,
                monto: aTexto(total),
                iva: aTexto(iva),
                estimacion: aTexto(estimacion),
                gasto: aTexto(gasto),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const castigoId = Number(fila!.id)
        t.fijarEntidad('castigo', castigoId)
        await t.trx
            .insertQuery()
            .table('ledger.castigos_facturas')
            .multiInsert(
                partes.map((p) => ({
                    castigo_id: castigoId,
                    factura_id: p.factura.id,
                    monto: aTexto(p.monto),
                    iva: aTexto(p.iva),
                })),
            )

        const movimientos: LineaAsiento[] = []
        if (iva.gt(0)) movimientos.push({ cuenta: CUENTAS_GT.IVA_POR_CERTIFICAR, debe: aTexto(iva) })
        if (estimacion.gt(0)) {
            movimientos.push({ cuenta: CUENTAS_GT.ESTIMACION_INCOBRABLES, debe: aTexto(estimacion) })
        }
        if (gasto.gt(0)) movimientos.push({ cuenta: CUENTAS_GT.CUENTAS_INCOBRABLES, debe: aTexto(gasto) })
        movimientos.push({ cuenta: CUENTAS.CXC_CLIENTES, haber: aTexto(total), cliente_id: clienteId })
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Castigo ${castigoId} de cartera · facturas ${ids.join(', ')}: ${motivo}`,
                origen_tipo: 'castigo',
                origen_id: castigoId,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )

        const servicios = new Set<number>()
        for (const p of partes) {
            // decisión (g): estado propio; `pagado` sigue siendo solo lo cobrado (pagado + castigado = total)
            await t.trx
                .from('billing.facturas')
                .where('id', p.factura.id)
                .update({
                    estado: 'castigada',
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'factura', id: p.factura.id },
                { estado: p.factura.estado },
                { estado: 'castigada' },
            )
            if (p.factura.servicio_id) servicios.add(Number(p.factura.servicio_id))
        }
        for (const servicioId of [...servicios].sort((a, b) => a - b)) {
            await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, { trx: t.trx })
        }
        await t.emit('cartera.castigada', {
            castigo_id: castigoId,
            empresa_id: empresaId,
            cliente_id: clienteId,
            facturas: ids,
            monto: aTexto(total),
        })
        return verCastigo(castigoId, t.trx)
    }
}
