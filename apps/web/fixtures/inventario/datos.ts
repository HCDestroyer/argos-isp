import type { Schema } from '@argosisp/contracts'
import { servicios } from '../servicios/datos'
import { agregarMovimiento } from './kardex'

type Producto = Schema<'Producto'>
type Bodega = Schema<'Bodega'>
type Movimiento = Schema<'MovimientoInventario'>
type Unidad = Schema<'UnidadInventario'>
type Conteo = Schema<'ConteoInventarioDetalle'>

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

/** Bodega central, la del técnico (Pedro, usuario 4) y una de Fibra del Sur (empresa 2). */
export const bodegasIniciales: Bodega[] = [
    { id: 1, empresa_id: 1, nombre: 'Bodega central', tipo: 'bodega', usuario_id: null, usuario_nombre: null, zona_id: null, router_id: null, activo: true, ...meta },
    { id: 2, empresa_id: 1, nombre: 'Vehículo de Pedro', tipo: 'tecnico', usuario_id: 4, usuario_nombre: 'Pedro Técnico', zona_id: null, router_id: null, activo: true, ...meta },
    { id: 3, empresa_id: 2, nombre: 'Bodega Fibra del Sur', tipo: 'bodega', usuario_id: null, usuario_nombre: null, zona_id: null, router_id: null, activo: true, ...meta },
]

/** Producto como lo guarda la API; `existencia` y `valor` se calculan del kardex al leerlo. */
const producto = (id: number, datos: Pick<Producto, 'sku' | 'nombre' | 'unidad' | 'tipo' | 'seguimiento'> & Partial<Producto>): Producto => ({
    id,
    empresa_id: 1,
    clase_activo: datos.seguimiento === 'serie' ? 'equipo_red' : null,
    concepto_cargo_id: null,
    cuenta_costo: null,
    cuenta_consumo: null,
    existencia_minima: null,
    precio_venta: null,
    activo: true,
    existencia: '0.000',
    valor: '0.00',
    ...meta,
    ...datos,
})

export const productosIniciales: Producto[] = [
    producto(1, { sku: 'CAB-UTP6', nombre: 'Cable UTP Cat6', unidad: 'metro', tipo: 'material', seguimiento: 'cantidad', existencia_minima: '100.000' }),
    producto(2, { sku: 'CON-RJ45', nombre: 'Conector RJ45', unidad: 'unidad', tipo: 'material', seguimiento: 'cantidad', existencia_minima: '50.000' }),
    producto(3, { sku: 'ONU-HG8145', nombre: 'ONU Huawei HG8145', unidad: 'unidad', tipo: 'equipo', seguimiento: 'serie' }),
    producto(4, { sku: 'RT-AX1500', nombre: 'Router TP-Link AX1500', unidad: 'unidad', tipo: 'equipo', seguimiento: 'serie', concepto_cargo_id: 1, precio_venta: '650.00' }),
    producto(5, { sku: 'GRAPA-10', nombre: 'Grapa plástica 10 mm', unidad: 'caja', tipo: 'material', seguimiento: 'cantidad', empresa_id: 2 }),
]

const SERVICIO_COMODATO = servicios.find(s => s.cliente_id === 1)?.id ?? 1
/** El servicio retirado del cliente 9: su ONU quedó «por recuperar». */
const SERVICIO_RETIRADO = servicios.find(s => s.estado === 'retirado')

const unidad = (id: number, productoId: number, serie: string, mac: string, extra: Partial<Unidad>): Unidad => {
    const p = productosIniciales.find(x => x.id === productoId)
    return {
        id,
        empresa_id: 1,
        producto_id: productoId,
        producto_sku: p?.sku ?? '',
        producto_nombre: p?.nombre ?? '',
        serie,
        mac,
        estado: 'disponible',
        condicion: 'nuevo',
        bodega_id: 1,
        bodega_nombre: 'Bodega central',
        costo: '350.00',
        servicio_id: null,
        cliente_id: null,
        activo_id: null,
        compra_id: null,
        ...meta,
        ...extra,
    }
}

export function unidadesIniciales(): Unidad[] {
    return [
        unidad(1, 3, 'HWTC1A2B3C01', 'AA:BB:CC:00:00:01', { estado: 'en_comodato', bodega_id: null, bodega_nombre: null, servicio_id: SERVICIO_COMODATO, cliente_id: 1, activo_id: 901 }),
        unidad(2, 3, 'HWTC1A2B3C02', 'AA:BB:CC:00:00:02', {}),
        unidad(3, 3, 'HWTC1A2B3C03', 'AA:BB:CC:00:00:03', { bodega_id: 2, bodega_nombre: 'Vehículo de Pedro' }),
        unidad(4, 4, 'TPAX15000001', 'AA:BB:CC:00:10:01', { costo: '425.00' }),
        unidad(5, 3, 'HWTC1A2B3C05', 'AA:BB:CC:00:00:05', { estado: 'por_recuperar', bodega_id: null, bodega_nombre: null, servicio_id: SERVICIO_RETIRADO?.id ?? null, cliente_id: SERVICIO_RETIRADO?.cliente_id ?? null, activo_id: 902 }),
    ]
}

