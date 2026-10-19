import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { CLIENTE_IMPORTADO, clientes } from '../clientes/datos'
import { empresas } from '../empresas/datos'
import { planes } from '../planes/datos'
import { servicios } from '../servicios/datos'

type Factura = Schema<'Factura'>
type Pago = Schema<'Pago'>
type Servicio = Schema<'Servicio'>

/** "Hoy" de los fixtures, en Guatemala: las facturas que vencen antes están vencidas. */
export const HOY_FIXTURES = '2026-10-15'

/** Caja de Fibra del Sur (empresa 2), con turno abierto: el cobro repartido la usa. */
export const CAJA_SUR_ID = 4

const PERIODOS = ['2026-09-01', '2026-10-01'] as const
const IVA = new Decimal('1.12')

export function dinero(valor: Decimal): string {
    return valor.toFixed(2)
}

export function sumarDias(fecha: string, dias: number): string {
    const resultado = new Date(`${fecha}T00:00:00Z`)
    resultado.setUTCDate(resultado.getUTCDate() + dias)
    return resultado.toISOString().slice(0, 10)
}

/** Cuánto se pagó de la factura según el estado del servicio, para que la historia sea coherente. */
function pagadoDe(servicio: Servicio, periodo: string, total: Decimal): Decimal {
    if (servicio.estado === 'suspendido') {
        return servicio.promesa_activa && periodo === PERIODOS[0] ? total.div(2).toDecimalPlaces(2) : new Decimal(0)
    }
    if (servicio.estado === 'limitado') {
        return periodo === PERIODOS[0] ? total : new Decimal(0)
    }
    // Multiempresa: las sucursales de Fibra del Sur deben octubre, para que un cliente tenga
    // avisos pendientes de dos empresas (cobro repartido, ficha agrupada).
    if (periodo === PERIODOS[1] && (servicio.id % 3 === 0 || servicio.empresa_id === 2)) {
        return new Decimal(0)
    }
    return total
}

/** Estado de la factura según lo pagado y el vencimiento, como `billing.facturas.estado`. */
export function estadoFactura(pagado: Decimal, total: Decimal, vence: string): Factura['estado'] {
    if (pagado.gte(total)) {
        return 'pagada'
    }
    if (vence < HOY_FIXTURES) {
        return 'vencida'
    }
    return pagado.isZero() ? 'emitida' : 'parcial'
}

/** Avisos de septiembre y octubre de 2026 de cada servicio no retirado. */
export const facturas: Factura[] = servicios
    .filter(servicio => servicio.estado !== 'retirado')
    .flatMap((servicio) => {
        const plan = planes.find(p => p.id === servicio.plan_id)
        const total = new Decimal(servicio.costo_override ?? plan?.precio ?? '0')
        const subtotal = total.div(IVA).toDecimalPlaces(2)
        return PERIODOS.map((periodo, indice): Factura => {
            const vence = sumarDias(periodo, servicio.estado === 'activo' && indice === 1 ? 19 : 9)
            const pagado = pagadoDe(servicio, periodo, total)
            const emitida = `${periodo}T14:00:00.000Z`
            const estado = estadoFactura(pagado, total, vence)
            return {
                id: servicio.id * 100 + indice + 9,
                // Multiempresa (A3): la empresa del servicio, con su nombre comercial.
                empresa_id: servicio.empresa_id,
                empresa_nombre: empresas.find(e => e.id === servicio.empresa_id)?.nombre_comercial ?? '',
                cliente_id: servicio.cliente_id,
                servicio_id: servicio.id,
                periodo,
                clave_unica: `${servicio.id}-${periodo}`,
                emitida_en: emitida,
                vence_en: vence,
                estado,
                subtotal: dinero(subtotal),
                iva: dinero(total.minus(subtotal)),
                total: dinero(total),
                pagado: dinero(pagado),
                fel_uuid: null,
                fel_serie: null,
                fel_numero: null,
                fel_estado: null,
                // Como la API: `tipo` siempre viene; `vencida_en` cuando el cron la marcó vencida.
                tipo: 'servicio',
                factura_origen_id: null,
                vencida_en: estado === 'vencida' ? `${sumarDias(vence, 1)}T06:05:00.000Z` : null,
                anulada_en: null,
                motivo_anulacion: null,
                version: 1,
                created_at: emitida,
                updated_at: emitida,
            }
        })
    })

