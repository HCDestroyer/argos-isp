import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, permite, permisosDeUsuario, type Alcance } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { AJUSTES_FABRICA } from '#ledger/custodia'

/**
 * Cajas y turnos: lectura y la caja de un cajero. Las acciones (`abrirCaja`, `cerrarCaja`) están
 * en `actions/`. Alcance ACL por caja: un cajero con rol acotado a su caja solo la ve y la opera.
 */

export const FORMATOS_IMPRESION = ['pos_80', 'carta'] as const
export type FormatoImpresion = (typeof FORMATOS_IMPRESION)[number]

export interface CajaVista {
    id: number
    /** empresa (NIT) de la caja: sus cobros y su cierre van al libro de esa empresa */
    empresa_id: number
    nombre: string
    cajero_id: number | null
    cajero_nombre: string | null
    cuenta_id: number
    activa: boolean
    turno_abierto_id: number | null
    turno_abierto_por: number | null
    turno_abierto_por_nombre: string | null
    /** decisión del PM 20: formato del recibo (`pos_80` de fábrica) y de la factura (`carta`) */
    formato_recibo: FormatoImpresion
    formato_factura: FormatoImpresion
    /**
     * B1 (§5.7): `cobros` (turno, cierre y entrega) o `gastos` (caja chica, B9: fondo fijo, sin turnos;
     * su `cajero_id` es su encargado)
     */
    tipo: 'cobros' | 'gastos'
    /** fondo fijo propio; null = el fondo de cambio de la empresa */
    fondo_fijo: string | null
    /** fondo con el que abre (cobros) o su fondo fijo (caja chica): el propio o el de la empresa */
    fondo_fijo_efectivo: string
    /** B11: false = caja sin factura (recibo no fiscal, cuentas internas) */
    fiscal: boolean
    /** B11: quiénes ven y usan la caja; vacío = todos los que la alcanzan por el ACL */
    usuarios: number[]
    /** B11: aviso de una caja sin factura en una empresa con FEL obligatoria (o null) */
    aviso_sin_factura: string | null
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
    denominaciones: Array<{ valor: string; cantidad: number }> | null
    fondo_siguiente: string | null
    entregado_a: number | null
    entregado_a_nombre: string | null
    entregado_monto: string | null
    /** B1: lo que debía haber al abrir (lo que quedó del turno anterior o el fondo fijo) */
    fondo_esperado: string | null
    /** B1: la entrega vigente del turno (por recibir o recibida), o null */
    entrega_id: number | null
    entrega_estado: 'por_recibir' | 'recibida' | null
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
    't.denominaciones',
    't.fondo_siguiente',
    't.entregado_a',
    db.raw('(select u.nombre from core.usuarios u where u.id = t.entregado_a) as entregado_a_nombre'),
    't.entregado_monto',
    't.fondo_esperado',
    db.raw(
        `(SELECT e.id FROM ledger.entregas e WHERE e.turno_id = t.id AND NOT EXISTS (SELECT 1 FROM ledger.entregas_recepciones r WHERE r.entrega_id = e.id AND r.resultado = 'rechazada') ORDER BY e.id DESC LIMIT 1) AS entrega_id`,
    ),
    db.raw(
        `(SELECT CASE WHEN r.id IS NULL THEN 'por_recibir' ELSE 'recibida' END FROM ledger.entregas e LEFT JOIN ledger.entregas_recepciones r ON r.entrega_id = e.id WHERE e.turno_id = t.id AND (r.id IS NULL OR r.resultado = 'recibida') ORDER BY e.id DESC LIMIT 1) AS entrega_estado`,
    ),
    't.version',
    't.created_at',
    't.updated_at',
]

/** `GET /cajas`: cajas con su turno abierto, filtradas por el alcance de caja y por empresa. */
export async function listarCajas(
    alcance?: Alcance,
    empresas: number[] | null = null,
    cliente: QueryClientContract = db.connection(),
    usuarioId: number | null = null,
): Promise<CajaVista[]> {
    const consulta = cliente
        .from('ledger.cajas as c')
        .leftJoin('ledger.cajas_turnos as t', (j) => j.on('t.caja_id', 'c.id').andOnNull('t.cerrado_en'))
        .select(
            'c.id',
            'c.empresa_id',
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
            'c.formato_recibo',
            'c.formato_factura',
            'c.tipo',
            'c.fondo_fijo',
            db.raw(
                `coalesce(c.fondo_fijo, CASE WHEN c.tipo = 'gastos'
                    THEN coalesce((SELECT a.fondo_caja_chica FROM ledger.cajas_ajustes a WHERE a.empresa_id = c.empresa_id), ${AJUSTES_FABRICA.fondo_caja_chica})
                    ELSE coalesce((SELECT a.fondo_cobros FROM ledger.cajas_ajustes a WHERE a.empresa_id = c.empresa_id), ${AJUSTES_FABRICA.fondo_cobros}) END)::text AS fondo_fijo_efectivo`,
            ),
            'c.fiscal',
            db.raw(
                "(SELECT coalesce(array_agg(cu.usuario_id ORDER BY cu.usuario_id), '{}') FROM ledger.cajas_usuarios cu WHERE cu.caja_id = c.id) AS usuarios",
            ),
            db.raw(
                `CASE WHEN NOT c.fiscal AND (SELECT fc.modo FROM fiscal.fel_configuracion fc WHERE fc.empresa_id = c.empresa_id) = 'obligatoria'
                      THEN ? END AS aviso_sin_factura`,
                [AVISO_SIN_FACTURA],
            ),
            'c.version',
            'c.created_at',
            'c.updated_at',
        )
        .orderBy([
            { column: 'c.empresa_id', order: 'asc' },
            { column: 'c.nombre', order: 'asc' },
        ])
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('c.id', ids) })
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('c.empresa_id', ids))
    if (usuarioId !== null && !(await veTodasLasCajas(usuarioId))) {
        consulta.whereRaw(SQL_VISIBLE, [usuarioId, usuarioId])
    }
    const filas = (await consulta) as CajaVista[]
    return filas.map((f) => ({ ...f, usuarios: (f.usuarios ?? []).map(Number) }))
}

