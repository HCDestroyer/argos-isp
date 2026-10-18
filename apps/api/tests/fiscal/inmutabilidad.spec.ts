import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { empresaInstalada } from '#tests/fiscal/ayudas_fiscal'

/**
 * Las tablas de solo inserción del módulo fiscal rechazan UPDATE,
 * DELETE y TRUNCATE por trigger (y por `REVOKE` al rol de la app). Los triggers de validación
 * repiten en la base las reglas de las acciones.
 */

const TABLAS = [
    'fiscal.localizaciones',
    'fiscal.instalaciones',
    'fiscal.parametros_valores',
    'fiscal.impuestos',
    'fiscal.impuestos_versiones',
    'fiscal.frases',
]

test.group('Localización fiscal · inmutabilidad', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('UPDATE, DELETE y TRUNCATE fallan en las tablas de solo inserción', async ({ assert }) => {
        // al menos una fila en cada tabla (los triggers de UPDATE y DELETE son por fila)
        const { empresaId } = await empresaInstalada()
        await db.table('fiscal.frases').insert({
            empresa_id: empresaId,
            clave: 'manual:9-9',
            tipo_frase: 9,
            escenario: 9,
            texto: 'Frase de prueba',
            tipos_dte: ['FACT'],
            vigente_desde: '2026-10-01',
            motivo: 'Prueba de inmutabilidad',
        })
        for (const tabla of TABLAS) {
            // dentro de una transacción que se revierte: si el trigger faltara, nada se perdería
            const intentar = (sql: string) =>
                db.transaction(async (trx) => {
                    await trx.rawQuery(sql)
                    throw new Error(`${tabla}: no lo rechazó`)
                })
            const columna = tabla === 'fiscal.instalaciones' ? 'instalada_en' : 'created_at'
            await assert.rejects(() => intentar(`UPDATE ${tabla} SET ${columna} = ${columna}`), /inmutable/)
            await assert.rejects(() => intentar(`DELETE FROM ${tabla}`), /inmutable/)
            await assert.rejects(() => intentar(`TRUNCATE ${tabla} CASCADE`), /inmutable/)
        }
    })

    test('la base repite las reglas: alcance N, alcance E global, rango y signo de la retención', async ({
        assert,
    }) => {
        const insertar = (fila: Record<string, unknown>) =>
            db.transaction((trx) =>
                trx
                    .insertQuery()
                    .table('fiscal.parametros_valores')
                    .insert({
                        pais: 'GT',
                        vigente_desde: '2099-01-01',
                        origen: 'usuario',
                        motivo: 'Directo en la base',
                        ...fila,
                    }),
            )
        await assert.rejects(
            () => insertar({ empresa_id: 1, clave: 'moneda', valor: JSON.stringify('USD') }),
            /alcance N/,
        )
        await assert.rejects(
            () => insertar({ empresa_id: null, clave: 'reserva_legal_pct', valor: JSON.stringify('5.00') }),
            /alcance E/,
        )
        await assert.rejects(
            () => insertar({ empresa_id: 1, clave: 'reserva_legal_pct', valor: JSON.stringify('4.00') }),
            /fuera de rango/,
        )
        await assert.rejects(
            () =>
                insertar({
                    empresa_id: 1,
                    clave: 'credito_fiscal_ventana_meses',
                    valor: JSON.stringify(1),
                    origen: 'paquete',
                }),
            /parametros_valores_paquete_global/,
        )

        const version = await db.from('fiscal.impuestos_versiones').where('codigo', 'RET_IVA_ESP').first()
        const { id: idOriginal, created_at: creadaEn, ...copia } = version
        void idOriginal
        void creadaEn
        await assert.rejects(
            () =>
                db.transaction((trx) =>
                    trx
                        .insertQuery()
                        .table('fiscal.impuestos_versiones')
                        .insert({
                            ...copia,
                            vigente_desde: '2099-01-01',
                            origen: 'usuario',
                            motivo: 'x',
                            signo: 1,
                        }),
                ),
            /Signo 1 incorrecto/,
        )
    })
})
