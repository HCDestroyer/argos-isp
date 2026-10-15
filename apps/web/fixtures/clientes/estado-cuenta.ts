import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { bd } from '../bd'

type Factura = Schema<'Factura'>
type Movimiento = Schema<'MovimientoEstadoCuenta'>

const PERIODOS = ['2026-09-01', '2026-10-01'] as const
const IVA = new Decimal('1.12')

function dinero(valor: Decimal): string {
    return valor.toFixed(2)
}

function sumarDias(fecha: string, dias: number): string {
    const resultado = new Date(`${fecha}T00:00:00Z`)
    resultado.setUTCDate(resultado.getUTCDate() + dias)
    return resultado.toISOString().slice(0, 10)
}

/** Cuánto se pagó de la factura según el estado del servicio, para que la historia sea coherente. */
function pagadoDe(servicio: Schema<'Servicio'>, periodo: string, total: Decimal): Decimal {
    if (servicio.estado === 'suspendido') {
        return servicio.promesa_activa && periodo === PERIODOS[0] ? total.div(2).toDecimalPlaces(2) : new Decimal(0)
    }
    if (servicio.estado === 'limitado') {
        return periodo === PERIODOS[0] ? total : new Decimal(0)
    }
    if (periodo === PERIODOS[1] && servicio.id % 3 === 0) {
        return new Decimal(0)
    }
    return total
}

function estadoDe(pagado: Decimal, total: Decimal, vence: string): Factura['estado'] {
    if (pagado.gte(total)) {
        return 'pagada'
    }
    if (vence < '2026-10-15') {
        return 'vencida'
    }
    return pagado.isZero() ? 'emitida' : 'parcial'
}

/** Facturas de los servicios del cliente (septiembre y octubre de 2026). */
export function facturasDe(clienteId: number): Factura[] {
    return bd.servicios
        .filter(servicio => servicio.cliente_id === clienteId && servicio.estado !== 'retirado')
        .flatMap((servicio) => {
            const plan = bd.planes.find(p => p.id === servicio.plan_id)
            const total = new Decimal(servicio.costo_override ?? plan?.precio ?? '0')
            const subtotal = total.div(IVA).toDecimalPlaces(2)
            return PERIODOS.map((periodo, indice) => {
                const vence = sumarDias(periodo, servicio.estado === 'activo' && indice === 1 ? 19 : 9)
                const pagado = pagadoDe(servicio, periodo, total)
                const emitida = `${periodo}T14:00:00.000Z`
                return {
                    id: servicio.id * 100 + indice + 9,
                    cliente_id: clienteId,
                    servicio_id: servicio.id,
                    periodo,
                    clave_unica: `${servicio.id}-${periodo}`,
                    emitida_en: emitida,
                    vence_en: vence,
                    estado: estadoDe(pagado, total, vence),
                    subtotal: dinero(subtotal),
                    iva: dinero(total.minus(subtotal)),
                    total: dinero(total),
                    pagado: dinero(pagado),
                    fel_uuid: null,
                    fel_serie: null,
                    fel_numero: null,
                    fel_estado: null,
                    version: 1,
                    created_at: emitida,
                    updated_at: emitida,
                }
            })
        })
}

export function estadoCuentaDe(clienteId: number): Schema<'EstadoCuenta'> {
    const facturas = facturasDe(clienteId)
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
        if (new Decimal(factura.pagado).gt(0)) {
            eventos.push({
                fecha: sumarDias(factura.periodo, 4),
                tipo: 'pago',
                referencia_id: factura.id + 5000,
                descripcion: `Pago en caja · aviso ${factura.id}`,
                cargo: '0.00',
                abono: factura.pagado,
            })
        }
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
        facturas_pendientes: facturas.filter(factura => factura.estado !== 'pagada' && factura.estado !== 'anulada'),
        movimientos,
    }
}
