import db from '@adonisjs/lucid/services/db'

/**
 * Bancos del libro (`ledger.bancos`): las cuentas bancarias contables de las que salen los
 * egresos con `metodo: banco`. No confundir con `billing.bancos` (catálogo de bancos de
 * Guatemala) ni con `billing.cuentas_bancarias` (cuentas propias que reciben depósitos).
 * Solo lectura.
 */

export interface BancoLibro {
    id: number
    /** empresa dueña del banco del libro */
    empresa_id: number
    nombre: string
    banco_id: number | null
    banco: string | null
    numero_enmascarado: string | null
    cuenta_id: number
    cuenta_codigo: string
    cuenta_nombre: string
}

/**
 * Deja visibles solo los últimos 4 caracteres alfanuméricos; el resto se reemplaza por `•`
 * (guiones y espacios se conservan). Si la fila ya viene enmascarada (`*` o `•`), no la toca.
 */
export function enmascararNumero(numero: string | null): string | null {
    if (!numero) return null
    if (/[*•]/.test(numero)) return numero
    const total = numero.replace(/[^0-9a-z]/gi, '').length
    let vistos = 0
    return numero.replace(/[0-9a-z]/gi, (c) => (++vistos > total - 4 ? c : '•'))
}

export async function listarBancosLibro(empresas: number[] | null = null): Promise<BancoLibro[]> {
    const filas = (await db
        .from('ledger.bancos as b')
        .if(empresas !== null, (q) => q.whereIn('b.empresa_id', empresas!))
        .join('ledger.cuentas as cu', 'cu.id', 'b.cuenta_id')
        .leftJoin('billing.bancos as bc', 'bc.id', 'b.banco_id')
        .select(
            'b.id',
            'b.empresa_id',
            'b.nombre',
            'b.banco_id',
            'bc.nombre as banco',
            'b.numero_mascarado',
            'b.cuenta_id',
            'cu.codigo as cuenta_codigo',
            'cu.nombre as cuenta_nombre',
        )
        .orderBy('cu.codigo', 'asc')
        .orderBy('b.id', 'asc')) as Array<
        Omit<BancoLibro, 'numero_enmascarado'> & { numero_mascarado: string | null }
    >
    return filas.map(({ numero_mascarado: numero, ...fila }) => ({
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        banco_id: fila.banco_id === null ? null : Number(fila.banco_id),
        cuenta_id: Number(fila.cuenta_id),
        numero_enmascarado: enmascararNumero(numero),
    }))
}
