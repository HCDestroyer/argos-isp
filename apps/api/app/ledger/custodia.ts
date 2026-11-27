import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { enesimoDiaHabil, feriadosVigentes } from '#fiscal/calendario'

/**
 * Cajas de cobros y custodia (B1 del plan de contabilidad, §5.7; decisiones del PM del 26 nov 2026).
 *
 * El efectivo de cobros recorre **caja de cobros → custodia → banco**:
 *
 * - **Entrega** (`ledger.entregas`): al cerrar el turno, lo contado menos lo que queda de fondo. Sin
 *   asiento mientras está «por recibir»: el efectivo sigue a nombre del cajero (cuenta de la caja).
 * - **Recepción** (`ledger.entregas_recepciones`): quien recibe dice «Recibí» con su usuario
 *   (asiento `1.1.15 Efectivo en custodia / Caja`; un faltante o sobrante queda a cargo de quien
 *   entregó) o «No lo recibí» (sin asiento; la entrega se puede rehacer).
 * - **Depósito** (`ledger.depositos` con `origen = custodia`): de la custodia de quien deposita al
 *   banco (`1.1.11 / 1.1.15`), sin turno abierto.
 *
 * Custodia de una persona en una empresa = Σ contado de lo que recibió − Σ lo que depositó desde su
 * custodia. Plazo (días hábiles) y tope por persona: `ledger.cajas_ajustes`; pasarse avisa, no bloquea.
 */

export const TIPOS_CAJA = ['cobros', 'gastos'] as const
export type TipoCaja = (typeof TIPOS_CAJA)[number]

/** Valores de fábrica (decisiones del PM N3, N4 y N9, 26 nov 2026). */
export const AJUSTES_FABRICA = {
    fondo_cobros: '200.00',
    custodia_plazo_dias: 1,
    custodia_tope: '5000.00',
    autoentrega: true,
    /** B9: fondo fijo de cada caja chica (sin tope por gasto) */
    fondo_caja_chica: '2000.00',
} as const

export interface AjustesCajas {
    empresa_id: number
    /** fondo de cambio de cada caja de cobros (salvo la que tenga su `fondo_fijo`) */
    fondo_cobros: string
    /** días hábiles para depositar lo recibido */
    custodia_plazo_dias: number
    /** efectivo máximo en custodia por persona */
    custodia_tope: string
    /** «lo deposito yo»: el cajero se entrega a sí mismo */
    autoentrega: boolean
    /** B9: fondo fijo de cada caja chica (salvo la que tenga su `fondo_fijo`) */
    fondo_caja_chica: string
    /** true si la empresa usa los valores de fábrica (no tiene fila) */
    de_fabrica: boolean
    version: number
    updated_at: Date | null
}

export async function ajustesCajas(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AjustesCajas> {
    const fila = (await cliente
        .from('ledger.cajas_ajustes')
        .where('empresa_id', empresaId)
        .select(
            'fondo_cobros',
            'custodia_plazo_dias',
            'custodia_tope',
            'autoentrega',
            'fondo_caja_chica',
            'version',
            'updated_at',
        )
        .first()) as {
        fondo_cobros: string
        custodia_plazo_dias: number
        custodia_tope: string
        autoentrega: boolean
        fondo_caja_chica: string
        version: number
        updated_at: Date
    } | null
    if (!fila) {
        return { empresa_id: empresaId, ...AJUSTES_FABRICA, de_fabrica: true, version: 0, updated_at: null }
    }
    return {
        empresa_id: empresaId,
        fondo_cobros: aTexto(fila.fondo_cobros),
        custodia_plazo_dias: Number(fila.custodia_plazo_dias),
        custodia_tope: aTexto(fila.custodia_tope),
        autoentrega: Boolean(fila.autoentrega),
        fondo_caja_chica: aTexto(fila.fondo_caja_chica),
        de_fabrica: false,
        version: Number(fila.version),
        updated_at: fila.updated_at,
    }
}

/** Fondo fijo de una caja: el suyo o el de cobros de la empresa. */
export async function fondoFijoDe(
    cliente: QueryClientContract,
    caja: { empresa_id: number; fondo_fijo: string | null },
): Promise<Dec> {
    if (caja.fondo_fijo !== null && caja.fondo_fijo !== undefined) return dec(caja.fondo_fijo)
    const ajustes = await ajustesCajas(Number(caja.empresa_id), cliente)
    return dec(ajustes.fondo_cobros)
}

/**
 * Fondo con el que debe abrir el turno siguiente de la caja: lo que quedó al cerrar el último
 * (`fondo_siguiente`, o todo lo contado si se cerró sin entrega) o, si nunca abrió, su fondo fijo.
 */
export async function fondoParaAbrir(
    cliente: QueryClientContract,
    caja: { id: number; empresa_id: number; fondo_fijo: string | null },
): Promise<Dec> {
    const ultimo = (await cliente
        .from('ledger.cajas_turnos')
        .where('caja_id', caja.id)
        .whereNotNull('cerrado_en')
        .orderBy('id', 'desc')
        .select('fondo_siguiente', 'contado')
        .first()) as { fondo_siguiente: string | null; contado: string | null } | null
    if (!ultimo) return fondoFijoDe(cliente, caja)
    return dec(ultimo.fondo_siguiente ?? ultimo.contado ?? '0')
}

/** Lock por (empresa, persona) para que dos depósitos no saquen la misma custodia. */
export async function bloquearCustodia(cliente: QueryClientContract, empresaId: number, usuarioId: number) {
    await cliente.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3101, empresaId * 100000 + usuarioId])
}

