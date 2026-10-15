import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { Queue, type Worker } from 'bullmq'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica } from '#tests/core/fabricas'
import { NOMBRE_COLA_ACCOUNTING, type RegistroAccounting } from '#network/sesiones/registro'
import { crearWorkerAccounting, procesarAccounting } from '#network/sesiones/cola'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import TerminarSesion from '#network/sesiones/actions/terminar_sesion'

/**
 * Tarea 4 de A2: accounting → `network.sesiones` + `sesion.iniciada` / `sesion.terminada` por outbox.
 * Postgres real; la última prueba pasa por BullMQ real (Redis local, prefijo propio).
 */

interface Escenario {
    servicioId: number
    routerId: number
    nasIp: string
    userPpp: string
    enlace: string
    delegado: string
}

let contadorV6 = 0

async function escenario(ipv6Modo = 'radius_servicio'): Promise<Escenario> {
    const nasIp = ipUnica()
    const routerId = await crearRouterFila({ nas_ip: nasIp })
    const clienteId = await crearClienteFila()
    const userPpp = unico('ppp')
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        router_id: routerId,
        user_ppp: userPpp,
        ipv6_modo: ipv6Modo,
    })
    contadorV6 += 1
    // La BD se recrea en cada corrida (tests/bootstrap.ts): basta un contador.
    const n = contadorV6.toString(16)
    const enlace = `2001:db8:a2:${n}::/64`
    const delegado = `2001:db8:a3:${n}00::/56`
    await db.table('network.ipv6_asignaciones').multiInsert([
        { servicio_id: servicioId, prefijo: enlace, tipo: 'enlace' },
        { servicio_id: servicioId, prefijo: delegado, tipo: 'delegacion' },
    ])
    return { servicioId, routerId, nasIp, userPpp, enlace, delegado }
}

function registro(e: Escenario, parcial: Partial<RegistroAccounting> = {}): RegistroAccounting {
    return {
        tipo: 'Start',
        nas_ip: e.nasIp,
        acct_session_id: unico('ses'),
        user_ppp: e.userPpp,
        ipv4: '10.10.1.10',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        bytes_in: '0',
        bytes_out: '0',
        duracion_s: null,
        causa_fin: null,
        evento_en: new Date().toISOString(),
        ...parcial,
    }
}

async function sesion(nasIp: string, acctSessionId: string) {
    return db
        .from('network.sesiones')
        .whereRaw('nas_ip = ?::inet', [nasIp])
        .where('acct_session_id', acctSessionId)
        .select(
            '*',
            db.raw('host(ipv4) AS ipv4_txt'),
            db.raw('prefijo_enlace_v6::text AS enlace_txt'),
            db.raw('prefijo_delegado_v6::text AS delegado_txt'),
        )
        .first()
}

/** Eventos de sesión emitidos para un acct_session_id. */
async function eventos(acctSessionId: string) {
    return db
        .from('audit.outbox')
        .whereIn('evento', ['sesion.iniciada', 'sesion.terminada'])
        .whereRaw("payload->>'acct_session_id' = ?", [acctSessionId])
        .orderBy('id')
        .select('evento', 'payload')
}

async function nombresEventos(acctSessionId: string): Promise<string[]> {
    const lista = await eventos(acctSessionId)
    return lista.map((x) => x.evento as string)
}

