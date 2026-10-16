import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { Redis } from 'ioredis'
import env from '#start/env'
import { cifrar } from '#shared/cifrado'
import { insertarEvento } from '#shared/outbox'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import DesconectarSesion from '#network/sesiones/actions/desconectar_sesion'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearRouterFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Tarea 6 de A2, de punta a punta con procesos reales:
 *
 *   CambiarEstadoServicio (A1) → audit.outbox → XADD al stream (lo que hará el relay de A1)
 *   → services/coa (proceso aparte, grupo `coa`) → NAS simulado por UDP (services/coa/test/nas_simulado.ts)
 *   → audit.red con la respuesta y, si no hubo ACK, coa.fallido en audit.outbox.
 *
 * La sesión abierta la crea `IniciarSesion` (accounting, tarea 4). Cada NAS simulado escucha en
 * su propia 127.0.0.x con el mismo puerto (coa usa un solo COA_NAS_PORT). Stream con prefijo propio.
 */

const SECRET = 'secreto-del-mikrotik-de-prueba'
const PUERTO_NAS = 20_000 + (process.pid % 20_000)
const RAIZ = app.makePath('../..')
const STREAM = `a2test-${randomUUID().slice(0, 8)}:argos:eventos`

interface PaqueteNas {
    codigo: string
    atributos: Record<string, string>
    firmaValida: boolean
    messageAuthenticator: boolean
    respondido: string | null
}

class Proceso {
    readonly lineas: string[] = []
    readonly hijo: ChildProcess

