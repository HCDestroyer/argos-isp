import type { Transaccion } from '#shared/domain_action'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { cuentaIngresoDeLinea, totalesDe, type LineaCalculada } from '#billing/facturas'
import { aplicarAnticipos } from '#billing/cobros'
import { cuentaIva, fechaContableAbierta } from '#billing/fel_facturas'
import { configuracionFel, modoEmision, type CertificarAl, type ModoEmision } from '#fiscal/fel/configuracion'
import {
    ERROR_RECEPTOR,
    insertarDte,
    receptorDe,
    receptorFaltante,
    tipoFacturaDte,
    type DteFila,
    type ReceptorFiscal,
} from '#fiscal/fel/dte'

/**
 * Emisión de una factura según el modo FEL de su empresa (contrato de localización fiscal §8.3):
 *
 * | Modo (`modoEmision`) | Factura | Asiento y `factura.emitida` | DTE |
 * | --- | --- | --- | --- |
 * | `sin_fel` | `emitida` | al emitir, IVA a `2.1.02` | ninguno (o a mano en `opcional`) |
 * | `aviso` (`certificar_al = pagar`) | `emitida`, `aviso_cobro` | al emitir, IVA a `2.1.11` | al quedar cubierta |
 * | `por_certificar` (obligatoria + emitir) | `por_certificar` | al certificarse (`facturas.confirmar_emision`) | `pendiente` ya |
 * | `contingencia` | `emitida` | al emitir, IVA a `2.1.02` | `contingencia` |
 *
 * Con FEL desactivada (todas las empresas al migrar) todo queda como antes.
 */

/**
 * `CxC + Descuentos / Ingresos (servicio) + Otros ingresos + Recargos + IVA` (a `2.1.02` o `2.1.11`).
 * Con líneas `descuento`: los ingresos van por el bruto, el descuento (sin IVA) al debe de `5.1.01` y el
 * IVA es el del neto (lealtad §5: `CxC 150.00 + 5.1.01 44.64 / 4.1.01 178.57 + 2.1.02 16.07`).
 * Cada línea acredita su cuenta (`cuentaIngresoDeLinea`: la de su concepto de cargo o la de su tipo).
 * Total 0 (solo una bonificación: nunca hay factura de Q0): sin CxC; queda `5.1.01 / ingreso` por la base.
 */
export function movimientosFactura(
    clienteId: number,
    lineas: Array<Pick<LineaCalculada, 'tipo' | 'total' | 'iva' | 'cuenta_codigo'>>,
    total: Dec,
    avisoCobro: boolean,
): LineaAsiento[] {
    const ingresos = new Map<string, Dec>()
    let descuentos = CERO
    let iva = CERO
    for (const linea of lineas) {
        const subtotal = dec(linea.total).minus(linea.iva)
        if (linea.tipo === 'descuento') descuentos = descuentos.minus(subtotal)
        else {
            const cuenta = cuentaIngresoDeLinea(linea)
            ingresos.set(cuenta, (ingresos.get(cuenta) ?? CERO).plus(subtotal))
        }
        iva = iva.plus(linea.iva)
    }
    const movimientos: LineaAsiento[] = []
    if (total.gt(0)) {
        movimientos.push({ cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(total), cliente_id: clienteId })
    }
    // descuento de la factura (lealtad, cargo único): la venta queda bruta en ingresos y el descuento en 5.1.01
    if (descuentos.gt(0)) movimientos.push({ cuenta: CUENTAS.DESCUENTOS, debe: aTexto(descuentos) })
    // orden estable: internet, recargos, otros ingresos y luego las demás cuentas por código
    const orden = [CUENTAS.INGRESOS_INTERNET, CUENTAS.OTROS_INGRESOS, CUENTAS.RECARGOS_MORA] as string[]
    const cuentas = [...ingresos.keys()].sort((a, b) => {
        const ia = orden.indexOf(a)
        const ib = orden.indexOf(b)
        if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
        return a.localeCompare(b)
    })
    for (const cuenta of cuentas) {
        const monto = ingresos.get(cuenta)!
        if (monto.gt(0)) movimientos.push({ cuenta, haber: aTexto(monto) })
    }
    if (iva.gt(0)) movimientos.push({ cuenta: cuentaIva(avisoCobro), haber: aTexto(iva) })
    return movimientos
}

