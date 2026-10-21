import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { RawQueryBindings } from '@adonisjs/lucid/types/querybuilder'
import { Problema, ValidacionFallida } from '#shared/errores'
import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'

/**
 * Bloqueos del libro por tipo y sus excepciones (contrato de localización fiscal §9.2 y §10.4).
 *
 * - `ledger.bloqueos`: solo inserción; el vigente de cada tipo es la última fila. `hasta` null =
 *   sin bloqueo de ese tipo. El duro solo avanza; ningún otro queda antes del duro; el de
 *   impuestos no retrocede (trigger `ledger.validar_bloqueo`).
 * - Qué impide una fecha lo decide `ledger.bloqueo_de` (la misma función que los triggers):
 *   `duro`, `cerrado` (mes cerrado), `global`, `ventas` (diario de ventas), `compras` (diario de
 *   compras, o compras y pagos a proveedores), `impuestos` (asiento con una cuenta de
 *   `ledger.cuentas_con_impuesto` o con etiqueta de impuesto).
 * - Excepciones: por tipo (nunca `duro`), para un usuario o para todos, con fin obligatorio.
 *   Cubren solo su tipo; el asiento que entra por una guarda `excepcion_id`.
 */

export const TIPOS_BLOQUEO = ['global', 'ventas', 'compras', 'impuestos', 'duro'] as const
export type TipoBloqueo = (typeof TIPOS_BLOQUEO)[number]
/** Tipos que admiten excepción (todos menos el duro). */
export const TIPOS_EXCEPCION = ['global', 'ventas', 'compras', 'impuestos'] as const
export type TipoExcepcion = (typeof TIPOS_EXCEPCION)[number]
/** Lo que puede impedir una fecha: un bloqueo o el mes cerrado. */
export type Impedimento = TipoBloqueo | 'cerrado'