/** Id en el sistema de origen de los pagos históricos (`RegistrarPagoHistorico`, A3). */
export const clavesHistoricas: Record<number, string> = { 9001: 'mikrowisp:pago:987' }

/** Pago histórico importado de Mikrowisp: sin factura (anticipo), sin caja ni banco. */
const pagoHistorico: Pago = {
    id: 9001,
    empresa_id: 1,
    cobro_id: null,
    cliente_id: CLIENTE_IMPORTADO,
    metodo: 'deposito',
    monto: '75.00',
    comision: '0.00',
    referencia: 'MW-987',
    caja_id: null,
    pasarela: null,
    estado: 'registrado',
    nota: null,
    registrado_por: 1,
    historico: true,
    origen: 'mikrowisp',
    id_externo: 'mikrowisp:pago:987',
    aplicaciones: [],
    anulado_en: null,
    motivo_anulacion: null,
    banco_origen_id: null,
    banco_origen_nombre: null,
    cuenta_bancaria_id: null,
    cuenta_bancaria_nombre: null,
    proveedor_cobro_id: null,
    proveedor_cobro_nombre: null,
    liquidacion_id: null,
    version: 1,
    created_at: '2026-09-10T18:00:00.000Z',
    updated_at: '2026-09-10T18:00:00.000Z',
}

/** Un pago en caja por cada factura con algo pagado, cuatro días después de emitida. */
export const pagos: Pago[] = facturas
    .filter(factura => new Decimal(factura.pagado).gt(0))
    .map((factura): Pago => {
        const fecha = `${sumarDias(factura.periodo, 4)}T16:20:00.000Z`
        return {
            id: factura.id + 5000,
            // Multiempresa (A3): el pago es de la empresa de su factura, en una caja de esa empresa.
            empresa_id: factura.empresa_id,
            cobro_id: null,
            cliente_id: factura.cliente_id,
            metodo: 'caja',
            monto: factura.pagado,
            comision: '0.00',
            referencia: null,
            caja_id: factura.empresa_id === 2 ? CAJA_SUR_ID : 1,
            pasarela: null,
            estado: 'registrado',
            nota: null,
            registrado_por: 2,
            historico: false,
            aplicaciones: [{
                factura_id: factura.id,
                monto: factura.pagado,
                cliente_id: factura.cliente_id,
                cliente_nombre: clientes.find(c => c.id === factura.cliente_id)?.nombre ?? '',
            }],
            anulado_en: null,
            motivo_anulacion: null,
            // Como la vista `Pago` de la API: siempre trae los datos bancarios (null en efectivo).
            banco_origen_id: null,
            banco_origen_nombre: null,
            cuenta_bancaria_id: null,
            cuenta_bancaria_nombre: null,
            proveedor_cobro_id: null,
            proveedor_cobro_nombre: null,
            liquidacion_id: null,
            version: 1,
            created_at: fecha,
            updated_at: fecha,
        }
    })
    .concat(pagoHistorico)

/** H16 (A3, fase 4 final): aviso sin DTE cubierto entero por notas internas, sin cobro. */
export const FACTURA_ACREDITADA_ID = 9101

function facturaExtra(base: Factura, datos: Partial<Factura>): Factura {
    return { ...base, fel_uuid: null, fel_serie: null, fel_numero: null, fel_estado: null, vencida_en: null, anulada_en: null, motivo_anulacion: null, version: 1, ...datos }
}

