import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { filtrarBodegasVisibles, type AccesoBodegas } from '#inventario/bodegas'
import type { MovimientoVista } from '#inventario/kardex'

/**
 * Unidades por serie o MAC (`contratos/inventario.md` §4, fase B). Una fila por equipo de un producto
 * con seguimiento `serie`. Es la única tabla del módulo que se actualiza: cada cambio pasa por una
 * acción, con `version + 1`, y deja su movimiento en el kardex.
 *
 * - **Serie y MAC** únicas por empresa entre las unidades vivas (422 `serie_duplicada`); la MAC se
 *   guarda como `AA:BB:CC:DD:EE:FF` (acepta guiones, puntos o sin separador).
 * - **Límites** (§5): una unidad `en_comodato` o `por_recuperar` no se vende, no se traslada ni se da
 *   de baja (409 `unidad_en_comodato`); una que no está en la bodega pedida, 409
 *   `unidad_en_otra_bodega`; una vendida, dada de baja, anulada o devuelta, 409 `unidad_no_disponible`.
 */

export const ESTADOS_UNIDAD = [
    'disponible',
    'en_comodato',
    'por_recuperar',
    'en_reparacion',
    'vendida',
    'dada_de_baja',
    'anulada',
    'devuelta_proveedor',
] as const
export type EstadoUnidad = (typeof ESTADOS_UNIDAD)[number]
export const CONDICIONES = ['nuevo', 'usado'] as const
export type Condicion = (typeof CONDICIONES)[number]

/** Estados de una unidad que está en una bodega (cuenta en sus existencias). */
export const EN_BODEGA: readonly EstadoUnidad[] = ['disponible', 'en_reparacion']

export const LOCK_SERIES = 3063

export interface UnidadNueva {
    serie?: string | null
    mac?: string | null
}

export interface UnidadNormalizada {
    serie: string | null
    mac: string | null
}

export function normalizarSerie(valor?: string | null): string | null {
    const serie = (valor ?? '').trim().toUpperCase()
    return serie === '' ? null : serie
}

/** MAC en `AA:BB:CC:DD:EE:FF`, o null si no parece una MAC. */
export function normalizarMac(valor?: string | null): string | null {
    const limpia = (valor ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
    if (limpia.length !== 12) return null
    return limpia.match(/.{2}/g)!.join(':')
}

/**
 * Valida unidades nuevas: serie o MAC (al menos una), MAC bien formada y ninguna repetida en la
 * petición ni entre las unidades vivas de la empresa (422 `serie_duplicada`). Toma el lock de cada
 * serie y MAC para que dos altas simultáneas no pasen las dos.
 */
export async function validarUnidadesNuevas(
    t: Transaccion,
    empresaId: number,
    unidades: UnidadNueva[],
    campo: string,
): Promise<UnidadNormalizada[]> {
    const errores: ErrorCampo[] = []
    const vistas = new Set<string>()
    const salida: UnidadNormalizada[] = []
    for (const [i, unidad] of unidades.entries()) {
        const serie = normalizarSerie(unidad.serie)
        const macTexto = (unidad.mac ?? '').trim()
        const mac = macTexto ? normalizarMac(macTexto) : null
        if (macTexto && !mac) {
            errores.push({ field: `${campo}.${i}.mac`, message: `MAC inválida: ${macTexto}`, rule: 'mac' })
            continue
        }
        if (!serie && !mac) {
            errores.push({
                field: `${campo}.${i}`,
                message: 'Cada unidad lleva serie o MAC',
                rule: 'required',
            })
            continue
        }
        for (const [tipo, valor] of [
            ['serie', serie],
            ['mac', mac],
        ] as const) {
            if (!valor) continue
            const clave = `${tipo}:${valor}`
            if (vistas.has(clave)) {
                errores.push({
                    field: `${campo}.${i}.${tipo}`,
                    message: `La ${tipo} ${valor} está repetida en la petición`,
                    rule: 'serie_duplicada',
                })
            }
            vistas.add(clave)
        }
        salida.push({ serie, mac })
    }
    if (errores.length === 0) {
        for (const clave of [...vistas].sort()) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [
                LOCK_SERIES,
                `${empresaId}:${clave}`,
            ])
        }
        const series = salida.map((u) => u.serie).filter((v): v is string => v !== null)
        const macs = salida.map((u) => u.mac).filter((v): v is string => v !== null)
        const existentes = (await t.trx
            .from('inventario.unidades')
            .where('empresa_id', empresaId)
            .whereNotIn('estado', ['anulada', 'devuelta_proveedor'])
            .where((q) => {
                // la serie se guarda normalizada (mayúsculas)
                if (series.length > 0) q.orWhereIn('serie', series)
                if (macs.length > 0) q.orWhereIn('mac', macs)
            })
            .select('id', 'serie', 'mac')) as Array<{ id: number; serie: string | null; mac: string | null }>
        for (const existente of existentes) {
            const i = salida.findIndex(
                (u) =>
                    (u.serie !== null && u.serie === existente.serie) ||
                    (u.mac !== null && u.mac === existente.mac),
            )
            errores.push({
                field: `${campo}.${i}`,
                message: `La empresa ya tiene la unidad ${existente.id} con ${existente.serie ? `serie ${existente.serie}` : `MAC ${existente.mac}`}`,
                rule: 'serie_duplicada',
            })
        }
    }
    if (errores.length > 0) {
        throw new Problema(
            422,
            'serie_duplicada',
            'Serie o MAC inválida o repetida',
            errores.map((e) => e.message).join('; '),
            errores,
        )
    }
    return salida
}

