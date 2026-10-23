import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, redondear } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { resolverOrigenEgreso, type MetodoEgreso } from '#ledger/egresos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import type { ImpuestoDeclarable } from '#fiscal/declaraciones'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { hoyFiscal } from '#fiscal/comun'
import { valorParametro } from '#fiscal/parametros'
import { payloadDeclaracion } from '#fiscal/actions/calcular_declaracion'
import {
    CUENTA_POR_PAGAR,
    LOCK_DECLARACIONES,
    textoDePeriodo,
    ultimaVersion,
    verDeclaracion,
    type DeclaracionFila,
} from '#fiscal/declaraciones'

/**
 * `declaraciones.pagar` (`POST /declaraciones/:id/registrar-pago`, contrato §9.3; fase 7 PR B):
 * registra el pago de la última versión revisada o presentada. Asiento `pago_impuesto`: la cuenta por
 * pagar del impuesto (`2.1.06` IVA, `2.1.09` pequeño contribuyente, `2.1.07` ISR, `2.1.08` ISO, `2.1.04`
 * y `2.1.05` retenciones; §9.3) + `5.4.02 Multas y recargos` / Caja o Banco.
 *
 * - Monto = `a_pagar` del borrador menos lo pagado (sin anular) por versiones anteriores del periodo
 *   (una sustitutiva paga la diferencia); sin monto: 422 `sin_monto_a_pagar`. Un pago vigente por
 *   versión (409 `declaracion_pagada`); anulado (`declaraciones.anular_pago`), se registra otro.
 * - Pago tardío (inv. E.2): mora = monto × `mora_tributaria` (por ciento diario) × días después del
 *   vencimiento; multa por presentación tardía = `multa_declaracion_tardia.por_dia` × días entre el
 *   vencimiento y la presentación, hasta su máximo (solo si ya se marcó presentada). Las dos a
 *   `5.4.02`. El interés resarcitorio no se calcula (sin valor: §15 #9).
 * - Emite `declaracion.pagada` (monto = total pagado).
 */

export interface EntradaPagoDeclaracion {
    declaracion_id: number
    metodo: MetodoEgreso
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    fecha?: string | null
    boleta?: string | null
}

const dias = (desde: string, hasta: string) =>
    Math.max(
        0,
        Math.round(
            DateTime.fromISO(hasta, { zone: 'utc' }).diff(DateTime.fromISO(desde, { zone: 'utc' }), 'days')
                .days,
        ),
    )

export default class RegistrarPagoDeclaracion extends DomainAction<EntradaPagoDeclaracion, DeclaracionFila> {
    readonly nombre = 'declaraciones.pagar'