export interface DatosEmision {
    empresa_id: number
    cliente_id: number
    /** null en un cargo único sin servicio */
    servicio_id: number | null
    periodo: string
    clave_unica: string
    vence_en: string
    lineas: LineaCalculada[]
    reglas_snapshot: Record<string, unknown>
    certificar_al: CertificarAl
    /** descripción del asiento (sin el id, que se agrega) */
    descripcion: string
    /** receptor corregido (sustitución) */
    receptor?: ReceptorFiscal | null
}

export interface ResultadoEmision {
    factura_id: number | null
    creada: boolean
    modo: ModoEmision
    dte: DteFila | null
}

/** Inserta la factura (idempotente por `clave_unica`) y hace lo que su modo FEL pide. */
export async function emitirDocumento(t: Transaccion, datos: DatosEmision): Promise<ResultadoEmision> {
    const config = await configuracionFel(datos.empresa_id, t.trx)
    const totales = totalesDe(datos.lineas)
    // decisión del PM (19 oct): una factura de valor 0 nunca se genera; quien llama registra una
    // bonificación (`#billing/bonificaciones`)
    if (!totales.total.gt(0)) {
        throw new Error(
            `Factura ${datos.clave_unica} de total ${totales.total.toFixed(2)}: va como bonificación`,
        )
    }
    const modo: ModoEmision = modoEmision(config, datos.certificar_al)
    const avisoCobro = modo === 'aviso'
    const tipoDte = modo === 'sin_fel' ? null : await tipoFacturaDte(datos.empresa_id, hoyGuatemala(), t.trx)

    const insertadas = (await t.trx
        .knexQuery()
        .table('billing.facturas')
        .insert({
            empresa_id: datos.empresa_id,
            cliente_id: datos.cliente_id,
            servicio_id: datos.servicio_id,
            tipo: 'servicio',
            periodo: datos.periodo,
            clave_unica: datos.clave_unica,
            vence_en: datos.vence_en,
            estado: modo === 'por_certificar' ? 'por_certificar' : 'emitida',
            subtotal: aTexto(totales.subtotal),
            iva: aTexto(totales.iva),
            total: aTexto(totales.total),
            reglas_snapshot: JSON.stringify(datos.reglas_snapshot),
            aviso_cobro: avisoCobro,
            certificar_al: datos.certificar_al,
            tipo_dte: tipoDte,
        })
        .onConflict('clave_unica')
        .ignore()
        .returning('id')) as Array<{ id: number }>
    const facturaId = insertadas[0]?.id
    if (!facturaId) {
        const otra = await t.trx
            .from('billing.facturas')
            .where('clave_unica', datos.clave_unica)
            .select('id')
            .first()
        return { factura_id: otra?.id ?? null, creada: false, modo, dte: null }
    }
    t.fijarEntidad('factura', facturaId)
    await insertarLineas(t, facturaId, datos.lineas)

    if (modo !== 'por_certificar') {
        await contabilizarFactura(t, {
            id: facturaId,
            empresa_id: datos.empresa_id,
            cliente_id: datos.cliente_id,
            servicio_id: datos.servicio_id,
            total: aTexto(totales.total),
            vence_en: datos.vence_en,
            aviso_cobro: avisoCobro,
            descripcion: datos.descripcion,
        })
    }

    let dte: DteFila | null = null
    if (modo === 'por_certificar' || modo === 'contingencia') {
        const receptor = await receptorDe(t.trx, datos.cliente_id, datos.receptor)
        const falta = await receptorFaltante(
            datos.empresa_id,
            receptor,
            aTexto(totales.total),
            hoyGuatemala(),
            t.trx,
        )
        dte = await insertarDte(t.trx, {
            empresa_id: datos.empresa_id,
            documento_tipo: 'factura',
            documento_id: facturaId,
            tipo_dte: tipoDte!,
            proveedor: config.proveedor!,
            ambiente: config.ambiente,
            receptor,
            total: aTexto(totales.total),
            iva: aTexto(totales.iva),
            estado: falta ? 'rechazado' : modo === 'contingencia' ? 'contingencia' : 'pendiente',
            contingencia: modo === 'contingencia',
            ultimo_error: falta ? ERROR_RECEPTOR : null,
            definitivo: falta,
        })
        if (falta) {
            await t.emit('dte.rechazado', {
                dte_id: dte.id,
                empresa_id: datos.empresa_id,
                documento_tipo: 'factura',
                documento_id: facturaId,
                error: `${ERROR_RECEPTOR}: el total llega al límite de consumidor final; el cliente necesita NIT, CUI o pasaporte`,
                definitivo: true,
            })
        }
    }
    return { factura_id: facturaId, creada: true, modo, dte }
}

