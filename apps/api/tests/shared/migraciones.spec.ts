import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'

const SCHEMAS = ['audit', 'billing', 'core', 'ledger', 'network', 'notify']

async function schemasPresentes(): Promise<string[]> {
    const filas = (await db
        .from('pg_namespace')
        .whereIn('nspname', SCHEMAS)
        .orderBy('nspname')
        .select('nspname')) as Array<{ nspname: string }>
    return filas.map((f) => f.nspname)
}

async function ace(comando: string, argumentos: string[]) {
    const kernel = await app.container.make('ace')
    const resultado = await kernel.exec(comando, argumentos)
    if (resultado.exitCode) throw resultado.error ?? new Error(`Falló ${comando}`)
}

test.group('Migraciones', () => {
    test('bajan por completo y vuelven a subir', async ({ assert }) => {
        assert.deepEqual(await schemasPresentes(), SCHEMAS)

        await ace('migration:rollback', ['--batch=0', '--force'])
        assert.deepEqual(await schemasPresentes(), [])

        await ace('migration:run', ['--force'])
        await ace('db:seed', [])
        assert.deepEqual(await schemasPresentes(), SCHEMAS)
    })

    test('crean las restricciones clave del modelo', async ({ assert }) => {
        const indices = (await db
            .from('pg_indexes')
            .whereIn('schemaname', ['core', 'billing'])
            .select('indexname')) as Array<{ indexname: string }>
        const nombres = indices.map((i) => i.indexname)
        assert.includeMembers(nombres, [
            'servicios_user_ppp_unico',
            'facturas_clave_unica',
            'pagos_metodo_referencia',
            'idempotency_keys_clave_actor_id_key',
        ])
    })

    test('audit.* está particionada por mes: actual + 12 y DEFAULT', async ({ assert }) => {
        for (const tabla of ['acciones', 'cambios', 'red']) {
            const particiones = (await db
                .from('pg_inherits as i')
                .join('pg_class as c', 'c.oid', 'i.inhrelid')
                .join('pg_class as p', 'p.oid', 'i.inhparent')
                .join('pg_namespace as n', 'n.oid', 'p.relnamespace')
                .where('n.nspname', 'audit')
                .where('p.relname', tabla)
                .select('c.relname')) as Array<{ relname: string }>
            const nombres = particiones.map((p) => p.relname)
            assert.include(nombres, `${tabla}_default`)
            assert.isAtLeast(nombres.length, 14, `${tabla} debe tener 13 mensuales + default`)
        }
    })

    test('el rol argosisp_app no puede modificar ledger ni audit', async ({ assert }) => {
        const privilegio = async (tabla: string, tipo: string) => {
            const fila = (await db
                .rawQuery('SELECT has_table_privilege(?, ?, ?) AS ok', ['argosisp_app', tabla, tipo])
                .then((r) => r.rows[0])) as { ok: boolean }
            return fila.ok
        }
        assert.isTrue(await privilegio('ledger.asientos', 'INSERT'))
        assert.isFalse(await privilegio('ledger.asientos', 'UPDATE'))
        assert.isFalse(await privilegio('ledger.movimientos', 'DELETE'))
        assert.isFalse(await privilegio('audit.acciones', 'UPDATE'))
        assert.isFalse(await privilegio('audit.outbox', 'DELETE'))
        assert.isTrue(await privilegio('core.clientes', 'UPDATE'))

        const columna = (await db
            .rawQuery(
                "SELECT has_column_privilege('argosisp_app', 'audit.outbox', 'publicado_en', 'UPDATE') AS ok",
            )
            .then((r) => r.rows[0])) as { ok: boolean }
        assert.isTrue(columna.ok)
    })
})
