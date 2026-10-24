import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { aTexto, dec, type Dec } from '#ledger/dinero'

/**
 * Cierre de los saldos de apertura (contrato de localización fiscal §23, §15 #100; estudio Odoo
 * n.º 39): la importación deja su contrapartida en `2.9.01 Saldos de apertura por importación`
 * (pasivo transitorio, `contratos/importacion.md`). Terminada la importación, `libro.cerrar_apertura`
 * traslada el saldo neto de 2.9.01 a una cuenta de patrimonio y el check `apertura_cero` (§10.5)
 * pasa solo.
 *
 * El asiento es `origen_tipo = 'ajuste'` sin `origen_id`, como un asiento manual (desvío (a) de
 * §23: sin tabla ni origen nuevos). Se reconoce por su forma: dos partidas, 2.9.01 y una de las
 * cuentas de `DESTINOS_APERTURA`, sin reverso. Si estuvo mal, se corrige con
 * `POST /libro/asientos/:id/revertir` y se vuelve a cerrar.
 */

/** Cuentas de patrimonio que reciben el saldo; la primera es la de por defecto. */
export const DESTINOS_APERTURA = [CUENTAS_GT.UTILIDADES_ACUMULADAS, CUENTAS_GT.CAPITAL_SOCIAL] as const
export type DestinoApertura = (typeof DESTINOS_APERTURA)[number]
export const DESTINO_APERTURA_DEFECTO: DestinoApertura = CUENTAS_GT.UTILIDADES_ACUMULADAS

export interface CierreAperturaVista {
    asiento_id: number
    fecha: string
    cuenta_destino: string
    /** saldo de 2.9.01 que se canceló (debe − haber antes del cierre; negativo = acreedor) */
    monto: string
    created_at: Date
}

export interface EstadoApertura {
    empresa_id: number
    fecha: string
    cuenta: string
    /** saldo de 2.9.01 al día (debe − haber; negativo = acreedor, lo normal tras importar) */
    saldo: string
    cierres: CierreAperturaVista[]
}

/** Saldo (debe − haber) de 2.9.01 en el libro de la empresa hasta `fecha` inclusive. */
export async function saldoApertura(c: QueryClientContract, empresaId: number, fecha: string): Promise<Dec> {
    const fila = (await c
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as cu', 'cu.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('cu.codigo', CUENTAS.SALDOS_APERTURA)
        .where('a.fecha', '<=', fecha)
        .select(c.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
        .first()) as { saldo: string }
    return dec(fila.saldo)
}

/** Cierres de apertura vigentes (sin reverso) de la empresa, el más reciente primero. */
export async function cierresApertura(
    c: QueryClientContract,
    empresaId: number,
): Promise<CierreAperturaVista[]> {
    const { rows } = (await c.rawQuery(
        `SELECT a.id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.created_at,
                max(cu.codigo) FILTER (WHERE cu.codigo <> ?) AS destino,
                sum(CASE WHEN cu.codigo = ? THEN m.haber - m.debe ELSE 0 END)::text AS monto
           FROM ledger.asientos a
           JOIN ledger.movimientos m ON m.asiento_id = a.id
           JOIN ledger.cuentas cu ON cu.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.origen_tipo = 'ajuste' AND a.origen_id IS NULL AND a.reversa_de IS NULL
            AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = a.id)
          GROUP BY a.id
         HAVING count(*) = 2
            AND bool_or(cu.codigo = ?)
            AND bool_and(cu.codigo = ANY (?::text[]))
          ORDER BY a.fecha DESC, a.id DESC`,
        [
            CUENTAS.SALDOS_APERTURA,
            CUENTAS.SALDOS_APERTURA,
            empresaId,
            CUENTAS.SALDOS_APERTURA,
            [CUENTAS.SALDOS_APERTURA, ...DESTINOS_APERTURA],
        ],
    )) as { rows: Array<{ id: number; fecha: string; created_at: Date; destino: string; monto: string }> }
    return rows.map((f) => ({
        asiento_id: Number(f.id),
        fecha: f.fecha,
        cuenta_destino: f.destino,
        // el asiento mueve 2.9.01 con el signo contrario al saldo: (haber − debe) del asiento = el
        // saldo (debe − haber) que canceló
        monto: aTexto(dec(f.monto)),
        created_at: f.created_at,
    }))
}

export async function estadoApertura(
    empresaId: number,
    fecha: string,
    c: QueryClientContract = db.connection(),
): Promise<EstadoApertura> {
    return {
        empresa_id: empresaId,
        fecha,
        cuenta: CUENTAS.SALDOS_APERTURA,
        saldo: aTexto(await saldoApertura(c, empresaId, fecha)),
        cierres: await cierresApertura(c, empresaId),
    }
}
