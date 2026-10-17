import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'

/**
 * Cadena de hash de los asientos (contrato de localización fiscal §10.10).
 *
 * `hash = SHA-256(hash_anterior ‖ json)`, con `json` canónico **v1**: claves ordenadas, sin
 * espacios; `empresa_id`, `asiento_id`, `fecha` (YYYY-MM-DD), `diario` y `numero` (§10.7),
 * `origen_tipo`, `origen_id`, `descripcion`, `reversa_de` y los movimientos en orden de id con
 * `cuenta_codigo`, `debe` y `haber` como texto con 2 decimales, `cliente_id`, `proveedor_id`,
 * `impuesto_codigo` y `cuadricula`. El primer `hash_anterior` de cada empresa son 64 ceros.
 *
 * El sello es correlativo por empresa y sigue el orden de sellado (`SellarAsientos`, cron cada
 * minuto con lock), no el de los ids: un asiento que confirma tarde recibe el siguiente sello.
 *
 * `proveedor_id` aún no existe en `ledger.movimientos` (fase 4, compras): v1 lo lleva en null.
 * Cuando llegue la columna, las filas existentes siguen en null y su hash no cambia.
 */

export const VERSION_SELLO = 'v1'
export const HASH_INICIAL = '0'.repeat(64)

/** Espacio de advisory locks de la cadena (por empresa). */
export const LOCK_SELLOS = 3006

export interface MovimientoCanonico {
    cuenta_codigo: string
    debe: string
    haber: string
    cliente_id: number | null
    proveedor_id: number | null
    impuesto_codigo: string | null
    cuadricula: string | null
}

export interface AsientoCanonico {
    empresa_id: number
    asiento_id: number
    fecha: string
    diario: string | null
    numero: number | null
    origen_tipo: string
    origen_id: number | null
    descripcion: string
    reversa_de: number | null
    movimientos: MovimientoCanonico[]
}

