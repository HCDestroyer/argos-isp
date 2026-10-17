import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { bd } from '../bd'
import { clavesHistoricas, dinero } from '../facturacion/datos'

type Movimiento = Schema<'MovimientoEstadoCuenta'>

const METODOS: Record<Schema<'Pago'>['metodo'], string> = {
    caja: 'Pago en caja',
    pasarela: 'Pago en línea',
    deposito: 'Depósito',
    agente: 'Pago en agente',
    debito: 'Débito automático',
    transferencia: 'Transferencia',
    ach: 'ACH',
    remesa: 'Remesa',
}

/**
 * Estado de cuenta como lo arma A3: el saldo es la suma del auxiliar (cargos de facturas menos
 * abonos de pagos registrados), nunca una columna. Se calcula sobre `bd`, así que un pago hecho
 * en `/cobro` se ve aquí enseguida.
 */
export function estadoCuentaDe(clienteId: number): Schema<'EstadoCuenta'> {
    const facturas = bd.facturas.filter(f => f.cliente_id === clienteId && f.estado !== 'anulada')
    const eventos: Omit<Movimiento, 'saldo'>[] = []
    for (const factura of facturas) {
        eventos.push({
            fecha: factura.periodo,
            tipo: 'factura',
            referencia_id: factura.id,
            descripcion: `Aviso de cobro ${factura.periodo.slice(0, 7)} · servicio ${factura.servicio_id}`,
            cargo: factura.total,
            abono: '0.00',
        })
    }
    const propias = new Set(facturas.map(f => f.id))
    for (const pago of bd.pagos.filter(p => p.estado === 'registrado')) {
        // Pago de terceros (A3): el abono va al auxiliar del dueño de cada factura; al pagador le
        // queda lo que aplicó a las suyas más el anticipo.
        const aplicadas = pago.aplicaciones.filter(a => propias.has(a.factura_id))
        const aplicadoAOtros = pago.aplicaciones
            .filter(a => !propias.has(a.factura_id))
            .reduce((total, a) => total.plus(a.monto), new Decimal(0))
        const abono = pago.cliente_id === clienteId
            ? new Decimal(pago.monto).minus(aplicadoAOtros)
            : aplicadas.reduce((total, a) => total.plus(a.monto), new Decimal(0))
        if (abono.lte(0)) {
            continue
        }
        const avisos = aplicadas.map(a => a.factura_id).join(', ')
        const pagador = pago.cliente_id === clienteId ? null : bd.clientes.find(c => c.id === pago.cliente_id)
        if (pago.historico) {
            // Como `RegistrarPagoHistorico`: la descripción del asiento lleva el id del origen.
            eventos.push({
                fecha: pago.created_at.slice(0, 10),
                tipo: 'pago',
                referencia_id: pago.id,
                descripcion: `Pago histórico ${pago.id} (${clavesHistoricas[pago.id] ?? `importado:pago:${pago.id}`}) · ${pago.metodo}${pago.referencia ? ` · ref. ${pago.referencia}` : ''}${avisos ? ` · facturas ${avisos}` : ' · anticipo'}`,
                cargo: '0.00',
                abono: dinero(abono),
            })
            continue
        }
        eventos.push({
            fecha: pago.created_at.slice(0, 10),
            tipo: 'pago',
            referencia_id: pago.id,
            descripcion: `${METODOS[pago.metodo]}${avisos ? ` · aviso ${avisos}` : ''}${pagador ? ` · pagado por ${pagador.nombre}` : ''}`,
            cargo: '0.00',
            abono: dinero(abono),
        })
    }
    // Notas de crédito (A3): abonan la CxC del dueño de la factura.
    for (const nota of bd.notasCredito.filter(n => n.cliente_id === clienteId)) {
        eventos.push({
            fecha: nota.fecha,
            tipo: 'nota_credito',
            referencia_id: nota.id,
            descripcion: `Nota de crédito ${nota.id} · factura ${nota.factura_id} · ${nota.motivo}`,
            cargo: '0.00',
            abono: nota.monto,
        })
    }
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.referencia_id - b.referencia_id)

    let saldo = new Decimal(0)
    const movimientos: Movimiento[] = eventos.map((evento) => {
        saldo = saldo.plus(evento.cargo).minus(evento.abono)
        return { ...evento, saldo: dinero(saldo) }
    })

    // Como `saldoAnticipos` de la API: lo que sobró de los pagos del cliente sin aplicar a facturas.
    const aFavor = bd.pagos
        .filter(p => p.cliente_id === clienteId && p.estado === 'registrado')
        .reduce((total, p) => total.plus(p.monto).minus(p.aplicaciones.reduce((suma, a) => suma.plus(a.monto), new Decimal(0))), new Decimal(0))

    return {
        cliente_id: clienteId,
        saldo: dinero(saldo),
        saldo_a_favor: dinero(Decimal.max(aFavor, 0)),
        facturas_pendientes: facturas.filter(factura => factura.estado !== 'pagada'),
        movimientos,
    }
}
