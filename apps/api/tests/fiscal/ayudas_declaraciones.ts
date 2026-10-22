import db from '@adonisjs/lucid/services/db'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { dec } from '#ledger/dinero'

/**
 * Fase 7 PR B: los invariantes del auditor (`tests/contabilidad`, que A3 no edita) aún no conocen los
 * asientos de la liquidación (`liquidacion_impuesto`) ni de su pago (`pago_impuesto`). Hasta que el
 * auditor los sume (pedido en `.claude/integration/a3.md`), estas pruebas toleran **solo** lo que
 * explican esos asientos en los invariantes de abajo; cualquier otra violación hace fallar la prueba.
 */
const ORIGENES_FASE7 = new Set(['liquidacion_impuesto', 'pago_impuesto'])

/** Neto (debe − haber) de los pagos de declaraciones en esa cuenta de la empresa. */
async function pagosDeImpuestos(empresaId: number, cuenta: string) {
    const fila = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('a.origen_tipo', 'pago_impuesto')
        .where('c.codigo', cuenta)
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::text as neto'))
        .first()) as { neto: string }
    return dec(fila.neto)
}

const PENDIENTES_AUDITOR: Record<string, (fila: Record<string, unknown>) => Promise<boolean> | boolean> = {
    '9.origen_de_asiento_desconocido': (f) => ORIGENES_FASE7.has(String(f.origen_tipo)),
    '15.libro_compras_distinto_de_1.1.04': (f) => ORIGENES_FASE7.has(String(f.origen)),
    // el banco baja por el pago de la declaración, que el invariante aún no cuenta como documento
    '4.saldo_de_caja_o_banco_distinto_de_sus_documentos': async (f) =>
        dec(String(f.mayor))
            .minus(dec(String(f.documentos)))
            .equals(await pagosDeImpuestos(Number(f.empresa_id), String(f.cuenta))),
}

export async function afirmarLibroConLiquidacion(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresas: number[],
) {
    const violaciones = []
    for (const v of await verificarLibro(empresas)) {
        const tolera = Object.entries(PENDIENTES_AUDITOR).find(([clave]) =>
            v.invariante.startsWith(clave),
        )?.[1]
        if (!tolera || !Array.isArray(v.detalle)) {
            violaciones.push(v)
            continue
        }
        const resto = []
        for (const f of v.detalle as Array<Record<string, unknown>>) if (!(await tolera(f))) resto.push(f)
        if (resto.length > 0) violaciones.push({ ...v, detalle: resto })
    }
    assert.deepEqual(
        violaciones,
        [],
        `Invariantes contables rotos (empresa ${empresas}):\n${JSON.stringify(violaciones, null, 2)}`,
    )
}