/** Reparte un costo total entre `n` unidades a centavos; el residuo va en la última. */
export function repartirCosto(total: Dec, n: number): Dec[] {
    const parte = redondear(total.div(n))
    const costos = Array.from({ length: n }, () => parte)
    costos[n - 1] = total.minus(parte.times(n - 1))
    return costos
}

export interface UnidadFila {
    id: number
    empresa_id: number
    producto_id: number
    serie: string | null
    mac: string | null
    estado: EstadoUnidad
    condicion: Condicion
    bodega_id: number | null
    costo: string
    servicio_id: number | null
    activo_id: number | null
    compra_id: number | null
    version: number
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizarFila(f: UnidadFila): UnidadFila {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        producto_id: Number(f.producto_id),
        bodega_id: n(f.bodega_id),
        servicio_id: n(f.servicio_id),
        activo_id: n(f.activo_id),
        compra_id: n(f.compra_id),
        version: Number(f.version),
    }
}

/** Inserta unidades `disponible` en una bodega; devuelve sus filas. */
export async function crearUnidades(
    t: Transaccion,
    datos: {
        empresaId: number
        productoId: number
        bodegaId: number
        unidades: UnidadNormalizada[]
        costos: Dec[]
        condicion?: Condicion
        compraId?: number | null
    },
): Promise<UnidadFila[]> {
    if (datos.unidades.length === 0) return []
    const filas = (await t.trx
        .insertQuery()
        .table('inventario.unidades')
        .multiInsert(
            datos.unidades.map((u, i) => ({
                empresa_id: datos.empresaId,
                producto_id: datos.productoId,
                serie: u.serie,
                mac: u.mac,
                estado: 'disponible',
                condicion: datos.condicion ?? 'nuevo',
                bodega_id: datos.bodegaId,
                costo: aTexto(datos.costos[i] ?? CERO),
                compra_id: datos.compraId ?? null,
            })),
        )
        .returning('*')) as UnidadFila[]
    return filas.map(normalizarFila)
}

/**
 * Unidades que salen de una bodega (traslado, baja, ajuste, devolución al proveedor, comodato): las
 * bloquea (FOR UPDATE) y exige que sean del producto, estén en la bodega y en un estado que lo
 * permita.
 */
