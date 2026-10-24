import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { Queue, Worker } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import ProgramarRecordatorios from '#notify/actions/programar_recordatorios'
import { ejecutarRecordatorios, crearWorkerCron, programarCronRecordatorios } from '#notify/recordatorios'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { venceRelativo } from '#notify/variables'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { CanalFalso, ColaFalsa, crearCliente, crearFactura, crearServicio } from '#tests/notify/ayudas_notify'

/**
 * Las fechas de estas pruebas están en 2027 (lejos de las facturas de otras pruebas). La hora
 * por defecto de los recordatorios es 09:00 de Guatemala = 15:00 UTC.
 */

async function facturaPendiente(
    vence: string,
    datos: { pagado?: string; estado?: string; emitidaEn?: string; email?: string } = {},
) {
    const clienteId = await crearCliente({ email: datos.email })
    const servicioId = await crearServicio(clienteId)
    const facturaId = await crearFactura(clienteId, servicioId, {
        vence,
        periodo: `${vence.slice(0, 7)}-01`,
        total: '150.00',
        pagado: datos.pagado,
        estado: datos.estado,
    })
    await db
        .from('billing.facturas')
        .where('id', facturaId)
        .update({ emitida_en: datos.emitidaEn ?? '2026-10-01T00:00:00Z' })
    return { clienteId, facturaId }
}

const programar = (ahora: string, extra: { ventanaDias?: number } = {}) =>
    new ProgramarRecordatorios().execute({ ahora, ...extra }, contextoSistema('cron'))

const enviosDe = (facturaId: number) =>
    db.from('notify.envios').where('origen', 'like', `recordatorio:%:factura:${facturaId}`).orderBy('id')

