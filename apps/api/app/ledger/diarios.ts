import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'

/**
 * Diarios y numeración guardada del libro (contrato de localización fiscal §10.7).
 *
 * - `ledger.diarios` por empresa: `VEN` ventas, `COB` cobros, `COM` compras y egresos, `IMP`
 *   impuestos, `CIE` cierre, `VAR` varios, un `CAJ-<caja_id>` por caja y un `BAN-<cuenta_id>` por
 *   cuenta bancaria propia (`billing.cuentas_bancarias`). Se crean en la migración para lo que
 *   existe y, después, la primera vez que un asiento los necesita.
 * - Número de diario: `ledger.secuencias` (`diario_id`, `anio`, `ultimo`) se bloquea con
 *   `SELECT … FOR UPDATE` en la transacción del asiento y el número se guarda en
 *   `ledger.asientos_numeros` (solo inserción). Sin huecos ni repetidos: si la transacción se
 *   deshace, la secuencia también; dos asientos simultáneos del mismo diario esperan su turno.
 * - Partida del Libro Diario: correlativo por empresa y año en `ledger.asientos_partidas`,
 *   asignado al **cerrar el mes** (`asignarPartidas`), en orden `(fecha, numero)`. El mes cerrado
 *   ya no admite asientos, así que nunca se renumera; un mes reabierto conserva sus partidas y los
 *   asientos nuevos reciben las siguientes al volver a cerrarse.
 */

export const TIPOS_DIARIO = [
    'ventas',
    'cobros',
    'caja',
    'banco',
    'compras',
    'impuestos',
    'cierre',
    'varios',
] as const
export type TipoDiario = (typeof TIPOS_DIARIO)[number]

/** Diarios fijos de cada empresa. */
export const DIARIOS_BASE: Record<string, { nombre: string; tipo: TipoDiario }> = {
    VEN: { nombre: 'Ventas', tipo: 'ventas' },
    COB: { nombre: 'Cobros', tipo: 'cobros' },
    COM: { nombre: 'Compras y egresos', tipo: 'compras' },
    IMP: { nombre: 'Impuestos', tipo: 'impuestos' },
    CIE: { nombre: 'Cierre', tipo: 'cierre' },
    VAR: { nombre: 'Varios', tipo: 'varios' },
}

/** Orígenes de venta: siempre al diario de ventas, aunque toquen otra cuenta. */
const ORIGENES_VENTA = new Set(['factura', 'mora', 'nota_credito'])

/** Diario por defecto de cada origen cuando el asiento no toca una caja ni una cuenta bancaria. */
const DIARIO_POR_ORIGEN: Record<string, string> = {
    pago: 'COB',
    egreso: 'COM',
    cierre_caja: 'VAR',
    ajuste: 'VAR',
}

export interface DiarioAsiento {
    id: number
    codigo: string
}

interface DatosDiario {
    codigo: string
    nombre: string
    tipo: TipoDiario
    cuenta_por_defecto?: number | null
    caja_id?: number | null
    cuenta_bancaria_id?: number | null
}

/** Crea el diario si no existe (idempotente) y devuelve su id. */
async function asegurarDiario(
    trx: TransactionClientContract,
    empresaId: number,
    datos: DatosDiario,
): Promise<DiarioAsiento> {
    await trx
        .insertQuery()
        .table('ledger.diarios')
        .insert({
            empresa_id: empresaId,
            codigo: datos.codigo,
            nombre: datos.nombre,
            tipo: datos.tipo,
            cuenta_por_defecto: datos.cuenta_por_defecto ?? null,
            caja_id: datos.caja_id ?? null,
            cuenta_bancaria_id: datos.cuenta_bancaria_id ?? null,
        })
        .knexQuery.onConflict(['empresa_id', 'codigo'])
        .ignore()
    const fila = (await trx
        .from('ledger.diarios')
        .where('empresa_id', empresaId)
        .where('codigo', datos.codigo)
        .select('id', 'codigo', 'activo')
        .firstOrFail()) as { id: number; codigo: string; activo: boolean }
    if (!fila.activo) {
        throw new ReglaNegocio(`El diario ${fila.codigo} está inactivo`, 'diario_inactivo')
    }
    return { id: Number(fila.id), codigo: fila.codigo }
}

/**
 * Diario de un asiento, derivado de su origen y del medio de pago (las cuentas que toca):
 * ventas (factura, mora, nota de crédito) → `VEN`; ajuste manual → `VAR`; si toca la cuenta de
 * una caja → `CAJ-<caja>`; si toca la subcuenta de una cuenta bancaria propia → `BAN-<cuenta>`;
 * si no, pago → `COB` y egreso → `COM`. Un reverso toca las mismas cuentas con el mismo origen:
 * cae en el diario de su original.
 */