export async function unidadesDeBodega(
    t: Transaccion,
    ids: number[],
    datos: {
        empresaId: number
        productoId?: number
        bodegaId?: number
        estados?: readonly EstadoUnidad[]
        campo?: string
    },
): Promise<UnidadFila[]> {
    const campo = datos.campo ?? 'unidad_ids'
    if (ids.length === 0) {
        throw new ValidacionFallida([
            { field: campo, message: 'Indica al menos una unidad', rule: 'required' },
        ])
    }
    if (new Set(ids).size !== ids.length) {
        throw new ValidacionFallida([{ field: campo, message: 'Una unidad está repetida', rule: 'distinta' }])
    }
    const filas = (
        (await t.trx
            .from('inventario.unidades')
            .whereIn(
                'id',
                [...ids].sort((a, b) => a - b),
            )
            .where('empresa_id', datos.empresaId)
            .orderBy('id')
            .forUpdate()
            .select('*')) as UnidadFila[]
    ).map(normalizarFila)
    const estados = datos.estados ?? EN_BODEGA
    for (const id of ids) {
        const unidad = filas.find((f) => f.id === id)
        if (!unidad) throw new NoEncontrado(`La unidad ${id} no existe`)
        const nombre = unidad.serie ?? unidad.mac
        if (datos.productoId !== undefined && unidad.producto_id !== datos.productoId) {
            throw new ValidacionFallida([
                { field: campo, message: `La unidad ${nombre} es de otro producto`, rule: 'otro_producto' },
            ])
        }
        if (!estados.includes(unidad.estado)) {
            if (unidad.estado === 'en_comodato' || unidad.estado === 'por_recuperar') {
                throw new Conflicto(
                    `La unidad ${nombre} está en comodato en el servicio ${unidad.servicio_id}: devuélvela o declárala perdida antes`,
                    'unidad_en_comodato',
                    'Unidad en comodato',
                )
            }
            throw new Conflicto(
                `La unidad ${nombre} está ${unidad.estado.replaceAll('_', ' ')}`,
                'unidad_no_disponible',
                'Unidad no disponible',
            )
        }
        if (datos.bodegaId !== undefined && unidad.bodega_id !== datos.bodegaId) {
            throw new Conflicto(
                `La unidad ${nombre} está en la bodega ${unidad.bodega_id}, no en la ${datos.bodegaId}`,
                'unidad_en_otra_bodega',
                'Unidad en otra bodega',
            )
        }
    }
    return ids.map((id) => filas.find((f) => f.id === id)!)
}