/** Serializa los cambios de bloqueo de una empresa (mismo lock que el trigger `validar_bloqueo`). */
export async function bloquearBloqueos(trx: TransactionClientContract, empresaId: number): Promise<void> {
    await trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('ledger.bloqueos'), ?::integer)`, [empresaId])
}

/** Motivo obligatorio (≥ 3 caracteres). */
export function motivoObligatorio(motivo: string | undefined | null): string {
    const texto = motivo?.trim()
    if (!texto || texto.length < 3) {
        throw new ValidacionFallida([
            { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
        ])
    }
    return texto
}

/**
 * Inserta la fila del bloqueo (el trigger escribe `anterior` y vuelve a validar el orden) y
 * emite `libro.bloqueo_cambiado`.
 */
export async function guardarBloqueo(
    t: Transaccion,
    datos: {
        empresaId: number
        tipo: TipoBloqueo
        hasta: string | null
        motivo: string
        confirmacion?: string
    },
): Promise<BloqueoVista> {
    const [fila] = (await t.trx
        .insertQuery()
        .table('ledger.bloqueos')
        .insert({
            empresa_id: datos.empresaId,
            tipo: datos.tipo,
            hasta: datos.hasta,
            motivo: datos.motivo,
            confirmacion: datos.confirmacion ?? null,
            creado_por: usuarioDelActor(t.ctx.actor),
        })
        .returning('id')) as Array<{ id: number }>
    const bloqueo = await verBloqueo(Number(fila!.id), t.trx)
    t.fijarEntidad('bloqueo', bloqueo.id)
    await t.emit('libro.bloqueo_cambiado', {
        empresa_id: datos.empresaId,
        tipo: datos.tipo,
        hasta: bloqueo.hasta,
        anterior: bloqueo.anterior,
    })
    return bloqueo
}

/**
 * Fecha bajo un bloqueo: 422 `periodo_bloqueado` (`errors[0].rule` = el tipo) o 409
 * `bloqueo_duro`. El mes cerrado sigue siendo 422 `periodo_cerrado` (lo lanza quien lo detecta).
 */
export class PeriodoBloqueado extends Problema {
    constructor(
        readonly tipoBloqueo: TipoBloqueo,
        readonly fecha: string,
        readonly hasta: string | null,
        readonly empresaId: number,
    ) {
        const duro = tipoBloqueo === 'duro'
        const detalle = duro
            ? `La fecha ${fecha} está bajo el bloqueo duro${hasta ? ` (hasta ${hasta})` : ''}: no se registra ni se reabre nada`
            : `La fecha ${fecha} está bajo el bloqueo ${tipoBloqueo}${hasta ? ` (hasta ${hasta})` : ''}`
        super(
            duro ? 409 : 422,
            duro ? 'bloqueo_duro' : 'periodo_bloqueado',
            duro ? 'Bloqueo duro' : 'Periodo bloqueado',
            detalle,
            [{ field: 'fecha', message: detalle, rule: tipoBloqueo }],
        )
    }
}

export interface ConsultaBloqueo {
    fecha: string
    empresaId: number
    diarioId?: number | null
    origen?: string | null
    conImpuesto?: boolean
    usuarioId?: number | null
    excepcionId?: number | null
}

/** Bindings con null (knex los acepta; el tipo de Lucid no). */
function parametros(c: ConsultaBloqueo): RawQueryBindings {
    return [
        c.fecha,
        c.empresaId,
        c.diarioId ?? null,
        c.origen ?? null,
        c.conImpuesto ?? false,
        c.usuarioId ?? null,
        c.excepcionId ?? null,
    ] as unknown as RawQueryBindings
}

/** Qué impide registrar un asiento con esa fecha (`ledger.bloqueo_de`), o null. */
export async function bloqueoDe(
    cliente: QueryClientContract,
    c: ConsultaBloqueo,
): Promise<Impedimento | null> {
    const { rows } = (await cliente.rawQuery(
        'SELECT ledger.bloqueo_de(?::date, ?, ?, ?, ?, ?, ?) AS tipo',
        parametros(c),
    )) as { rows: Array<{ tipo: Impedimento | null }> }
    return rows[0]?.tipo ?? null
}

/**
 * Lo que impide la fecha después de aplicar la excepción vigente del usuario (o para todos) del
 * tipo que la bloquea, si hay una: `{ tipo: null, excepcionId }` = entra por esa excepción.
 */
export async function impedimentoConExcepcion(
    cliente: QueryClientContract,
    c: Omit<ConsultaBloqueo, 'excepcionId'>,
): Promise<{ tipo: Impedimento | null; excepcionId: number | null }> {
    let tipo = await bloqueoDe(cliente, c)
    let excepcionId: number | null = null
    if (tipo !== null && tipo !== 'cerrado' && tipo !== 'duro') {
        excepcionId = await excepcionAplicable(cliente, c.empresaId, tipo, c.usuarioId ?? null)
        if (excepcionId !== null) tipo = await bloqueoDe(cliente, { ...c, excepcionId })
    }
    return { tipo, excepcionId: tipo === null ? excepcionId : null }
}

/** Primer día en que el asiento automático no queda bloqueado (sin excepciones). */
export async function primerDiaAbierto(
    cliente: QueryClientContract,
    c: Omit<ConsultaBloqueo, 'usuarioId' | 'excepcionId'>,
): Promise<string> {
    const { rows } = (await cliente.rawQuery(
        `SELECT to_char(ledger.primer_dia_abierto(?::date, ?, ?, ?, ?), 'YYYY-MM-DD') AS fecha`,
        [
            c.fecha,
            c.empresaId,
            c.diarioId ?? null,
            c.origen ?? null,
            c.conImpuesto ?? false,
        ] as unknown as RawQueryBindings,
    )) as { rows: Array<{ fecha: string }> }
    return rows[0]!.fecha
}

/** ¿Alguna de estas cuentas pone el asiento bajo el bloqueo de impuestos? (`ledger.cuentas_con_impuesto`) */
export async function cuentasTocanImpuesto(
    cliente: QueryClientContract,
    cuentas: number[],
): Promise<boolean> {
    if (cuentas.length === 0) return false
    const { rows } = (await cliente.rawQuery('SELECT ledger.cuentas_tocan_impuesto(?::bigint[]) AS si', [
        cuentas,
    ])) as { rows: Array<{ si: boolean }> }
    return Boolean(rows[0]?.si)
}

/** `hasta` vigente de un tipo (YYYY-MM-DD o null). */
export async function bloqueoVigente(
    cliente: QueryClientContract,
    empresaId: number,
    tipo: TipoBloqueo,
): Promise<string | null> {
    const { rows } = (await cliente.rawQuery(
        `SELECT to_char(ledger.bloqueo_vigente(?, ?), 'YYYY-MM-DD') AS hasta`,
        [empresaId, tipo],
    )) as { rows: Array<{ hasta: string | null }> }
    return rows[0]?.hasta ?? null
}

/**
 * Excepción vigente del tipo que cubre al usuario (la suya o una para todos), la que termina más
 * tarde; null si no hay.
 */
export async function excepcionAplicable(
    cliente: QueryClientContract,
    empresaId: number,
    tipo: TipoExcepcion,
    usuarioId: number | null,
): Promise<number | null> {
    const fila = (await cliente
        .from('ledger.bloqueos_excepciones as e')
        .where('e.empresa_id', empresaId)
        .where('e.tipo', tipo)
        .whereRaw('e.hasta_en > now()')
        .where((q) => {
            q.whereNull('e.usuario_id')
            if (usuarioId !== null) q.orWhere('e.usuario_id', usuarioId)
        })
        .whereNotExists((q) =>
            q.from('ledger.bloqueos_excepciones_revocaciones as r').whereRaw('r.excepcion_id = e.id'),
        )
        .orderBy('e.hasta_en', 'desc')
        .orderBy('e.id', 'desc')
        .select('e.id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/*
|--------------------------------------------------------------------------
| Lectura (GET /libro/bloqueos, /libro/bloqueos/excepciones)
|--------------------------------------------------------------------------
*/

export interface BloqueoVista {
    id: number
    empresa_id: number
    tipo: TipoBloqueo
    hasta: string | null
    anterior: string | null
    motivo: string
    creado_por: number | null
    creado_por_nombre: string | null
    created_at: Date
}

export interface BloqueosEmpresa {
    empresa_id: number
    /** `hasta` vigente de cada tipo (null = sin bloqueo) */
    vigentes: Record<TipoBloqueo, string | null>
    /** última fila de cada tipo que tiene alguna */
    ultimos: BloqueoVista[]
}

function consultaBloqueos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.bloqueos as b')
        .leftJoin('core.usuarios as u', 'u.id', 'b.creado_por')
        .select(
            'b.id',
            'b.empresa_id',
            'b.tipo',
            cliente.raw(`to_char(b.hasta, 'YYYY-MM-DD') as hasta`),
            cliente.raw(`to_char(b.anterior, 'YYYY-MM-DD') as anterior`),
            'b.motivo',
            'b.creado_por',
            'u.nombre as creado_por_nombre',
            'b.created_at',
        )
}

function normalizarBloqueo(f: BloqueoVista): BloqueoVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        creado_por: f.creado_por === null ? null : Number(f.creado_por),
    }
}

export async function verBloqueo(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaBloqueos(cliente).where('b.id', id).firstOrFail()) as BloqueoVista
    return normalizarBloqueo(fila)
}

/** Bloqueos vigentes de cada empresa. */
export async function bloqueosVigentes(empresas: number[]): Promise<BloqueosEmpresa[]> {
    const conexion = db.connection()
    const ultimos = (
        (await consultaBloqueos(conexion)
            .whereIn('b.empresa_id', empresas.length > 0 ? empresas : [0])
            .whereRaw(
                'b.id = (select max(x.id) from ledger.bloqueos x where x.empresa_id = b.empresa_id and x.tipo = b.tipo)',
            )
            .orderBy('b.empresa_id')
            .orderBy('b.tipo')) as BloqueoVista[]
    ).map(normalizarBloqueo)
    return empresas.map((empresaId) => {
        const propios = ultimos.filter((b) => b.empresa_id === empresaId)
        const vigentes = Object.fromEntries(
            TIPOS_BLOQUEO.map((tipo) => [tipo, propios.find((b) => b.tipo === tipo)?.hasta ?? null]),
        ) as Record<TipoBloqueo, string | null>
        return { empresa_id: empresaId, vigentes, ultimos: propios }
    })
}

/** Historia de bloqueos, el más reciente primero. */
export function listarBloqueos(
    filtros: OpcionesPaginacion & { tipo?: TipoBloqueo },
    empresas: number[] | null,
) {
    const consulta = consultaBloqueos(db.connection()).if(filtros.tipo, (q) =>
        q.where('b.tipo', filtros.tipo!),
    )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('b.empresa_id', ids))
    return paginar<BloqueoVista>(consulta, filtros, { columna: 'b.id' }).then((p) => ({
        ...p,
        data: p.data.map(normalizarBloqueo),
    }))
}

export type EstadoExcepcion = 'vigente' | 'vencida' | 'revocada'

export interface ExcepcionVista {
    id: number
    empresa_id: number
    tipo: TipoExcepcion
    usuario_id: number | null
    usuario_nombre: string | null
    motivo: string
    hasta_en: Date
    estado: EstadoExcepcion
    creada_por: number | null
    creada_por_nombre: string | null
    created_at: Date
    revocada_en: Date | null
    revocada_por: number | null
    motivo_revocacion: string | null
    /** asientos que entraron por esta excepción */
    asientos: number
}

function consultaExcepciones(cliente: QueryClientContract) {
    return cliente
        .from('ledger.bloqueos_excepciones as e')
        .leftJoin('ledger.bloqueos_excepciones_revocaciones as r', 'r.excepcion_id', 'e.id')
        .leftJoin('core.usuarios as u', 'u.id', 'e.usuario_id')
        .leftJoin('core.usuarios as c', 'c.id', 'e.creada_por')
        .select(
            'e.id',
            'e.empresa_id',
            'e.tipo',
            'e.usuario_id',
            'u.nombre as usuario_nombre',
            'e.motivo',
            'e.hasta_en',
            cliente.raw(
                `case when r.id is not null then 'revocada' when e.hasta_en <= now() then 'vencida' else 'vigente' end as estado`,
            ),
            'e.creada_por',
            'c.nombre as creada_por_nombre',
            'e.created_at',
            'r.created_at as revocada_en',
            'r.revocada_por',
            'r.motivo as motivo_revocacion',
            cliente.raw(
                '(select count(*)::int from ledger.asientos a where a.excepcion_id = e.id) as asientos',
            ),
        )
}

function normalizarExcepcion(f: ExcepcionVista): ExcepcionVista {
    const n = (v: number | null) => (v === null ? null : Number(v))
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        usuario_id: n(f.usuario_id),
        creada_por: n(f.creada_por),
        revocada_por: n(f.revocada_por),
    }
}

export async function verExcepcion(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaExcepciones(cliente).where('e.id', id).first()) as ExcepcionVista | null
    return fila ? normalizarExcepcion(fila) : null
}

export function listarExcepciones(
    filtros: OpcionesPaginacion & { estado?: EstadoExcepcion; tipo?: TipoExcepcion },
    empresas: number[] | null,
) {
    const consulta = consultaExcepciones(db.connection())
        .if(filtros.tipo, (q) => q.where('e.tipo', filtros.tipo!))
        .if(filtros.estado === 'revocada', (q) => q.whereNotNull('r.id'))
        .if(filtros.estado === 'vencida', (q) => q.whereNull('r.id').whereRaw('e.hasta_en <= now()'))
        .if(filtros.estado === 'vigente', (q) => q.whereNull('r.id').whereRaw('e.hasta_en > now()'))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('e.empresa_id', ids))
    return paginar<ExcepcionVista>(consulta, filtros, { columna: 'e.id' }).then((p) => ({
        ...p,
        data: p.data.map(normalizarExcepcion),
    }))
}