/**
 * Efectivo en custodia de una persona en la empresa: lo recibido menos lo depositado y, desde B9, lo
 * que salió de su custodia para reponer una caja chica.
 */
export async function saldoCustodia(
    cliente: QueryClientContract,
    empresaId: number,
    usuarioId: number,
): Promise<Dec> {
    const { rows } = (await cliente.rawQuery(
        `SELECT (SELECT coalesce(sum(r.contado), 0) FROM ledger.entregas_recepciones r
                  WHERE r.empresa_id = ? AND r.recibido_por = ? AND r.resultado = 'recibida')
              - (SELECT coalesce(sum(d.monto), 0) FROM ledger.depositos d
                  WHERE d.empresa_id = ? AND d.custodio_id = ? AND d.origen = 'custodia')
              - (SELECT coalesce(sum(p.monto), 0) FROM ledger.reposiciones p
                  WHERE p.empresa_id = ? AND p.custodio_id = ? AND p.origen = 'custodia') AS saldo`,
        [empresaId, usuarioId, empresaId, usuarioId, empresaId, usuarioId],
    )) as { rows: Array<{ saldo: string }> }
    return dec(rows[0]?.saldo ?? '0')
}

/*
|--------------------------------------------------------------------------
| Entregas
|--------------------------------------------------------------------------
*/

export type EstadoEntrega = 'por_recibir' | 'recibida' | 'rechazada'

export interface EntregaVista {
    id: number
    empresa_id: number
    caja_id: number
    caja_nombre: string
    turno_id: number
    monto: string
    entregado_por: number | null
    entregado_por_nombre: string | null
    recibe_id: number
    recibe_nombre: string | null
    autoentrega: boolean
    origen: 'cierre' | 'reentrega' | 'migracion'
    estado: EstadoEntrega
    recibido_por: number | null
    recibido_en: Date | null
    contado: string | null
    /** contado − monto, a cargo de quien entregó */
    diferencia: string | null
    motivo: string | null
    created_at: Date
}

function consultaEntregas(cliente: QueryClientContract) {
    return cliente
        .from('ledger.entregas as e')
        .join('ledger.cajas as c', 'c.id', 'e.caja_id')
        .leftJoin('ledger.entregas_recepciones as r', 'r.entrega_id', 'e.id')
        .select(
            'e.id',
            'e.empresa_id',
            'e.caja_id',
            'c.nombre as caja_nombre',
            'e.turno_id',
            'e.monto',
            'e.entregado_por',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = e.entregado_por) AS entregado_por_nombre',
            ),
            'e.recibe_id',
            cliente.raw('(SELECT u.nombre FROM core.usuarios u WHERE u.id = e.recibe_id) AS recibe_nombre'),
            'e.autoentrega',
            'e.origen',
            cliente.raw(
                `CASE WHEN r.id IS NULL THEN 'por_recibir' WHEN r.resultado = 'recibida' THEN 'recibida' ELSE 'rechazada' END AS estado`,
            ),
            'r.recibido_por',
            'r.created_at as recibido_en',
            'r.contado',
            'r.diferencia',
            'r.motivo',
            'e.created_at',
        )
}

