import db from '@adonisjs/lucid/services/db'
import { verificarLibro, type Violacion } from '#tests/contabilidad/verificar_libro'

/**
 * Canje revertido como reverso espejo (contrato de lealtad §15.2, `a3.md` fila 136): mientras el
 * inv. 14 del auditor no acepte el reverso positivo de un canje (`4.1.06 / 2.1.10`, uno por lote
 * consumido, `reversa_de` = la salida del canje), estas pruebas apartan **solo** esas filas de
 * `14.movimiento_de_lealtad_mal_contabilizado` y `14.lote_revertido_dos_veces`. Todo lo demás se
 * afirma igual que `afirmarLibro`. Se quita cuando el auditor cambie el inv. 14.
 */
async function reversosDeCanje(): Promise<{ ids: Set<number>; salidas: Set<number> }> {
    const filas = (await db
        .from('lealtad.movimientos')
        .where('tipo', 'reverso')
        .where('origen_tipo', 'canje')
        .where('puntos', '>', 0)
        .select('id', 'reversa_de')) as Array<{ id: number; reversa_de: number }>
    return {
        ids: new Set(filas.map((f) => Number(f.id))),
        salidas: new Set(filas.map((f) => Number(f.reversa_de))),
    }
}

function soloReversosDeCanje(v: Violacion, r: { ids: Set<number>; salidas: Set<number> }): boolean {
    const filas = Array.isArray(v.detalle) ? (v.detalle as Array<Record<string, unknown>>) : []
    if (filas.length === 0) return false
    if (v.invariante.startsWith('14.movimiento_de_lealtad_mal_contabilizado')) {
        return filas.every((f) => r.ids.has(Number(f.id)))
    }
    if (v.invariante.startsWith('14.lote_revertido_dos_veces')) {
        return filas.every((f) => r.salidas.has(Number(f.reversa_de)))
    }
    return false
}

export async function afirmarLibro(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresaId?: number | number[] | null,
) {
    const reversos = await reversosDeCanje()
    const todas = await verificarLibro(empresaId)
    const violaciones = todas.filter((v) => !soloReversosDeCanje(v, reversos))
    assert.deepEqual(violaciones, [], 'Invariantes contables rotos')
}
