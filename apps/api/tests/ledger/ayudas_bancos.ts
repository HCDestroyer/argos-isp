import db from '@adonisjs/lucid/services/db'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import { prepararEmpresas, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'

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
