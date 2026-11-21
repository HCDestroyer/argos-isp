import db from '@adonisjs/lucid/services/db'
import { historialUnidad, verUnidad } from '#inventario/unidades'

/**
 * Lecturas de una unidad para A48 (contrato Iris 0.12.0 §3.10):
 *
 * - **Panel** (`GET /inventario/unidades/:id`): la unidad con su kardex (`historial`), más
 *   `historial_estados` (cada cambio del estado del equipo), sus `garantias` (proveedor, RMA, vencimiento,
 *   resultado), los `intentos` de recuperación (actor, foto, ubicación) y los `contactos` registrados.
 * - **Iris** (M5, `inventario.ver_unidad`): serie, MAC, modelo, estado del equipo e historial de estados
 *   (fecha, de, a, motivo), **sin costos, proveedor ni RMA**; en el historial, `servicio_id` solo para el
 *   servicio actual de la unidad y para el de la orden en curso (`?servicio_id=`).
 */

async function historialEstados(unidadId: number) {
    return (await db
        .from('inventario.unidades_historial')
        .where('unidad_id', unidadId)
        .orderBy('id')
        .select(
            'id',
            'de',
            'a',
            'motivo',
            'servicio_id',
            'origen_externo_tipo',
            'origen_externo_id',
            'created_at',
        )) as Array<{
        id: number
        de: string | null
        a: string
        motivo: string | null
        servicio_id: number | null
        origen_externo_tipo: string | null
        origen_externo_id: string | null
        created_at: Date
    }>
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function detalleUnidad(unidadId: number) {
    const base = await historialUnidad(unidadId)
    const estados = await historialEstados(unidadId)
    const garantias = (await db
        .from('inventario.garantias as g')
        .leftJoin('ledger.proveedores as p', 'p.id', 'g.proveedor_id')
        .where('g.unidad_id', unidadId)
        .orderBy('g.id')
        .select(
            'g.id',
            'g.proveedor_id',
            db.raw('coalesce(p.nombre, g.proveedor_nombre) as proveedor_nombre'),
            'g.rma',
            db.raw(`to_char(g.vence_en, 'YYYY-MM-DD') as vence_en`),
            'g.enviada_en',
            'g.origen',
            'g.abierta_en',
            'g.resultado',
            'g.resuelta_en',
            'g.serie_anterior',
            'g.mac_anterior',
            'g.nota',
        )) as Array<Record<string, unknown>>
    const intentos = (await db
        .from('inventario.intentos_recuperacion as i')
        .leftJoin('core.usuarios as u', 'u.id', 'i.actor_tecnico_id')
        .where('i.unidad_id', unidadId)
        .orderBy('i.id')
        .select(
            'i.id',
            'i.servicio_id',
            'i.intento_n',
            'i.motivo',
            'i.foto_ref',
            db.raw('i.lat::text as lat'),
            db.raw('i.lng::text as lng'),
            db.raw('i.precision_m::text as precision_m'),
            'i.nota',
            'i.fecha',
            'i.actor_tecnico',
            'i.actor_tecnico_id',
            'u.nombre as actor_tecnico_nombre',
            'i.origen_externo_id',
            'i.created_at',
        )) as Array<Record<string, unknown>>
    const contactos = (await db
        .from('inventario.contactos_recuperacion as c')
        .leftJoin('core.usuarios as u', 'u.id', 'c.registrado_por')
        .where('c.unidad_id', unidadId)
        .orderBy('c.id')
        .select(
            'c.id',
            'c.servicio_id',
            'c.medio',
            'c.nota',
            'c.registrado_por',
            'u.nombre as registrado_por_nombre',
            'c.created_at',
        )) as Array<Record<string, unknown>>
    return {
        ...base,
        historial_estados: estados.map((e) => ({
            fecha: e.created_at,
            de: e.de,
            a: e.a,
            motivo: e.motivo,
            servicio_id: n(e.servicio_id),
            origen_externo_tipo: e.origen_externo_tipo,
            origen_externo_id: e.origen_externo_id,
        })),
        garantias: garantias.map((g) => ({ ...g, id: Number(g.id), proveedor_id: n(g.proveedor_id) })),
        intentos: intentos.map((i) => ({
            ...i,
            id: Number(i.id),
            servicio_id: Number(i.servicio_id),
            actor_tecnico_id: n(i.actor_tecnico_id),
        })),
        contactos: contactos.map((c) => ({
            ...c,
            id: Number(c.id),
            servicio_id: n(c.servicio_id),
            registrado_por: n(c.registrado_por),
        })),
    }
}

/** La vista de Iris (M5): sin costos, proveedor ni RMA. */
export async function unidadParaIris(unidadId: number, servicioOrden: number | null) {
    const unidad = await verUnidad(unidadId)
    const estados = await historialEstados(unidadId)
    const visibles = new Set([unidad.servicio_id, servicioOrden].filter((s): s is number => s !== null))
    return {
        id: unidad.id,
        empresa_id: unidad.empresa_id,
        producto_id: unidad.producto_id,
        modelo: unidad.producto_nombre,
        serie: unidad.serie,
        mac: unidad.mac,
        estado: unidad.estado_equipo,
        servicio_id: unidad.servicio_id,
        historial: estados.map((e) => {
            const servicio = n(e.servicio_id)
            return {
                fecha: e.created_at,
                de: e.de,
                a: e.a,
                motivo: e.motivo,
                servicio_id: servicio !== null && visibles.has(servicio) ? servicio : null,
            }
        }),
    }
}