export async function diarioDeAsiento(
    trx: TransactionClientContract,
    empresaId: number,
    origen: string,
    cuentas: number[],
    codigo?: string | null,
): Promise<DiarioAsiento> {
    if (codigo) {
        const base = DIARIOS_BASE[codigo]
        if (base) return asegurarDiario(trx, empresaId, { codigo, ...base })
        const fila = (await trx
            .from('ledger.diarios')
            .where('empresa_id', empresaId)
            .where('codigo', codigo)
            .where('activo', true)
            .select('id', 'codigo')
            .first()) as DiarioAsiento | null
        if (!fila) throw new ReglaNegocio(`El diario ${codigo} no existe en la empresa`, 'diario_inexistente')
        return { id: Number(fila.id), codigo: fila.codigo }
    }
    if (ORIGENES_VENTA.has(origen)) {
        return asegurarDiario(trx, empresaId, { codigo: 'VEN', ...DIARIOS_BASE.VEN! })
    }
    if (origen !== 'ajuste' && cuentas.length > 0) {
        const caja = (await trx
            .from('ledger.cajas')
            .where('empresa_id', empresaId)
            .whereIn('cuenta_id', cuentas)
            .orderBy('id', 'asc')
            .select('id', 'nombre', 'cuenta_id')
            .first()) as { id: number; nombre: string; cuenta_id: number } | null
        if (caja) {
            return asegurarDiario(trx, empresaId, {
                codigo: `CAJ-${caja.id}`,
                nombre: `Caja · ${caja.nombre}`,
                tipo: 'caja',
                cuenta_por_defecto: caja.cuenta_id,
                caja_id: caja.id,
            })
        }
        const cuenta = (await trx
            .from('billing.cuentas_bancarias')
            .where('empresa_id', empresaId)
            .whereIn('cuenta_id', cuentas)
            .orderBy('id', 'asc')
            .select('id', 'alias', 'cuenta_id')
            .first()) as { id: number; alias: string; cuenta_id: number } | null
        if (cuenta) {
            return asegurarDiario(trx, empresaId, {
                codigo: `BAN-${cuenta.id}`,
                nombre: `Banco · ${cuenta.alias}`,
                tipo: 'banco',
                cuenta_por_defecto: cuenta.cuenta_id,
                cuenta_bancaria_id: cuenta.id,
            })
        }
    }
    const porDefecto = DIARIO_POR_ORIGEN[origen] ?? 'VAR'
    return asegurarDiario(trx, empresaId, { codigo: porDefecto, ...DIARIOS_BASE[porDefecto]! })
}

/**
 * Siguiente número del diario en el año de `fecha` y su fila en `ledger.asientos_numeros`, en la
 * transacción del asiento. La fila de la secuencia queda bloqueada hasta el COMMIT: ningún otro
 * asiento del mismo diario y año toma número mientras tanto, así no hay repetidos ni huecos.
 */
export async function numerarAsiento(
    trx: TransactionClientContract,
    asientoId: number,
    empresaId: number,
    fecha: string,
    diario: DiarioAsiento,
): Promise<number> {
    const anio = Number(fecha.slice(0, 4))
    await trx.rawQuery(
        `INSERT INTO ledger.secuencias (empresa_id, diario_id, anio, ultimo) VALUES (?, ?, ?, 0)
         ON CONFLICT (diario_id, anio) DO NOTHING`,
        [empresaId, diario.id, anio],
    )
    const secuencia = (await trx
        .from('ledger.secuencias')
        .where('diario_id', diario.id)
        .where('anio', anio)
        .forUpdate()
        .select('ultimo')
        .firstOrFail()) as { ultimo: number }
    const numero = Number(secuencia.ultimo) + 1
    await trx
        .from('ledger.secuencias')
        .where('diario_id', diario.id)
        .where('anio', anio)
        .update({ ultimo: numero })
    await trx.insertQuery().table('ledger.asientos_numeros').insert({
        asiento_id: asientoId,
        diario_id: diario.id,
        anio,
        numero,
    })
    return numero
}

/**
 * Partidas del Libro Diario de un mes que se acaba de cerrar (el que llama ya tiene el lock de
 * cierres de la empresa y ya insertó el cierre). Los asientos del mes sin partida reciben el
 * correlativo siguiente de la empresa en ese año, en orden `(fecha, numero, id)`. Devuelve
 * cuántas asignó.
 */
export async function asignarPartidas(
    trx: TransactionClientContract,
    empresaId: number,
    periodo: string,
    cierreId: number,
): Promise<number> {
    const anio = Number(periodo.slice(0, 4))
    const resultado = await trx.rawQuery(
        `WITH base AS (
             SELECT coalesce(max(partida), 0) AS ultima
               FROM ledger.asientos_partidas WHERE empresa_id = ? AND anio = ?
         ), pendientes AS (
             SELECT a.id, row_number() OVER (ORDER BY a.fecha, n.numero, a.id) AS orden
               FROM ledger.asientos a
               LEFT JOIN ledger.asientos_numeros n ON n.asiento_id = a.id
              WHERE a.empresa_id = ?
                AND a.fecha >= ?::date AND a.fecha < (?::date + interval '1 month')
                AND NOT EXISTS (SELECT 1 FROM ledger.asientos_partidas p WHERE p.asiento_id = a.id)
         )
         INSERT INTO ledger.asientos_partidas (asiento_id, empresa_id, anio, partida, cierre_id)
         SELECT p.id, ?, ?, base.ultima + p.orden, ?
           FROM pendientes p CROSS JOIN base
          ORDER BY p.orden`,
        [empresaId, anio, empresaId, periodo, periodo, empresaId, anio, cierreId],
    )
    return Number(resultado.rowCount ?? 0)
}