test.group('notify · recordatorios de pago', (group) => {
    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', new CanalFalso('telegram'))
        return () => reiniciarCanales()
    })

    test('texto relativo del vencimiento', ({ assert }) => {
        assert.equal(venceRelativo(0), 'vence hoy')
        assert.equal(venceRelativo(1), 'vence mañana')
        assert.equal(venceRelativo(3), 'vence en 3 días')
        assert.equal(venceRelativo(-1), 'venció ayer')
        assert.equal(venceRelativo(-4), 'venció hace 4 días')
    })

    test('se programa a la hora del recordatorio (Guatemala) y una sola vez', async ({ assert }) => {
        const { clienteId, facturaId } = await facturaPendiente('2027-03-10', { email: 'rec@prueba.local' })

        await programar('2027-03-07T14:59:00Z')
        assert.lengthOf(await enviosDe(facturaId), 0)

        const resultado = await programar('2027-03-07T15:00:00Z')
        const envios = await enviosDe(facturaId)
        assert.lengthOf(envios, 1)
        assert.containsSubset(envios[0], {
            origen: `recordatorio:1:factura:${facturaId}`,
            evento: 'recordatorio.1',
            cliente_id: clienteId,
            canal: 'correo',
            destino: 'rec@prueba.local',
            estado: 'encolado',
        })
        assert.equal(envios[0].asunto, `Recordatorio: tu factura ${facturaId} vence en 3 días`)
        assert.include(envios[0].cuerpo, 'vence en 3 días (10/03/2027). Saldo pendiente: Q 150.00.')
        assert.include(resultado.encolar, envios[0].id)

        await programar('2027-03-07T18:00:00Z')
        assert.lengthOf(await enviosDe(facturaId), 1)
    })

    test('si el cron estuvo detenido manda solo el último recordatorio que toca', async ({ assert }) => {
        const { facturaId } = await facturaPendiente('2027-04-10')

        await programar('2027-04-14T16:00:00Z')

        const envios = await enviosDe(facturaId)
        assert.lengthOf(envios, 1)
        assert.equal(envios[0].origen, `recordatorio:3:factura:${facturaId}`)
        assert.include(envios[0].cuerpo, 'venció hace 4 días')
        assert.include(envios[0].cuerpo, 'Paga hoy para evitar la suspensión')
    })

    test('no avisa facturas pagadas, anuladas, fuera de la ventana o antes de su emisión', async ({
        assert,
    }) => {
        const pagada = await facturaPendiente('2027-05-10', { pagado: '150.00', estado: 'pagada' })
        const anulada = await facturaPendiente('2027-05-10', { estado: 'anulada' })
        const vieja = await facturaPendiente('2027-03-20')
        // emitida después del momento del recordatorio 1 (07/05 09:00)
        const tardia = await facturaPendiente('2027-05-10', { emitidaEn: '2027-05-08T12:00:00Z' })

        await programar('2027-05-09T00:00:00Z')
        for (const { facturaId } of [pagada, anulada, vieja, tardia]) {
            assert.lengthOf(await enviosDe(facturaId), 0)
        }

        await programar('2027-05-10T15:00:00Z')
        const envios = await enviosDe(tardia.facturaId)
        assert.deepEqual(
            envios.map((e) => e.origen),
            [`recordatorio:2:factura:${tardia.facturaId}`],
        )
        assert.lengthOf(await enviosDe(pagada.facturaId), 0)
    })

    test('solo recuerda deuda cobrable: un caso por cada estado de la factura', async ({ assert }) => {
        // Momento del recordatorio 2 (vence hoy) del 10/09/2027: 15:00 UTC.
        const vence = '2027-09-10'
        const casos: Array<{ estado: string; pagado?: string; recuerda: boolean }> = [
            { estado: 'emitida', recuerda: true },
            { estado: 'parcial', pagado: '50.00', recuerda: true },
            { estado: 'vencida', recuerda: true },
            // aún no es documento cobrable (espera certificación FEL)
            { estado: 'por_certificar', recuerda: false },
            { estado: 'pagada', pagado: '150.00', recuerda: false },
            { estado: 'anulada', recuerda: false },
            // castigo de cartera: `pagado` es solo lo cobrado, el resto se dio por incobrable
            { estado: 'castigada', pagado: '20.00', recuerda: false },
            // aviso de cobro cubierto por notas internas
            { estado: 'acreditada', recuerda: false },
            // estado pendiente pero sin saldo (total = pagado): no hay nada que cobrar
            { estado: 'parcial', pagado: '150.00', recuerda: false },
        ]
        const facturas = []
        for (const caso of casos) {
            facturas.push({ caso, ...(await facturaPendiente(vence, caso)) })
        }
        // Sustituida: la original sigue "emitida" pero ya tiene una sustituta (billing.sustituciones).
        const original = await facturaPendiente(vence)
        const nueva = await facturaPendiente(vence)
        await db.table('billing.sustituciones').insert({
            empresa_id: 1,
            original_id: original.facturaId,
            nueva_id: nueva.facturaId,
            tipo: 'anulacion',
            motivo: 'prueba de recordatorios',
        })

        await programar('2027-09-10T15:00:00Z')

        for (const { caso, facturaId } of facturas) {
            const envios = await enviosDe(facturaId)
            assert.lengthOf(
                envios,
                caso.recuerda ? 1 : 0,
                `estado ${caso.estado} (pagado ${caso.pagado ?? '0.00'}) ${caso.recuerda ? 'debe' : 'no debe'} recordarse`,
            )
        }
        assert.lengthOf(await enviosDe(original.facturaId), 0, 'la factura sustituida no se recuerda')
        assert.lengthOf(await enviosDe(nueva.facturaId), 1, 'la sustituta sí')
        const parcial = await enviosDe(facturas[1]!.facturaId)
        assert.include(parcial[0].cuerpo, 'Saldo pendiente: Q 100.00')
    })

    test('respeta recordatorios inactivos y plantillas inactivas', async ({ assert }) => {
        const r3 = await db.from('notify.recordatorios').where('orden', 3).firstOrFail()
        await db.from('notify.recordatorios').where('id', r3.id).update({ activo: false })
        try {
            const { facturaId } = await facturaPendiente('2027-06-10')
            await programar('2027-06-14T16:00:00Z')
            const envios = await enviosDe(facturaId)
            assert.deepEqual(
                envios.map((e) => e.origen),
                [`recordatorio:2:factura:${facturaId}`],
            )
        } finally {
            await db.from('notify.recordatorios').where('id', r3.id).update({ activo: true })
        }

        await db.from('notify.plantillas').where('evento', 'recordatorio.1').update({ activa: false })
        try {
            const { facturaId } = await facturaPendiente('2027-06-20')
            await programar('2027-06-17T16:00:00Z')
            assert.lengthOf(await enviosDe(facturaId), 0)
        } finally {
            await db.from('notify.plantillas').where('evento', 'recordatorio.1').update({ activa: true })
        }
    })

    test('ejecutarRecordatorios procesa en lotes hasta agotar lo pendiente y encola', async ({ assert }) => {
        const facturas = await Promise.all(
            ['2027-08-10', '2027-08-10', '2027-08-10'].map((v) => facturaPendiente(v)),
        )
        const cola = new ColaFalsa()

        const totales = await ejecutarRecordatorios(cola, { ahora: '2027-08-07T15:30:00Z', limite: 1 })

        assert.isAtLeast(totales.lotes, 3)
        assert.equal(totales.errores, 0)
        for (const { facturaId } of facturas) {
            const envios = await enviosDe(facturaId)
            assert.lengthOf(envios, 1)
            assert.include(cola.ids, envios[0].id)
        }
    })

    test('lista y edita la configuración con version y auditoría', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const lista = await estado(client.get('/api/v1/notificaciones/recordatorios').bearerToken(token), 200)
        const filas = lista.body() as Array<{ id: number; orden: number; dias: number; version: number }>
        assert.deepEqual(
            filas.map((r) => r.orden),
            [1, 2, 3],
        )
        const r1 = filas[0]!

        const editado = await estado(
            client
                .put(`/api/v1/notificaciones/recordatorios/${r1.id}`)
                .bearerToken(token)
                .json({ version: r1.version, dias: -5, hora: '07:30' }),
            200,
        )
        assert.containsSubset(editado.body(), { dias: -5, hora: '07:30:00', version: r1.version + 1 })
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'recordatorio', entidad_id: r1.id })
            .orderBy('campo')
        assert.deepEqual(
            cambios.map((c) => c.campo),
            ['dias', 'hora'],
        )

        await estado(
            client
                .put(`/api/v1/notificaciones/recordatorios/${r1.id}`)
                .bearerToken(token)
                .json({ version: r1.version, dias: 1 }),
            409,
        )
        await estado(
            client
                .put(`/api/v1/notificaciones/recordatorios/${r1.id}`)
                .bearerToken(token)
                .json({ version: r1.version + 1, hora: '25:00' }),
            422,
        )
        // deja la configuración como estaba para las demás pruebas
        await db.from('notify.recordatorios').where('id', r1.id).update({ dias: r1.dias, hora: '09:00' })
    })
})

