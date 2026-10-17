import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { importar } from '#importacion/importador'
import { enmascararFila, FilasSinContar } from '#importacion/archivo'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico } from '#tests/importacion/ayudas_importacion'

/**
 * Archivo del origen (`importacion.filas_origen`) y cuadre por tabla: cada fila del volcado queda
 * importada, solo en el archivo u omitida con motivo; si alguna no queda contada, la corrida falla
 * sin guardar nada. Credenciales siempre como `***`.
 */
test.group('importacion · archivo del origen', (group) => {
    let FIXTURE: string
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })

    test('enmascara credenciales: columnas de claves, secretos y tokens, y el valor de un atributo de contraseña', ({
        assert,
    }) => {
        assert.deepEqual(
            enmascararFila({
                id: '1',
                pass: 'x',
                ppppass: 'y',
                secret_radius: 'z',
                password: 'w',
                api_token: 't',
                nombre: 'Ana',
                pass_vacia: '',
            }),
            {
                id: '1',
                pass: '***',
                ppppass: '***',
                secret_radius: '***',
                password: '***',
                api_token: '***',
                nombre: 'Ana',
                pass_vacia: '',
            },
        )
        assert.deepEqual(enmascararFila({ username: 'u', attribute: 'Cleartext-Password', value: 'clave' }), {
            username: 'u',
            attribute: 'Cleartext-Password',
            value: '***',
        })
        assert.deepEqual(enmascararFila({ username: 'u', attribute: 'Simultaneous-Use', value: '1' }), {
            username: 'u',
            attribute: 'Simultaneous-Use',
            value: '1',
        })
    })

    test('una fila que no queda contada hace fallar la corrida y no se guarda nada', async ({ assert }) => {
        const plantillaId = await crearPlantillaFila()
        const fuente = await leerDumpMikrowisp(FIXTURE)
        // El adaptador la vinculó a la factura 5001, pero se quitó de la fuente: nadie la cuenta.
        fuente.facturas = fuente.facturas.filter((f) => f.id !== '5001')
        const antes = (await db.from('importacion.filas_origen').count('* as n').first()) as { n: string }
        const trx = await db.transaction()
        try {
            await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            assert.fail('debía fallar')
        } catch (error) {
            assert.instanceOf(error, FilasSinContar)
            const e = error as FilasSinContar
            assert.deepInclude(
                e.tablas.map((t) => [t.tabla, t.sin_contar]),
                ['facturas', 1],
            )
            assert.include(e.message, 'facturas#1 → facturas:5001')
            assert.include(e.message, 'No se guardó nada')
        } finally {
            await trx.rollback()
        }
        const despues = (await db.from('importacion.filas_origen').count('* as n').first()) as { n: string }
        assert.equal(despues.n, antes.n)
    })

    test('una fila que cambia en el origen se reescribe sola; las demás no se tocan', async ({ assert }) => {
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const primera = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
            })
            assert.isTrue(primera.saldos.cuadra)
            const fuente = await leerDumpMikrowisp(FIXTURE)
            const zonas = fuente.archivo!.tablas.find((t) => t.tabla === 'zonas')!
            zonas.filas[0] = { ...zonas.filas[0]!, zona: 'MW Centro (renombrada)' }
            const segunda = await importar(fuente, { sistema: 'mikrowisp', dryRun: false, trx, plantillaId })
            const lotes = (await trx
                .from('audit.acciones')
                .where({ request_id: segunda.request_id, accion: 'importacion.archivar' })
                .select('entrada')) as Array<{ entrada: { tabla: string; filas: number } }>
            assert.deepEqual(
                lotes.map((l) => [l.entrada.tabla, l.entrada.filas]),
                [['zonas', 1]],
            )
            const fila = (await trx
                .from('importacion.filas_origen')
                .where({ origen: 'mikrowisp', tabla: 'zonas', id_externo: '1' })
                .first()) as { fila: Record<string, string>; request_id: string }
            assert.equal(fila.fila.zona, 'MW Centro (renombrada)')
            assert.equal(fila.request_id, segunda.request_id)
        } finally {
            await trx.rollback()
        }
    })
})