    protected async handle(input: EntradaPagoDeclaracion, t: Transaccion): Promise<DeclaracionFila> {
        const hoy = hoyFiscal()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
            ])
        }
        const inicial = await verDeclaracion(input.declaracion_id, t.trx)
        exigirAccesoEmpresa(t.ctx, inicial.empresa_id)
        t.fijarEmpresa(inicial.empresa_id)
        t.fijarEntidad('declaracion', inicial.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, inicial.empresa_id])
        const d = await verDeclaracion(input.declaracion_id, t.trx)
        const ultima = await ultimaVersion(t.trx, d.empresa_id, d.impuesto, d.periodo_desde)
        if (ultima && ultima.id !== d.id) {
            throw new Conflicto(
                `La versión ${d.version} fue sustituida`,
                'declaracion_sustituida',
                'Declaración sustituida',
            )
        }
        if (d.estado !== 'revisada' && d.estado !== 'presentada') {
            throw new Conflicto(
                `La declaración ${d.id} está en ${d.estado}: se paga después de revisarla`,
                'declaracion_no_revisada',
                'Declaración no revisada',
            )
        }
        if (d.pago) {
            throw new Conflicto(
                `La declaración ${d.id} ya tiene su pago (${d.pago.id})`,
                'declaracion_pagada',
                'Declaración pagada',
            )
        }
        const previos = (await t.trx
            .from('fiscal.declaraciones_pagos as p')
            .join('fiscal.declaraciones as x', 'x.id', 'p.declaracion_id')
            .where({
                'x.empresa_id': d.empresa_id,
                'x.impuesto': d.impuesto,
                'x.periodo_desde': d.periodo_desde,
            })
            .whereNotExists((q) =>
                q.from('fiscal.declaraciones_pagos_anulaciones as n').whereRaw('n.pago_id = p.id'),
            )
            .select(t.trx.raw('coalesce(sum(p.impuesto), 0)::text as pagado'))
            .first()) as { pagado: string }
        const monto = redondear(dec(d.totales.a_pagar ?? '0').minus(dec(previos.pagado)))
        if (monto.lte(0)) {
            throw new ReglaNegocio(
                `No hay impuesto por pagar en ${d.impuesto} ${textoDePeriodo(d.impuesto, d.periodo_desde)} (a pagar ${d.totales.a_pagar ?? '0.00'}, ya pagado ${aTexto(previos.pagado)})`,
                'sin_monto_a_pagar',
            )
        }

        const atraso = dias(d.vence_en, fecha)
        let mora = CERO
        if (atraso > 0) {
            const pct = await valorParametro<string>(d.empresa_id, 'mora_tributaria', fecha, t.trx)
            mora = redondear(monto.times(dec(pct)).dividedBy(100).times(atraso))
        }
        let multa = CERO
        if (d.fecha_presentacion && d.fecha_presentacion > d.vence_en) {
            const regla = await valorParametro<{ por_dia: string; maximo: string }>(
                d.empresa_id,
                'multa_declaracion_tardia',
                d.fecha_presentacion,
                t.trx,
            )
            const bruto = dec(regla.por_dia).times(dias(d.vence_en, d.fecha_presentacion))
            multa = redondear(bruto.gt(dec(regla.maximo)) ? dec(regla.maximo) : bruto)
        }
        const total = monto.plus(mora).plus(multa)

        const origen = await resolverOrigenEgreso(t.trx, { ...t.ctx, empresaId: d.empresa_id }, input)
        if (origen.empresa_id !== d.empresa_id) {
            throw new ValidacionFallida([
                {
                    field:
                        input.metodo === 'caja'
                            ? 'caja_id'
                            : input.metodo === 'banco'
                              ? 'banco_id'
                              : 'cuenta_bancaria_id',
                    message: `El pago sale de la empresa ${origen.empresa_id} y la declaración es de la empresa ${d.empresa_id}`,
                    rule: 'cuenta_de_otra_empresa',
                },
            ])
        }
        const cuentaImpuesto = CUENTA_POR_PAGAR[d.impuesto as ImpuestoDeclarable]
        const asiento = await new RegistrarAsiento().execute(
            {
                empresa_id: d.empresa_id,
                fecha,
                descripcion: `Pago ${d.impuesto} ${textoDePeriodo(d.impuesto, d.periodo_desde)} (declaración ${d.id})${input.boleta ? ` · boleta ${input.boleta}` : ''}`,
                origen_tipo: 'pago_impuesto',
                origen_id: d.id,
                movimientos: [
                    { cuenta: cuentaImpuesto, debe: aTexto(monto) },
                    ...(mora.plus(multa).gt(0)
                        ? [{ cuenta: CUENTAS_GT.MULTAS_TRIBUTARIAS, debe: aTexto(mora.plus(multa)) }]
                        : []),
                    { cuenta: origen.cuenta_id, haber: aTexto(total) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('fiscal.declaraciones_pagos')
            .insert({
                declaracion_id: d.id,
                empresa_id: d.empresa_id,
                fecha,
                impuesto: aTexto(monto),
                mora: aTexto(mora),
                multa: aTexto(multa),
                total: aTexto(total),
                dias_atraso: atraso,
                boleta: input.boleta?.trim() || null,
                asiento_id: asiento.id,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
        const pagada = await verDeclaracion(d.id, t.trx)
        await t.emit('declaracion.pagada', payloadDeclaracion(pagada, aTexto(total)))
        return pagada
    }
}
