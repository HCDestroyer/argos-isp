import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import { CRONS, conLock, ejecutarCron, programarCronsBilling } from '#billing/jobs'
import { crearPlantillaFila, escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'

/**
 * El corte global evalúa todos los servicios de la base de pruebas: se usa un día lejano propio
 * (2030-03-04) para que sus `cortes_ejecutados` no choquen con otras pruebas.
 */
const A_LAS = (hora: string) => new Date(`2030-03-04T${hora}:00-06:00`)

const corte = (ahora: Date) => new EjecutarCorte().execute({ ahora }, contextoPrueba())

test.group('billing · cron de corte', () => {
    test('a la hora de cada plantilla (o de la excepción): vence lo pendiente y corta una sola vez por día', async ({
        assert,
    }) => {
        const ocho = await escenario({ plantilla: { hora_corte: '08:00' } })
        const plantillaDiez = await crearPlantillaFila({ hora_corte: '10:00' })
        const diez = await escenario({ servicio: { plantilla_facturacion_id: plantillaDiez } })
        const conExcepcion = await escenario({ servicio: { plantilla_facturacion_id: plantillaDiez } })
        await db.table('core.servicios_excepciones').insert({
            servicio_id: conExcepcion.servicioId,
            campo: 'hora_corte',
            valor: JSON.stringify('07:30'),
        })
        for (const { servicioId } of [ocho, diez, conExcepcion]) await generar(servicioId, '2026-10-01')

        const primera = await corte(A_LAS('09:00'))
        assert.includeMembers(primera.horas, ['07:30', '08:00'])
        assert.notInclude(primera.horas, '10:00')
        assert.isAbove(primera.vencimiento!.vencidas, 0)
        assert.equal(await estadoServicio(ocho.servicioId), 'suspendido')
        assert.equal(await estadoServicio(conExcepcion.servicioId), 'suspendido')
        assert.equal(await estadoServicio(diez.servicioId), 'activo')

        const repetida = await corte(A_LAS('09:30'))
        assert.deepEqual(repetida.horas, [])
        assert.isNull(repetida.vencimiento)

        const segunda = await corte(A_LAS('10:00'))
        assert.include(segunda.horas, '10:00')
        assert.equal(await estadoServicio(diez.servicioId), 'suspendido')

        const registrado = await db
            .from('billing.cortes_ejecutados')
            .where('clave', '2030-03-04 08:00')
            .firstOrFail()
        assert.isAtLeast(registrado.cambiados, 1)
        await afirmarLibroCuadrado(assert)
    })

    test('POST /facturas/corte manual por servicio ignora la hora si se pide', async ({ client, assert }) => {
        const { servicioId } = await escenario({ plantilla: { hora_corte: '23:59' } })
        await generar(servicioId, '2026-10-01')
        const { token } = await usuarioConRoles(['contabilidad'])

        const respetando = await estado(
            client.post('/api/v1/facturas/corte').bearerToken(token).json({ servicio_id: servicioId }),
            200,
        )
        assert.containSubset(respetando.body(), { horas: ['*'], evaluados: 1 })
        const ignorando = await estado(
            client
                .post('/api/v1/facturas/corte')
                .bearerToken(token)
                .json({ servicio_id: servicioId, ignorar_hora: true }),
            200,
        )
        assert.containSubset(ignorando.body(), { evaluados: 1, cambiados: 1 })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
    })
})

test.group('billing · jobs', () => {
    test('conLock: una segunda corrida simultánea del mismo cron se omite', async ({ assert }) => {
        const externa = await conLock('prueba-lock', async () => {
            const interna = await conLock('prueba-lock', async () => 'no debería correr')
            const otra = await conLock('otro-lock', async () => 'corre')
            return { interna, otra }
        })
        assert.isFalse(externa.omitido)
        assert.deepEqual(externa.resultado!.interna, { omitido: true })
        assert.deepEqual(externa.resultado!.otra, { omitido: false, resultado: 'corre' })
        await assert.rejects(() => ejecutarCron('desconocido'), /desconocido/)
    })

    test('programa los tres job schedulers en Redis (idempotente)', async ({ assert }) => {
        const prefijo = `${process.env.COLAS_PREFIJO ?? 'a3test'}-jobs-${process.pid}`
        const cola = await programarCronsBilling({ prefijo })
        await programarCronsBilling({ prefijo }).then((otra) => otra.close())
        try {
            const programados = await cola.getJobSchedulers()
            assert.sameMembers(
                programados.map((p) => p.key),
                Object.keys(CRONS),
            )
            const corteJob = programados.find((p) => p.key === 'corte')
            assert.equal(Number(corteJob!.every), CRONS.corte)
        } finally {
            for (const nombre of Object.keys(CRONS)) await cola.removeJobScheduler(nombre)
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })
})