test.group('network · sesiones (accounting)', () => {
    test('Start → sesión abierta y sesion.iniciada con el /56 de la asignación vigente', async ({
        assert,
    }) => {
        const e = await escenario()
        // RouterOS 7.24.5 manda Framed-IPv6-Prefix pero no Delegated-IPv6-Prefix.
        const r = registro(e, { prefijo_enlace_v6: e.enlace })
        const resultado = await procesarAccounting(r, randomUUID())
        assert.deepInclude(resultado, { efecto: 'abierta', eventos: ['sesion.iniciada'] })

        const fila = await sesion(e.nasIp, r.acct_session_id)
        assert.equal(Number(fila.servicio_id), e.servicioId)
        assert.equal(Number(fila.router_id), e.routerId)
        assert.equal(fila.ipv4_txt, '10.10.1.10')
        assert.equal(fila.enlace_txt, e.enlace)
        assert.equal(fila.delegado_txt, e.delegado)
        assert.isNull(fila.fin)

        const [evento] = await eventos(r.acct_session_id)
        assert.equal(evento.evento, 'sesion.iniciada')
        assert.deepEqual(evento.payload, {
            servicio_id: e.servicioId,
            nas_ip: e.nasIp,
            acct_session_id: r.acct_session_id,
            ipv4: '10.10.1.10',
            prefijos_v6: [e.enlace, e.delegado],
        })

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'sesiones.iniciar')
            .where('entidad_id', fila.id)
            .first()
        assert.equal(accion.resultado, 'ok')
        assert.equal(accion.canal, 'worker')
    })

    test('el prefijo que reporta el NAS gana sobre la asignación; radius_pool no usa la asignación', async ({
        assert,
    }) => {
        const e = await escenario()
        const r = registro(e, {
            prefijo_enlace_v6: '2001:db8:ffff:1::/64',
            prefijo_delegado_v6: '2001:db8:ffee:100::/56',
        })
        await procesarAccounting(r, randomUUID())
        const fila = await sesion(e.nasIp, r.acct_session_id)
        assert.equal(fila.enlace_txt, '2001:db8:ffff:1::/64')
        assert.equal(fila.delegado_txt, '2001:db8:ffee:100::/56')

        const pool = await escenario('radius_pool')
        const rp = registro(pool, { prefijo_enlace_v6: '2001:db8:fffe:1::/64' })
        await procesarAccounting(rp, randomUUID())
        const filaPool = await sesion(pool.nasIp, rp.acct_session_id)
        assert.equal(filaPool.enlace_txt, '2001:db8:fffe:1::/64')
        assert.isNull(filaPool.delegado_txt)
    })

    test('Start → Interim → Stop: contadores, cierre y un solo evento de cada tipo aunque se repitan', async ({
        assert,
    }) => {
        const e = await escenario()
        const inicio = new Date(Date.now() - 600_000)
        const r = registro(e, { evento_en: inicio.toISOString() })
        await procesarAccounting(r, randomUUID())
        assert.deepInclude(await procesarAccounting(r, randomUUID()), { efecto: 'actualizada', eventos: [] })

        const interim = {
            ...r,
            tipo: 'Interim-Update' as const,
            bytes_in: '1000',
            bytes_out: '5000000000',
            duracion_s: 300,
            evento_en: new Date(inicio.getTime() + 300_000).toISOString(),
        }
        assert.deepInclude(await procesarAccounting(interim, randomUUID()), { efecto: 'actualizada' })
        let fila = await sesion(e.nasIp, r.acct_session_id)
        assert.equal(String(fila.bytes_in), '1000')
        assert.equal(String(fila.bytes_out), '5000000000')

        const stop = {
            ...r,
            tipo: 'Stop' as const,
            bytes_in: '2000',
            bytes_out: '6000000000',
            duracion_s: 600,
            causa_fin: 'User-Request',
            evento_en: new Date(inicio.getTime() + 600_000).toISOString(),
        }
        assert.deepInclude(await procesarAccounting(stop, randomUUID()), {
            efecto: 'cerrada',
            eventos: ['sesion.terminada'],
        })
        assert.deepInclude(await procesarAccounting(stop, randomUUID()), { efecto: 'ignorada' })
        // Interim tardío: no reabre ni cambia contadores
        assert.deepInclude(await procesarAccounting(interim, randomUUID()), { efecto: 'ignorada' })

        fila = await sesion(e.nasIp, r.acct_session_id)
        assert.equal(new Date(fila.fin).toISOString(), stop.evento_en)
        assert.equal(new Date(fila.inicio).toISOString(), r.evento_en)
        assert.equal(fila.causa_fin, 'User-Request')
        assert.equal(String(fila.bytes_out), '6000000000')

        const lista = await eventos(r.acct_session_id)
        assert.deepEqual(
            lista.map((x) => x.evento),
            ['sesion.iniciada', 'sesion.terminada'],
        )
        assert.deepEqual(lista[1].payload.prefijos_v6, [e.enlace, e.delegado])
    })

    test('desorden: Stop sin Start crea la sesión cerrada; el Start tardío se ignora', async ({ assert }) => {
        const e = await escenario()
        const fin = new Date()
        const stop = registro(e, {
            tipo: 'Stop',
            duracion_s: 120,
            causa_fin: 'Lost-Carrier',
            evento_en: fin.toISOString(),
        })
        assert.deepInclude(await procesarAccounting(stop, randomUUID()), { efecto: 'creada_cerrada' })
        const start = {
            ...stop,
            tipo: 'Start' as const,
            evento_en: new Date(fin.getTime() - 120_000).toISOString(),
        }
        assert.deepInclude(await procesarAccounting(start, randomUUID()), { efecto: 'ignorada' })

        const fila = await sesion(e.nasIp, stop.acct_session_id)
        assert.equal(new Date(fila.inicio).toISOString(), start.evento_en)
        assert.deepEqual(await nombresEventos(stop.acct_session_id), ['sesion.terminada'])
    })

    test('Interim sin Start abre la sesión con inicio = evento − Acct-Session-Time', async ({ assert }) => {
        const e = await escenario()
        const ahora = new Date()
        const r = registro(e, { tipo: 'Interim-Update', duracion_s: 900, evento_en: ahora.toISOString() })
        assert.deepInclude(await procesarAccounting(r, randomUUID()), {
            efecto: 'abierta',
            eventos: ['sesion.iniciada'],
        })
        const fila = await sesion(e.nasIp, r.acct_session_id)
        assert.equal(new Date(fila.inicio).getTime(), ahora.getTime() - 900_000)
    })

    test('una sesión nueva del mismo usuario cierra la vieja que perdió su Stop', async ({ assert }) => {
        const e = await escenario()
        const vieja = registro(e, { evento_en: new Date(Date.now() - 3_600_000).toISOString() })
        await procesarAccounting(vieja, randomUUID())
        const nueva = registro(e)
        await procesarAccounting(nueva, randomUUID())

        const filaVieja = await sesion(e.nasIp, vieja.acct_session_id)
        assert.equal(filaVieja.causa_fin, 'Sesion-Reemplazada')
        assert.equal(new Date(filaVieja.fin).toISOString(), nueva.evento_en)
        const filaNueva = await sesion(e.nasIp, nueva.acct_session_id)
        assert.isNull(filaNueva.fin)
        assert.deepEqual(await nombresEventos(vieja.acct_session_id), ['sesion.iniciada', 'sesion.terminada'])
    })

    test('acct_session_id reutilizado por el NAS: archiva la sesión vieja y abre otra', async ({
        assert,
    }) => {
        const e = await escenario()
        const id = unico('ses')
        const t0 = Date.now() - 7_200_000
        await procesarAccounting(
            registro(e, { acct_session_id: id, evento_en: new Date(t0).toISOString() }),
            randomUUID(),
        )
        await procesarAccounting(
            registro(e, {
                acct_session_id: id,
                tipo: 'Stop',
                duracion_s: 60,
                evento_en: new Date(t0 + 60_000).toISOString(),
            }),
            randomUUID(),
        )
        const otra = registro(e, { acct_session_id: id })
        assert.deepInclude(await procesarAccounting(otra, randomUUID()), { efecto: 'abierta' })

        const filas = await db
            .from('network.sesiones')
            .whereRaw('nas_ip = ?::inet', [e.nasIp])
            .where('acct_session_id', 'like', `${id}%`)
            .orderBy('id')
        assert.lengthOf(filas, 2)
        assert.equal(filas[0].acct_session_id, `${id}~${filas[0].id}`)
        assert.isNotNull(filas[0].fin)
        assert.equal(filas[1].acct_session_id, id)
        assert.isNull(filas[1].fin)
    })

    test('Accounting-On cierra todas las sesiones abiertas de ese NAS', async ({ assert }) => {
        const e = await escenario()
        const otro = await escenario()
        const a = registro(e)
        const b = registro(otro)
        await procesarAccounting(a, randomUUID())
        await procesarAccounting(b, randomUUID())

        const on = registro(e, {
            tipo: 'Accounting-On',
            acct_session_id: '',
            user_ppp: '',
            evento_en: new Date(Date.now() + 1000).toISOString(),
        })
        const resultado = (await procesarAccounting(on, randomUUID())) as { cerradas: number[] }
        assert.lengthOf(resultado.cerradas, 1)
        const filaA = await sesion(e.nasIp, a.acct_session_id)
        const filaB = await sesion(otro.nasIp, b.acct_session_id)
        assert.equal(filaA.causa_fin, 'NAS-Reboot')
        assert.isNull(filaB.fin)
    })

    test('usuario sin servicio ni router conocidos: se registra igual con ids nulos', async ({ assert }) => {
        const nasIp = ipUnica()
        const r: RegistroAccounting = {
            ...registro({ nasIp, userPpp: unico('fantasma') } as Escenario),
        }
        await new IniciarSesion().execute(r, contextoPrueba())
        const fila = await sesion(nasIp, r.acct_session_id)
        assert.isNull(fila.servicio_id)
        assert.isNull(fila.router_id)
        await new TerminarSesion().execute({ ...r, tipo: 'Stop' }, contextoPrueba())
        const [, terminada] = await eventos(r.acct_session_id)
        assert.isNull(terminada.payload.servicio_id)
    })
})

