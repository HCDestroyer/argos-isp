import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { filtrarBodegasVisibles, type AccesoBodegas } from '#inventario/bodegas'

/**
 * Órdenes de traslado (fase D, `contratos/inventario.md` D.1): lo enviado viaja en la bodega virtual
 * «en tránsito» de la empresa hasta que el destino lo recibe (con firma digital, firma en papel o
 * aceptación sin firma si la empresa lo permite) o el origen cancela. Lecturas, la bodega de tránsito
 * y la configuración del inventario por empresa.
 */

export const ESTADOS_ORDEN_TRASLADO = [
    'en_transito',
    'recibida',
    'recibida_con_diferencias',
    'cancelada',
] as const
export type EstadoOrdenTraslado = (typeof ESTADOS_ORDEN_TRASLADO)[number]
export const METODOS_RECEPCION = ['firma_digital', 'firma_papel', 'aceptacion_sistema'] as const
export type MetodoRecepcion = (typeof METODOS_RECEPCION)[number]

/** Origen interno de los movimientos de una orden (`inventario.movimientos.origen_tipo`). */
export const ORIGEN_ORDEN_TRASLADO = 'orden_traslado'

const LOCK_TRANSITO = 3071
export const LOCK_NUMERO_TRASLADO = 3072
const NOMBRE_TRANSITO = 'En tránsito (órdenes de traslado)'

/** Bodega «en tránsito» de la empresa; la crea la primera vez (con lock por empresa). */
export async function bodegaTransito(t: Transaccion, empresaId: number): Promise<number> {
    const buscar = async () =>
        (await t.trx
            .from('inventario.bodegas')
            .where({ empresa_id: empresaId, tipo: 'transito' })
            .select('id')
            .first()) as { id: number } | null
    const existente = await buscar()
    if (existente) return Number(existente.id)
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_TRANSITO, empresaId])
    const otra = await buscar()
    if (otra) return Number(otra.id)
    const repetida = await t.trx
        .from('inventario.bodegas')
        .where('empresa_id', empresaId)
        .whereRaw('lower(nombre) = lower(?)', [NOMBRE_TRANSITO])
        .select('id')
        .first()
    if (repetida) {
        throw new Conflicto(
            `La bodega ${repetida.id} usa el nombre «${NOMBRE_TRANSITO}», reservado para lo que viaja en órdenes de traslado: renómbrala`,
            'bodega_transito_nombre',
            'Nombre reservado',
        )
    }
    const [fila] = (await t.trx
        .insertQuery()
        .table('inventario.bodegas')
        .insert({ empresa_id: empresaId, nombre: NOMBRE_TRANSITO, tipo: 'transito' })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}

export interface ConfiguracionInventario {
    empresa_id: number
    traslado_firma_obligatoria: boolean
    version: number
}

