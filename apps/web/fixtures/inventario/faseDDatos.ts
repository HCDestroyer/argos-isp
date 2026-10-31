import type { Schema } from '@argosisp/contracts'
import { BODEGA_TRANSITO_ID } from './datos'

/**
 * Inventario fase D (A3, `contratos/inventario.md` «Fase D»): tipos de producto, órdenes de traslado
 * (con su firma y su papel firmado), configuración del inventario y de la IA, y borradores de compra
 * cargados desde un archivo. Los movimientos de las tres órdenes sembradas están en `datos.ts`.
 */

type TipoProducto = Schema<'TipoProducto'>
type Orden = Schema<'OrdenTrasladoDetalle'>

export interface ArchivoFixture {
    bytes: Uint8Array
    tipo: string
    nombre: string
}

export interface InventarioFaseDFixtures {
    tiposProducto: TipoProducto[]
    ordenes: Orden[]
    /** PNG de la firma digital por orden. */
    firmas: Record<number, Uint8Array>
    /** Papel firmado por orden. */
    documentos: Record<number, ArchivoFixture>
    configuracion: Schema<'ConfiguracionInventario'>[]
    /** Configuración de la IA por empresa (`empresa_id` null = global); la clave nunca sale. */
    ia: Schema<'ConfiguracionIa'>[]
    borradores: Schema<'BorradorCompra'>[]
    archivosBorradores: Record<number, ArchivoFixture>
    /** Lo que se aprende al confirmar: código del proveedor → producto. */
    codigosProveedor: { empresa_id: number, proveedor_id: number, codigo: string, producto_id: number }[]
}

const creado = '2026-09-01T15:00:00.000Z'

/** Firma de Pedro en la orden N.º 1 (PNG de 200×80 px). */
export const FIRMA_SEMILLA_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAABQCAYAAABcbTqwAAABXElEQVR42u3dwY2EMBAEQFLgRwbkH6FJAKGREMOMXSXt73S3dLu9+7ttAwAAAAAAAAAAAABoaz/O8fSSEIYRfEkNwzAUjCN+4I2EJYfxx++A8uOoMDaYchxZvxtSx9FxgNB6HEaCcRgJxjHP34fyh9NAMA6fIp/kJoVFbm0jMRDjMBJfS321MhIZCdbtqEPBGolcBOs9y0OwPYP1dcI4HDIHw0XhgHkGzy9Yz+K5Betrhg4dJgdGh24ez+Y5jcPNqkPcri4ABLvESIxDsJ5Zh4L1qalDh8TB0qFgjcT7F6wsvG8HwqepDh0GuQwdOgSCbTwSHbolZaRDwbqhdah0eelQ2XLToZLlp0PlUitHHQpWnjo0jpkyzf4/jNIXrJHocK4bTs7+D7zSSMtch4Fw3oYq2H9HosMCQd/9rGBrdafDxJAjLwnqUMBC1SGxoCWkQwAAAAAAAAAAAIAlXbxFk6c6gx6pAAAAAElFTkSuQmCC'
export const FIRMA_SEMILLA_SHA256 = 'c5297c684187f912eb8b22b7b28024eea0852b2f6dce152e105c240ffdbc365b'

function bytesDeBase64(base64: string): Uint8Array {
    const binario = atob(base64)
    const bytes = new Uint8Array(binario.length)
    for (let i = 0; i < binario.length; i++) {
        bytes[i] = binario.charCodeAt(i)
    }
    return bytes
}

const tipo = (id: number, codigo: string, nombre: string, seguimiento: TipoProducto['seguimiento_defecto'], modalidad: TipoProducto['modalidad_defecto'], empresaId: number | null = null): TipoProducto => ({
    id,
    empresa_id: empresaId,
    codigo,
    nombre,
    seguimiento_defecto: seguimiento,
    modalidad_defecto: modalidad,
    activo: true,
    version: 1,
    created_at: creado,
    updated_at: creado,
})