test.group('network · sesiones:worker (BullMQ)', (group) => {
    let cola: Queue
    let worker: Worker

    group.each.setup(async () => {
        const prefijo = `a2test-${randomUUID().slice(0, 8)}`
        const conexion = {
            host: process.env.REDIS_HOST ?? '127.0.0.1',
            port: Number(process.env.REDIS_PORT ?? 6379),
            maxRetriesPerRequest: null,
        }
        cola = new Queue(NOMBRE_COLA_ACCOUNTING, { connection: conexion, prefix: prefijo })
        worker = crearWorkerAccounting({ conexion: conexion, prefijo, concurrencia: 2 })
        return async () => {
            await worker.close()
            await cola.obliterate({ force: true })
            await cola.close()
        }
    })

    test('procesa el job que deja aaa y descarta uno inválido sin reintentar', async ({ assert }) => {
        const e = await escenario()
        const r = registro(e)
        const job = await cola.add('Start', r, { attempts: 3 })
        const malo = await cola.add('Start', { tipo: 'Start', nas_ip: 'no-es-ip' }, { attempts: 3 })

        const limite = Date.now() + 10_000
        while (Date.now() < limite) {
            const [estado, estadoMalo] = await Promise.all([job.getState(), malo.getState()])
            if (estado === 'completed' && estadoMalo === 'failed') break
            await new Promise((resolver) => setTimeout(resolver, 50))
        }
        assert.equal(await job.getState(), 'completed')
        assert.equal(await malo.getState(), 'failed')
        const fallido = await cola.getJob(malo.id!)
        assert.equal(fallido?.attemptsMade, 1)
        assert.isNotNull(await sesion(e.nasIp, r.acct_session_id))
    })
})