/** Configuración del inventario de la empresa; sin fila, los valores por defecto (`version` 0). */
export async function configuracionInventario(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConfiguracionInventario> {
    const fila = (await cliente
        .from('inventario.configuracion')
        .where('empresa_id', empresaId)
        .select('traslado_firma_obligatoria', 'version')
        .first()) as { traslado_firma_obligatoria: boolean; version: number } | null
    return {
        empresa_id: empresaId,
        traslado_firma_obligatoria: fila ? Boolean(fila.traslado_firma_obligatoria) : true,
        version: fila ? Number(fila.version) : 0,
    }
}

export interface UnidadOrdenVista {
    unidad_id: number
    serie: string | null
    mac: string | null
    costo: string
    recibida: boolean | null
}

export interface LineaOrdenVista {
    id: number
    producto_id: number
    producto_sku: string
    producto_nombre: string
    unidad: string
    seguimiento: string
    cantidad: string
    costo_total: string
    cantidad_recibida: string | null
    costo_recibido: string | null
    /** enviado − recibido (null en tránsito o cancelada) */
    faltante: string | null
    unidades: UnidadOrdenVista[]
}

export interface OrdenTrasladoVista {
    id: number
    empresa_id: number
    numero: number
    estado: EstadoOrdenTraslado
    bodega_origen_id: number
    bodega_origen_nombre: string
    bodega_destino_id: number
    bodega_destino_nombre: string
    bodega_destino_tipo: string
    /** el técnico de la bodega destino (null si es una bodega) */
    usuario_destino_id: number | null
    usuario_destino_nombre: string | null
    motivo: string | null
    enviado_por: number | null
    enviado_por_nombre: string | null
    enviado_en: Date
    metodo_recepcion: MetodoRecepcion | null
    recibido_por: number | null
    recibido_por_nombre: string | null
    registrado_por: number | null
    registrado_por_nombre: string | null
    recibido_en: Date | null
    observaciones: string | null
    firma_sha256: string | null
    firma_en: Date | null
    documento_sha256: string | null
    documento_tipo: string | null
    documento_en: Date | null
    cancelado_por: number | null
    cancelado_en: Date | null
    motivo_cancelacion: string | null
    lineas_total: number
    costo_total: string
    version: number
    created_at: Date
    updated_at: Date
}

export interface OrdenTrasladoDetalle extends OrdenTrasladoVista {
    lineas: LineaOrdenVista[]
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('inventario.ordenes_traslado as o')
        .join('inventario.bodegas as bo', 'bo.id', 'o.bodega_origen_id')
        .join('inventario.bodegas as b', 'b.id', 'o.bodega_destino_id')
        .leftJoin('core.usuarios as ud', 'ud.id', 'b.usuario_id')
        .leftJoin('core.usuarios as ue', 'ue.id', 'o.enviado_por')
        .leftJoin('core.usuarios as ur', 'ur.id', 'o.recibido_por')
        .leftJoin('core.usuarios as ug', 'ug.id', 'o.registrado_por')
        .select(
            'o.id',
            'o.empresa_id',
            'o.numero',
            'o.estado',
            'o.bodega_origen_id',
            'bo.nombre as bodega_origen_nombre',
            'o.bodega_destino_id',
            'b.nombre as bodega_destino_nombre',
            'b.tipo as bodega_destino_tipo',
            'b.usuario_id as usuario_destino_id',
            'ud.nombre as usuario_destino_nombre',
            'o.motivo',
            'o.enviado_por',
            'ue.nombre as enviado_por_nombre',
            'o.enviado_en',
            'o.metodo_recepcion',
            'o.recibido_por',
            'ur.nombre as recibido_por_nombre',
            'o.registrado_por',
            'ug.nombre as registrado_por_nombre',
            'o.recibido_en',
            'o.observaciones',
            'o.firma_sha256',
            'o.firma_en',
            'o.documento_sha256',
            'o.documento_tipo',
            'o.documento_en',
            'o.cancelado_por',
            'o.cancelado_en',
            'o.motivo_cancelacion',
            cliente.raw(
                '(SELECT count(*) FROM inventario.ordenes_traslado_lineas l WHERE l.orden_id = o.id)::int as lineas_total',
            ),
            cliente.raw(
                '(SELECT coalesce(sum(l.costo_total), 0) FROM inventario.ordenes_traslado_lineas l WHERE l.orden_id = o.id)::numeric(14,2)::text as costo_total',
            ),
            'o.version',
            'o.created_at',
            'o.updated_at',
        )
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizar(f: OrdenTrasladoVista): OrdenTrasladoVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        numero: Number(f.numero),
        bodega_origen_id: Number(f.bodega_origen_id),
        bodega_destino_id: Number(f.bodega_destino_id),
        usuario_destino_id: n(f.usuario_destino_id),
        enviado_por: n(f.enviado_por),
        recibido_por: n(f.recibido_por),
        registrado_por: n(f.registrado_por),
        cancelado_por: n(f.cancelado_por),
        lineas_total: Number(f.lineas_total),
        version: Number(f.version),
    }
}

/** Empresa y bodegas de una orden (para revisar el acceso antes de la acción); 404 si no existe. */
export async function datosDeOrden(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('inventario.ordenes_traslado')
        .where('id', id)
        .select('id', 'empresa_id', 'bodega_origen_id', 'bodega_destino_id', 'estado')
        .first()) as {
        id: number
        empresa_id: number
        bodega_origen_id: number
        bodega_destino_id: number
        estado: EstadoOrdenTraslado
    } | null
    if (!fila) throw new NoEncontrado(`La orden de traslado ${id} no existe`)
    return {
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        bodega_origen_id: Number(fila.bodega_origen_id),
        bodega_destino_id: Number(fila.bodega_destino_id),
        estado: fila.estado,
    }
}

