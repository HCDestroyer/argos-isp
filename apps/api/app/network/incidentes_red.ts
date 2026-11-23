import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { codificarCursor, decodificarCursor, paginar, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { dimensionesServicio } from '#core/consultas/servicios'
import type { PayloadFallaGeneral } from '#shared/eventos'

/**
 * Falla general de red (decisión del PM 31, contrato Iris 0.13.0): muchos servicios del mismo router,
 * OLT, puerto PON o zona caen a la vez. Se abre UN incidente por alcance (`network.incidentes_red`) con
 * sus servicios afectados (`network.incidentes_red_servicios`) para que Iris abra un solo ticket general.
 *
 * - **Alcances**: `router` (`servicios.router_id`), `zona` (`clientes.zona_id`), `pon` y `olt` (servidor
 *   PPPoE del servicio → VLAN → `olt_puertos_pon`).
 * - **Caído**: servicio `activo` o `limitado` sin sesión abierta cuya última sesión terminó dentro de la
 *   ventana (`falla_general.ventana_min`), por cualquier causa salvo `Admin-Reset` (el corte, la
 *   reactivación o el Disconnect de Argos). Cuentan `NAS-Reboot` y `sin_interim`: son justo lo que
 *   deja un router caído o reiniciado.
 * - **Umbral** (`falla_general.modo`): `porcentaje` de los servicios activos o limitados del alcance, o
 *   `cantidad`; siempre al menos `falla_general.minimo_servicios`.
 * - **Eventos**: uno por empresa afectada con el mismo `incidente_id` y solo los servicios de esa empresa
 *   (`ids` hasta 5000; el resto por `GET /incidentes-red/:id/servicios`). Nunca nombres ni direcciones.
 * - **Reapertura**: si el mismo alcance vuelve a caer después del cierre se abre un incidente NUEVO
 *   (otro `incidente_id`); Iris reusa su ticket si cae dentro de los 30 minutos siguientes al cierre.
 * - Mientras un servicio está en un incidente abierto (o en el alcance de uno), no se emite
 *   `servicio.caidas_repetidas` (no hay tickets por servicio).
 */

export const ALCANCES_INCIDENTE = ['router', 'olt', 'pon', 'zona'] as const
export type AlcanceIncidente = (typeof ALCANCES_INCIDENTE)[number]
export const MAX_IDS_EVENTO = 5000
/** Causas que no son caídas para la falla general (las provoca Argos). */
export const CAUSAS_NO_FALLA = ['Admin-Reset'] as const

/** Expresión SQL con el id del alcance de un servicio `s` (y su cliente `cl`). */
export function sqlAlcanceServicio(alcance: AlcanceIncidente, s = 's', cl = 'cl'): string {
    switch (alcance) {
        case 'router':
            return `${s}.router_id`
        case 'zona':
            return `${cl}.zona_id`
        case 'pon':
            return `(SELECT v.puerto_pon_id FROM network.servidores_pppoe sp
                       JOIN network.vlans v ON v.id = sp.vlan_id WHERE sp.id = ${s}.servidor_pppoe_id)`
        case 'olt':
            return `(SELECT pp.olt_id FROM network.servidores_pppoe sp
                       JOIN network.vlans v ON v.id = sp.vlan_id
                       JOIN network.olt_puertos_pon pp ON pp.id = v.puerto_pon_id
                      WHERE sp.id = ${s}.servidor_pppoe_id)`
    }
}

/**
 * ¿El servicio `s` (cliente `cl`) está en un incidente abierto o en el alcance de uno? Para no emitir
 * tickets por servicio mientras dura la falla general.
 */
export function sqlEnIncidenteAbierto(s = 's', cl = 'cl'): string {
    return `(EXISTS (SELECT 1 FROM network.incidentes_red_servicios irs
                       JOIN network.incidentes_red ir ON ir.id = irs.incidente_id
                      WHERE ir.estado = 'abierto' AND irs.servicio_id = ${s}.id)
             OR EXISTS (SELECT 1 FROM network.incidentes_red ir
                         WHERE ir.estado = 'abierto' AND (
                               (ir.alcance = 'router' AND ir.alcance_id = ${sqlAlcanceServicio('router', s, cl)})
                            OR (ir.alcance = 'zona' AND ir.alcance_id = ${sqlAlcanceServicio('zona', s, cl)})
                            OR (ir.alcance = 'pon' AND ir.alcance_id = ${sqlAlcanceServicio('pon', s, cl)})
                            OR (ir.alcance = 'olt' AND ir.alcance_id = ${sqlAlcanceServicio('olt', s, cl)}))))`
}

/** Servicios caídos ahora (ver arriba) con el id de cada alcance; sin los que ya están en un incidente abierto. */
export async function serviciosCaidos(
    cliente: QueryClientContract,
    ahora: Date,
    ventanaMin: number,
    opciones: { incluirEnIncidente?: boolean } = {},
): Promise<Array<{ servicio_id: number; empresa_id: number } & Record<AlcanceIncidente, number | null>>> {
    const desde = new Date(ahora.getTime() - ventanaMin * 60_000)
    const { rows } = (await cliente.rawQuery(
        `SELECT s.id AS servicio_id, s.empresa_id,
                ${sqlAlcanceServicio('router')} AS router, ${sqlAlcanceServicio('zona')} AS zona,
                ${sqlAlcanceServicio('pon')} AS pon, ${sqlAlcanceServicio('olt')} AS olt
           FROM core.servicios s
           JOIN core.clientes cl ON cl.id = s.cliente_id
          WHERE s.estado IN ('activo', 'limitado')
            AND EXISTS (SELECT 1 FROM network.sesiones se
                         WHERE se.servicio_id = s.id AND se.fin > ?::timestamptz AND se.fin <= ?::timestamptz
                           AND coalesce(se.causa_fin, 'Desconocida') <> ALL (?::text[]))
            AND NOT EXISTS (SELECT 1 FROM network.sesiones se WHERE se.servicio_id = s.id AND se.fin IS NULL)
            AND (?::boolean OR NOT EXISTS (
                    SELECT 1 FROM network.incidentes_red_servicios irs
                      JOIN network.incidentes_red ir ON ir.id = irs.incidente_id
                     WHERE ir.estado = 'abierto' AND irs.servicio_id = s.id))
          ORDER BY s.id`,
        [
            desde.toISOString(),
            ahora.toISOString(),
            [...CAUSAS_NO_FALLA],
            opciones.incluirEnIncidente ?? false,
        ],
    )) as { rows: Array<Record<string, unknown>> }
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return rows.map((r) => ({
        servicio_id: Number(r.servicio_id),
        empresa_id: Number(r.empresa_id),
        router: n(r.router),
        zona: n(r.zona),
        pon: n(r.pon),
        olt: n(r.olt),
    }))
}

/** Servicios activos o limitados del alcance (la base del porcentaje). */
export async function serviciosDelAlcance(
    cliente: QueryClientContract,
    alcance: AlcanceIncidente,
    alcanceId: number,
): Promise<Array<{ servicio_id: number; empresa_id: number }>> {
    const { rows } = (await cliente.rawQuery(
        `SELECT s.id AS servicio_id, s.empresa_id
           FROM core.servicios s JOIN core.clientes cl ON cl.id = s.cliente_id
          WHERE s.estado IN ('activo', 'limitado') AND ${sqlAlcanceServicio(alcance)} = ?
          ORDER BY s.id`,
        [alcanceId],
    )) as { rows: Array<{ servicio_id: number; empresa_id: number }> }
    return rows.map((r) => ({ servicio_id: Number(r.servicio_id), empresa_id: Number(r.empresa_id) }))
}

/** ¿El alcance existe? (router, zona, puerto PON u OLT) */
export async function alcanceExiste(
    cliente: QueryClientContract,
    alcance: AlcanceIncidente,
    alcanceId: number,
): Promise<boolean> {
    const tabla = {
        router: 'network.routers',
        zona: 'core.zonas',
        pon: 'network.olt_puertos_pon',
        olt: 'network.olts',
    }[alcance]
    return Boolean(await cliente.from(tabla).where('id', alcanceId).first())
}

/*
|--------------------------------------------------------------------------
| Escritura (dentro de las acciones)
|--------------------------------------------------------------------------
*/

interface FilaIncidente {
    id: number
    alcance: AlcanceIncidente
    alcance_id: number
    estado: 'abierto' | 'cerrado'
    origen: 'automatico' | 'manual'
    desde: Date
    hasta: Date | null
}

export async function bloquearIncidente(t: Transaccion, id: number): Promise<FilaIncidente> {
    const fila = (await t.trx
        .from('network.incidentes_red')
        .where('id', id)
        .forUpdate()
        .select('id', 'alcance', 'alcance_id', 'estado', 'origen', 'desde', 'hasta')
        .first()) as FilaIncidente | null
    if (!fila) throw new NoEncontrado(`El incidente ${id} no existe`)
    return { ...fila, id: Number(fila.id), alcance_id: Number(fila.alcance_id) }
}

/** Afectados por empresa (ordenados por id). */
async function afectadosPorEmpresa(t: Transaccion, incidenteId: number): Promise<Map<number, number[]>> {
    const filas = (await t.trx
        .from('network.incidentes_red_servicios')
        .where('incidente_id', incidenteId)
        .orderBy('empresa_id')
        .orderBy('servicio_id')
        .select('empresa_id', 'servicio_id')) as Array<{ empresa_id: number; servicio_id: number }>
    const mapa = new Map<number, number[]>()
    for (const f of filas) {
        const lista = mapa.get(Number(f.empresa_id)) ?? []
        lista.push(Number(f.servicio_id))
        mapa.set(Number(f.empresa_id), lista)
    }
    return mapa
}

/** Emite `red.falla_general_<fase>` una vez por empresa afectada, con el mismo `incidente_id`. */
export async function emitirPorEmpresa(
    t: Transaccion,
    incidente: FilaIncidente,
    fase: 'abierta' | 'cerrada',
): Promise<number[]> {
    const empresas: number[] = []
    for (const [empresaId, ids] of await afectadosPorEmpresa(t, incidente.id)) {
        const payload: PayloadFallaGeneral = {
            incidente_id: incidente.id,
            empresa_id: empresaId,
            alcance: incidente.alcance,
            alcance_id: incidente.alcance_id,
            servicios_afectados: { cantidad: ids.length, ids: ids.slice(0, MAX_IDS_EVENTO) },
            origen: incidente.origen,
            desde: new Date(incidente.desde).toISOString(),
            hasta: incidente.hasta ? new Date(incidente.hasta).toISOString() : null,
        }
        await t.emit(fase === 'abierta' ? 'red.falla_general_abierta' : 'red.falla_general_cerrada', payload)
        empresas.push(empresaId)
    }
    return empresas
}

/** Agrega servicios a un incidente (los que ya estaban se ignoran). Devuelve los nuevos. */
export async function agregarAfectados(
    t: Transaccion,
    incidenteId: number,
    servicios: Array<{ servicio_id: number; empresa_id: number }>,
): Promise<number[]> {
    if (servicios.length === 0) return []
    const { rows } = (await t.trx.rawQuery(
        `INSERT INTO network.incidentes_red_servicios (incidente_id, servicio_id, empresa_id)
         SELECT ?, q.s, q.e FROM unnest(?::bigint[], ?::bigint[]) AS q (s, e)
         ON CONFLICT DO NOTHING RETURNING servicio_id`,
        [incidenteId, servicios.map((s) => s.servicio_id), servicios.map((s) => s.empresa_id)],
    )) as { rows: Array<{ servicio_id: number }> }
    return rows.map((r) => Number(r.servicio_id))
}

/*
|--------------------------------------------------------------------------
| Lecturas
|--------------------------------------------------------------------------
*/

export interface IncidenteRedVista {
    id: number
    alcance: AlcanceIncidente
    alcance_id: number
    estado: 'abierto' | 'cerrado'
    origen: 'automatico' | 'manual'
    motivo: string | null
    abierto_por: number | null
    cerrado_por: number | null
    motivo_cierre: string | null
    desde: string
    hasta: string | null
    /** servicios activos o limitados del alcance al abrir */
    base: number
    /** afectados de las empresas visibles para quien consulta */
    servicios_afectados: number
    empresas: number[]
}

function vista(f: Record<string, unknown>): IncidenteRedVista {
    const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as Date).toISOString())
    return {
        id: Number(f.id),
        alcance: f.alcance as AlcanceIncidente,
        alcance_id: Number(f.alcance_id),
        estado: f.estado as 'abierto' | 'cerrado',
        origen: f.origen as 'automatico' | 'manual',
        motivo: (f.motivo as string | null) ?? null,
        abierto_por: f.abierto_por === null ? null : Number(f.abierto_por),
        cerrado_por: f.cerrado_por === null ? null : Number(f.cerrado_por),
        motivo_cierre: (f.motivo_cierre as string | null) ?? null,
        desde: iso(f.desde)!,
        hasta: iso(f.hasta),
        base: Number(f.base),
        servicios_afectados: Number(f.servicios_afectados),
        empresas: Array.isArray(f.empresas) ? (f.empresas as unknown[]).map(Number) : [],
    }
}

