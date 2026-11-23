import { test } from '@japa/runner'
import { Queue } from 'bullmq'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { conCorrida, correrJobCron } from '#monitoreo/crons/corridas'
import { desenvolver, resumir } from '#monitoreo/crons/resumen'
import { buscarCron, CATALOGO_CRONS } from '#monitoreo/crons/catalogo'
import { horarioApi, listarCrons, proximaCalculada } from '#monitoreo/crons/estado'
import { cerrarColasCrons } from '#monitoreo/crons/locks'
import { idJobManual } from '#monitoreo/actions/ejecutar_cron'
import { DateTime } from 'luxon'

/** Tareas programadas: corridas, estado y «Ejecutar ahora» (`GET/POST /sistema/crons`). */

function prefijo() {
    return process.env.COLAS_PREFIJO ?? 'argosisp'
}

async function colaBilling() {
    return new Queue('billing-cron', {
        connection: {
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: Number(process.env.REDIS_PORT ?? 6379),
        },
        prefix: prefijo(),
    })
}

async function usuarioConPermisos(permisos: string[]) {
    const { usuario, token } = await usuarioConRoles([])
    const [rol] = (await db
        .table('core.roles')
        .insert({ nombre: `prueba_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
        .returning('id')) as Array<{ id: number }>
    const ids = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(ids.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol!.id })
    return { usuario, token }
}

/** Abre una transacción con el advisory lock de un cron de billing hasta llamar a `soltar`. */
async function tomarLockBilling(nombre: string) {
    let soltar: () => void = () => {}
    let listo: () => void = () => {}
    const tomado = new Promise<void>((r) => (listo = r))
    const fin = new Promise<void>((r) => (soltar = r))
    const trx = db.transaction(async (t) => {
        await t.rawQuery('SELECT pg_advisory_xact_lock(4004, hashtext(?))', [nombre])
        listo()
        await fin
    })
    await tomado
    return async () => {
        soltar()
        await trx
    }
}

test.group('monitoreo · crons · resumen', () => {
    test('resume contadores, rutas de listas y errores parciales', ({ assert }) => {
        const generar = buscarCron('billing.generar')!
        const r = resumir({ generadas: 24, bonificadas: 1, bloqueados: 0, errores: 0 }, generar)
        assert.equal(r.estado, 'ok')
        assert.equal(r.resumen, '24 facturas emitidas, 1 periodo bonificado')

        assert.equal(resumir({ generadas: 0, bonificadas: 0, errores: 0 }, generar).estado, 'sin_cambios')
        const conError = resumir({ generadas: 3, errores: 2 }, generar)
        assert.equal(conError.estado, 'error')
        assert.equal(conError.error, '2 elementos fallaron')

        const reconciliar = buscarCron('routeros.reconciliar')!
        const rr = resumir(
            [
                { correcciones: [{}, {}], error: null },
                { correcciones: [], error: 'no responde' },
            ],
            reconciliar,
        )
        assert.equal(rr.resumen, '2 correcciones')
        assert.equal(rr.estado, 'error')

        assert.deepEqual(desenvolver({ omitido: true }), { omitido: true, resultado: null })
        assert.deepEqual(desenvolver({ omitido: false, resultado: { a: 1 } }), {
            omitido: false,
            resultado: { a: 1 },
        })
        assert.equal(resumir(null, buscarCron('core.iris_canjes_sin_uso')!).estado, 'sin_cambios')
    })

    test('horario legible y próxima corrida calculada en hora de Guatemala', ({ assert }) => {
        assert.equal(horarioApi({ tipo: 'cada', ms: 300_000 }).texto, 'Cada 5 min')
        assert.equal(horarioApi({ tipo: 'cada', ms: 3_600_000 }).texto, 'Cada hora')
        assert.equal(horarioApi({ tipo: 'diario', hora: '02:15' }).texto, 'Todos los días a las 02:15')
        const ahora = DateTime.fromISO('2026-11-21T10:00:00Z') // 04:00 en Guatemala
        assert.equal(
            proximaCalculada({ tipo: 'diario', hora: '02:15' }, ahora, null)!.toISO(),
            '2026-11-22T08:15:00.000Z',
        )
        assert.equal(
            proximaCalculada({ tipo: 'diario', hora: '06:30' }, ahora, null)!.toISO(),
            '2026-11-21T12:30:00.000Z',
        )
        assert.equal(
            proximaCalculada({ tipo: 'mensual', dia: 1, hora: '00:07' }, ahora, null)!.toISO(),
            '2026-12-01T06:07:00.000Z',
        )
    })
})

test.group('monitoreo · crons · corridas', (group) => {
    group.each.setup(async () => {
        await db.from('core.cron_corridas').delete()
    })

    test('anota inicio, fin, resultado, resumen e instancia', async ({ assert }) => {
        const salida = await conCorrida('billing.generar', {}, async () => {
            const enCurso = await db.from('core.cron_corridas').where('clave', 'billing.generar').first()
            assert.equal(enCurso.estado, 'en_curso')
            return { omitido: false, resultado: { generadas: 2, bonificadas: 0, errores: 0 } }
        })
        assert.deepEqual(salida, { omitido: false, resultado: { generadas: 2, bonificadas: 0, errores: 0 } })
        const fila = await db.from('core.cron_corridas').where('clave', 'billing.generar').firstOrFail()
        assert.equal(fila.estado, 'ok')
        assert.equal(fila.origen, 'programado')
        assert.equal(fila.resumen, '2 facturas emitidas')
        assert.isNotNull(fila.fin)
        assert.isAtLeast(fila.duracion_ms, 0)
        assert.match(fila.instancia, /:\d+$/)
    })

    test('agrupa corridas programadas seguidas sin cambios', async ({ assert }) => {
        for (let i = 0; i < 3; i++) {
            await conCorrida('billing.corte', {}, async () => ({
                omitido: false,
                resultado: { horas: [], cambiados: 0, evaluados: 0, errores: 0, vencimiento: null },
            }))
        }
        await conCorrida('billing.corte', {}, async () => ({
            omitido: false,
            resultado: { horas: ['08:00'], cambiados: 4, evaluados: 9, errores: 0, vencimiento: null },
        }))
        const filas = await db.from('core.cron_corridas').where('clave', 'billing.corte').orderBy('id')
        assert.lengthOf(filas, 2)
        assert.equal(filas[0].estado, 'sin_cambios')
        assert.equal(filas[0].repeticiones, 3)
        assert.equal(filas[0].resumen, 'Nada pendiente')
        assert.equal(filas[1].resumen, '4 servicios cambiaron de estado, 1 hora de corte procesada')
    })

    test('un error queda anotado sin secretos y se vuelve a lanzar', async ({ assert }) => {
        await assert.rejects(
            () =>
                conCorrida('billing.vencer', {}, async () => {
                    throw new Error('falló la conexión password=secreta123')
                }),
            /falló la conexión/,
        )
        const fila = await db.from('core.cron_corridas').where('clave', 'billing.vencer').firstOrFail()
        assert.equal(fila.estado, 'error')
        assert.equal(fila.error, 'falló la conexión password=***')
    })

    test('omitido cuando otra instancia tenía el lock; manual guarda quién la pidió', async ({ assert }) => {
        await conCorrida('billing.sellar', {}, async () => ({ omitido: true }))
        const omitida = await db.from('core.cron_corridas').where('clave', 'billing.sellar').firstOrFail()
        assert.equal(omitida.estado, 'omitido')

        const { usuario } = await usuarioConRoles(['admin'])
        await correrJobCron(
            'billing-cron',
            {
                name: 'promesas',
                id: 'manual-billing_promesas',
                data: { origen: 'manual', usuario_id: usuario.id },
            },
            async () => ({
                omitido: false,
                resultado: { incumplidas: 1, cumplidas: 0, canceladas: 0, errores: 0 },
            }),
        )
        const manual = await db.from('core.cron_corridas').where('clave', 'billing.promesas').firstOrFail()
        assert.equal(manual.origen, 'manual')
        assert.equal(Number(manual.usuario_id), usuario.id)
        assert.equal(manual.job_id, 'manual-billing_promesas')

        // un job que no es cron (a pedido) solo corre
        const r = await correrJobCron('routeros-cron', { name: 'cambiar_control' }, async () => 7)
        assert.equal(r, 7)
        const total = await db.from('core.cron_corridas').count('* as n').first()
        assert.equal(Number(total.n), 2)
    })
})

test.group('monitoreo · crons · API', (group) => {
    group.each.setup(async () => {
        await db.from('core.cron_corridas').delete()
        const cola = await colaBilling()
        await cola.obliterate({ force: true })
        await cola.close()
    })
    group.teardown(async () => {
        const cola = await colaBilling()
        await cola.obliterate({ force: true })
        await cola.close()
        await cerrarColasCrons()
    })

    test('GET lista todo el catálogo con última corrida, atraso e interrumpidas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        // generar: última correcta hace 3 h (cada hora + 30 min de tolerancia) → atrasada
        await db.table('core.cron_corridas').insert({
            clave: 'billing.generar',
            origen: 'programado',
            estado: 'ok',
            inicio: db.raw(`now() - interval '3 hours'`),
            ultimo_inicio: db.raw(`now() - interval '3 hours'`),
            fin: db.raw(`now() - interval '3 hours'`),
            duracion_ms: 1200,
            resumen: '5 facturas emitidas',
            instancia: 'worker-1:10',
        })
        // vencer: quedó en curso en una instancia que murió hace 10 min (nadie tiene el lock)
        await db.table('core.cron_corridas').insert({
            clave: 'billing.vencer',
            origen: 'programado',
            estado: 'en_curso',
            inicio: db.raw(`now() - interval '10 minutes'`),
            ultimo_inicio: db.raw(`now() - interval '10 minutes'`),
            instancia: 'worker-2:20',
        })
        const r = await estado(client.get('/api/v1/sistema/crons').bearerToken(token), 200)
        const data = r.body().data as Array<Record<string, any>>
        assert.sameMembers(
            data.map((c) => c.clave),
            CATALOGO_CRONS.map((c) => c.clave),
        )
        const generar = data.find((c) => c.clave === 'billing.generar')!
        // El atraso también mira audit.acciones, que es inmutable y comparte base con otras suites:
        // si otra suite corrió el cron de facturación hace poco, «ahora» no sirve. Tres horas
        // después de este momento, ninguna corrida correcta (de esta prueba ni de otra) es reciente.
        const despues = await listarCrons({ ahora: new Date(Date.now() + 3 * 3_600_000) })
        const generarDespues = despues.data.find((c) => c.clave === 'billing.generar')!
        assert.equal(generarDespues.estado, 'atrasada')
        assert.isTrue(generarDespues.atrasada)
        assert.equal(generar.ultima.resumen, '5 facturas emitidas')
        assert.equal(generar.horario.texto, 'Cada hora')
        assert.isTrue(generar.manual)
        assert.includeMembers(generar.permisos, ['sistema.ejecutar_cron', 'facturas.generar'])
        assert.isNotNull(generar.proxima)

        const vencer = data.find((c) => c.clave === 'billing.vencer')!
        assert.equal(vencer.estado, 'error')
        assert.match(vencer.ultima.error, /se interrumpió/)
        assert.isNull(vencer.en_curso)

        const relay = data.find((c) => c.clave === 'sistema.relay_outbox')!
        assert.isFalse(relay.manual)
        assert.equal(relay.horario.tipo, 'continuo')
    })

    test('lock tomado: se ve en curso con su instancia y «Ejecutar ahora» responde 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const soltar = await tomarLockBilling('generar')
        try {
            await db.table('core.cron_corridas').insert({
                clave: 'billing.generar',
                origen: 'programado',
                estado: 'en_curso',
                instancia: 'worker-9:99',
            })
            const { data } = await listarCrons()
            const generar = data.find((c) => c.clave === 'billing.generar')!
            assert.equal(generar.estado, 'en_curso')
            assert.isTrue(generar.lock!.tomado)
            assert.equal(generar.lock!.instancia, 'worker-9:99')
            assert.equal(generar.en_curso!.instancia, 'worker-9:99')

            const r = await estado(
                client.post('/api/v1/sistema/crons/billing.generar/ejecutar').bearerToken(token),
                409,
            )
            assert.match(r.body().type, /en_curso$/)
        } finally {
            await soltar()
        }
    })

    test('«Ejecutar ahora» encola el job con quién lo pidió, idempotente y auditado', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post('/api/v1/sistema/crons/billing.vencer/ejecutar')
                .header('Idempotency-Key', 'crons-vencer-1')
                .bearerToken(token),
            202,
        )
        assert.equal(r.body().estado, 'encolada')
        assert.equal(r.body().job_id, idJobManual('billing.vencer'))

        const cola = await colaBilling()
        const job = await cola.getJob(idJobManual('billing.vencer'))
        assert.equal(job!.name, 'vencer')
        assert.equal(job!.data.origen, 'manual')
        assert.equal(job!.data.usuario_id, usuario.id)
        await cola.close()

        // misma clave de idempotencia: misma respuesta, sin encolar otro
        const repetida = await estado(
            client
                .post('/api/v1/sistema/crons/billing.vencer/ejecutar')
                .header('Idempotency-Key', 'crons-vencer-1')
                .bearerToken(token),
            202,
        )
        assert.deepEqual(repetida.body(), r.body())
        // otro pedido mientras espera: 409
        await estado(client.post('/api/v1/sistema/crons/billing.vencer/ejecutar').bearerToken(token), 409)

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'sistema.ejecutar_cron')
            .where('actor_id', usuario.id)
            .where('resultado', 'ok')
        assert.lengthOf(auditoria, 1)
    })

    test('404, 422 en procesos continuos y permisos propios del cron', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(client.post('/api/v1/sistema/crons/no.existe/ejecutar').bearerToken(token), 404)
        await estado(client.get('/api/v1/sistema/crons/no.existe/corridas').bearerToken(token), 404)
        await estado(
            client.post('/api/v1/sistema/crons/sistema.relay_outbox/ejecutar').bearerToken(token),
            422,
        )

        const solo = await usuarioConPermisos(['sistema.ver_crons', 'sistema.ejecutar_cron'])
        await estado(
            client.post('/api/v1/sistema/crons/billing.generar/ejecutar').bearerToken(solo.token),
            403,
        )
        await estado(client.get('/api/v1/sistema/crons').bearerToken(solo.token), 200)

        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/sistema/crons').bearerToken(cajero.token), 403)
        await estado(
            client.post('/api/v1/sistema/crons/billing.vencer/ejecutar').bearerToken(cajero.token),
            403,
        )
    })

    test('historial paginado por cursor, del más nuevo al más viejo', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const resumen of ['uno', 'dos', 'tres']) {
            await db.table('core.cron_corridas').insert({
                clave: 'billing.sellar',
                origen: 'programado',
                estado: 'ok',
                fin: db.raw('now()'),
                duracion_ms: 5,
                resumen,
                instancia: 'w:1',
            })
        }
        const p1 = await estado(
            client.get('/api/v1/sistema/crons/billing.sellar/corridas?limit=2').bearerToken(token),
            200,
        )
        assert.deepEqual(
            p1.body().data.map((c: { resumen: string }) => c.resumen),
            ['tres', 'dos'],
        )
        assert.isString(p1.body().nextCursor)
        const p2 = await estado(
            client
                .get(`/api/v1/sistema/crons/billing.sellar/corridas?limit=2&cursor=${p1.body().nextCursor}`)
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            p2.body().data.map((c: { resumen: string }) => c.resumen),
            ['uno'],
        )
        assert.isNull(p2.body().nextCursor)
        assert.equal(p2.body().data[0].fuente, 'corridas')
    })
})