function normalizarEntrega(f: EntregaVista): EntregaVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        caja_id: Number(f.caja_id),
        turno_id: Number(f.turno_id),
        entregado_por: f.entregado_por === null ? null : Number(f.entregado_por),
        recibe_id: Number(f.recibe_id),
        recibido_por: f.recibido_por === null ? null : Number(f.recibido_por),
    }
}

export async function verEntrega(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaEntregas(cliente).where('e.id', id).first()) as EntregaVista | null
    if (!fila) throw new NoEncontrado(`La entrega ${id} no existe`)
    return normalizarEntrega(fila)
}

/** Entrega vigente (no rechazada) del turno, o null. */
export async function entregaVigenteDelTurno(cliente: QueryClientContract, turnoId: number) {
    const fila = (await consultaEntregas(cliente)
        .where('e.turno_id', turnoId)
        .where((q) => q.whereNull('r.id').orWhere('r.resultado', 'recibida'))
        .orderBy('e.id', 'desc')
        .first()) as EntregaVista | null
    return fila ? normalizarEntrega(fila) : null
}

export interface FiltrosEntregas extends OpcionesPaginacion {
    estado?: EstadoEntrega
    caja_id?: number
    recibe_id?: number
}

/**
 * `GET /cajas/entregas`. Con `persona` (sin `cajas.ver_custodia`), solo las que entregó o debe
 * recibir esa persona.
 */
export async function listarEntregas(
    filtros: FiltrosEntregas,
    empresas: number[] | null,
    persona: number | null,
) {
    const consulta = consultaEntregas(db.connection())
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('e.empresa_id', ids))
    if (filtros.caja_id) consulta.where('e.caja_id', filtros.caja_id)
    if (filtros.recibe_id) consulta.where('e.recibe_id', filtros.recibe_id)
    if (filtros.estado === 'por_recibir') consulta.whereNull('r.id')
    if (filtros.estado === 'recibida') consulta.where('r.resultado', 'recibida')
    if (filtros.estado === 'rechazada') consulta.where('r.resultado', 'rechazada')
    if (persona !== null) {
        consulta.where((q) => q.where('e.recibe_id', persona).orWhere('e.entregado_por', persona))
    }
    const pagina = await paginar<EntregaVista>(consulta, filtros, { columna: 'e.id' })
    return { ...pagina, data: pagina.data.map(normalizarEntrega) }
}

/*
|--------------------------------------------------------------------------
| Custodia por persona
|--------------------------------------------------------------------------
*/

export interface CustodiaPersona {
    empresa_id: number
    usuario_id: number
    usuario_nombre: string | null
    /** efectivo a su nombre (recibido − depositado) */
    saldo: string
    /** fecha (Guatemala) de la recepción más vieja que aún no se deposita (FIFO) */
    desde: string | null
    /** último día hábil para depositar lo más viejo */
    vence: string | null
    fuera_de_plazo: boolean
    sobre_tope: boolean
    /** entregas que esta persona aún no confirma («por recibir») */
    por_recibir: { cantidad: number; monto: string }
}

export interface ResumenCustodia {
    empresa_id: number
    ajustes: AjustesCajas
    personas: CustodiaPersona[]
    /** total en custodia de la empresa (= saldo de 1.1.15) */
    total: string
    /** entregas sin «Recibí»: el efectivo sigue en las cajas de cobros del libro */
    por_recibir: { cantidad: number; monto: string }
}

/** Vence = n-ésimo día hábil después de `desde` (0 = el mismo día). */
export function venceCustodia(desde: string, plazo: number, feriados: ReadonlySet<string>): string {
    if (plazo <= 0) return desde
    const siguiente = DateTime.fromISO(desde, { zone: 'utc' }).plus({ days: 1 }).toISODate()!
    return enesimoDiaHabil(siguiente, plazo, feriados)
}

/**
 * Custodia de cada persona de la empresa (solo `persona` si se pide), con plazo y tope.
 * `hoy` = fecha de Guatemala del cálculo.
 */
