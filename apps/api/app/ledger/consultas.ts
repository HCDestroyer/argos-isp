import db from '@adonisjs/lucid/services/db'

/**
 * Consultas de solo lectura del libro (plan de cuentas, diario, mayor).
 */

export async function listarCuentas() {
    return db
        .from('ledger.cuentas')
        .select(
            'id',
            'codigo',
            'nombre',
            'tipo',
            'padre_id',
            'imputable',
            'auxiliar_cliente',
            'activa',
            'version',
            'created_at',
            'updated_at',
        )
        .orderBy('codigo', 'asc')
}
