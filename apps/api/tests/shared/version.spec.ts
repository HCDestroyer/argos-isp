import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { actualizarConVersion } from '#shared/version'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { aProblema } from '#exceptions/handler'
import { unico } from '#tests/ayudas'

test.group('Control de versión (409)', () => {
    test('actualiza con la versión leída e incrementa; con una versión vieja lanza 409', async ({
        assert,
    }) => {
        const [zona] = (await db
            .insertQuery()
            .table('core.zonas')
            .insert({ nombre: unico('Zona') })
            .returning(['id', 'version'])) as Array<{ id: number; version: number }>

        const nueva = await db.transaction((trx) =>
            actualizarConVersion<{ nombre: string; version: number }>(trx, 'core.zonas', zona!.id, 1, {
                nombre: unico('Zona'),
            }),
        )
        assert.equal(nueva.version, 2)

        const conflicto = await db
            .transaction((trx) =>
                actualizarConVersion(trx, 'core.zonas', zona!.id, 1, { nombre: unico('Z') }),
            )
            .catch((error: unknown) => error)
        assert.instanceOf(conflicto, ConflictoVersion)
        assert.containsSubset(aProblema(conflicto, false), {
            type: 'urn:argosisp:problema:conflicto_version',
            status: 409,
        })

        const inexistente = await db
            .transaction((trx) => actualizarConVersion(trx, 'core.zonas', 999_999_999, 1, { nombre: 'x' }))
            .catch((error: unknown) => error)
        assert.instanceOf(inexistente, NoEncontrado)
    })
})
