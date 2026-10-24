import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    enumerado,
    fecha,
    id,
    instante,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { SEGUIMIENTOS, TIPOS_PRODUCTO } from '#inventario/productos'
import { TIPOS_BODEGA } from '#inventario/bodegas'
import { CAUSAS_BAJA, TIPOS_MOVIMIENTO } from '#inventario/kardex'

/**
 * Schemas de respuesta del inventario (`contratos/inventario.md` §6, fase A).
 */

const Cantidad = { type: 'string', pattern: '^-?\\d+\\.\\d{3}$', description: 'Cantidad con 3 decimales' }
const DineroConSigno = { ...Dinero, description: 'Monto con signo (+ entra, − sale)' }

export const Producto = definirEsquema(
    'Producto',
    objeto({
        id,
        empresa_id: id,
        sku: texto,
        nombre: texto,
        unidad: texto,
        tipo: enumerado(TIPOS_PRODUCTO),
        seguimiento: enumerado(SEGUIMIENTOS),
        clase_activo: nulable(texto),
        concepto_cargo_id: nulable(id),
        cuenta_costo: { ...nulable(texto), description: 'null = 5.6.01' },
        cuenta_consumo: { ...nulable(texto), description: 'null = 5.2.07' },
        existencia_minima: nulable(Cantidad),
        activo: booleano,
        existencia: { ...Cantidad, description: 'Existencia total en todas las bodegas' },
        valor: { ...Dinero, description: 'Valor del kardex del producto' },
        ...auditable,
    }),
)

export const Bodega = definirEsquema(
    'Bodega',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        tipo: enumerado(TIPOS_BODEGA),
        usuario_id: nulable(id),
        usuario_nombre: nulable(texto),
        zona_id: nulable(id),
        router_id: nulable(id),
        activo: booleano,
        ...auditable,
    }),
)

export const Existencia = definirEsquema(
    'ExistenciaInventario',
    objeto({
        id,
        empresa_id: id,
        producto_id: id,
        producto_sku: texto,
        producto_nombre: texto,
        unidad: texto,
        bodega_id: id,
        bodega_nombre: texto,
        bodega_tipo: enumerado(TIPOS_BODEGA),
        cantidad: Cantidad,
        valor: Dinero,
        costo_promedio: {
            ...nulable(texto),
            description: 'valor / cantidad de la bodega, 6 decimales; null sin existencia',
        },
        existencia_total: Cantidad,
        existencia_minima: nulable(Cantidad),
        bajo_minimo: booleano,
    }),
)

export const MovimientoInventario = definirEsquema(
    'MovimientoInventario',
    objeto({
        id,
        empresa_id: id,
        tipo: enumerado(TIPOS_MOVIMIENTO),
        fecha,
        producto_id: id,
        producto_sku: texto,
        producto_nombre: texto,
        bodega_id: id,
        bodega_nombre: texto,
        cantidad: { ...Cantidad, description: 'Con signo: + entra, − sale' },
        costo_unitario: { ...texto, description: 'Costo unitario con 6 decimales' },
        costo_total: DineroConSigno,
        unidad_id: nulable(id),
        servicio_id: nulable(id),
        asiento_id: {
            ...nulable(id),
            description: 'Asiento del movimiento (o el de su compra); null sin efecto contable',
        },
        origen_tipo: nulable(texto),
        origen_id: nulable(id),
        traslado_id: nulable(id),
        reverso_de: nulable(id),
        causa: nulable(enumerado(CAUSAS_BAJA)),
        motivo: nulable(texto),
        actor_tipo: texto,
        actor_id: nulable(id),
        created_at: instante,
        saldo_cantidad: { ...Cantidad, description: 'Saldo corrido después del movimiento' },
        saldo_valor: { ...Dinero, description: 'Valor corrido después del movimiento' },
    }),
)

export const TrasladoInventario = definirEsquema(
    'TrasladoInventario',
    objeto({ traslado_id: id, salida: MovimientoInventario, entrada: MovimientoInventario }),
)