/**
 * Kardex inicial: saldos de apertura del 1 de septiembre, el traslado de una ONU al vehículo del
 * técnico, los dos comodatos y un consumo de cable. Cada movimiento con su saldo corrido.
 */
export function movimientosIniciales(): Movimiento[] {
    const movimientos: Movimiento[] = []
    const nombres = (productoId: number, bodegaId: number) => ({
        producto: productosIniciales.find(p => p.id === productoId) ?? productosIniciales[0]!,
        bodega: bodegasIniciales.find(b => b.id === bodegaId)?.nombre ?? '',
    })
    const mover = (fecha: string, datos: Parameters<typeof agregarMovimiento>[2]) => agregarMovimiento(movimientos, nombres(datos.producto_id, datos.bodega_id), { ...datos, fecha }, `${fecha}T16:00:00.000Z`)
    mover('2026-09-01', { tipo: 'saldo_inicial', fecha: '', producto_id: 1, bodega_id: 1, cantidad: '305', costo_total: '762.50' })
    mover('2026-09-01', { tipo: 'saldo_inicial', fecha: '', producto_id: 2, bodega_id: 1, cantidad: '40', costo_total: '50.00' })
    for (const u of [1, 2, 3, 5]) {
        mover('2026-09-01', { tipo: 'saldo_inicial', fecha: '', producto_id: 3, bodega_id: 1, cantidad: '1', costo_total: '350.00', unidad_id: u })
    }
    mover('2026-09-01', { tipo: 'saldo_inicial', fecha: '', producto_id: 4, bodega_id: 1, cantidad: '1', costo_total: '425.00', unidad_id: 4 })
    mover('2026-09-05', { tipo: 'traslado', fecha: '', producto_id: 3, bodega_id: 1, cantidad: '-1', costo_total: '-350.00', unidad_id: 3, traslado_id: 1, motivo: 'Para instalaciones de la semana' })
    mover('2026-09-05', { tipo: 'traslado', fecha: '', producto_id: 3, bodega_id: 2, cantidad: '1', costo_total: '350.00', unidad_id: 3, traslado_id: 1, motivo: 'Para instalaciones de la semana' })
    mover('2026-09-10', { tipo: 'asignacion_comodato', fecha: '', producto_id: 3, bodega_id: 1, cantidad: '-1', costo_total: '-350.00', unidad_id: 1, servicio_id: SERVICIO_COMODATO })
    mover('2026-09-12', { tipo: 'asignacion_comodato', fecha: '', producto_id: 3, bodega_id: 1, cantidad: '-1', costo_total: '-350.00', unidad_id: 5, servicio_id: SERVICIO_RETIRADO?.id ?? null })
    mover('2026-09-15', { tipo: 'consumo', fecha: '', producto_id: 1, bodega_id: 1, cantidad: '-25', costo_total: '-62.50', servicio_id: SERVICIO_COMODATO, motivo: 'Instalación' })
    return movimientos
}

/** Un conteo cerrado de la bodega central con un faltante de 2 conectores. */
export function conteosIniciales(): Conteo[] {
    return [{
        id: 1,
        empresa_id: 1,
        bodega_id: 1,
        bodega_nombre: 'Bodega central',
        estado: 'cerrado',
        fecha_corte: '2026-09-30',
        motivo: 'Conteo de fin de mes',
        abierto_por: 1,
        cerrado_por: 1,
        cerrado_en: '2026-09-30T22:00:00.000Z',
        faltante: '0.00',
        sobrante: '0.00',
        version: 2,
        created_at: '2026-09-30T15:00:00.000Z',
        lineas: [{
            id: 1,
            producto_id: 2,
            producto_sku: 'CON-RJ45',
            producto_nombre: 'Conector RJ45',
            seguimiento: 'cantidad',
            contado: '40.000',
            series: [],
            costo_unitario: null,
            esperado: '40.000',
            diferencia: '0.000',
            valor_diferencia: '0.00',
            capturado_en: '2026-09-30T18:00:00.000Z',
            esperado_captura: '40.000',
            valor_captura: '50.00',
            movimientos_desde_captura: 0,
        }],
    }]
}

/** Fecha de asignación de los comodatos del kardex inicial. */
export const FECHAS_COMODATO: Record<number, string> = { 1: '2026-09-10', 5: '2026-09-12' }