function consultaIncidentes(cliente: QueryClientContract, empresas: number[] | null) {
    const filtro = empresas === null ? 'TRUE' : 'irs.empresa_id = ANY (?::bigint[])'
    const valores = empresas === null ? [] : [empresas]
    return cliente
        .from('network.incidentes_red as i')
        .select(
            'i.id',
            'i.alcance',
            'i.alcance_id',
            'i.estado',
            'i.origen',
            'i.motivo',
            'i.abierto_por',
            'i.cerrado_por',
            'i.motivo_cierre',
            'i.desde',
            'i.hasta',
            'i.base',
            cliente.raw(
                `(SELECT count(*)::int FROM network.incidentes_red_servicios irs
                   WHERE irs.incidente_id = i.id AND ${filtro}) AS servicios_afectados`,
                valores,
            ),
            cliente.raw(
                `ARRAY(SELECT DISTINCT irs.empresa_id::int FROM network.incidentes_red_servicios irs
                        WHERE irs.incidente_id = i.id AND ${filtro} ORDER BY 1) AS empresas`,
                valores,
            ),
        )
        .whereRaw(
            `(i.origen = 'manual' AND NOT EXISTS (SELECT 1 FROM network.incidentes_red_servicios x WHERE x.incidente_id = i.id))
             OR EXISTS (SELECT 1 FROM network.incidentes_red_servicios irs WHERE irs.incidente_id = i.id AND ${filtro})`,
            valores,
        )
}

