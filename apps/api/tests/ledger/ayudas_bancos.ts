import db from '@adonisjs/lucid/services/db'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import { prepararEmpresas, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro, type Violacion } from '#tests/contabilidad/verificar_libro'
import { dec } from '#ledger/dinero'

/**
 * Ayudas de las pruebas de la fase 4 (cobros y bancos): las empresas del auditor con la
 * localización GT instalada (los parámetros `cobros_liquidar_dias`, `diferencia_cobro_tope` y
 * `reserva_incobrables_max` se leen de ella) y su cuenta bancaria propia.
 */

export interface EmpresasGt extends Empresas {
    banco: Map<number, { id: number; codigo: string; cuenta_id: number }>
}

export async function prepararEmpresasGt(): Promise<EmpresasGt> {
    const e = await prepararEmpresas()
    const banco = new Map<number, { id: number; codigo: string; cuenta_id: number }>()
    for (const empresaId of [e.B, e.C]) {
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, e.ctx)
        const fila = (await db
            .from('billing.cuentas_bancarias as cb')
            .join('ledger.cuentas as c', 'c.id', 'cb.cuenta_id')
            .where('cb.id', e.cuentas.get(empresaId)!)
            .select('cb.id', 'c.codigo', 'c.id as cuenta_id')
            .firstOrFail()) as { id: number; codigo: string; cuenta_id: number }
        banco.set(empresaId, fila)
    }
    return { ...e, banco }
}

/**
 * El auditor del libro (`#tests/contabilidad/verificar_libro`) con lo único que todavía no conoce:
 * el origen `diferencia_conciliacion` del lote B3 (plan de contabilidad §5.8). Clasificarlo es del
 * lote AU3 del auditor; mientras tanto se descuenta **exactamente** lo que esas diferencias explican:
 *
 * - invariante 9 (origen desconocido): solo los asientos de origen `diferencia_conciliacion`;
 * - invariante 4 (saldo del banco = sus documentos): mayor − documentos = Σ de los movimientos del
 *   banco de esos asientos (vigentes y sus reversos) en esa cuenta.
 *
 * - invariante 13 (llegada reatribuida, por línea): cuenta las filas de `transitos_acreditados` de la
 *   línea cuyo documento tiene alguna llegada viva, aunque esa fila ya se haya revertido. Con E11
 *   (deshacer la conciliación revierte la llegada) el mismo depósito puede volver a llegar con la
 *   misma línea; se acepta solo si la línea tiene a lo sumo **una** fila sin reatribución.
 *
 * Cualquier otra violación, o una diferencia que no cuadre al centavo, falla igual.
 */
export async function afirmarLibroConDiferencias(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresas: number[],
) {
    const violaciones = await verificarLibro(empresas)
    const restantes: Violacion[] = []
    for (const v of violaciones) {
        if (v.invariante.startsWith('9.origen_de_asiento_desconocido')) {
            const otros = (v.detalle as Array<{ origen_tipo: string }>).filter(
                (d) => d.origen_tipo !== 'diferencia_conciliacion',
            )
            if (otros.length > 0) restantes.push({ ...v, detalle: otros })
            continue
        }
        if (v.invariante.startsWith('4.saldo_de_caja_o_banco_distinto_de_sus_documentos')) {
            const otros = []
            for (const d of v.detalle as Array<{
                empresa_id: number
                cuenta: string
                mayor: string
                documentos: string
            }>) {
                const r = (await db.rawQuery(
                    `SELECT coalesce(sum(m.debe - m.haber), 0)::text AS s
                       FROM ledger.asientos a JOIN ledger.movimientos m ON m.asiento_id = a.id
                       JOIN ledger.cuentas c ON c.id = m.cuenta_id
                      WHERE a.origen_tipo = 'diferencia_conciliacion' AND a.empresa_id = ? AND c.codigo = ?`,
                    [d.empresa_id, d.cuenta],
                )) as { rows: Array<{ s: string }> }
                if (!dec(d.mayor).minus(d.documentos).equals(dec(r.rows[0]!.s))) otros.push(d)
            }
            if (otros.length > 0) restantes.push({ ...v, detalle: otros })
            continue
        }
        if (v.invariante.startsWith('13.llegada_reatribuida')) {
            const otros = []
            for (const d of v.detalle as Array<{ que: string; id: string }>) {
                if (d.que !== 'linea') {
                    otros.push(d)
                    continue
                }
                const r = (await db.rawQuery(
                    `SELECT count(*)::int AS n FROM ledger.transitos_acreditados x
                      WHERE x.linea_id = ?
                        AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id)`,
                    [Number(d.id)],
                )) as { rows: Array<{ n: number }> }
                if (r.rows[0]!.n > 1) otros.push(d)
            }
            if (otros.length > 0) restantes.push({ ...v, detalle: otros })
            continue
        }
        restantes.push(v)
    }
    assert.deepEqual(restantes, [], `Invariantes contables rotos:\n${JSON.stringify(restantes, null, 2)}`)
}
