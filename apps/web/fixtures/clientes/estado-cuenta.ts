import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { bd } from '../bd'
import { dinero } from '../facturacion/datos'

type Movimiento = Schema<'MovimientoEstadoCuenta'>

const METODOS: Record<Schema<'Pago'>['metodo'], string> = {
    caja: 'Pago en caja',
    pasarela: 'Pago en línea',
    deposito: 'Depósito',
    agente: 'Pago en agente',
    debito: 'Débito automático',
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
    for (const pago of bd.pagos.filter(p => p.cliente_id === clienteId && p.estado === 'registrado')) {
        const avisos = pago.aplicaciones.map(a => a.factura_id).join(', ')
        eventos.push({
            fecha: pago.created_at.slice(0, 10),
            tipo: 'pago',
            referencia_id: pago.id,
            descripcion: `${METODOS[pago.metodo]}${avisos ? ` · aviso ${avisos}` : ''}`,
            cargo: '0.00',
            abono: pago.monto,
        })
    }
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.referencia_id - b.referencia_id)

    let saldo = new Decimal(0)
    const movimientos: Movimiento[] = eventos.map((evento) => {
        saldo = saldo.plus(evento.cargo).minus(evento.abono)
        return { ...evento, saldo: dinero(saldo) }
    })

    return {
        cliente_id: clienteId,
        saldo: dinero(saldo),
        facturas_pendientes: facturas.filter(factura => factura.estado !== 'pagada'),
        movimientos,
    }
}
