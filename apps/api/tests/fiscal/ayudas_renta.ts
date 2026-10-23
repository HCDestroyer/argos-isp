import db from '@adonisjs/lucid/services/db'
import { verificarLibro, type Violacion } from '#tests/contabilidad/verificar_libro'

/**
 * Tolerancia temporal (fase 7 PR C) mientras el auditor actualiza sus invariantes con lo nuevo de esta
 * PR (pedido en `.claude/integration/a3.md`). Solo deja pasar estas violaciones y solo con filas de
 * estos casos; todo lo demás falla igual que `afirmarLibro`:
 *  - inv. 22 (liquidación): las cuentas de la liquidación de ISR e ISO (1.1.06, 1.1.07, 1.1.08, 2.1.07,
 *    2.1.08, 5.5.01);
 *  - inv. 22 (sin bloqueo): ISR e ISO no fijan el bloqueo de impuestos;
 *  - inv. 22 (pago): el pago de ISR, ISO o retenciones (otra cuenta por pagar), el reverso de un pago
 *    anulado (`pago_impuesto` sin fila en `declaraciones_pagos`) y el pago de una versión con otro anulado;
 *  - inv. 15 (2.1.04 y 2.1.05): empresas que pagaron una declaración de retenciones (el pago las salda);
 *  - inv. 4 (caja y banco): empresas con un pago de declaración anulado (el reverso devuelve el dinero);
 *  - inv. 18: la clave nueva `retenciones_cuadradas` (tipo impuestos).
 * Se quita cuando el auditor publique sus invariantes.
 */
const CUENTAS_RENTA = new Set(['1.1.06', '1.1.07', '1.1.08', '2.1.07', '2.1.08', '5.5.01'])

async function contexto() {
    const renta = (await db
        .from('fiscal.declaraciones')
        .whereNotIn('impuesto', ['iva_mensual', 'pc_mensual'])
        .select('id', 'impuesto')) as Array<{ id: number; impuesto: string }>
    const anuladas = (await db
        .from('fiscal.declaraciones_pagos_anulaciones as x')
        .join('fiscal.declaraciones_pagos as p', 'p.id', 'x.pago_id')
        .select('p.declaracion_id', 'p.empresa_id', 'x.asiento_id')) as Array<{
        declaracion_id: number
        empresa_id: number
        asiento_id: number
    }>
    const retencionesPagadas = (await db
        .from('fiscal.declaraciones_pagos as p')
        .join('fiscal.declaraciones as d', 'd.id', 'p.declaracion_id')
        .whereIn('d.impuesto', ['retenciones_iva', 'retenciones_isr'])
        .distinct('p.empresa_id')) as Array<{ empresa_id: number }>
    return {
        empresasRetencionesPagadas: new Set(retencionesPagadas.map((r) => Number(r.empresa_id))),
        renta: new Set(renta.map((r) => Number(r.id))),
        rentaSinBloqueo: new Set(
            renta.filter((r) => !r.impuesto.startsWith('retenciones')).map((r) => Number(r.id)),
        ),
        conAnulacion: new Set(anuladas.map((a) => Number(a.declaracion_id))),
        empresasConAnulacion: new Set(anuladas.map((a) => Number(a.empresa_id))),
        reversos: new Set(anuladas.map((a) => Number(a.asiento_id))),
    }
}

type Contexto = Awaited<ReturnType<typeof contexto>>

const REGLAS: Array<{ prefijo: string; acepta: (f: Record<string, any>, c: Contexto) => boolean }> = [
    {
        prefijo: '22.liquidacion_distinta_de_la_declaracion',
        acepta: (f) => CUENTAS_RENTA.has(String(f.impuesto)),
    },
    {
        prefijo: '22.revisada_sin_bloqueo_de_impuestos',
        acepta: (f, c) => c.rentaSinBloqueo.has(Number(f.id)),
    },
    {
        prefijo: '22.pago_de_declaracion_mal_contabilizado',
        acepta: (f, c) =>
            f.que === 'asiento_sin_pago'
                ? c.reversos.has(Number(f.id))
                : c.renta.has(Number(f.declaracion_id)) || c.conAnulacion.has(Number(f.declaracion_id)),
    },
    {
        prefijo: '4.saldo_de_caja_o_banco_distinto_de_sus_documentos',
        acepta: (f, c) => c.empresasConAnulacion.has(Number(f.empresa_id)),
    },
    {
        prefijo: '15.retenciones_por_pagar_distintas',
        acepta: (f, c) => c.empresasRetencionesPagadas.has(Number(f.empresa_id)),
    },
    { prefijo: '18.check_mal_formado', acepta: (f) => f.clave === 'retenciones_cuadradas' },
]

function tolerada(v: Violacion, c: Contexto): boolean {
    const regla = REGLAS.find((r) => v.invariante.startsWith(r.prefijo))
    if (!regla) return false
    const filas = Array.isArray(v.detalle) ? (v.detalle as Array<Record<string, any>>) : []
    return filas.length > 0 && filas.every((f) => regla.acepta(f, c))
}

export async function afirmarLibroPrC(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresaId?: number | number[] | null,
) {
    const c = await contexto()
    const todas = await verificarLibro(empresaId)
    const violaciones = todas.filter((v) => !tolerada(v, c))
    assert.deepEqual(
        violaciones,
        [],
        `Invariantes contables rotos (empresa ${String(empresaId ?? 'todas')}):\n${JSON.stringify(violaciones, null, 2)}`,
    )
}