    constructor(args: string[], entorno: Record<string, string> = {}) {
        this.hijo = spawn(process.execPath, args, {
            cwd: RAIZ,
            env: { ...process.env, ...entorno },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        createInterface({ input: this.hijo.stdout! }).on('line', (l) => this.lineas.push(l))
        createInterface({ input: this.hijo.stderr! }).on('line', (l) => this.lineas.push(`stderr: ${l}`))
    }

    json<T>(): T[] {
        return this.lineas.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as T)
    }

    detener() {
        this.hijo.kill('SIGTERM')
    }
}

/** NAS simulado como proceso. Devuelve los paquetes que recibió. */
function nasSimulado(ip: string, modo: 'ack' | 'nak') {
    return new Proceso([
        'services/coa/test/nas_simulado.ts',
        '--ip',
        ip,
        '--puerto',
        String(PUERTO_NAS),
        '--secret',
        SECRET,
        '--modo',
        modo,
    ])
}

async function esperarHasta<T>(
    fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
    ms = 8000,
): Promise<T> {
    const limite = Date.now() + ms
    for (;;) {
        const valor = await fn()
        if (valor) return valor
        if (Date.now() > limite) throw new Error(`No se cumplió la condición en ${ms} ms`)
        await new Promise((resolver) => setTimeout(resolver, 25))
    }
}

/** NAS con su router (secret cifrado v1), plan con velocidad limitada y servicio con sesión abierta. */
async function escenario(nasIp: string) {
    const routerId =
        (
            (await db.from('network.routers').whereRaw('nas_ip = ?::inet', [nasIp]).select('id').first()) as {
                id: number
            } | null
        )?.id ?? (await crearRouterFila({ nas_ip: nasIp, radius_secret: cifrar(SECRET) }))
    const planId = await crearPlanFila({
        subida_kbps: 5120,
        bajada_kbps: 20480,
        subida_limitada_kbps: 1024,
        bajada_limitada_kbps: 2048,
    })
    const userPpp = unico('ppp')
    const servicioId = await crearServicioFila({
        cliente_id: await crearClienteFila(),
        router_id: routerId,
        plan_id: planId,
        user_ppp: userPpp,
        ipv6_modo: 'ninguno',
    })
    const acctSessionId = unico('81a0')
    await new IniciarSesion().execute(
        {
            tipo: 'Start',
            nas_ip: nasIp,
            acct_session_id: acctSessionId,
            user_ppp: userPpp,
            ipv4: '10.10.1.10',
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            bytes_in: '0',
            bytes_out: '0',
            duracion_s: null,
            causa_fin: null,
            evento_en: new Date().toISOString(),
        },
        contextoPrueba(),
    )
    const sesion = (await db
        .from('network.sesiones')
        .where('acct_session_id', acctSessionId)
        .select('id')
        .firstOrFail()) as { id: number }
    return { servicioId, userPpp, acctSessionId, routerId, sesionId: Number(sesion.id) }
}

test.group('coa · de punta a punta (CambiarEstadoServicio → evento → CoA/Disconnect)', (group) => {
    let redis: Redis
    let coa: Proceso
    let nasAck: Proceso
    let nasNak: Proceso

    /** Lo que hará el relay de A1: publica en el stream las filas nuevas del outbox de un servicio. */
    async function relayar(servicioId: number, desdeId = 0): Promise<number[]> {
        const filas = (await db
            .from('audit.outbox')
            .whereIn('evento', [
                'servicio.estado_cambiado',
                'servicio.config_cambiada',
                'sesion.desconexion_solicitada',
            ])
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
            .where('id', '>', desdeId)
            .orderBy('id')) as Array<{
            id: number
            evento: string
            payload: unknown
            request_id: string | null
        }>
        for (const f of filas) {
            await redis.xadd(
                STREAM,
                '*',
                'id',
                String(f.id),
                'evento',
                f.evento,
                'payload',
                JSON.stringify(f.payload),
                'request_id',
                f.request_id ?? '',
            )
        }
        return filas.map((f) => Number(f.id))
    }

    /** true cuando el grupo `coa` ya entregó y confirmó (XACK) la entrada `idStream`. */
    async function confirmado(idStream: string): Promise<boolean> {
        const grupos = (await redis.xinfo('GROUPS', STREAM)) as unknown[][]
        for (const g of grupos) {
            const info: Record<string, unknown> = {}
            for (let i = 0; i + 1 < g.length; i += 2) info[String(g[i])] = g[i + 1]
            if (info.name === 'coa') {
                return info['last-delivered-id'] === idStream && Number(info.pending) === 0
            }
        }
        return false
    }

    async function filasRed(eventoId: number) {
        return db
            .from('audit.red')
            .whereRaw(`comando->>'evento_id' = ?`, [String(eventoId)])
            .orderBy('id')
            .select('tipo', 'router_id', 'servicio_id', 'comando', 'respuesta', 'ok')
    }

    async function respuestaFinal(eventoId: number) {
        return esperarHasta(async () => {
            const filas = await filasRed(eventoId)
            const final = filas.find((f) => f.respuesta.final === true)
            return final ? { final, filas } : null
        })
    }

    async function cambiar(servicioId: number, nuevo: 'activo' | 'limitado' | 'suspendido') {
        const ultimo = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
        await new CambiarEstadoServicio().execute(
            { servicioId, nuevo, motivo: 'prueba e2e' },
            contextoPrueba(),
        )
        const [eventoId] = await relayar(servicioId, Number(ultimo.id ?? 0))
        return eventoId!
    }

    group.setup(async () => {
        redis = new Redis({ host: env.get('REDIS_HOST') ?? '127.0.0.1', port: env.get('REDIS_PORT') ?? 6379 })
        nasAck = nasSimulado('127.0.0.2', 'ack')
        nasNak = nasSimulado('127.0.0.3', 'nak')
        await esperarHasta(() => nasAck.lineas.some((l) => l.includes('"listo"')))
        await esperarHasta(() => nasNak.lineas.some((l) => l.includes('"listo"')))
        coa = new Proceso(['services/coa/src/index.ts'], {
            PORT: '0',
            HOST: '127.0.0.1',
            LOG_LEVEL: 'info',
            REDIS_HOST: env.get('REDIS_HOST') ?? '127.0.0.1',
            REDIS_PORT: String(env.get('REDIS_PORT') ?? 6379),
            COA_STREAM: STREAM,
            COA_GRUPO_INICIO: '0',
            DB_HOST: env.get('DB_HOST'),
            DB_PORT: String(env.get('DB_PORT')),
            DB_USER: env.get('DB_USER'),
            DB_PASSWORD: env.get('DB_PASSWORD') ?? '',
            DB_DATABASE: env.get('DB_DATABASE'),
            AAA_PPP_KEY: env.get('AAA_PPP_KEY') ?? '',
            COA_NAS_PORT: String(PUERTO_NAS),
            COA_TIMEOUT_MS: '300',
            COA_REINTENTOS: '1',
            COA_ESPERA_MS: '50',
        })
        await esperarHasta(() => coa.lineas.some((l) => l.includes('coa escuchando')))
        return async () => {
            coa.detener()
            nasAck.detener()
            nasNak.detener()
            await redis.del(STREAM)
            redis.disconnect()
        }
    })

    test('suspender → CoA con el perfil de corte, ACK en audit.red en < 5 s, y el duplicado no reenvía', async ({
        assert,
    }) => {
        const e = await escenario('127.0.0.2')
        const inicio = Date.now()
        const eventoId = await cambiar(e.servicioId, 'suspendido')
        const { final, filas } = await respuestaFinal(eventoId)
        assert.isBelow(Date.now() - inicio, 5000)

        assert.lengthOf(filas, 1)
        assert.equal(final.tipo, 'coa')
        assert.isTrue(final.ok)
        assert.equal(Number(final.servicio_id), e.servicioId)
        assert.equal(Number(final.router_id), e.routerId)
        assert.equal(final.respuesta.resultado, 'ack')
        assert.equal(final.respuesta.codigo, 'CoA-ACK')
        assert.equal(final.comando.nas_ip, '127.0.0.2')

        const paquete = await esperarHasta<PaqueteNas>(() =>
            nasAck.json<PaqueteNas>().find((p) => p.atributos?.['Acct-Session-Id'] === e.acctSessionId),
        )
        assert.equal(paquete.codigo, 'CoA-Request')
        assert.isTrue(paquete.firmaValida)
        assert.isTrue(paquete.messageAuthenticator)
        assert.deepEqual(paquete.atributos, {
            'User-Name': e.userPpp,
            'Acct-Session-Id': e.acctSessionId,
            'Mikrotik-Rate-Limit': '256k/256k',
            'Mikrotik-Address-List': 'suspendidos',
            'Filter-Id': 'argos-corte.in',
        })

        // El relay entrega al menos una vez: el mismo evento otra vez no vuelve al NAS.
        const fila = await db.from('audit.outbox').where('id', eventoId).firstOrFail()
        const idStream = await redis.xadd(
            STREAM,
            '*',
            'id',
            String(eventoId),
            'evento',
            fila.evento,
            'payload',
            JSON.stringify(fila.payload),
            'request_id',
            '',
        )
        await esperarHasta(() => confirmado(idStream!))
        assert.lengthOf(await filasRed(eventoId), 1)
        assert.lengthOf(
            nasAck.json<PaqueteNas>().filter((p) => p.atributos?.['Acct-Session-Id'] === e.acctSessionId),
            1,
        )
    })

    test('reactivar (suspendido → activo) → Disconnect-Request y Disconnect-ACK', async ({ assert }) => {
        const e = await escenario('127.0.0.2')
        await respuestaFinal(await cambiar(e.servicioId, 'suspendido'))
        const eventoId = await cambiar(e.servicioId, 'activo')
        const { final } = await respuestaFinal(eventoId)
        assert.equal(final.tipo, 'disconnect')
        assert.isTrue(final.ok)
        assert.equal(final.respuesta.codigo, 'Disconnect-ACK')
        const paquetes = nasAck
            .json<PaqueteNas>()
            .filter((p) => p.atributos?.['Acct-Session-Id'] === e.acctSessionId)
        assert.deepEqual(
            paquetes.map((p) => p.codigo),
            ['CoA-Request', 'Disconnect-Request'],
        )
        assert.deepEqual(paquetes[1]!.atributos, {
            'User-Name': e.userPpp,
            'Acct-Session-Id': e.acctSessionId,
        })
    })

    test('limitar y volver a activo → CoA con la velocidad limitada y luego la del plan, sin desconectar', async ({
        assert,
    }) => {
        const e = await escenario('127.0.0.2')
        await respuestaFinal(await cambiar(e.servicioId, 'limitado'))
        await respuestaFinal(await cambiar(e.servicioId, 'activo'))
        const paquetes = nasAck
            .json<PaqueteNas>()
            .filter((p) => p.atributos?.['Acct-Session-Id'] === e.acctSessionId)
        assert.deepEqual(
            paquetes.map((p) => [p.codigo, p.atributos['Mikrotik-Rate-Limit']]),
            [
                // rate-limit completo de `network/velocidad.ts` (A1): MIR, sin ráfaga, prioridad 8 y
                // limit-at = MIR con reuso 1
                ['CoA-Request', '1024k/2048k 0/0 0/0 0/0 8 1024k/2048k'],
                ['CoA-Request', '5120k/20480k 0/0 0/0 0/0 8 5120k/20480k'],
            ],
        )
    })

    test('cambio de prefijo IPv6 (servicio.config_cambiada) → Disconnect', async ({ assert }) => {
        const e = await escenario('127.0.0.2')
        const eventoId = await db.transaction((trx) =>
            insertarEvento(
                trx,
                'servicio.config_cambiada',
                { servicio_id: e.servicioId, campos: ['prefijo_v6'] },
                null,
            ),
        )
        await relayar(e.servicioId, eventoId - 1)
        const { final } = await respuestaFinal(eventoId)
        assert.equal(final.tipo, 'disconnect')
        assert.isTrue(final.ok)
    })

    test('NAK del NAS → audit.red con Error-Cause y coa.fallido por outbox', async ({ assert }) => {
        const e = await escenario('127.0.0.3')
        const eventoId = await cambiar(e.servicioId, 'suspendido')
        const { final, filas } = await respuestaFinal(eventoId)
        assert.lengthOf(filas, 1, 'un NAK no se reintenta')
        assert.isFalse(final.ok)
        assert.equal(final.respuesta.resultado, 'nak')
        assert.equal(final.respuesta.codigo, 'CoA-NAK')
        assert.equal(final.respuesta.atributos['Error-Cause'], 'Session-Context-Not-Found')

        const fallido = await esperarHasta(() =>
            db
                .from('audit.outbox')
                .where('evento', 'coa.fallido')
                .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [e.servicioId])
                .first(),
        )
        assert.deepEqual(fallido.payload, {
            servicio_id: e.servicioId,
            nas_ip: '127.0.0.3',
            tipo: 'coa',
            error: 'CoA-NAK: Session-Context-Not-Found',
        })
    })

    test('NAS que no responde → reintentos registrados y coa.fallido por timeout', async ({ assert }) => {
        const e = await escenario('127.0.0.4')
        const eventoId = await cambiar(e.servicioId, 'suspendido')
        const { filas } = await respuestaFinal(eventoId)
        assert.deepEqual(
            filas.map((f) => [f.comando.intento, f.respuesta.resultado, f.respuesta.final]),
            [
                [1, 'timeout', false],
                [2, 'timeout', true],
            ],
        )
        const fallido = await esperarHasta(() =>
            db
                .from('audit.outbox')
                .where('evento', 'coa.fallido')
                .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [e.servicioId])
                .first(),
        )
        assert.equal(fallido.payload.error, 'timeout')
    })

