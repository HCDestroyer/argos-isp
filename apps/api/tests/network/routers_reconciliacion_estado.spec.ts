import { test } from '@japa/runner'
import { Queue, type Worker } from 'bullmq'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import env from '#start/env'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import {
    NOMBRE_COLA_ROUTEROS,
    cerrarColaCambios,
    crearWorkerRouterOS,
    idJobReconciliar,
} from '#network/routeros/jobs'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila, ipUnica } from '#tests/core/fabricas'

/**
 * «Reconciliar ahora» no informaba nada (bug del PM, v1.17.0): `GET /routers/:id/reconciliaciones/:job_id`
 * lee el job de BullMQ (estado, instantes, `returnvalue` con cambios y errores) con un worker real.
 */

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 300,
            reintentos: 0,
            esperaMs: 5,
        }),
}

type Estado = {
    router_id: number
    job_id: string
    estado: string
    encolado_en: string | null
    iniciado_en: string | null
    terminado_en: string | null
    cambios: number | null
    errores: Array<{ operacion: string; mensaje: string }>
    error: string | null
}

test.group('Routers · estado de «Reconciliar ahora»', (group) => {
    let falso: RouterOSFalso
    let cola: Queue
    let worker: Worker | null = null
    let token: string

    group.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        cola = new Queue(NOMBRE_COLA_ROUTEROS, {
            connection: { host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 },
            prefix: env.get('COLAS_PREFIJO') ?? 'argosisp',
        })
        ;({ token } = await usuarioConRoles(['tecnico']))
        return async () => {
            await cerrarColaCambios()
            await cola.close()
            await falso.cerrar()
        }
    })
    group.each.setup(() => {
        falso.rechazos.clear()
        return async () => {
            await worker?.close()
            worker = null
        }
    })

    async function routerConApi() {
        const id = await crearRouterFila({
            nas_ip: ipUnica(),
            api_url: falso.url,
            api_tls_verificar: false,
            api_usuario: falso.usuario,
            api_password: cifrar(falso.password),
        })
        await cola.remove(idJobReconciliar(id))
        return id
    }

    async function ver(client: ApiClient, routerId: number, jobId: string): Promise<Estado> {
        const r = await estado(
            client.get(`/api/v1/routers/${routerId}/reconciliaciones/${jobId}`).bearerToken(token),
            200,
        )
        return r.body()
    }

    async function hastaTerminar(client: ApiClient, routerId: number, jobId: string): Promise<Estado> {
        const limite = Date.now() + 15_000
        for (;;) {
            const e = await ver(client, routerId, jobId)
            if (e.estado === 'completada' || e.estado === 'fallida') return e
            if (Date.now() > limite) throw new Error(`la reconciliación no terminó: ${JSON.stringify(e)}`)
            await new Promise((r) => setTimeout(r, 100))
        }
    }

    async function encolar(client: ApiClient, routerId: number): Promise<{ job_id: string }> {
        const r = await estado(client.post(`/api/v1/routers/${routerId}/reconciliar`).bearerToken(token), 202)
        return r.body()
    }

    test('en espera: sin worker, encolada con su instante y sin resultado', async ({ client, assert }) => {
        const routerId = await routerConApi()
        const { job_id: jobId } = await encolar(client, routerId)
        const e = await ver(client, routerId, jobId)
        assert.containsSubset(e, {
            router_id: routerId,
            job_id: jobId,
            estado: 'en_espera',
            iniciado_en: null,
            terminado_en: null,
            cambios: null,
            errores: [],
            error: null,
        })
        assert.isNotNull(e.encolado_en)
        assert.isTrue(Number.isFinite(Date.parse(e.encolado_en!)))
        await cola.remove(jobId)
    })

    test('completada con cambios: el worker la toma y devuelve los comandos escritos', async ({
        client,
        assert,
    }) => {
        const routerId = await routerConApi()
        worker = crearWorkerRouterOS({ dispatcher: OPCIONES })
        const { job_id: jobId } = await encolar(client, routerId)
        const e = await hastaTerminar(client, routerId, jobId)
        assert.equal(e.estado, 'completada', JSON.stringify(e))
        assert.isAbove(e.cambios!, 0)
        assert.deepEqual(e.errores, [])
        assert.isNull(e.error)
        assert.isNotNull(e.iniciado_en)
        assert.isNotNull(e.terminado_en)
        assert.isAtLeast(Date.parse(e.terminado_en!), Date.parse(e.iniciado_en!))

        // Se puede volver a pedir: el job terminado se reemplaza.
        const otra = await encolar(client, routerId)
        const segunda = await hastaTerminar(client, routerId, otra.job_id)
        assert.equal(segunda.estado, 'completada')
        assert.equal(segunda.cambios, 0)
    })

    test('completada con errores: un comando rechazado se reporta y lo demás se aplica', async ({
        client,
        assert,
    }) => {
        const routerId = await routerConApi()
        // Sin los filtros que dejó la prueba anterior: hay que escribirlos y el router los rechaza.
        falso.borrarAMano('/ip/firewall/filter', () => true)
        falso.rechazos.set('/ip/firewall/filter', 'failure: bad chain')
        worker = crearWorkerRouterOS({ dispatcher: OPCIONES })
        const { job_id: jobId } = await encolar(client, routerId)
        const e = await hastaTerminar(client, routerId, jobId)
        assert.equal(e.estado, 'completada', JSON.stringify(e))
        assert.isNull(e.error)
        assert.isAbove(e.errores.length, 0)
        assert.isTrue(e.errores.every((x) => x.operacion.startsWith('/ip/firewall/filter')))
        assert.include(e.errores[0]!.mensaje, 'bad chain')
        // Terminó y dice cuántos comandos escribió (lo demás ya estaba de la prueba anterior).
        assert.isNotNull(e.cambios)
    })

    test('fallida: el router no responde (ni se pudo leer)', async ({ client, assert }) => {
        const caido = new RouterOSFalso()
        await caido.levantar()
        const routerId = await crearRouterFila({
            nas_ip: ipUnica(),
            api_url: caido.url,
            api_tls_verificar: false,
            api_usuario: caido.usuario,
            api_password: cifrar(caido.password),
        })
        await caido.cerrar()
        await cola.remove(idJobReconciliar(routerId))
        worker = crearWorkerRouterOS({ dispatcher: OPCIONES })
        const { job_id: jobId } = await encolar(client, routerId)
        const e = await hastaTerminar(client, routerId, jobId)
        assert.equal(e.estado, 'fallida', JSON.stringify(e))
        assert.isNotNull(e.error)
    })

    test('desconocida: job purgado o de otro router (200, nunca 404); 404 solo sin router', async ({
        client,
        assert,
    }) => {
        const a = await routerConApi()
        const b = await routerConApi()
        const { job_id: jobA } = await encolar(client, a)
        assert.containsSubset(await ver(client, b, jobA), {
            router_id: b,
            job_id: jobA,
            estado: 'desconocida',
        })
        assert.containsSubset(await ver(client, a, 'no-existe'), { estado: 'desconocida', errores: [] })
        await cola.remove(jobA)
        assert.containsSubset(await ver(client, a, jobA), {
            estado: 'desconocida',
            encolado_en: null,
            cambios: null,
        })
        await estado(client.get(`/api/v1/routers/999999999/reconciliaciones/${jobA}`).bearerToken(token), 404)
    })

    test('permiso routers.reconciliar y alcance por router', async ({ client }) => {
        const a = await routerConApi()
        const b = await routerConApi()
        const soporte = await usuarioConRoles(['soporte'])
        await estado(
            client
                .get(`/api/v1/routers/${a}/reconciliaciones/${idJobReconciliar(a)}`)
                .bearerToken(soporte.token),
            403,
        )
        // Técnico con alcance solo en el router b
        const { usuario, token: acotado } = await usuarioConRoles([])
        const rol = (await db.from('core.roles').where('nombre', 'tecnico').select('id').first()) as {
            id: number
        }
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: usuario.id, role_id: rol.id, alcance_tipo: 'router', alcance_id: b })
        await estado(
            client.get(`/api/v1/routers/${a}/reconciliaciones/${idJobReconciliar(a)}`).bearerToken(acotado),
            403,
        )
        await estado(
            client.get(`/api/v1/routers/${b}/reconciliaciones/${idJobReconciliar(b)}`).bearerToken(acotado),
            200,
        )
    })
})
