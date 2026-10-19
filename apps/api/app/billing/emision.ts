import type { Transaccion } from '#shared/domain_action'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import { totalesDe, type LineaCalculada } from '#billing/facturas'
import { aplicarAnticipos } from '#billing/cobros'
import { cuentaIva } from '#billing/fel_facturas'
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

/** `CxC / Ingresos (servicio) + Otros ingresos + Recargos + IVA` (a `2.1.02` o `2.1.11`). */
export function movimientosFactura(
    clienteId: number,
    lineas: Array<Pick<LineaCalculada, 'tipo' | 'total' | 'iva'>>,
    total: Dec,
    avisoCobro: boolean,
): LineaAsiento[] {
    let internet = CERO
    let otros = CERO
    let mora = CERO
    let iva = CERO
    for (const linea of lineas) {
        const subtotal = dec(linea.total).minus(linea.iva)
        if (linea.tipo === 'servicio') internet = internet.plus(subtotal)
        else if (linea.tipo === 'mora') mora = mora.plus(subtotal)
        else otros = otros.plus(subtotal)
        iva = iva.plus(linea.iva)
    }
    const movimientos: LineaAsiento[] = [
        { cuenta: CUENTAS.CXC_CLIENTES, debe: aTexto(total), cliente_id: clienteId },
    ]
    if (internet.gt(0)) movimientos.push({ cuenta: CUENTAS.INGRESOS_INTERNET, haber: aTexto(internet) })
    if (otros.gt(0)) movimientos.push({ cuenta: CUENTAS.OTROS_INGRESOS, haber: aTexto(otros) })
    if (mora.gt(0)) movimientos.push({ cuenta: CUENTAS.RECARGOS_MORA, haber: aTexto(mora) })
    if (iva.gt(0)) movimientos.push({ cuenta: cuentaIva(avisoCobro), haber: aTexto(iva) })
    return movimientos
}

export interface DatosEmision {
    empresa_id: number
    cliente_id: number
    servicio_id: number
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
    const modo = modoEmision(config, datos.certificar_al)
    const totales = totalesDe(datos.lineas)
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
    await t.trx
        .insertQuery()
        .table('billing.facturas_lineas')
        .multiInsert(datos.lineas.map((linea) => ({ ...linea, factura_id: facturaId })))

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
        .select('tipo', 'total', 'iva')) as Array<Pick<LineaCalculada, 'tipo' | 'total' | 'iva'>>
    await new RegistrarAsiento().execute(
        {
            empresa_id: f.empresa_id,
            // confirmación de una por_certificar: la fecha de certificación o, si está cerrada o
            // bloqueada, el primer día abierto (con la real en fecha_documento, §10.1 y §10.4)
            fecha: f.fecha,
            trasladar_si_bloqueado: f.fecha !== undefined,
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