/** B11: texto del aviso de una caja sin factura con FEL obligatoria (decisión del PM del 25 nov). */
export const AVISO_SIN_FACTURA =
    'La empresa tiene FEL obligatoria y esta caja es sin factura: sus cobros emiten un recibo no fiscal, no van a la SAT y su ingreso va a la cuenta interna'

/**
 * B11 (visibilidad por usuario): con `contabilidad.ver_cuentas_internas` se ven todas las cajas; sin
 * él, una caja con lista de usuarios solo la ven y usan los de la lista (y su cajero). Sin lista,
 * como siempre (alcance ACL). No esconde nada a una auditoría: todo sigue en el libro y la bitácora.
 */
export async function veTodasLasCajas(usuarioId: number): Promise<boolean> {
    const permisos = await permisosDeUsuario(usuarioId)
    return permisos.includes('contabilidad.ver_cuentas_internas')
}

const SQL_VISIBLE = `(NOT EXISTS (SELECT 1 FROM ledger.cajas_usuarios v WHERE v.caja_id = c.id)
    OR c.cajero_id = ? OR EXISTS (SELECT 1 FROM ledger.cajas_usuarios v WHERE v.caja_id = c.id AND v.usuario_id = ?))`

/** 404 si la caja tiene lista de usuarios y el usuario no está (ni puede ver todas). */
export async function exigirCajaVisible(cajaId: number, usuarioId: number | null) {
    if (usuarioId === null || (await veTodasLasCajas(usuarioId))) return
    const { rows } = (await db.rawQuery(`SELECT 1 FROM ledger.cajas c WHERE c.id = ? AND ${SQL_VISIBLE}`, [
        cajaId,
        usuarioId,
        usuarioId,
    ])) as { rows: unknown[] }
    if (rows.length === 0) throw new NoEncontrado(`La caja ${cajaId} no existe`)
}

/** Usuarios de la lista de visibilidad de la caja (vacía = todos los del ACL). */
export async function usuariosDeCaja(cliente: QueryClientContract, cajaId: number): Promise<number[]> {
    const filas = (await cliente
        .from('ledger.cajas_usuarios')
        .where('caja_id', cajaId)
        .orderBy('usuario_id')
        .select('usuario_id')) as Array<{ usuario_id: number }>
    return filas.map((f) => Number(f.usuario_id))
}

/** 404 si la caja no existe; devuelve sus dimensiones (alcance por caja y empresa). */
export async function existeCaja(id: number): Promise<{ caja: number[]; empresa_id: number }> {
    const fila = await db.from('ledger.cajas').where('id', id).select('id', 'empresa_id').first()
    if (!fila) throw new NoEncontrado(`La caja ${id} no existe`)
    return { caja: [id], empresa_id: Number(fila.empresa_id) }
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
 * Multiempresa: con `empresaId`, solo cajas de esa empresa (un cajero abre una caja por empresa).
 */
export async function cajaDelCajero(
    usuarioId: number | null,
    alcance?: Alcance,
    cliente: QueryClientContract = db.connection(),
    empresaId: number | null = null,
): Promise<number | null> {
    if (!usuarioId) return null
    const filas = (await cliente
        .from('ledger.cajas_turnos as t')
        .join('ledger.cajas as c', 'c.id', 't.caja_id')
        .whereNull('t.cerrado_en')
        .where('c.activa', true)
        .if(empresaId !== null, (q) => q.where('c.empresa_id', empresaId!))
        .where((q) => q.where('t.abierto_por', usuarioId).orWhere('c.cajero_id', usuarioId))
        .orderByRaw('(t.abierto_por = ?) DESC NULLS LAST, t.abierto_en DESC', [usuarioId])
        .select('c.id')) as Array<{ id: number }>
    const propia = filas.find((f) => permite(alcance, { caja: [f.id] }))
    return propia?.id ?? null
}
