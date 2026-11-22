import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import { CRONS, CRONS_DIARIOS, conLock, ejecutarCron, programarCronsBilling } from '#billing/jobs'
import { horasDeCorte } from '#billing/cortes'
import { crearPlantillaFila, escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'

/**
 * El corte manual por servicio usa un día lejano propio (2030-03-04) a mediodía.
 */
const A_LAS = (hora: string) => new Date(`2030-03-04T${hora}:00-06:00`)

/**
 * El cron de corte (sistema, sin servicio) recorre **toda la base**: vence lo pendiente de todas las
 * empresas hasta el día y evalúa cada servicio cuya hora ya pasó. En la suite completa eso son los
 * datos de todas las pruebas que corrieron antes (el orden de los archivos varía), y con un día
 * futuro la corrida vencía y cortaba miles de servicios ajenos y se pasaba de los 30 s. Por eso la
 * prueba del cron vive en un día del pasado propio (2025-03-04), anterior a los vencimientos de las
 * demás pruebas, con horas de corte que nadie más usa y sus servicios en una empresa propia; las
 * otras horas que ya existen en la base se dan por corridas ese día (`cortes_ejecutados`), como si
 * el cron ya hubiera pasado por ellas. Así la corrida solo procesa lo de esta prueba.
 */
const DIA_CRON = '2025-03-04'
const EN_EL_DIA = (hora: string) => new Date(`${DIA_CRON}T${hora}:00-06:00`)
const HORAS = { excepcion: '07:43', ocho: '08:13', diez: '10:13' }

const corte = (ahora: Date) => new EjecutarCorte().execute({ ahora }, contextoPrueba())

/** Las horas de corte de la base que no son de esta prueba quedan como ya corridas en `DIA_CRON`. */
async function otrasHorasYaCorridas() {
    const propias = new Set(Object.values(HORAS))
    const existentes = await horasDeCorte('23:59')
    const otras = existentes.filter((hora) => !propias.has(hora))
    if (otras.length === 0) return
    await db
        .knexQuery()
        .table('billing.cortes_ejecutados')
        .insert(otras.map((hora) => ({ clave: `${DIA_CRON} ${hora}` })))
        .onConflict('clave')
        .ignore()
}

test.group('billing · cron de corte', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('a la hora de cada plantilla (o de la excepción): vence lo pendiente y corta una sola vez por día', async ({
        assert,
    }) => {
        const empresa = await crearEmpresaFila()
        const enEmpresa = { empresa_id: empresa, fecha_instalacion: '2025-01-01' }
        const ocho = await escenario({ plantilla: { hora_corte: HORAS.ocho }, servicio: enEmpresa })
        const plantillaDiez = await crearPlantillaFila({ hora_corte: HORAS.diez })
        const diez = await escenario({
            servicio: { ...enEmpresa, plantilla_facturacion_id: plantillaDiez },
        })
        const conExcepcion = await escenario({
            servicio: { ...enEmpresa, plantilla_facturacion_id: plantillaDiez },
        })
        await db.table('core.servicios_excepciones').insert({
            servicio_id: conExcepcion.servicioId,
            campo: 'hora_corte',
            valor: JSON.stringify(HORAS.excepcion),
        })
        // enero y febrero: las dos vencen antes del día del cron (6 de enero y 6 de febrero)
        for (const { servicioId } of [ocho, diez, conExcepcion]) await generar(servicioId, '2025-02-01')
        await otrasHorasYaCorridas()

        const primera = await corte(EN_EL_DIA('09:00'))
        assert.sameMembers(primera.horas, [HORAS.excepcion, HORAS.ocho])
        assert.equal(primera.evaluados, 2)
        assert.isAbove(primera.vencimiento!.vencidas, 0)
        assert.equal(await estadoServicio(ocho.servicioId), 'suspendido')
        assert.equal(await estadoServicio(conExcepcion.servicioId), 'suspendido')
        assert.equal(await estadoServicio(diez.servicioId), 'activo')

        const repetida = await corte(EN_EL_DIA('09:30'))
        assert.deepEqual(repetida.horas, [])
        assert.isNull(repetida.vencimiento)

        const segunda = await corte(EN_EL_DIA('10:30'))
        assert.deepEqual(segunda.horas, [HORAS.diez])
        assert.equal(await estadoServicio(diez.servicioId), 'suspendido')

        const registrado = await db
            .from('billing.cortes_ejecutados')
            .where('clave', `${DIA_CRON} ${HORAS.ocho}`)
            .firstOrFail()
        assert.deepEqual([registrado.evaluados, registrado.cambiados], [1, 1])
        await afirmarLibroCuadrado(assert)
    })

    test('POST /facturas/corte manual por servicio ignora la hora si se pide', async ({ client, assert }) => {
        // Respetar la hora solo se ve antes de la hora de corte: con el reloj real, a las 23:59 de
        // Guatemala la primera llamada ya cortaba. La regla se prueba en un instante fijo (el día propio
        // de este archivo, a mediodía); un corte manual no registra `cortes_ejecutados`.
        const { servicioId } = await escenario({ plantilla: { hora_corte: '23:59' } })
        await generar(servicioId, '2026-10-01')
        const mediodia = A_LAS('12:00')
        const respetando = await new EjecutarCorte().execute(
            { servicio_id: servicioId, ahora: mediodia },
            contextoPrueba(),
        )
        assert.containSubset(respetando, { horas: ['*'], evaluados: 1, cambiados: 0 })
        assert.isAbove(respetando.vencimiento!.vencidas, 0)
        assert.equal(await estadoServicio(servicioId), 'activo')
        const ignorando = await new EjecutarCorte().execute(
            { servicio_id: servicioId, ignorar_hora: true, ahora: mediodia },
            contextoPrueba(),
        )
        assert.containSubset(ignorando, { horas: ['*'], evaluados: 1, cambiados: 1 })
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        // el endpoint: con ignorar_hora corta a cualquier hora del día real
        const otro = await escenario({ plantilla: { hora_corte: '23:59' } })
        await generar(otro.servicioId, '2026-10-01')
        const { token } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(
            client
                .post('/api/v1/facturas/corte')
                .bearerToken(token)
                .json({ servicio_id: otro.servicioId, ignorar_hora: true }),
            200,
        )
        assert.containSubset(respuesta.body(), { horas: ['*'], evaluados: 1, cambiados: 1 })
        assert.equal(await estadoServicio(otro.servicioId), 'suspendido')
        await afirmarLibroCuadrado(assert)
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

    test('programa los job schedulers en Redis, también el diario de conciliación (idempotente)', async ({
        assert,
    }) => {
        const prefijo = `${process.env.COLAS_PREFIJO ?? 'a3test'}-jobs-${process.pid}`
        const cola = await programarCronsBilling({ prefijo })
        await programarCronsBilling({ prefijo }).then((otra) => otra.close())
        try {
            const programados = await cola.getJobSchedulers()
            assert.sameMembers(
                programados.map((p) => p.key),
                [...Object.keys(CRONS), ...Object.keys(CRONS_DIARIOS)],
            )
            const corteJob = programados.find((p) => p.key === 'corte')
            assert.equal(Number(corteJob!.every), CRONS.corte)
            const conciliar = programados.find((p) => p.key === 'conciliar')
            assert.equal(conciliar!.pattern, CRONS_DIARIOS.conciliar.pattern)
            assert.equal(conciliar!.tz, 'America/Guatemala')
        } finally {
            for (const nombre of [...Object.keys(CRONS), ...Object.keys(CRONS_DIARIOS)]) {
                await cola.removeJobScheduler(nombre)
            }
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })
})