export async function resumenCustodia(
    empresaId: number,
    persona: number | null = null,
    cliente: QueryClientContract = db.connection(),
    hoy: string = hoyGuatemala(),
): Promise<ResumenCustodia> {
    const ajustes = await ajustesCajas(empresaId, cliente)
    const recepciones = (await cliente
        .from('ledger.entregas_recepciones as r')
        .where('r.empresa_id', empresaId)
        .where('r.resultado', 'recibida')
        .if(persona !== null, (q) => q.where('r.recibido_por', persona!))
        .orderBy('r.id')
        .select(
            'r.recibido_por',
            'r.contado',
            cliente.raw(`to_char(r.fecha, 'YYYY-MM-DD') as fecha`),
        )) as Array<{
        recibido_por: number
        contado: string
        fecha: string
    }>
    // salidas de la custodia: depósitos al banco y, desde B9, reposiciones de una caja chica
    const { rows: depositos } = (await cliente.rawQuery(
        `SELECT s.custodio_id, sum(s.monto)::text AS total FROM (
             SELECT d.custodio_id, d.monto FROM ledger.depositos d
              WHERE d.empresa_id = ? AND d.origen = 'custodia'
             UNION ALL
             SELECT p.custodio_id, p.monto FROM ledger.reposiciones p
              WHERE p.empresa_id = ? AND p.origen = 'custodia') s
          WHERE (?::bigint = 0 OR s.custodio_id = ?::bigint)
          GROUP BY s.custodio_id`,
        [empresaId, empresaId, persona ?? 0, persona ?? 0],
    )) as { rows: Array<{ custodio_id: number; total: string }> }
    const pendientes = (await cliente
        .from('ledger.entregas as e')
        .where('e.empresa_id', empresaId)
        .whereNotExists((q) => q.from('ledger.entregas_recepciones as r').whereRaw('r.entrega_id = e.id'))
        .if(persona !== null, (q) => q.where('e.recibe_id', persona!))
        .groupBy('e.recibe_id')
        .select(
            'e.recibe_id',
            cliente.raw('count(*)::int as cantidad'),
            cliente.raw('sum(e.monto)::text as monto'),
        )) as Array<{
        recibe_id: number
        cantidad: number
        monto: string
    }>

    const ids = new Set<number>([
        ...recepciones.map((r) => Number(r.recibido_por)),
        ...depositos.map((d) => Number(d.custodio_id)),
        ...pendientes.map((p) => Number(p.recibe_id)),
    ])
    if (persona !== null) ids.add(persona)
    const nombres = new Map<number, string>()
    if (ids.size > 0) {
        const filas = (await cliente
            .from('core.usuarios')
            .whereIn('id', [...ids])
            .select('id', 'nombre')) as Array<{
            id: number
            nombre: string
        }>
        for (const f of filas) nombres.set(Number(f.id), f.nombre)
    }
    const feriados = await feriadosVigentes(cliente)
    const tope = dec(ajustes.custodia_tope)

    const personas: CustodiaPersona[] = []
    let total: Dec = CERO
    let pendienteCantidad = 0
    let pendienteMonto: Dec = CERO
    for (const id of [...ids].sort((a, b) => a - b)) {
        const propias = recepciones.filter((r) => Number(r.recibido_por) === id)
        const recibido = propias.reduce((s, r) => s.plus(r.contado), CERO)
        let depositado = dec(depositos.find((d) => Number(d.custodio_id) === id)?.total ?? '0')
        const saldo = recibido.minus(depositado)
        // FIFO: lo depositado cubre primero lo más viejo
        let desde: string | null = null
        if (saldo.gt(0)) {
            for (const r of propias) {
                const monto = dec(r.contado)
                if (depositado.gte(monto)) {
                    depositado = depositado.minus(monto)
                    continue
                }
                desde = r.fecha
                break
            }
        }
        const vence = desde ? venceCustodia(desde, ajustes.custodia_plazo_dias, feriados) : null
        const pend = pendientes.find((p) => Number(p.recibe_id) === id)
        pendienteCantidad += Number(pend?.cantidad ?? 0)
        pendienteMonto = pendienteMonto.plus(pend?.monto ?? '0')
        total = total.plus(saldo)
        personas.push({
            empresa_id: empresaId,
            usuario_id: id,
            usuario_nombre: nombres.get(id) ?? null,
            saldo: aTexto(saldo),
            desde,
            vence,
            fuera_de_plazo: vence !== null && hoy > vence,
            sobre_tope: saldo.gt(tope),
            por_recibir: { cantidad: Number(pend?.cantidad ?? 0), monto: aTexto(dec(pend?.monto ?? '0')) },
        })
    }
    return {
        empresa_id: empresaId,
        ajustes,
        personas,
        total: aTexto(total),
        por_recibir: { cantidad: pendienteCantidad, monto: aTexto(pendienteMonto) },
    }
}