/** Cambia una unidad (con `version + 1`); la llama solo una acción que deja su movimiento. */
export async function actualizarUnidad(
    t: Transaccion,
    id: number,
    cambios: Partial<
        Pick<UnidadFila, 'estado' | 'condicion' | 'bodega_id' | 'costo' | 'servicio_id' | 'activo_id'>
    >,
): Promise<void> {
    await t.trx
        .from('inventario.unidades')
        .where('id', id)
        .update({
            ...cambios,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
}

/** Fecha del último movimiento de la unidad (una salida con fecha pasada no queda antes). */
export async function ultimaFechaDeUnidad(t: Transaccion, unidadId: number): Promise<string | null> {
    const fila = (await t.trx
        .from('inventario.movimientos')
        .where('unidad_id', unidadId)
        .select(t.trx.raw(`to_char(max(fecha), 'YYYY-MM-DD') as fecha`))
        .first()) as { fecha: string | null } | null
    return fila?.fecha ?? null
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface UnidadVista extends UnidadFila {
    producto_sku: string
    producto_nombre: string
    bodega_nombre: string | null
    cliente_id: number | null
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('inventario.unidades as u')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .leftJoin('inventario.bodegas as b', 'b.id', 'u.bodega_id')
        .leftJoin('core.servicios as s', 's.id', 'u.servicio_id')
        .select(
            'u.id',
            'u.empresa_id',
            'u.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'u.serie',
            'u.mac',
            'u.estado',
            'u.condicion',
            'u.bodega_id',
            'b.nombre as bodega_nombre',
            cliente.raw('u.costo::text as costo'),
            'u.servicio_id',
            's.cliente_id',
            'u.activo_id',
            'u.compra_id',
            'u.version',
            'u.created_at',
            'u.updated_at',
        )
}

function normalizarVista(f: UnidadVista): UnidadVista {
    return { ...f, ...normalizarFila(f), cliente_id: n(f.cliente_id) }
}

export async function verUnidad(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consulta(cliente).where('u.id', id).first()) as UnidadVista | null
    if (!fila) throw new NoEncontrado(`La unidad ${id} no existe`)
    return normalizarVista(fila)
}

export async function empresaDeUnidad(id: number): Promise<{ empresa_id: number; bodega_id: number | null }> {
    const fila = await db
        .from('inventario.unidades')
        .where('id', id)
        .select('empresa_id', 'bodega_id')
        .first()
    if (!fila) throw new NoEncontrado(`La unidad ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id), bodega_id: n(fila.bodega_id) }
}

export interface FiltrosUnidades extends OpcionesPaginacion {
    estado?: EstadoUnidad
    producto_id?: number
    bodega_id?: number
    servicio_id?: number
    q?: string
}

/**
 * Unidades con filtros; `q` busca por serie (contiene) o MAC (con o sin separadores). Las que están
 * en una bodega siguen las reglas de visibilidad de su bodega; las de un servicio, no.
 */
export async function listarUnidades(
    filtros: FiltrosUnidades,
    empresas: number[] | null,
    acceso?: AccesoBodegas,
) {
    const q = consulta(db.connection())
        .if(filtros.estado, (c) => c.where('u.estado', filtros.estado!))
        .if(filtros.producto_id, (c) => c.where('u.producto_id', filtros.producto_id!))
        .if(filtros.bodega_id, (c) => c.where('u.bodega_id', filtros.bodega_id!))
        .if(filtros.servicio_id, (c) => c.where('u.servicio_id', filtros.servicio_id!))
        .if(filtros.q, (c) => {
            const mac = normalizarMac(filtros.q)
            c.where((w) => {
                w.whereILike('u.serie', `%${filtros.q!.trim()}%`)
                if (mac) w.orWhere('u.mac', mac)
                else w.orWhereILike('u.mac', `%${filtros.q!.trim()}%`)
            })
        })
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('u.empresa_id', ids))
    if (acceso) {
        q.where((w) => {
            w.whereNull('u.bodega_id').orWhereExists((sub) => {
                sub.from('inventario.bodegas as b').whereRaw('b.id = u.bodega_id')
                filtrarBodegasVisibles(sub as never, acceso, 'b')
            })
        })
    }
    const pagina = await paginar<UnidadVista>(q, filtros, { columna: 'u.id' })
    return { data: pagina.data.map(normalizarVista), nextCursor: pagina.nextCursor }
}

/** La unidad con su historial (sus movimientos del kardex, en orden). */
export async function historialUnidad(id: number) {
    const unidad = await verUnidad(id)
    const filas = (await db
        .from('inventario.movimientos as m')
        .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
        .where('m.unidad_id', id)
        .orderBy('m.id')
        .select(
            'm.id',
            'm.tipo',
            db.raw(`to_char(m.fecha, 'YYYY-MM-DD') as fecha`),
            'm.bodega_id',
            'b.nombre as bodega_nombre',
            db.raw('m.cantidad::text as cantidad'),
            db.raw('m.costo_total::text as costo_total'),
            'm.servicio_id',
            'm.asiento_id',
            'm.origen_tipo',
            'm.origen_id',
            'm.motivo',
            'm.created_at',
        )) as Array<Partial<MovimientoVista>>
    return {
        ...unidad,
        historial: filas.map((f) => ({
            ...f,
            id: Number(f.id),
            bodega_id: Number(f.bodega_id),
            servicio_id: n(f.servicio_id),
            asiento_id: n(f.asiento_id),
            origen_id: n(f.origen_id),
        })),
    }
}

/** Σ costo de las unidades en bodega de un producto (para revisar el saldo de serie). */
export async function valorUnidadesEnBodega(
    t: Transaccion,
    productoId: number,
    bodegaId: number,
): Promise<Dec> {
    const fila = (await t.trx
        .from('inventario.unidades')
        .where({ producto_id: productoId, bodega_id: bodegaId })
        .whereIn('estado', EN_BODEGA as string[])
        .select(t.trx.raw('coalesce(sum(costo), 0)::text as valor'))
        .first()) as { valor: string }
    return dec(fila.valor)
}
