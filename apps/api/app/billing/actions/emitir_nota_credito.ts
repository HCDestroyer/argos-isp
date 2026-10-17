import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { bloquearCliente, sumarAPagado, type FacturaPendiente } from '#billing/cobros'
import { ESTADOS_PENDIENTES, pendienteDe, verFactura, type EstadoFactura } from '#billing/facturas'
import { repartirProporcional, verNotaCredito, type NotaCreditoFila } from '#billing/notas_credito'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import type { ResultadoEvaluarEstado } from '#billing/actions/evaluar_estado_servicio'

/**
 * `facturas.nota_credito` (`POST /facturas/:id/notas-credito { monto, motivo }`): nota de crédito
 * interna (sin FEL; semana 5) por una parte o todo el saldo de una factura viva.
 *
 * - 404 si la factura no existe; 409 `factura_anulada` o `factura_sin_saldo` (pagada).
 * - `monto` > 0, a centavos y nunca mayor al saldo de la factura (422 `monto`).
 * - Asiento `nota_credito`: Debe lo que la factura acreditó (Ingresos, IVA, Otros ingresos,
 *   Recargos…) en proporción `monto / total`; Haber CxC del cliente. La nota guarda su IVA.
 * - Suma `monto` a `pagado` de la factura (puede quedar `pagada`), emite `nota_credito.emitida` y
 *   re-evalúa el servicio: si ya no le quedan vencidas se reactiva en la misma transacción.
 *   Las promesas activas del cliente se revisan al consumir el evento (grupo `billing`).
 */

export interface EntradaNotaCredito {
    factura_id: number
    monto: string
    motivo: string
}

export type ServicioEvaluadoNota = Pick<
    ResultadoEvaluarEstado,
    'servicio_id' | 'estado' | 'de' | 'cambiado' | 'motivo'
>

export interface ResultadoNotaCredito extends NotaCreditoFila {
    factura: Awaited<ReturnType<typeof verFactura>>
    servicios: ServicioEvaluadoNota[]
}

interface FacturaNota extends FacturaPendiente {
    tipo: 'servicio' | 'mora'
    estado: EstadoFactura
    vence_en: string
}

export default class EmitirNotaCredito extends DomainAction<EntradaNotaCredito, ResultadoNotaCredito> {
    readonly nombre = 'facturas.nota_credito'

    protected async handle(input: EntradaNotaCredito, t: Transaccion): Promise<ResultadoNotaCredito> {
        t.fijarEntidad('factura', input.factura_id)
        const motivo = input.motivo?.trim() ?? ''
        const monto = this.validarMonto(input.monto, motivo)

        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)

        const factura = (await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
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
                'vencida_en',
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )
            .firstOrFail()) as FacturaNota
        const empresaId = Number(factura.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (factura.estado === 'anulada') {
            throw new Conflicto(`La factura ${factura.id} está anulada`, 'factura_anulada', 'Factura anulada')
        }
        const saldo = pendienteDe(factura)
        if (!ESTADOS_PENDIENTES.includes(factura.estado) || saldo.lte(0)) {
            throw new Conflicto(
                `La factura ${factura.id} no tiene saldo pendiente`,
                'factura_sin_saldo',
                'Factura sin saldo',
            )
        }
        if (monto.gt(saldo)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: `El monto (Q${aTexto(monto)}) excede el saldo de la factura (Q${aTexto(saldo)})`,
                    rule: 'saldo_factura',
                },
            ])
        }

        const debitos = repartirProporcional(await this.lineasAcreditadas(t, factura), monto)
        const iva = debitos
            .filter((d) => d.cuenta_codigo === CUENTAS.IVA_DEBITO)
            .reduce((suma, d) => suma.plus(d.debe), CERO)

        const fecha = hoyGuatemala()
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.notas_credito')
            .insert({
                empresa_id: empresaId,
                factura_id: factura.id,
                cliente_id: factura.cliente_id,
                servicio_id: factura.servicio_id,
                fecha,
                subtotal: aTexto(monto.minus(iva)),
                iva: aTexto(iva),
                monto: aTexto(monto),
                motivo,
                created_by: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const notaId = fila!.id

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Nota de crédito ${notaId} · factura ${factura.id}: ${motivo}`,
                origen_tipo: 'nota_credito',
                origen_id: notaId,
                movimientos: [
                    ...debitos.map((d) => ({ cuenta: d.cuenta_id, debe: aTexto(d.debe) })),
                    { cuenta: CUENTAS.CXC_CLIENTES, haber: aTexto(monto), cliente_id: factura.cliente_id },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )

        const antes = { estado: factura.estado, pagado: factura.pagado }
        const estado = await sumarAPagado(t.trx, factura, monto)
        await t.registrarCambios({ tipo: 'factura', id: factura.id }, antes, {
            estado,
            pagado: factura.pagado,
        })
        await t.emit('nota_credito.emitida', {
            nota_credito_id: notaId,
            empresa_id: empresaId,
            factura_id: factura.id,
            servicio_id: factura.servicio_id,
            cliente_id: factura.cliente_id,
            monto: aTexto(monto),
            motivo,
        })

        const servicios: ServicioEvaluadoNota[] = []
        if (factura.servicio_id) {
            const r = await new EvaluarEstadoServicio().execute({ servicio_id: factura.servicio_id }, t.ctx, {
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

        return {
            ...(await verNotaCredito(notaId, t.trx)),
            factura: await verFactura(factura.id, t.trx),
            servicios,
        }
    }

    private validarMonto(valor: string, motivo: string): Dec {
        const errores = []
        let monto: Dec | null = null
        try {
            monto = dec(valor)
        } catch {
            errores.push({ field: 'monto', message: 'Monto inválido', rule: 'dinero' })
        }
        if (monto && (monto.lte(0) || !tieneCentavosExactos(monto))) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor a 0 con hasta 2 decimales',
                rule: 'dinero',
            })
        }
        if (motivo.length < 3) {
            errores.push({
                field: 'motivo',
                message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                rule: 'motivo',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        return monto!
    }

    /** Lo que el asiento vigente de la factura acreditó (todo menos la CxC). */
    private async lineasAcreditadas(t: Transaccion, factura: FacturaNota) {
        const lineas = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.origen_tipo', factura.tipo === 'mora' ? 'mora' : 'factura')
            .where('a.origen_id', factura.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .where('m.haber', '>', 0)
            .whereNot('c.codigo', CUENTAS.CXC_CLIENTES)
            .groupBy('m.cuenta_id', 'c.codigo')
            .orderByRaw('min(m.id)')
            .select(
                'm.cuenta_id',
                'c.codigo as cuenta_codigo',
                t.trx.raw('sum(m.haber)::text as haber'),
            )) as Array<{
            cuenta_id: number
            cuenta_codigo: string
            haber: string
        }>
        if (lineas.length === 0) {
            throw new Conflicto(
                `La factura ${factura.id} no tiene asiento vigente en el libro`,
                'factura_sin_asiento',
                'Factura sin asiento',
            )
        }
        return lineas
    }
}