async function lineasDe(ordenId: number, cliente: QueryClientContract): Promise<LineaOrdenVista[]> {
    const lineas = (await cliente
        .from('inventario.ordenes_traslado_lineas as l')
        .join('inventario.productos as p', 'p.id', 'l.producto_id')
        .where('l.orden_id', ordenId)
        .orderBy('l.id')
        .select(
            'l.id',
            'l.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'p.unidad',
            'p.seguimiento',
            cliente.raw('l.cantidad::text as cantidad'),
            cliente.raw('l.costo_total::text as costo_total'),
            cliente.raw('l.cantidad_recibida::text as cantidad_recibida'),
            cliente.raw('l.costo_recibido::text as costo_recibido'),
            cliente.raw('(l.cantidad - l.cantidad_recibida)::numeric(14,3)::text as faltante'),
        )) as Array<Omit<LineaOrdenVista, 'unidades'>>
    const unidades = (await cliente
        .from('inventario.ordenes_traslado_unidades as x')
        .join('inventario.unidades as u', 'u.id', 'x.unidad_id')
        .whereIn(
            'x.linea_id',
            lineas.map((l) => Number(l.id)),
        )
        .orderBy('x.id')
        .select(
            'x.linea_id',
            'x.unidad_id',
            'u.serie',
            'u.mac',
            cliente.raw('x.costo::text as costo'),
            'x.recibida',
        )) as Array<UnidadOrdenVista & { linea_id: number }>
    return lineas.map((l) => ({
        ...l,
        id: Number(l.id),
        producto_id: Number(l.producto_id),
        unidades: unidades
            .filter((u) => Number(u.linea_id) === Number(l.id))
            .map((u) => ({
                unidad_id: Number(u.unidad_id),
                serie: u.serie,
                mac: u.mac,
                costo: u.costo,
                recibida: u.recibida,
            })),
    }))
}

export async function verOrdenTraslado(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<OrdenTrasladoDetalle> {
    const fila = (await consulta(cliente).where('o.id', id).first()) as OrdenTrasladoVista | null
    if (!fila) throw new NoEncontrado(`La orden de traslado ${id} no existe`)
    return { ...normalizar(fila), lineas: await lineasDe(id, cliente) }
}

/** Archivos de la orden (ruta interna y huella) para servirlos; nunca salen en la vista. */
export async function archivosDeOrden(id: number) {
    const fila = (await db
        .from('inventario.ordenes_traslado')
        .where('id', id)
        .select('firma_ruta', 'firma_sha256', 'documento_ruta', 'documento_sha256', 'documento_tipo')
        .first()) as {
        firma_ruta: string | null
        firma_sha256: string | null
        documento_ruta: string | null
        documento_sha256: string | null
        documento_tipo: string | null
    } | null
    if (!fila) throw new NoEncontrado(`La orden de traslado ${id} no existe`)
    return fila
}

export interface FiltrosOrdenesTraslado extends OpcionesPaginacion {
    estado?: EstadoOrdenTraslado
    /** origen o destino */
    bodega_id?: number
    numero?: number
}

/**
 * Órdenes de traslado de las empresas visibles. Con tope por técnico, solo las que salen de o llegan
 * a una bodega que el usuario ve.
 */
export async function listarOrdenesTraslado(
    filtros: FiltrosOrdenesTraslado,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const cliente = db.connection()
    const q = consulta(cliente)
        .if(filtros.estado, (c) => c.where('o.estado', filtros.estado!))
        .if(filtros.numero, (c) => c.where('o.numero', filtros.numero!))
        .if(filtros.bodega_id, (c) =>
            c.where((s) =>
                s
                    .where('o.bodega_origen_id', filtros.bodega_id!)
                    .orWhere('o.bodega_destino_id', filtros.bodega_id!),
            ),
        )
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('o.empresa_id', ids))
    if (acceso) {
        q.where((s) => {
            s.whereExists((e) => {
                e.from('inventario.bodegas as b').whereRaw('b.id = o.bodega_destino_id')
                filtrarBodegasVisibles(e as never, acceso, 'b')
            }).orWhereExists((e) => {
                e.from('inventario.bodegas as b').whereRaw('b.id = o.bodega_origen_id')
                filtrarBodegasVisibles(e as never, acceso, 'b')
            })
        })
    }
    const pagina = await paginar<OrdenTrasladoVista>(q, filtros, { columna: 'o.id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}