/** JSON con claves ordenadas en todos los niveles, sin espacios. */
export function jsonCanonico(valor: unknown): string {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null)
    if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`
    const objeto = valor as Record<string, unknown>
    const claves = Object.keys(objeto).sort()
    return `{${claves.map((c) => `${JSON.stringify(c)}:${jsonCanonico(objeto[c])}`).join(',')}}`
}

export function calcularHash(hashAnterior: string, asiento: AsientoCanonico): string {
    return createHash('sha256')
        .update(hashAnterior + jsonCanonico(asiento))
        .digest('hex')
}

const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Lee los asientos (por id) en su forma canónica v1, en el orden de `ids`. */
export async function asientosCanonicos(
    cliente: QueryClientContract,
    ids: number[],
): Promise<Map<number, AsientoCanonico>> {
    const salida = new Map<number, AsientoCanonico>()
    if (ids.length === 0) return salida
    const { rows: asientos } = (await cliente.rawQuery(
        `SELECT a.id, a.empresa_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, d.codigo AS diario, n.numero,
                a.origen_tipo, a.origen_id, a.descripcion, a.reversa_de
           FROM ledger.asientos a
           LEFT JOIN ledger.asientos_numeros n ON n.asiento_id = a.id
           LEFT JOIN ledger.diarios d ON d.id = n.diario_id
          WHERE a.id = ANY(?::bigint[])`,
        [ids],
    )) as { rows: Array<Record<string, unknown>> }
    for (const a of asientos) {
        salida.set(Number(a.id), {
            empresa_id: Number(a.empresa_id),
            asiento_id: Number(a.id),
            fecha: String(a.fecha),
            diario: (a.diario as string | null) ?? null,
            numero: nulo(a.numero),
            origen_tipo: String(a.origen_tipo),
            origen_id: nulo(a.origen_id),
            descripcion: String(a.descripcion),
            reversa_de: nulo(a.reversa_de),
            movimientos: [],
        })
    }
    const { rows: movimientos } = (await cliente.rawQuery(
        `SELECT m.asiento_id, c.codigo AS cuenta_codigo, m.debe::text AS debe, m.haber::text AS haber,
                m.cliente_id, NULL::bigint AS proveedor_id, m.impuesto_codigo, m.cuadricula
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE m.asiento_id = ANY(?::bigint[])
          ORDER BY m.asiento_id, m.id`,
        [ids],
    )) as { rows: Array<Record<string, unknown>> }
    for (const m of movimientos) {
        salida.get(Number(m.asiento_id))?.movimientos.push({
            cuenta_codigo: String(m.cuenta_codigo),
            debe: String(m.debe),
            haber: String(m.haber),
            cliente_id: nulo(m.cliente_id),
            proveedor_id: nulo(m.proveedor_id),
            impuesto_codigo: (m.impuesto_codigo as string | null) ?? null,
            cuadricula: (m.cuadricula as string | null) ?? null,
        })
    }
    return salida
}

export interface SelloFila {
    asiento_id: number
    empresa_id: number
    sello: number
    version: string
    hash_anterior: string
    hash: string
}

/** Último sello de la empresa (o null si la cadena está vacía). */
export async function ultimoSello(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<SelloFila | null> {
    const fila = (await cliente
        .from('ledger.asientos_sellos')
        .where('empresa_id', empresaId)
        .orderBy('sello', 'desc')
        .first()) as SelloFila | null
    return fila ? normalizarSello(fila) : null
}

function normalizarSello(f: SelloFila): SelloFila {
    return {
        asiento_id: Number(f.asiento_id),
        empresa_id: Number(f.empresa_id),
        sello: Number(f.sello),
        version: f.version,
        hash_anterior: String(f.hash_anterior),
        hash: String(f.hash),
    }
}

/** Empresas con asientos sin sellar (confirmados, vistos desde `cliente`) y cuántos. */
export async function pendientesDeSellar(
    cliente: QueryClientContract = db.connection(),
    empresaId?: number | null,
): Promise<Array<{ empresa_id: number; pendientes: number }>> {
    const { rows } = (await cliente.rawQuery(
        `SELECT a.empresa_id, count(*)::int AS pendientes
           FROM ledger.asientos a
          WHERE NOT EXISTS (SELECT 1 FROM ledger.asientos_sellos s WHERE s.asiento_id = a.id)
            ${empresaId ? 'AND a.empresa_id = ?' : ''}
          GROUP BY a.empresa_id ORDER BY a.empresa_id`,
        empresaId ? [empresaId] : [],
    )) as { rows: Array<{ empresa_id: number; pendientes: number }> }
    return rows.map((r) => ({ empresa_id: Number(r.empresa_id), pendientes: Number(r.pendientes) }))
}

/**
 * Sella hasta `limite` asientos sin sello de la empresa, en orden de id, encadenando con el último
 * sello. El que llama ya tiene el lock de la cadena de la empresa (`LOCK_SELLOS`). Devuelve los
 * sellos insertados.
 */
export async function sellarPendientes(
    cliente: QueryClientContract,
    empresaId: number,
    limite: number,
): Promise<SelloFila[]> {
    const { rows } = (await cliente.rawQuery(
        `SELECT a.id FROM ledger.asientos a
          WHERE a.empresa_id = ?
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos_sellos s WHERE s.asiento_id = a.id)
          ORDER BY a.id LIMIT ?`,
        [empresaId, limite],
    )) as { rows: Array<{ id: number }> }
    if (rows.length === 0) return []
    const ids = rows.map((r) => Number(r.id))
    const canonicos = await asientosCanonicos(cliente, ids)
    const ultimo = await ultimoSello(cliente, empresaId)
    let anterior = ultimo?.hash ?? HASH_INICIAL
    let sello = ultimo?.sello ?? 0
    const nuevos: SelloFila[] = []
    for (const id of ids) {
        const asiento = canonicos.get(id)!
        sello += 1
        const hash = calcularHash(anterior, asiento)
        nuevos.push({
            asiento_id: id,
            empresa_id: empresaId,
            sello,
            version: VERSION_SELLO,
            hash_anterior: anterior,
            hash,
        })
        anterior = hash
    }
    // en orden: el trigger exige que cada fila encadene con la anterior
    for (let i = 0; i < nuevos.length; i += 200) {
        await cliente
            .insertQuery()
            .table('ledger.asientos_sellos')
            .multiInsert(nuevos.slice(i, i + 200))
    }
    return nuevos
}

export type MotivoRuptura =
    'hash_distinto' | 'encadenamiento' | 'sello_faltante' | 'asiento_inexistente' | 'cierre_distinto'

export interface RupturaCadena {
    sello: number
    asiento_id: number | null
    motivo: MotivoRuptura
    esperado: string
    obtenido: string
}

export interface IntegridadEmpresa {
    empresa_id: number
    version: string
    verificado: boolean
    /** sellos de toda la cadena de la empresa */
    sellos: number
    /** sellos cuyo hash se recalculó (los asientos con fecha en el rango) */
    verificados: number
    /** asientos con fecha en el rango que aún no tienen sello */
    sin_sellar: number
    primer_sello: number | null
    ultimo_sello: number | null
    primer_hash: string | null
    ultimo_hash: string | null
    ruptura: RupturaCadena | null
}

export interface RangoIntegridad {
    desde?: string | null
    hasta?: string | null
}

const LOTE_VERIFICACION = 1000

/**
 * Recalcula la cadena de la empresa desde el sello 1. Todo el encadenamiento (correlativo y
 * `hash_anterior`) se revisa siempre; el hash se recalcula de los asientos con fecha en el rango
 * (sin rango, todos). También compara el último hash guardado en cada cierre mensual. Devuelve la
 * primera ruptura.
 */
export async function verificarCadena(
    empresaId: number,
    rango: RangoIntegridad = {},
    cliente: QueryClientContract = db.connection(),
): Promise<IntegridadEmpresa> {
    const desde = rango.desde ?? null
    const hasta = rango.hasta ?? null
    const salida: IntegridadEmpresa = {
        empresa_id: empresaId,
        version: VERSION_SELLO,
        verificado: true,
        sellos: 0,
        verificados: 0,
        sin_sellar: 0,
        primer_sello: null,
        ultimo_sello: null,
        primer_hash: null,
        ultimo_hash: null,
        ruptura: null,
    }
    const romper = (r: RupturaCadena) => {
        if (!salida.ruptura) {
            salida.ruptura = r
            salida.verificado = false
        }
    }

    let anterior = HASH_INICIAL
    let selloEsperado = 1
    let desdeSello = 0
    const hashPorSello = new Map<number, string>()
    for (;;) {
        const { rows } = (await cliente.rawQuery(
            `SELECT s.asiento_id, s.empresa_id, s.sello, s.version, s.hash_anterior, s.hash,
                    to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.id AS existe
               FROM ledger.asientos_sellos s
               LEFT JOIN ledger.asientos a ON a.id = s.asiento_id
              WHERE s.empresa_id = ? AND s.sello > ?
              ORDER BY s.sello LIMIT ?`,
            [empresaId, desdeSello, LOTE_VERIFICACION],
        )) as { rows: Array<SelloFila & { fecha: string | null; existe: number | null }> }
        if (rows.length === 0) break
        const enRango = rows.filter(
            (r) => r.fecha !== null && (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta),
        )
        const canonicos = await asientosCanonicos(
            cliente,
            enRango.map((r) => Number(r.asiento_id)),
        )
        for (const crudo of rows) {
            const s = normalizarSello(crudo)
            salida.sellos += 1
            if (s.sello !== selloEsperado) {
                romper({
                    sello: selloEsperado,
                    asiento_id: null,
                    motivo: 'sello_faltante',
                    esperado: String(selloEsperado),
                    obtenido: String(s.sello),
                })
            } else if (s.hash_anterior !== anterior) {
                romper({
                    sello: s.sello,
                    asiento_id: s.asiento_id,
                    motivo: 'encadenamiento',
                    esperado: anterior,
                    obtenido: s.hash_anterior,
                })
            }
            if (crudo.existe === null) {
                romper({
                    sello: s.sello,
                    asiento_id: s.asiento_id,
                    motivo: 'asiento_inexistente',
                    esperado: s.hash,
                    obtenido: '',
                })
            } else {
                const canonico = canonicos.get(s.asiento_id)
                if (canonico) {
                    salida.verificados += 1
                    const recalculado = calcularHash(s.hash_anterior, canonico)
                    if (recalculado !== s.hash) {
                        romper({
                            sello: s.sello,
                            asiento_id: s.asiento_id,
                            motivo: 'hash_distinto',
                            esperado: s.hash,
                            obtenido: recalculado,
                        })
                    }
                    if (salida.primer_sello === null) {
                        salida.primer_sello = s.sello
                        salida.primer_hash = s.hash
                    }
                    salida.ultimo_sello = s.sello
                    salida.ultimo_hash = s.hash
                }
            }
            hashPorSello.set(s.sello, s.hash)
            anterior = s.hash
            selloEsperado = s.sello + 1
            desdeSello = s.sello
        }
        if (rows.length < LOTE_VERIFICACION) break
    }
    if (!desde && !hasta && salida.sellos > 0 && salida.primer_sello === null) {
        // todos los asientos desaparecieron: el primer y el último hash son los de la cadena
        salida.primer_sello = 1
        salida.ultimo_sello = selloEsperado - 1
    }

    // el último hash guardado al cerrar cada mes debe seguir en la cadena
    const { rows: cierres } = (await cliente.rawQuery(
        `SELECT ultimo_sello, ultimo_hash FROM ledger.cierres_mensuales
          WHERE empresa_id = ? AND ultimo_sello IS NOT NULL ORDER BY id`,
        [empresaId],
    )) as { rows: Array<{ ultimo_sello: number; ultimo_hash: string }> }
    for (const c of cierres) {
        const enCadena = hashPorSello.get(Number(c.ultimo_sello))
        if (enCadena !== String(c.ultimo_hash)) {
            romper({
                sello: Number(c.ultimo_sello),
                asiento_id: null,
                motivo: 'cierre_distinto',
                esperado: String(c.ultimo_hash),
                obtenido: enCadena ?? '',
            })
        }
    }

    const { rows: sinSello } = (await cliente.rawQuery(
        `SELECT count(*)::int AS n FROM ledger.asientos a
          WHERE a.empresa_id = ?
            ${desde ? 'AND a.fecha >= ?::date' : ''} ${hasta ? 'AND a.fecha <= ?::date' : ''}
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos_sellos s WHERE s.asiento_id = a.id)`,
        [empresaId, ...(desde ? [desde] : []), ...(hasta ? [hasta] : [])],
    )) as { rows: Array<{ n: number }> }
    salida.sin_sellar = Number(sinSello[0]?.n ?? 0)
    return salida
}

/** Integridad de varias empresas (`GET /libro/integridad`). */
export async function integridadLibro(
    rango: RangoIntegridad,
    empresas: number[] | null,
): Promise<{ data: IntegridadEmpresa[] }> {
    const ids =
        empresas ??
        ((await db.from('core.empresas').orderBy('id').select('id')) as Array<{ id: number }>).map((e) =>
            Number(e.id),
        )
    const data: IntegridadEmpresa[] = []
    for (const id of ids) data.push(await verificarCadena(id, rango))
    return { data }
}

/**
 * Emite `libro.integridad_rota` dentro de la acción, una sola vez por (empresa, sello): si el
 * outbox ya tiene el aviso de ese sello, no lo repite (el sellador corre cada minuto).
 */
export async function avisarRuptura(
    t: Transaccion,
    empresaId: number,
    ruptura: RupturaCadena,
): Promise<boolean> {
    const { rows } = (await t.trx.rawQuery(
        `SELECT 1 FROM audit.outbox
          WHERE evento = 'libro.integridad_rota'
            AND (payload->>'empresa_id')::bigint = ? AND (payload->>'sello')::int = ?
          LIMIT 1`,
        [empresaId, ruptura.sello],
    )) as { rows: unknown[] }
    if (rows.length > 0) return false
    await t.emit('libro.integridad_rota', {
        empresa_id: empresaId,
        sello: ruptura.sello,
        asiento_id: ruptura.asiento_id,
        esperado: ruptura.esperado,
        obtenido: ruptura.obtenido,
    })
    return true
}
