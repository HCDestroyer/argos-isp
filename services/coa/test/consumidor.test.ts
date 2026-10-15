import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, afterEach, describe, it } from 'node:test'
import { Redis } from 'ioredis'
import { ConsumidorStream, type Procesador } from '../src/consumidor.ts'
import { EventoInvalido } from '../src/decision.ts'
import type { EventoEntrante } from '../src/dispatcher.ts'
import { silencio } from './ayudas.ts'

/**
 * Consumidor contra Redis real (base 2) con un stream propio por prueba (`prueba-a2-<hex>:argos:eventos`),
 * publicando con XADD como lo hará el relay de A1 (`contratos/eventos.md`).
 */

const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: 2,
    maxRetriesPerRequest: null,
})

class ProcesadorFalso implements Procesador {
    readonly recibidos: EventoEntrante[] = []
    fallar: (e: EventoEntrante) => Error | null = () => null
    acepta(evento: string) {
        return evento.startsWith('servicio.')
    }
    async procesar(e: EventoEntrante) {
        this.recibidos.push(e)
        const error = this.fallar(e)
        if (error) throw error
    }
}

async function esperar(condicion: () => Promise<boolean> | boolean, ms = 5000) {
    const limite = Date.now() + ms
    while (!(await condicion())) {
        if (Date.now() > limite) throw new Error('no se cumplió a tiempo')
        await new Promise((r) => setTimeout(r, 20))
    }
}

function publicar(stream: string, id: number, evento: string, payload: unknown) {
    return redis.xadd(
        stream,
        '*',
        'id',
        String(id),
        'evento',
        evento,
        'payload',
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        'request_id',
        `req-${id}`,
    )
}

describe('ConsumidorStream (Redis real)', () => {
    const streams: string[] = []
    let consumidores: ConsumidorStream[] = []
    let conexiones: Redis[] = []

    function nuevo(
        procesador: Procesador,
        opciones: { reclamarTrasMs?: number; nombre?: string; stream?: string } = {},
    ) {
        const stream = opciones.stream ?? `prueba-a2-${randomBytes(4).toString('hex')}:argos:eventos`
        streams.push(stream)
        const conexion = redis.duplicate()
        conexiones.push(conexion)
        const c = new ConsumidorStream({
            redis: conexion,
            stream,
            grupo: 'coa',
            consumidor: opciones.nombre ?? 'coa-1',
            grupoInicio: '0',
            reclamarTrasMs: opciones.reclamarTrasMs ?? 60_000,
            bloqueoMs: 100,
            procesador,
            log: silencio,
        })
        consumidores.push(c)
        return { c, stream }
    }

    afterEach(async () => {
        await Promise.all(consumidores.map((c) => c.detener()))
        for (const conexion of conexiones) conexion.disconnect()
        consumidores = []
        conexiones = []
    })

    after(async () => {
        if (streams.length > 0) await redis.del(...streams)
        redis.disconnect()
    })

    it('procesa servicio.* en orden, confirma (XACK) y confirma sin procesar los eventos ajenos', async () => {
        const p = new ProcesadorFalso()
        const { c, stream } = nuevo(p)
        await c.asegurarGrupo()
        await publicar(stream, 1, 'servicio.estado_cambiado', {
            servicio_id: 5,
            de: 'activo',
            a: 'suspendido',
        })
        await publicar(stream, 2, 'pago.registrado', { pago_id: 1 })
        await publicar(stream, 3, 'servicio.estado_cambiado', {
            servicio_id: 5,
            de: 'suspendido',
            a: 'activo',
        })
        c.iniciar()
        await esperar(
            async () => Number((await redis.xpending(stream, 'coa'))[0]) === 0 && p.recibidos.length === 2,
        )
        assert.deepEqual(
            p.recibidos.map((e) => [e.id, e.evento, e.requestId]),
            [
                ['1', 'servicio.estado_cambiado', 'req-1'],
                ['3', 'servicio.estado_cambiado', 'req-3'],
            ],
        )
        assert.deepEqual(p.recibidos[0]?.payload, { servicio_id: 5, de: 'activo', a: 'suspendido' })
    })

    it('si procesar lanza no confirma; XAUTOCLAIM lo reintenta y los siguientes del mismo servicio esperan', async () => {
        const p = new ProcesadorFalso()
        let fallos = 1
        p.fallar = (e) => (e.id === '1' && fallos-- > 0 ? new Error('Postgres caído') : null)
        const { c, stream } = nuevo(p, { reclamarTrasMs: 200 })
        await c.asegurarGrupo()
        await publicar(stream, 1, 'servicio.estado_cambiado', {
            servicio_id: 7,
            de: 'activo',
            a: 'suspendido',
        })
        await publicar(stream, 2, 'servicio.estado_cambiado', {
            servicio_id: 7,
            de: 'suspendido',
            a: 'activo',
        })
        c.iniciar()
        await esperar(
            async () => p.recibidos.length >= 3 && Number((await redis.xpending(stream, 'coa'))[0]) === 0,
            8000,
        )
        // 1 (falla), 1 (reclamado, bien), 2: el 2 nunca se adelantó al 1.
        assert.deepEqual(
            p.recibidos.map((e) => e.id),
            ['1', '1', '2'],
        )
    })

    it('payload ilegible o fuera del catálogo: se confirma y se descarta (no se reintenta)', async () => {
        const p = new ProcesadorFalso()
        p.fallar = () => new EventoInvalido('estado inválido')
        const { c, stream } = nuevo(p, { reclamarTrasMs: 100 })
        await c.asegurarGrupo()
        await publicar(stream, 1, 'servicio.estado_cambiado', '{no-json')
        await publicar(stream, 2, 'servicio.estado_cambiado', { servicio_id: 1, de: 'x', a: 'y' })
        c.iniciar()
        await esperar(
            async () => p.recibidos.length >= 1 && Number((await redis.xpending(stream, 'coa'))[0]) === 0,
        )
        await new Promise((r) => setTimeout(r, 300))
        assert.deepEqual(
            p.recibidos.map((e) => e.id),
            ['2'],
        )
    })

    it('al arrancar relee sus pendientes (proceso que cayó antes del XACK)', async () => {
        const stream = `prueba-a2-${randomBytes(4).toString('hex')}:argos:eventos`
        await redis.xgroup('CREATE', stream, 'coa', '0', 'MKSTREAM')
        await publicar(stream, 1, 'servicio.config_cambiada', { servicio_id: 9, campos: ['ips'] })
        // Otro proceso con el mismo nombre de consumidor la leyó y murió sin confirmarla.
        await redis.xreadgroup('GROUP', 'coa', 'coa-1', 'COUNT', 10, 'STREAMS', stream, '>')
        const p = new ProcesadorFalso()
        const { c } = nuevo(p, { stream })
        c.iniciar()
        await esperar(
            async () => p.recibidos.length >= 1 && Number((await redis.xpending(stream, 'coa'))[0]) === 0,
        )
        assert.deepEqual(
            p.recibidos.map((e) => e.id),
            ['1'],
        )
    })
})
