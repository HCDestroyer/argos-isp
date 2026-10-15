import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { Queue, type Worker } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import CrearParticionesAuditoria from '#notify/actions/crear_particiones_auditoria'
import { ID_PARTICIONES, PATRON_PARTICIONES, programarCronParticiones } from '#notify/particiones'
import { NOMBRE_COLA_CRON, crearWorkerCron } from '#notify/recordatorios'
import { conexionRedis } from '#notify/cola'
import { ColaFalsa } from '#tests/notify/ayudas_notify'

/**
 * Las particiones de prueba son de 2090 y 2091 y se crean dentro de una transacción que se revierte
 * (el DDL de Postgres es transaccional): la BD de pruebas no se llena de tablas.
 */

const TABLAS = ['acciones', 'cambios', 'red']

function nombres(meses: string[]) {
    return TABLAS.flatMap((tabla) => meses.map((mes) => `audit.${tabla}_${mes}`)).sort()
}

async function existe(trx: { rawQuery: typeof db.rawQuery }, nombre: string): Promise<boolean> {
    const { rows } = (await trx.rawQuery('SELECT to_regclass(?) IS NOT NULL AS existe', [nombre])) as {
        rows: Array<{ existe: boolean }>
    }
    return rows[0]!.existe
}

test.group('notify · particiones de audit', () => {
    test('crea las particiones que faltan del mes de "desde" y los siguientes, una sola vez', async ({
        assert,
    }) => {
        const trx = await db.transaction()
        try {
            const accion = new CrearParticionesAuditoria()
            const ctx = contextoSistema('cron')
            const primera = await accion.execute({ desde: '2090-03-15', meses: 2 }, ctx, { trx })
            assert.equal(primera.desde, '2090-03-01')
            assert.deepEqual(primera.creadas, nombres(['2090_03', '2090_04', '2090_05']))
            assert.isTrue(await existe(trx, 'audit.red_2090_05'))

            const segunda = await accion.execute({ desde: '2090-03-15', meses: 2 }, ctx, { trx })
            assert.deepEqual(segunda.creadas, [])

            const auditadas = await trx
                .from('audit.acciones')
                .where('accion', 'auditoria.crear_particiones')
                .where('request_id', ctx.requestId)
            assert.lengthOf(auditadas, 2)
        } finally {
            await trx.rollback()
        }
    })

    test('rechaza un número de meses fuera de rango', async ({ assert }) => {
        await assert.rejects(
            () => new CrearParticionesAuditoria().execute({ meses: 500 }, contextoSistema('cron')),
            /fuera de rango/,
        )
    })

    test('el usuario de la aplicación (argosisp_app) puede crearlas aunque no tenga DDL en audit', async ({
        assert,
    }) => {
        const rol = await db.rawQuery("SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app'")
        if (rol.rows.length === 0) {
            assert.fail('Falta el rol argosisp_app (migración 1760900000011_crear_rol_app)')
        }

        const trx = await db.transaction()
        try {
            // Membresía temporal (se revierte con la transacción) para actuar como la API en producción.
            await trx.rawQuery('GRANT argosisp_app TO CURRENT_USER WITH SET TRUE, INHERIT FALSE')
            await trx.rawQuery('SET LOCAL ROLE argosisp_app')

            await assert.rejects(
                () => trx.transaction((sp) => sp.rawQuery('CREATE TABLE audit.prueba_sin_permiso (id int)')),
                /permission denied|permiso denegado/,
            )
            await trx.rawQuery("SELECT audit.crear_particiones('2091-01-01'::date, 1)")
            assert.isTrue(await existe(trx, 'audit.acciones_2091_01'))
            assert.isTrue(await existe(trx, 'audit.cambios_2091_02'))
        } finally {
            await trx.rollback()
        }
    })
})

test.group('notify · cron mensual de particiones (BullMQ)', (group) => {
    let cola: Queue
    let worker: Worker

    group.each.setup(async () => {
        const prefijo = `a6test-${randomUUID().slice(0, 8)}`
        cola = new Queue(NOMBRE_COLA_CRON, { connection: conexionRedis(), prefix: prefijo })
        worker = crearWorkerCron(new ColaFalsa(), { prefijo })
        return async () => {
            await worker.close()
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })

    test('registra el disparo mensual y corre una vez al arrancar', async ({ assert }) => {
        await programarCronParticiones(cola)
        // idempotente: arrancar dos veces no crea otro scheduler
        await programarCronParticiones(cola, { alArrancar: false })

        const schedulers = await cola.getJobSchedulers()
        assert.lengthOf(schedulers, 1)
        assert.equal(schedulers[0]!.key, ID_PARTICIONES)
        assert.equal(schedulers[0]!.pattern, PATRON_PARTICIONES)
        assert.equal(schedulers[0]!.tz, 'UTC')

        const limite = Date.now() + 10_000
        let completados = await cola.getJobs(['completed'])
        while (completados.length === 0 && Date.now() < limite) {
            await new Promise((resolver) => setTimeout(resolver, 100))
            completados = await cola.getJobs(['completed'])
        }
        assert.lengthOf(completados, 1)
        assert.equal(completados[0]!.name, ID_PARTICIONES)
        assert.equal(completados[0]!.returnvalue.meses, 12)
        // la migración ya creó el mes actual + 12; el siguiente mes también debe existir
        const siguiente = new Date()
        siguiente.setUTCDate(1)
        siguiente.setUTCMonth(siguiente.getUTCMonth() + 1)
        const mes = `${siguiente.getUTCFullYear()}_${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}`
        assert.isTrue(await existe(db, `audit.acciones_${mes}`))
    }).timeout(15_000)
})