const avisoServicio3 = facturas.find(f => f.servicio_id === 3)
if (avisoServicio3) {
    // Después de los pagos: no tiene un pago (se cubrió con notas).
    facturas.push(
        facturaExtra(avisoServicio3, {
            id: FACTURA_ACREDITADA_ID,
            periodo: '2026-08-01',
            clave_unica: '3-2026-08-01',
            emitida_en: '2026-08-01T14:00:00.000Z',
            vence_en: '2026-08-10',
            estado: 'acreditada',
            pagado: avisoServicio3.total,
            acreditado: avisoServicio3.total,
            created_at: '2026-08-01T14:00:00.000Z',
            updated_at: '2026-08-05T16:00:00.000Z',
        }),
    )
}

const momentoCaja = '2026-10-15T13:00:00.000Z'

/**
 * Cajas: la del cajero y la de la oficina con turno abierto; Mixco sin turno (las tres de
 * ArgosNet). Multiempresa: la caja Sur es de Fibra del Sur y también tiene turno abierto.
 */
export const cajas: Schema<'Caja'>[] = [
    { id: 1, empresa_id: 1, nombre: 'Caja Central', cajero_id: 2, cuenta_id: 3, activa: true, turno_abierto_id: 41, version: 3, created_at: '2026-09-01T15:00:00.000Z', updated_at: momentoCaja },
    { id: 2, empresa_id: 1, nombre: 'Caja Oficina', cajero_id: 1, cuenta_id: 4, activa: true, turno_abierto_id: 42, version: 2, created_at: '2026-09-01T15:00:00.000Z', updated_at: momentoCaja },
    { id: 3, empresa_id: 1, nombre: 'Caja Mixco', cajero_id: null, cuenta_id: 5, activa: true, turno_abierto_id: null, version: 1, created_at: '2026-09-01T15:00:00.000Z', updated_at: '2026-09-01T15:00:00.000Z' },
    { id: CAJA_SUR_ID, empresa_id: 2, nombre: 'Caja Sur', cajero_id: 1, cuenta_id: 19, activa: true, turno_abierto_id: 43, version: 2, created_at: '2026-09-01T15:00:00.000Z', updated_at: momentoCaja },
]

type Turno = Schema<'CajaTurno'>

function turnoCerrado(id: number, cajaId: number, dia: string, fondo: string, esperado: string, contado: string, motivo: string | null): Turno {
    const abierto = `${dia}T13:00:00.000Z`
    const cerrado = `${dia}T23:30:00.000Z`
    return {
        id,
        caja_id: cajaId,
        abierto_en: abierto,
        fondo_inicial: fondo,
        cerrado_en: cerrado,
        esperado,
        contado,
        diferencia: new Decimal(contado).minus(esperado).toFixed(2),
        motivo,
        abierto_por: 2,
        cerrado_por: 2,
        version: 2,
        created_at: abierto,
        updated_at: cerrado,
    }
}

function turnoAbierto(id: number, cajaId: number, fondo: string): Turno {
    return {
        id,
        caja_id: cajaId,
        abierto_en: momentoCaja,
        fondo_inicial: fondo,
        cerrado_en: null,
        esperado: null,
        contado: null,
        diferencia: null,
        motivo: null,
        abierto_por: cajaId === 1 ? 2 : 1,
        cerrado_por: null,
        version: 1,
        created_at: momentoCaja,
        updated_at: momentoCaja,
    }
}

/**
 * Turnos de caja: los abiertos 41 y 42 (`Caja.turno_abierto_id`) y cierres anteriores: uno
 * exacto, uno con faltante y uno con sobrante (con motivo, como exige `cerrarCaja`).
 */
export const turnos: Turno[] = [
    turnoCerrado(37, 1, '2026-10-12', '500.00', '1450.00', '1450.00', null),
    turnoCerrado(38, 2, '2026-10-12', '300.00', '620.00', '620.00', null),
    turnoCerrado(39, 1, '2026-10-13', '500.00', '1875.50', '1870.50', 'Faltaron Q 5.00: vuelto mal entregado'),
    turnoCerrado(40, 1, '2026-10-14', '500.00', '960.00', '980.00', 'Sobrante: un cliente no esperó su vuelto'),
    turnoAbierto(41, 1, '500.00'),
    turnoAbierto(42, 2, '300.00'),
    turnoAbierto(43, CAJA_SUR_ID, '200.00'),
]