/**
 * Inserta las líneas en orden; cada `descuento` va ligado (`linea_id`) a la línea de su
 * `linea_indice`, y esa línea guarda la suma de sus descuentos en `descuento`.
 */
export async function insertarLineas(
    t: Transaccion,
    facturaId: number,
    lineas: LineaCalculada[],
): Promise<number[]> {
    const ids: number[] = []
    const descontado = new Map<number, Dec>()
    for (const { linea_indice: indice, ...linea } of lineas) {
        let lineaId: number | null = null
        if (linea.tipo === 'descuento') {
            const objetivo = indice === undefined ? undefined : ids[indice]
            if (objetivo === undefined) throw new Error('Línea de descuento sin la línea que descuenta antes')
            lineaId = objetivo
            descontado.set(objetivo, (descontado.get(objetivo) ?? CERO).minus(linea.total))
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.facturas_lineas')
            .insert({ ...linea, factura_id: facturaId, linea_id: lineaId })
            .returning('id')) as Array<{ id: number }>
        ids.push(Number(fila!.id))
    }
    for (const [id, monto] of descontado) {
        await t.trx
            .from('billing.facturas_lineas')
            .where('id', id)
            .update({ descuento: aTexto(monto) })
    }
    return ids
}

export interface FacturaParaContabilizar {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    total: string
    vence_en: string
    aviso_cobro: boolean
    descripcion: string
    /** fecha contable (por defecto hoy; al confirmar una por_certificar, la de certificación) */
    fecha?: string
}

/** Asiento de la factura, `factura.emitida` y anticipos del cliente. */
export async function contabilizarFactura(t: Transaccion, f: FacturaParaContabilizar): Promise<void> {
    const lineas = (await t.trx
        .from('billing.facturas_lineas')
        .where('factura_id', f.id)
        .select('tipo', 'total', 'iva', 'cuenta_codigo')) as Array<
        Pick<LineaCalculada, 'tipo' | 'total' | 'iva' | 'cuenta_codigo'>
    >
    await new RegistrarAsiento().execute(
        {
            empresa_id: f.empresa_id,
            fecha: f.fecha ? await fechaContableAbierta(t.trx, f.fecha, f.empresa_id) : undefined,
            descripcion: `Factura ${f.id} · ${f.descripcion}`,
            origen_tipo: 'factura',
            origen_id: f.id,
            movimientos: movimientosFactura(f.cliente_id, lineas, dec(f.total), f.aviso_cobro),
        },
        t.ctx,
        { trx: t.trx },
    )
    await t.emit('factura.emitida', {
        factura_id: f.id,
        empresa_id: f.empresa_id,
        servicio_id: f.servicio_id,
        cliente_id: f.cliente_id,
        total: f.total,
        vence: f.vence_en,
    })
    await aplicarAnticipos(t, f.cliente_id, f.empresa_id)
}
