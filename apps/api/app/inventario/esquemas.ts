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
import { CONDICIONES, ESTADOS_UNIDAD } from '#inventario/unidades'
import { lista } from '#shared/openapi/esquemas'

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
    objeto(
        {
            traslado_id: id,
            salida: { ...MovimientoInventario, description: 'Primer par: salida' },
            entrada: { ...MovimientoInventario, description: 'Primer par: entrada' },
            movimientos: {
                ...lista(MovimientoInventario),
                description: 'Todos los movimientos (un par por unidad de serie)',
            },
        },
        ['movimientos'],
    ),
)

const camposUnidad = {
    id,
    empresa_id: id,
    producto_id: id,
    producto_sku: texto,
    producto_nombre: texto,
    serie: nulable(texto),
    mac: { ...nulable(texto), description: 'AA:BB:CC:DD:EE:FF' },
    estado: enumerado(ESTADOS_UNIDAD),
    condicion: enumerado(CONDICIONES),
    bodega_id: nulable(id),
    bodega_nombre: nulable(texto),
    costo: { ...Dinero, description: 'Costo específico (al volver de comodato, su valor en libros)' },
    servicio_id: nulable(id),
    cliente_id: nulable(id),
    activo_id: { ...nulable(id), description: 'Activo fijo mientras está en comodato' },
    compra_id: nulable(id),
    ...auditable,
}

export const Unidad = definirEsquema('UnidadInventario', objeto(camposUnidad))

export const UnidadConHistorial = definirEsquema(
    'UnidadInventarioHistorial',
    objeto({
        ...camposUnidad,
        historial: lista(
            objeto({
                id,
                tipo: enumerado(TIPOS_MOVIMIENTO),
                fecha,
                bodega_id: id,
                bodega_nombre: texto,
                cantidad: Cantidad,
                costo_total: DineroConSigno,
                servicio_id: nulable(id),
                asiento_id: nulable(id),
                origen_tipo: nulable(texto),
                origen_id: nulable(id),
                motivo: nulable(texto),
                created_at: instante,
            }),
        ),
    }),
)

export const EquipoServicio = definirEsquema(
    'EquipoServicio',
    objeto({
        ...camposUnidad,
        valor_libros: { ...nulable(texto), description: 'Costo − depreciación acumulada del activo' },
        fecha_asignacion: nulable(fecha),
    }),
)
