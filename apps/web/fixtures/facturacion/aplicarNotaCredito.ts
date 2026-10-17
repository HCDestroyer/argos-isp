import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { CUENTA_CXC, CUENTA_INGRESOS, CUENTA_IVA, fechaGuatemala, movimiento } from '../libro/datos'
import { dinero, estadoFactura } from './datos'

type NotaCredito = Schema<'NotaCredito'>
type Factura = Schema<'Factura'>

/** Las tablas que toca una nota de crédito (las de `bd`, o las iniciales al sembrar). */
export interface TablasNotaCredito {
    facturas: Factura[]
    asientos: Schema<'Asiento'>[]
    notasCredito: NotaCredito[]
    clientes: Schema<'Cliente'>[]
}

function siguiente(filas: readonly { id: number }[]): number {
    return filas.reduce((maximo, fila) => Math.max(maximo, fila.id), 0) + 1
}

/**
 * Como `EmitirNotaCredito` (A3) una vez validada: IVA en proporción al de la factura, asiento
 * `nota_credito` (Debe ingresos e IVA, Haber CxC del dueño) y la factura con `pagado` y
 * `acreditado` aumentados y su estado recalculado. No re-evalúa el servicio (lo hace la ruta).
 */
export function aplicarNotaCredito(
    tablas: TablasNotaCredito,
    factura: Factura,
    monto: Decimal,
    motivo: string,
    usuario: { id: number, nombre: string } | undefined,
    momento: string,
): NotaCredito {
    const iva = new Decimal(factura.total).isZero() ? new Decimal(0) : monto.times(factura.iva).div(factura.total).toDecimalPlaces(2)
    const subtotal = monto.minus(iva)
    const asientoId = siguiente(tablas.asientos)
    const nota: NotaCredito = {
        id: siguiente(tablas.notasCredito),
        empresa_id: factura.empresa_id,
        factura_id: factura.id,
        cliente_id: factura.cliente_id,
        cliente_nombre: tablas.clientes.find(c => c.id === factura.cliente_id)?.nombre ?? '',
        servicio_id: factura.servicio_id,
        fecha: fechaGuatemala(momento),
        subtotal: dinero(subtotal),
        iva: dinero(iva),
        monto: dinero(monto),
        motivo,
        asiento_id: asientoId,
        created_by: usuario?.id ?? null,
        created_by_nombre: usuario?.nombre ?? null,
        created_at: momento,
    }
    tablas.notasCredito.push(nota)
    tablas.asientos.push({
        id: asientoId,
        empresa_id: factura.empresa_id,
        fecha: nota.fecha,
        descripcion: `Nota de crédito ${nota.id} · factura ${factura.id} · ${motivo}`,
        origen_tipo: 'nota_credito',
        origen_id: nota.id,
        reversa_de: null,
        created_by: nota.created_by,
        created_at: momento,
        movimientos: [
            movimiento(CUENTA_INGRESOS, 'debe', nota.subtotal),
            movimiento(CUENTA_IVA, 'debe', nota.iva),
            movimiento(CUENTA_CXC, 'haber', nota.monto, factura.cliente_id),
        ].filter(m => !new Decimal(m.debe).plus(m.haber).isZero()),
    })
    const pagado = new Decimal(factura.pagado).plus(monto)
    Object.assign(factura, {
        pagado: dinero(pagado),
        acreditado: dinero(new Decimal(factura.acreditado ?? '0').plus(monto)),
        estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en.slice(0, 10)),
        version: factura.version + 1,
        updated_at: momento,
    })
    return nota
}

/**
 * Notas de crédito de ejemplo para la lista (`GET /notas-credito`): una parcial y una total sobre
 * facturas de septiembre con saldo, de clientes distintos, emitidas por la administradora.
 */
export function sembrarNotasCredito(tablas: TablasNotaCredito): void {
    // Los clientes de id más alto: los de las pruebas de cobro, promesas y libro quedan intactos.
    const conSaldo = tablas.facturas
        .filter(f => f.periodo.startsWith('2026-09') && new Decimal(f.total).gt(f.pagado))
        .sort((a, b) => b.cliente_id - a.cliente_id || a.id - b.id)
    const primera = conSaldo[0]
    const segunda = conSaldo.find(f => primera && f.cliente_id !== primera.cliente_id)
    const admin = { id: 1, nombre: 'Ana Administradora' }
    if (primera) {
        aplicarNotaCredito(tablas, primera, new Decimal('25.00'), 'Compensación por corte de 2 días en el sector', admin, '2026-09-18T16:30:00.000Z')
    }
    if (segunda) {
        const saldo = new Decimal(segunda.total).minus(segunda.pagado)
        aplicarNotaCredito(tablas, segunda, saldo, 'Cobro duplicado del periodo, se acredita completo', admin, '2026-09-25T15:10:00.000Z')
    }
}