/** Incidente visible para esas empresas (404 si no lo es, contrato 0.13.0). */
export async function verIncidente(
    id: number,
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<IncidenteRedVista> {
    const fila = (await consultaIncidentes(cliente, empresas).where('i.id', id).first()) as Record<
        string,
        unknown
    > | null
    if (!fila) throw new NoEncontrado(`El incidente ${id} no existe`)
    return vista(fila)
}

export async function listarIncidentes(
    filtro: { empresas: number[] | null; estado?: 'abierto' | 'cerrado'; cursor?: string; limit: number },
    cliente: QueryClientContract = db.connection(),
): Promise<Pagina<IncidenteRedVista>> {
    const consulta = consultaIncidentes(cliente, filtro.empresas).orderBy('i.id', 'desc')
    if (filtro.estado) consulta.where('i.estado', filtro.estado)
    const desde = filtro.cursor ? Number(decodificarCursor(filtro.cursor)) : null
    if (desde) consulta.where('i.id', '<', desde)
    const filas = (await consulta.limit(filtro.limit + 1)) as Array<Record<string, unknown>>
    const data = filas.slice(0, filtro.limit).map(vista)
    return {
        data,
        nextCursor: filas.length > filtro.limit ? codificarCursor(data[data.length - 1]!.id) : null,
    }
}

/**
 * `GET /incidentes-red/:id/servicios` (contrato 0.13.0): solo ids de los servicios afectados de las
 * empresas visibles (o de `empresaId`), por cursor (`servicio_id`), `limit` hasta 1000.
 */
export async function paginaServiciosIncidente(
    id: number,
    filtro: { empresas: number[] | null; cursor?: string; limit: number },
    cliente: QueryClientContract = db.connection(),
): Promise<Pagina<number>> {
    await verIncidente(id, filtro.empresas, cliente)
    const consulta = cliente
        .from('network.incidentes_red_servicios')
        .where('incidente_id', id)
        .orderBy('servicio_id')
        .select('servicio_id')
        .limit(filtro.limit + 1)
    if (filtro.empresas !== null) consulta.whereIn('empresa_id', filtro.empresas)
    const desde = filtro.cursor ? Number(decodificarCursor(filtro.cursor)) : null
    if (desde) consulta.where('servicio_id', '>', desde)
    const filas = (await consulta) as Array<{ servicio_id: number }>
    const data = filas.slice(0, filtro.limit).map((f) => Number(f.servicio_id))
    return {
        data,
        nextCursor: filas.length > filtro.limit ? codificarCursor(data[data.length - 1]!) : null,
    }
}

export interface ServicioAfectadoVista {
    servicio_id: number
    codigo: string
    nombre: string | null
    estado: string
    empresa_id: number
    empresa_nombre: string
    cliente_id: number
    cliente_nombre: string
    plan_id: number | null
    plan_nombre: string | null
    router_id: number | null
    conectado: boolean
    conectado_desde: string | null
    desconectado_desde: string | null
}

/**
 * `GET /incidentes-red/:id/afectados` (tablero de fallas generales): los servicios afectados con código,
 * cliente, plan, empresa y si están conectados ahora, por cursor (`servicio_id` ascendente). Una sola
 * consulta por página (joins y dos `LATERAL` sobre los índices de `network.sesiones`), sin N+1.
 * Filtra por las empresas de la lista (empresa activa o `empresas=todas`) y por el alcance del usuario
 * (router o zona del servicio). 404 si el incidente no tiene servicios de esas empresas. `total` cuenta
 * con el mismo filtro que las filas (para «1–50 de 395»).
 */
export async function paginaAfectadosIncidente(
    id: number,
    filtro: { empresas: number[] | null; alcance?: Alcance; cursor?: string | null; limit?: number | null },
    cliente: QueryClientContract = db.connection(),
): Promise<Pagina<ServicioAfectadoVista> & { total: number }> {
    await verIncidente(id, filtro.empresas, cliente)
    const consulta = cliente
        .from('network.incidentes_red_servicios as irs')
        .join('core.servicios as s', 's.id', 'irs.servicio_id')
        .join('core.clientes as cl', 'cl.id', 's.cliente_id')
        .join('core.empresas as e', 'e.id', 'irs.empresa_id')
        .leftJoin('network.planes as pl', 'pl.id', 's.plan_id')
        .joinRaw(
            `LEFT JOIN LATERAL (SELECT se.inicio FROM network.sesiones se
                                 WHERE se.servicio_id = s.id AND se.fin IS NULL
                                 ORDER BY se.inicio DESC LIMIT 1) abierta ON TRUE`,
        )
        .joinRaw(
            `LEFT JOIN LATERAL (SELECT se.fin FROM network.sesiones se
                                 WHERE se.servicio_id = s.id AND se.fin IS NOT NULL
                                 ORDER BY se.inicio DESC LIMIT 1) ultima ON TRUE`,
        )
        .where('irs.incidente_id', id)
        .select(
            'irs.servicio_id',
            's.codigo',
            's.nombre',
            's.estado',
            'irs.empresa_id',
            'e.nombre_comercial as empresa_nombre',
            's.cliente_id',
            'cl.nombre as cliente_nombre',
            's.plan_id',
            'pl.nombre as plan_nombre',
            's.router_id',
            'abierta.inicio as conectado_desde',
            'ultima.fin as ultima_fin',
        )
    if (filtro.empresas !== null) consulta.whereIn('irs.empresa_id', filtro.empresas)
    filtrarPorAlcance(consulta, filtro.alcance, dimensionesServicio)
    // el total con el mismo filtro que las filas (empresas y alcance del usuario), sin el cursor
    const conteo = cliente
        .from('network.incidentes_red_servicios as irs')
        .join('core.servicios as s', 's.id', 'irs.servicio_id')
        .where('irs.incidente_id', id)
        .count('* as total')
    if (filtro.empresas !== null) conteo.whereIn('irs.empresa_id', filtro.empresas)
    filtrarPorAlcance(conteo, filtro.alcance, dimensionesServicio)
    const [pagina, filaTotal] = await Promise.all([
        paginar<Record<string, unknown>>(
            consulta,
            { cursor: filtro.cursor, limit: filtro.limit },
            { columna: 'irs.servicio_id', direccion: 'asc', clave: (f) => Number(f.servicio_id) },
        ),
        conteo.first() as Promise<{ total: string | number } | null>,
    ])
    const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as Date).toISOString())
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...pagina,
        total: Number(filaTotal?.total ?? 0),
        data: pagina.data.map((f) => {
            const conectado = f.conectado_desde !== null && f.conectado_desde !== undefined
            return {
                servicio_id: Number(f.servicio_id),
                codigo: String(f.codigo),
                nombre: (f.nombre as string | null) ?? null,
                estado: String(f.estado),
                empresa_id: Number(f.empresa_id),
                empresa_nombre: String(f.empresa_nombre),
                cliente_id: Number(f.cliente_id),
                cliente_nombre: String(f.cliente_nombre),
                plan_id: n(f.plan_id),
                plan_nombre: (f.plan_nombre as string | null) ?? null,
                router_id: n(f.router_id),
                conectado,
                conectado_desde: iso(f.conectado_desde),
                desconectado_desde: conectado ? null : iso(f.ultima_fin),
            }
        }),
    }
}
