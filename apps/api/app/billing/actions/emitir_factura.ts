import { DomainAction, type Transaccion } from '#shared/domain_action'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { claveFactura, sumarDias, type PeriodoFacturable } from '#billing/periodos'
import { lineaConIva, totalesDe, type LineaCalculada } from '#billing/facturas'
import { aplicarAnticipos, bloquearCliente } from '#billing/cobros'

/**
 * `facturas.emitir`: emite la factura de UN periodo de un servicio. La llama `generarFacturas`
 * (cron o `POST /facturas/generar`), una transacción por factura.
 *
 * - Idempotente por `clave_unica = servicio_id-periodo` (`INSERT … ON CONFLICT DO NOTHING`): si
 *   dos corridas compiten, solo una la crea y la otra devuelve `creada: false`.
 * - Líneas: el plan al precio efectivo (`costo_override` o precio del plan) y los conceptos
 *   recurrentes activos, ambos multiplicados por el factor de prorrateo del periodo. Precios con
 *   IVA incluido; el IVA se desglosa por línea (`lineaConIva`).
 * - Guarda `reglas_snapshot`: la configuración efectiva (plantilla + excepciones) y el precio con
 *   que se emitió. Vence `dias_gracia` días después del inicio del periodo.
 * - Asiento: `CxC (cliente) / Ingresos por internet + Otros ingresos + IVA débito`.
 * - Emite `factura.emitida` y aplica el anticipo del cliente si tiene (excedentes de pagos).
 */

export interface EntradaEmitirFactura {
    servicio_id: number
    periodo: PeriodoFacturable
}

export interface ResultadoEmitirFactura {
    factura_id: number | null
    creada: boolean
    /** por qué no se creó (ya existía, sin plantilla, retirado, monto cero) */
    motivo: string | null
}

export default class EmitirFactura extends DomainAction<EntradaEmitirFactura, ResultadoEmitirFactura> {
    readonly nombre = 'facturas.emitir'

    protected async handle(input: EntradaEmitirFactura, t: Transaccion): Promise<ResultadoEmitirFactura> {
        const servicio = await leerServicio(t.trx, input.servicio_id)
        t.fijarEntidad('servicio', servicio.id)
        await bloquearCliente(t.trx, servicio.cliente_id)

        const clave = claveFactura(servicio.id, input.periodo.periodo)
        const existente = await t.trx
            .from('billing.facturas')
            .where('clave_unica', clave)
            .select('id')
            .first()
        if (existente) return { factura_id: existente.id, creada: false, motivo: 'ya_existe' }
        if (servicio.estado === 'retirado') return { factura_id: null, creada: false, motivo: 'retirado' }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) return { factura_id: null, creada: false, motivo: 'sin_plantilla' }

        const { periodo, fin, dias, dias_ciclo: diasCiclo } = input.periodo
        const factor = dec(input.periodo.factor)
        const prorrateado = !factor.equals(1)
        const ultimoDia = sumarDias(fin, -1)

        const lineas: LineaCalculada[] = [
            lineaConIva({
                concepto:
                    `Servicio de internet ${servicio.plan_nombre} del ${periodo} al ${ultimoDia}` +
                    (prorrateado ? ` (prorrateo ${dias}/${diasCiclo} días)` : ''),
                tipo: 'servicio',
                cantidad: '1',
                gravable: true,
                total: dec(servicio.precio).times(factor),
            }),
        ]
        const conceptos = (await t.trx
            .from('billing.conceptos_recurrentes')
            .where('servicio_id', servicio.id)
            .where('activo', true)
            .where('monto', '>', 0)
            .orderBy('id', 'asc')
            .select('nombre', 'monto')) as Array<{ nombre: string; monto: string }>
        for (const concepto of conceptos) {
            lineas.push(
                lineaConIva({
                    concepto: prorrateado
                        ? `${concepto.nombre} (prorrateo ${dias}/${diasCiclo} días)`
                        : concepto.nombre,
                    tipo: 'otro',
                    cantidad: '1',
                    gravable: true,
                    total: dec(concepto.monto).times(factor),
                }),
            )
        }
        const conMonto = lineas.filter((linea) => dec(linea.total).gt(0))
        const totales = totalesDe(conMonto)
        if (totales.total.lte(0)) return { factura_id: null, creada: false, motivo: 'monto_cero' }

        const venceEn = sumarDias(periodo, config.dias_gracia)
        const snapshot = {
            ...config,
            precio: aTexto(servicio.precio),
            plan_id: servicio.plan_id,
            plan_nombre: servicio.plan_nombre,
            periodo: input.periodo,
        }

        const insertadas = (await t.trx
            .knexQuery()
            .table('billing.facturas')
            .insert({
                cliente_id: servicio.cliente_id,
                servicio_id: servicio.id,
                tipo: 'servicio',
                periodo,
                clave_unica: clave,
                vence_en: venceEn,
                estado: 'emitida',
                subtotal: aTexto(totales.subtotal),
                iva: aTexto(totales.iva),
                total: aTexto(totales.total),
                reglas_snapshot: JSON.stringify(snapshot),
            })
            .onConflict('clave_unica')
            .ignore()
            .returning('id')) as Array<{ id: number }>
        const facturaId = insertadas[0]?.id
        if (!facturaId) {
            const otra = await t.trx.from('billing.facturas').where('clave_unica', clave).select('id').first()
            return { factura_id: otra?.id ?? null, creada: false, motivo: 'ya_existe' }
        }
        t.fijarEntidad('factura', facturaId)

        await t.trx
            .insertQuery()
            .table('billing.facturas_lineas')
            .multiInsert(conMonto.map((linea) => ({ ...linea, factura_id: facturaId })))

        await new RegistrarAsiento().execute(
            {
                descripcion: `Factura ${facturaId} · servicio ${servicio.id} · periodo ${periodo}`,
                origen_tipo: 'factura',
                origen_id: facturaId,
                movimientos: movimientosFactura(servicio.cliente_id, conMonto, totales.total),
            },
            t.ctx,
            { trx: t.trx },
        )

        await t.emit('factura.emitida', {
            factura_id: facturaId,
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            total: aTexto(totales.total),
            vence: venceEn,
        })

        await aplicarAnticipos(t, servicio.cliente_id)
        return { factura_id: facturaId, creada: true, motivo: null }
    }
}

/** `CxC / Ingresos (servicio) + Otros ingresos + IVA`, omitiendo las cuentas en cero. */
function movimientosFactura(clienteId: number, lineas: LineaCalculada[], total: Dec): LineaAsiento[] {
    let internet = CERO
    let otros = CERO
    let iva = CERO
    for (const linea of lineas) {
        const subtotal = dec(linea.total).minus(linea.iva)
        if (linea.tipo === 'servicio') internet = internet.plus(subtotal)
        else otros = otros.plus(subtotal)
        iva = iva.plus(linea.iva)
    }
    const movimientos: LineaAsiento[] = [
        { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(total), cliente_id: clienteId },
    ]
    if (internet.gt(0)) movimientos.push({ cuenta: CUENTAS.INGRESOS_INTERNET, haber: aTexto(internet) })
    if (otros.gt(0)) movimientos.push({ cuenta: CUENTAS.OTROS_INGRESOS, haber: aTexto(otros) })
    if (iva.gt(0)) movimientos.push({ cuenta: CUENTAS.IVA_DEBITO, haber: aTexto(iva) })
    return movimientos
}
