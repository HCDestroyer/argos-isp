import type { Schema } from '@argosisp/contracts'

/**
 * Compras de la fase 5 (A3): solo lo que el panel lee hoy, `GET /compras`, para entregar el bien de un
 * premio de sorteo con la contrapartida `compra` (decisión del PM, 19 oct). Dos compras de ArgosNet con
 * líneas de bien (una al crédito y una anulada, que no sirve) y una de Fibra del Sur.
 */

type Compra = Schema<'Compra'>
type Linea = Schema<'LineaCompra'>

function linea(id: number, descripcion: string, base: string, iva: string, cuenta: { id: number, codigo: string }, tipo: Linea['tipo'] = 'bien', cantidad = 1): Linea {
    return { id, descripcion, tipo, cuenta_id: cuenta.id, cuenta_codigo: cuenta.codigo, exento: false, base, iva, clase_activo: null, diferir_meses: null, cantidad }
}

const INVENTARIO = { id: 22, codigo: '1.1.14' }
const GASTOS_GENERALES = { id: 15, codigo: '5.1.02' }

function compra(id: number, datos: Partial<Compra> & Pick<Compra, 'proveedor_nombre' | 'numero' | 'fecha_documento' | 'lineas' | 'total' | 'iva'>): Compra {
    const fecha = datos.fecha_documento
    return {
        id,
        empresa_id: 1,
        proveedor_id: id,
        proveedor_nit: '1234567-8',
        tipo_documento: 'FACT',
        serie: 'A',
        autorizacion: null,
        periodo_iva: `${fecha.slice(0, 7)}-01`,
        fecha,
        condicion: 'contado',
        vence_en: null,
        base_bienes: '0.00',
        base_servicios: '0.00',
        base_importaciones: '0.00',
        exento: '0.00',
        credito_fiscal: true,
        retencion_iva: '0.00',
        retencion_isr: '0.00',
        neto: datos.total,
        saldo: '0.00',
        compra_referencia_id: null,
        egreso_id: null,
        egreso_pago_id: null,
        descripcion: null,
        asiento_id: 9500 + id,
        estado: 'vigente',
        anulado_en: null,
        anulado_por: null,
        motivo_anulacion: null,
        asiento_reverso_id: null,
        registrado_por: 1,
        created_at: `${fecha}T16:00:00.000Z`,
        retenciones: [],
        ...datos,
    }
}

export const compras: Compra[] = [
    compra(1, {
        proveedor_nombre: 'Ciclo Sport, S.A.',
        numero: '88123',
        fecha_documento: '2026-08-20',
        condicion: 'credito',
        vence_en: '2026-09-19',
        base_bienes: '4464.29',
        iva: '535.71',
        total: '5000.00',
        saldo: '5000.00',
        descripcion: 'Premios de los sorteos (2 bicicletas)',
        lineas: [linea(11, 'Bicicleta de montaña aro 29', '4464.29', '535.71', INVENTARIO, 'bien', 2)],
    }),
    compra(2, {
        proveedor_nombre: 'Electrónica Central',
        numero: '5521',
        fecha_documento: '2026-09-10',
        base_bienes: '4107.14',
        base_servicios: '89.29',
        iva: '503.57',
        total: '4700.00',
        lineas: [
            linea(21, 'Televisor inteligente 55"', '3750.00', '450.00', INVENTARIO),
            linea(22, 'Soporte de pared', '357.14', '42.86', INVENTARIO),
            linea(23, 'Instalación del soporte', '89.29', '10.71', GASTOS_GENERALES, 'servicio'),
        ],
    }),
    compra(3, {
        proveedor_nombre: 'Ciclo Sport, S.A.',
        numero: '88001',
        fecha_documento: '2026-08-02',
        base_bienes: '2232.14',
        iva: '267.86',
        total: '2500.00',
        estado: 'anulada',
        anulado_en: '2026-08-03T15:00:00.000Z',
        anulado_por: 1,
        motivo_anulacion: 'Factura con NIT equivocado',
        asiento_reverso_id: 9600,
        lineas: [linea(31, 'Bicicleta de montaña aro 29', '2232.14', '267.86', INVENTARIO)],
    }),
    compra(4, {
        empresa_id: 2,
        proveedor_nombre: 'Distribuidora del Sur',
        numero: '301',
        fecha_documento: '2026-09-15',
        base_bienes: '892.86',
        iva: '107.14',
        total: '1000.00',
        lineas: [linea(41, 'Router Wi-Fi 6 para premio', '892.86', '107.14', INVENTARIO)],
    }),
]
