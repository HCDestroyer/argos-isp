import { DateTime } from 'luxon'
import type { Transaccion } from '#shared/domain_action'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { aplicarAnticipos } from '#billing/cobros'
import { lineaConIva } from '#billing/facturas'
import { sinIvaPorRegimen } from '#billing/regimen'
import { cuentaIva } from '#billing/fel_facturas'
import { valorParametro } from '#fiscal/parametros'
import { configuracionFel } from '#fiscal/fel/configuracion'

/**
 * Mora: recargo por vencimiento. Se documenta como una factura `tipo = 'mora'` ligada a la
 * vencida (`factura_origen_id`), así el cobro la cubre como cualquier otra deuda (la más antigua
 * primero) y el estado de cuenta la muestra. No cuenta para limitar/cortar.
 *
 * - `mora_tipo` `fija`: `mora_valor` quetzales; `porcentaje`: `mora_valor` % del total de la
 *   factura vencida. Sin IVA (asiento `CxC / Recargos por mora`) salvo `mora_con_iva` de la
 *   empresa (solo el contador lo activa): con IVA desglosado y, con FEL, como aviso que sale NDEB.
 * - Se usa la regla del `reglas_snapshot` de la factura (la vigente cuando se emitió).
 * - `mora_recurrente`: un recargo más por cada mes que la factura siga vencida. Clave
 *   `mora-<factura>-<n>`: aplicarla dos veces no duplica.
 */

export interface ReglaMora {
    mora_tipo: 'ninguna' | 'fija' | 'porcentaje'
    mora_valor: string
    mora_recurrente: boolean
}

export interface FacturaConMora {
    id: number
    /** la mora es de la empresa de su factura */
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    periodo: string
    vence_en: string
    total: string
    reglas_snapshot: Partial<ReglaMora> | null
}

export function reglaMora(snapshot: Partial<ReglaMora> | null): ReglaMora {
    return {
        mora_tipo: snapshot?.mora_tipo ?? 'ninguna',
        mora_valor: snapshot?.mora_valor ?? '0.00',
        mora_recurrente: snapshot?.mora_recurrente ?? false,
    }
}

export function montoMora(regla: ReglaMora, totalFactura: string): Dec {
    if (regla.mora_tipo === 'fija') return redondear(regla.mora_valor)
    if (regla.mora_tipo === 'porcentaje') return redondear(dec(totalFactura).times(regla.mora_valor).div(100))
    return CERO
}

/**
 * Cuántos recargos corresponden a `hoy`: el primero al vencer; con `mora_recurrente`, uno más
 * por cada mes cumplido después del vencimiento (el n-ésimo cuando `hoy > vence + (n−1) meses`).
 */
export function morasDebidas(regla: ReglaMora, venceEn: string, hoy: string): number {
    if (regla.mora_tipo === 'ninguna' || hoy <= venceEn) return 0
    if (!regla.mora_recurrente) return 1
    const vence = DateTime.fromISO(venceEn, { zone: 'utc' })
    let n = 1
    while (vence.plus({ months: n }).toISODate()! < hoy) n += 1
    return n
}

export function claveMora(facturaId: number, n: number): string {
    return `mora-${facturaId}-${n}`
}

/**
 * Crea el recargo número `n` de la factura (si no existe) con su asiento. Devuelve el id de la
 * factura de mora creada, o null si ya existía o el monto es cero.
 */
export async function crearMora(
    t: Transaccion,
    factura: FacturaConMora,
    n: number,
    hoy: string,
): Promise<number | null> {
    const regla = reglaMora(factura.reglas_snapshot)
    const monto = montoMora(regla, factura.total)
    if (monto.lte(0)) return null

    const concepto = `Recargo por mora de la factura ${factura.id}` + (n > 1 ? ` (mes ${n})` : '')
    // `mora_con_iva` (decisión del PM: no por defecto; solo el contador lo activa). Con IVA y FEL
    // activa, el recargo es un aviso (IVA a 2.1.11) que sale como NDEB al cobrarse (§8.3).
    // pequeño contribuyente (#billing/regimen): la mora tampoco separa IVA
    const conIva = (await sinIvaPorRegimen(t.trx, factura.empresa_id, hoy))
        ? false
        : await valorParametro<boolean>(factura.empresa_id, 'mora_con_iva', hoy, t.trx).catch(() => false)
    // H9: es aviso solo si su factura es aviso de cobro o lleva DTE; si la factura no va por FEL, la mora
    // tampoco (su IVA va a 2.1.02 como el de su factura)
    const origenConFel = (await t.trx
        .from('billing.facturas as f')
        .where('f.id', factura.id)
        .where((q) =>
            q
                .where('f.aviso_cobro', true)
                .orWhereExists((d) =>
                    d
                        .from('fiscal.dte as d')
                        .whereRaw('d.documento_id = f.id')
                        .where('d.documento_tipo', 'factura')
                        .whereNot('d.estado', 'rechazado'),
                ),
        )
        .first()) as unknown
    const felActiva = await configuracionFel(factura.empresa_id, t.trx).then((c) => c.modo !== 'desactivada')
    const avisoCobro = conIva === true && felActiva && Boolean(origenConFel)
    const linea = lineaConIva({
        concepto,
        tipo: 'mora',
        cantidad: '1',
        gravable: conIva === true,
        total: monto,
    })
    const iva = dec(linea.iva)
    const insertadas = (await t.trx
        .knexQuery()
        .table('billing.facturas')
        .insert({
            empresa_id: factura.empresa_id,
            cliente_id: factura.cliente_id,
            servicio_id: factura.servicio_id,
            tipo: 'mora',
            factura_origen_id: factura.id,
            periodo: factura.periodo,
            clave_unica: claveMora(factura.id, n),
            vence_en: hoy,
            vencida_en: t.trx.knexRawQuery('now()'),
            estado: 'vencida',
            subtotal: aTexto(monto.minus(iva)),
            iva: aTexto(iva),
            total: aTexto(monto),
            aviso_cobro: avisoCobro,
            reglas_snapshot: JSON.stringify({
                ...regla,
                factura_origen_id: factura.id,
                numero: n,
                mora_con_iva: conIva === true,
            }),
        })
        .onConflict('clave_unica')
        .ignore()
        .returning('id')) as Array<{ id: number }>
    const moraId = insertadas[0]?.id
    if (!moraId) return null

    await t.trx
        .insertQuery()
        .table('billing.facturas_lineas')
        .insert({ ...linea, factura_id: moraId })
    await new RegistrarAsiento().execute(
        {
            empresa_id: factura.empresa_id,
            descripcion: `${concepto} (factura ${moraId})`,
            origen_tipo: 'mora',
            origen_id: moraId,
            movimientos: [
                { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(monto), cliente_id: factura.cliente_id },
                { cuenta: CUENTAS.RECARGOS_MORA, haber: aTexto(monto.minus(iva)) },
                ...(iva.gt(0) ? [{ cuenta: cuentaIva(avisoCobro), haber: aTexto(iva) }] : []),
            ],
        },
        t.ctx,
        { trx: t.trx },
    )
    await aplicarAnticipos(t, factura.cliente_id, factura.empresa_id)
    return moraId
}
