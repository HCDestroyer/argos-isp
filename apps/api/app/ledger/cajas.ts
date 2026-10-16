import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, permite, type Alcance } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * Cajas y turnos: lectura y la caja de un cajero. Las acciones (`abrirCaja`, `cerrarCaja`) están
 * en `actions/`. Alcance ACL por caja: un cajero con rol acotado a su caja solo la ve y la opera.
 */

export interface CajaVista {
    id: number
    nombre: string
    cajero_id: number | null
    cajero_nombre: string | null
    cuenta_id: number
    activa: boolean
    turno_abierto_id: number | null
    turno_abierto_por: number | null
    turno_abierto_por_nombre: string | null
    version: number
    created_at: Date
    updated_at: Date
}

export interface TurnoVista {
    id: number
    caja_id: number
    abierto_en: Date
    fondo_inicial: string
    cerrado_en: Date | null
    esperado: string | null
    contado: string | null
    diferencia: string | null
    motivo: string | null
    abierto_por: number | null
    cerrado_por: number | null
    abierto_por_nombre: string | null
    cerrado_por_nombre: string | null
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS_TURNO = [
    't.id',
    't.caja_id',
    't.abierto_en',
    't.fondo_inicial',
    't.cerrado_en',
    't.esperado',
    't.contado',
    't.diferencia',
    't.motivo',
    't.abierto_por',
    't.cerrado_por',
    db.raw('(select u.nombre from core.usuarios u where u.id = t.abierto_por) as abierto_por_nombre'),
    db.raw('(select u.nombre from core.usuarios u where u.id = t.cerrado_por) as cerrado_por_nombre'),
    't.version',
    't.created_at',
    't.updated_at',
]

/** `GET /cajas`: cajas con su turno abierto, filtradas por el alcance de caja. */
export async function listarCajas(alcance?: Alcance): Promise<CajaVista[]> {
    const consulta = db
        .from('ledger.cajas as c')
        .leftJoin('ledger.cajas_turnos as t', (j) => j.on('t.caja_id', 'c.id').andOnNull('t.cerrado_en'))
        .select(
            'c.id',
            'c.nombre',
            'c.cajero_id',
            db.raw('(select u.nombre from core.usuarios u where u.id = c.cajero_id) as cajero_nombre'),
            'c.cuenta_id',
            'c.activa',
            't.id as turno_abierto_id',
            't.abierto_por as turno_abierto_por',
            db.raw(
                '(select u.nombre from core.usuarios u where u.id = t.abierto_por) as turno_abierto_por_nombre',
            ),
            'c.version',
            'c.created_at',
            'c.updated_at',
        )
        .orderBy('c.nombre', 'asc')
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('c.id', ids) })
    return (await consulta) as CajaVista[]
}

export async function existeCaja(id: number): Promise<void> {
    const fila = await db.from('ledger.cajas').where('id', id).select('id').first()
    if (!fila) throw new NoEncontrado(`La caja ${id} no existe`)
}

export async function verTurno(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('ledger.cajas_turnos as t')
        .where('t.id', id)
        .select(...COLUMNAS_TURNO)
        .first()) as TurnoVista | null
    if (!fila) throw new NoEncontrado(`El turno ${id} no existe`)
    return fila
}

/** `GET /cajas/:id/turnos`: el más reciente primero. */
export async function listarTurnos(cajaId: number, filtros: OpcionesPaginacion) {
    await existeCaja(cajaId)
    const consulta = db
        .from('ledger.cajas_turnos as t')
        .where('t.caja_id', cajaId)
        .select(...COLUMNAS_TURNO)
    return paginar<TurnoVista>(consulta, filtros, { columna: 't.id' })
}

/** Turno abierto de una caja, o null. */
export async function turnoAbiertoDe(
    cliente: QueryClientContract,
    cajaId: number,
): Promise<{ id: number } | null> {
    const fila = await cliente
        .from('ledger.cajas_turnos')
        .where('caja_id', cajaId)
        .whereNull('cerrado_en')
        .select('id')
        .first()
    return fila ? { id: fila.id as number } : null
}

/**
 * Caja del cajero para un pago en efectivo sin `caja_id`: la del turno abierto que abrió él (el
 * más reciente) o, si no, una caja asignada a él (`cajas.cajero_id`) con turno abierto. Solo
 * cajas activas y dentro de su alcance. null si no tiene ninguna (se usa la caja principal).
 */
export async function cajaDelCajero(
    usuarioId: number | null,
    alcance?: Alcance,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    if (!usuarioId) return null
    const filas = (await cliente
        .from('ledger.cajas_turnos as t')
        .join('ledger.cajas as c', 'c.id', 't.caja_id')
        .whereNull('t.cerrado_en')
        .where('c.activa', true)
        .where((q) => q.where('t.abierto_por', usuarioId).orWhere('c.cajero_id', usuarioId))
        .orderByRaw('(t.abierto_por = ?) DESC NULLS LAST, t.abierto_en DESC', [usuarioId])
        .select('c.id')) as Array<{ id: number }>
    const propia = filas.find((f) => permite(alcance, { caja: [f.id] }))
    return propia?.id ?? null
}