test.group('notify · cron de recordatorios (BullMQ)', (group) => {
    let colaCron: Queue
    let worker: Worker

    group.each.setup(async () => {
        registrarCanal('correo', new CanalFalso('correo'))
        const prefijo = `a6test-${randomUUID().slice(0, 8)}`
        colaCron = await programarCronRecordatorios({ prefijo, cadaMs: 200 })
        worker = crearWorkerCron(new ColaFalsa(), { prefijo })
        return async () => {
            await worker.close()
            await colaCron.obliterate({ force: true })
            await colaCron.close()
            reiniciarCanales()
        }
    })

    test('el job scheduler dispara el cron y programa lo pendiente hasta ahora', async ({ assert }) => {
        const hoy = DateTime.now().setZone('America/Guatemala').startOf('day')
        const vence = hoy.minus({ days: 1 }).toISODate()!
        const { facturaId } = await facturaPendiente(vence, {
            emitidaEn: hoy.minus({ days: 10 }).toUTC().toISO()!,
        })

        const limite = Date.now() + 10_000
        let envios = await enviosDe(facturaId)
        while (envios.length === 0 && Date.now() < limite) {
            await new Promise((resolver) => setTimeout(resolver, 100))
            envios = await enviosDe(facturaId)
        }
        assert.deepEqual(
            envios.map((e) => e.origen),
            [`recordatorio:2:factura:${facturaId}`],
        )
        assert.include(envios[0].cuerpo, 'venció ayer')
    }).timeout(15_000)
})