/** Orden con los nombres y los campos en null como los devuelve `GET /inventario/traslados/:id`. */
function orden(datos: Pick<Orden, 'id' | 'numero' | 'estado' | 'enviado_en' | 'lineas' | 'motivo'> & Partial<Orden>): Orden {
    return {
        empresa_id: 1,
        bodega_origen_id: 1,
        bodega_origen_nombre: 'Bodega central',
        bodega_destino_id: 2,
        bodega_destino_nombre: 'Vehículo de Pedro',
        bodega_destino_tipo: 'tecnico',
        usuario_destino_id: 4,
        usuario_destino_nombre: 'Pedro Técnico',
        enviado_por: 1,
        enviado_por_nombre: 'Ana Administradora',
        metodo_recepcion: null,
        recibido_por: null,
        recibido_por_nombre: null,
        registrado_por: null,
        registrado_por_nombre: null,
        recibido_en: null,
        observaciones: null,
        firma_sha256: null,
        firma_en: null,
        documento_sha256: null,
        documento_tipo: null,
        documento_en: null,
        cancelado_por: null,
        cancelado_en: null,
        motivo_cancelacion: null,
        lineas_total: datos.lineas.length,
        costo_total: datos.lineas.reduce((t, l) => t + Number(l.costo_total), 0).toFixed(2),
        version: 1,
        created_at: datos.enviado_en,
        updated_at: datos.enviado_en,
        ...datos,
    }
}

const onu = { producto_id: 3, producto_sku: 'ONU-HG8145', producto_nombre: 'ONU Huawei HG8145', unidad: 'unidad', seguimiento: 'serie', modalidad: 'comodato' } as const
const cable = { producto_id: 1, producto_sku: 'CAB-UTP6', producto_nombre: 'Cable UTP Cat6', unidad: 'metro', seguimiento: 'cantidad', modalidad: 'consumible_gasto' } as const

export function faseDInicial(): InventarioFaseDFixtures {
    return {
        tiposProducto: [
            tipo(1, 'equipo', 'Equipo', 'serie', 'comodato'),
            tipo(2, 'material', 'Material', 'cantidad', 'consumible_gasto'),
            tipo(3, 'otro', 'Otro', 'cantidad', 'consumible_gasto'),
            tipo(4, 'fibra', 'Fibra óptica', 'cantidad', 'consumible_gasto', 1),
            tipo(5, 'router_venta', 'Router en venta', 'serie', 'consumible_cobro', 1),
        ],
        ordenes: [
            orden({
                id: 1,
                numero: 1,
                estado: 'recibida',
                motivo: 'Para instalaciones de la semana',
                enviado_en: '2026-09-05T16:00:00.000Z',
                metodo_recepcion: 'firma_digital',
                recibido_por: 4,
                recibido_por_nombre: 'Pedro Técnico',
                registrado_por: 4,
                registrado_por_nombre: 'Pedro Técnico',
                recibido_en: '2026-09-06T14:30:00.000Z',
                firma_sha256: FIRMA_SEMILLA_SHA256,
                firma_en: '2026-09-06T14:30:00.000Z',
                version: 2,
                updated_at: '2026-09-06T14:30:00.000Z',
                lineas: [{ id: 1, ...onu, cantidad: '1.000', costo_total: '350.00', cantidad_recibida: '1.000', costo_recibido: '350.00', faltante: '0.000', unidades: [{ unidad_id: 3, serie: 'HWTC1A2B3C03', mac: 'AA:BB:CC:00:00:03', costo: '350.00', recibida: true }] }],
            }),
            orden({
                id: 2,
                numero: 2,
                estado: 'cancelada',
                motivo: 'Reposición',
                enviado_en: '2026-09-18T16:00:00.000Z',
                cancelado_por: 1,
                cancelado_en: '2026-09-19T16:00:00.000Z',
                motivo_cancelacion: 'Se cambió de técnico',
                version: 2,
                updated_at: '2026-09-19T16:00:00.000Z',
                lineas: [{ id: 2, ...cable, cantidad: '15.000', costo_total: '37.50', cantidad_recibida: null, costo_recibido: null, faltante: null, unidades: [] }],
            }),
            orden({
                id: 3,
                numero: 3,
                estado: 'en_transito',
                motivo: 'Instalación del lunes',
                enviado_en: '2026-09-25T16:00:00.000Z',
                lineas: [{ id: 3, ...onu, cantidad: '1.000', costo_total: '350.00', cantidad_recibida: null, costo_recibido: null, faltante: null, unidades: [{ unidad_id: 6, serie: 'HWTC1A2B3C06', mac: 'AA:BB:CC:00:00:06', costo: '350.00', recibida: null }] }],
            }),
        ],
        firmas: { 1: bytesDeBase64(FIRMA_SEMILLA_BASE64) },
        documentos: {},
        configuracion: [{ empresa_id: 1, traslado_firma_obligatoria: true, version: 1 }],
        ia: [],
        borradores: [],
        archivosBorradores: {},
        codigosProveedor: [],
    }
}

export { BODEGA_TRANSITO_ID }