    test('desconexión manual (DesconectarSesion) → Disconnect-Request a la sesión y audit.red con el motivo', async ({
        assert,
    }) => {
        const e = await escenario('127.0.0.2')
        const ultimo = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
        await new DesconectarSesion().execute(
            { id: e.sesionId, motivo: 'reinicio pedido por el cliente' },
            contextoPrueba(),
        )
        const [eventoId] = await relayar(e.servicioId, Number(ultimo.id ?? 0))
        const inicio = Date.now()
        const { final, filas } = await respuestaFinal(eventoId!)
        assert.isBelow(Date.now() - inicio, 5000)
        assert.lengthOf(filas, 1)
        assert.equal(final.tipo, 'disconnect')
        assert.isTrue(final.ok)
        assert.equal(final.respuesta.codigo, 'Disconnect-ACK')
        assert.equal(Number(final.servicio_id), e.servicioId)
        assert.equal(final.comando.evento, 'sesion.desconexion_solicitada')
        assert.equal(final.comando.razon, 'manual: reinicio pedido por el cliente')
        const paquete = await esperarHasta<PaqueteNas>(() =>
            nasAck.json<PaqueteNas>().find((p) => p.atributos?.['Acct-Session-Id'] === e.acctSessionId),
        )
        assert.equal(paquete.codigo, 'Disconnect-Request')
        assert.isTrue(paquete.firmaValida)
    })
})
