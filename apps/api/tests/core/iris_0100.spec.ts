import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { PERMISOS_IRIS_0100, ROL_IRIS, usuarioIris } from '#core/integraciones_iris'
import MigracionPermisosIris0100 from '#database/migrations/1795255982193_alter_permisos_iris_0100_s_table'

/** Contrato Iris 0.10.0: permisos del usuario técnico y su migración en instalaciones ya conectadas. */
test.group('Iris 0.10.0 · permisos del usuario técnico', () => {
    test('la migración suma los permisos de 0.10.0 al rol y a los tokens vigentes, una sola vez', async ({
        assert,
    }) => {
        const vigente = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const usuarioId = (await usuarioIris())!
        const rol = await db.from('core.roles').where('nombre', ROL_IRIS).firstOrFail()
        const filas = await db
            .from('core.permisos')
            .whereIn('nombre', [...PERMISOS_IRIS_0100])
            .select('id')
        const ids = filas.map((f) => f.id)
        assert.lengthOf(ids, PERMISOS_IRIS_0100.length)
        await db.from('core.roles_permisos').where('role_id', rol.id).whereIn('permiso_id', ids).delete()
        for (const permiso of PERMISOS_IRIS_0100) {
            await db.rawQuery(
                `UPDATE core.tokens_api SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - ?::text)
                  WHERE usuario_id = ?`,
                [permiso, usuarioId],
            )
        }
        const migrar = () =>
            db.transaction((trx) => new MigracionPermisosIris0100(trx, 'permisos_iris_0100', false).execUp())
        await migrar()
        await migrar()
        const delRol = await db
            .from('core.roles_permisos')
            .where('role_id', rol.id)
            .whereIn('permiso_id', ids)
        assert.lengthOf(delRol, PERMISOS_IRIS_0100.length)
        const token = await db.from('core.tokens_api').where('id', vigente.datos.id).firstOrFail()
        for (const permiso of PERMISOS_IRIS_0100) {
            assert.lengthOf(
                token.alcances.permisos.filter((p: string) => p === permiso),
                1,
            )
        }
    })
})
