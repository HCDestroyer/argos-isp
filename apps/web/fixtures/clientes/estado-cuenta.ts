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
export function estadoCuentaDe(clienteId: number, empresaId?: number): Schema<'EstadoCuenta'> {
    const total = cuentaDe(clienteId, empresaId ?? null)
    // Multiempresa (A3): una sección por empresa en la que el cliente tiene documentos; la raíz
    // es el total (informativo). Con `empresa_id`, solo esa.
    const ids = [...new Set([
        ...bd.facturas.filter(f => f.cliente_id === clienteId).map(f => f.empresa_id ?? 1),
        ...bd.pagos.filter(p => p.cliente_id === clienteId).map(p => p.empresa_id ?? 1),
    ])].filter(id => empresaId === undefined || id === empresaId).sort((a, b) => a - b)
    const empresas: Schema<'SeccionEstadoCuenta'>[] = ids.map((id) => {
        const empresa = bd.empresas.find(e => e.id === id)
        const seccion = cuentaDe(clienteId, id)
        return {
            empresa_id: id,
            nombre_comercial: empresa?.nombre_comercial ?? `Empresa ${id}`,
            razon_social: empresa?.razon_social ?? null,
            nit: empresa?.nit ?? null,
            logo_url: empresa?.logo_url ?? null,
            saldo: seccion.saldo,
            saldo_a_favor: seccion.saldo_a_favor ?? '0.00',
            facturas_pendientes: seccion.facturas_pendientes,
            movimientos: seccion.movimientos,
        }
    })
    return { ...total, empresas }
}

/** El auxiliar del cliente en una empresa (o en todas con `null`). */
function cuentaDe(clienteId: number, empresaId: number | null): Omit<Schema<'EstadoCuenta'>, 'empresas'> {
    const deEmpresa = (id: number | undefined) => empresaId === null || (id ?? 1) === empresaId
    const facturas = bd.facturas.filter(f => f.cliente_id === clienteId && f.estado !== 'anulada' && f.estado !== 'por_certificar' && deEmpresa(f.empresa_id))
    const eventos: Omit<Movimiento, 'saldo'>[] = []
    for (const factura of facturas) {
        eventos.push({
            fecha: factura.periodo,
            tipo: 'factura',
            referencia_id: factura.id,
            empresa_id: factura.empresa_id,
            descripcion: `Aviso de cobro ${factura.periodo.slice(0, 7)} · servicio ${factura.servicio_id}`,
            cargo: factura.total,
            abono: '0.00',
        })
    }
    const propias = new Set(facturas.map(f => f.id))
    for (const pago of bd.pagos.filter(p => p.estado === 'registrado' && deEmpresa(p.empresa_id))) {
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
                empresa_id: pago.empresa_id,
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
            empresa_id: pago.empresa_id,
            descripcion: `${METODOS[pago.metodo]}${avisos ? ` · aviso ${avisos}` : ''}${pagador ? ` · pagado por ${pagador.nombre}` : ''}`,
            cargo: '0.00',
            abono: dinero(abono),
        })
    }
    // Notas de crédito (A3): abonan la CxC del dueño de la factura.
    for (const nota of bd.notasCredito.filter(n => n.cliente_id === clienteId && deEmpresa(n.empresa_id))) {
        eventos.push({
            fecha: nota.fecha,
            tipo: 'nota_credito',
            referencia_id: nota.id,
            descripcion: `Nota de crédito ${nota.id} · factura ${nota.factura_id} · ${nota.motivo}`,
            cargo: '0.00',
            abono: nota.monto,
        })
    }
    // Decisión B (A3): la diferencia de cobro cerrada como gasto abona la CxC del dueño de la factura
    // (`referencia_id` = la diferencia). Su reverso, al anular el pago, la quita del auxiliar.
    for (const diferencia of bd.diferenciasCerradas.filter(d => d.cliente_id === clienteId && d.revertida_en === null && deEmpresa(d.empresa_id))) {
        eventos.push({
            fecha: diferencia.fecha,
            tipo: 'diferencia_cobro',
            referencia_id: diferencia.id,
            empresa_id: diferencia.empresa_id,
            descripcion: diferencia.descripcion,
            cargo: '0.00',
            abono: diferencia.monto,
        })
    }
    // La API ordena por asiento (fecha, id): el de una diferencia siempre es posterior al del pago
    // que la dejó, así que el mismo día va después de los demás movimientos.
    const despues = (m: Omit<Movimiento, 'saldo'>) => (m.tipo === 'diferencia_cobro' ? 1 : 0)
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || despues(a) - despues(b) || a.referencia_id - b.referencia_id)

    let saldo = new Decimal(0)
    const movimientos: Movimiento[] = eventos.map((evento) => {
        saldo = saldo.plus(evento.cargo).minus(evento.abono)
        return { ...evento, saldo: dinero(saldo) }
    })

    // Como `saldoAnticipos` de la API: lo que sobró de los pagos del cliente sin aplicar a facturas.
    const aFavor = bd.pagos
        .filter(p => p.cliente_id === clienteId && p.estado === 'registrado' && deEmpresa(p.empresa_id))
        .reduce((total, p) => total.plus(p.monto).minus(p.aplicaciones.reduce((suma, a) => suma.plus(a.monto), new Decimal(0))), new Decimal(0))

    return {
        cliente_id: clienteId,
        saldo: dinero(saldo),
        saldo_a_favor: dinero(Decimal.max(aFavor, 0)),
        facturas_pendientes: facturas.filter(factura => factura.estado !== 'pagada'),
        movimientos,
    }
}
