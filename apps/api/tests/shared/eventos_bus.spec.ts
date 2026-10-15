import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { RelayOutbox } from '#shared/relay_outbox'
import {
    EjecutorGrupo,
    aEvento,
    nombreStream,
    type ConsumidorEventos,
    type EventoEntrante,
} from '#shared/eventos_bus'
import type { ConsumidorEventos as ConsumidorDesdeNotify } from '#notify/consumidor'
import { ConsumidorAaaCache } from '#core/consumidor_aaa'
import { claveAaa } from '#core/aaa'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { contextoPrueba } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Tarea 10: relay del outbox a Redis Streams y ejecutor de grupos. Usa el stream con el prefijo
 * de pruebas (`<COLAS_PREFIJO>:argos:eventos`).
 */

class Recolector implements ConsumidorEventos {
    readonly nombre = 'recolector'
    recibidos: EventoEntrante[] = []
    fallarRestantes = 0
    constructor(private readonly filtro: (e: string) => boolean = () => true) {}
    acepta(evento: string) {
        return this.filtro(evento)
    }
    async procesar(e: EventoEntrante) {
        if (this.fallarRestantes > 0) {
            this.fallarRestantes--
            throw new Error('falla simulada')
        }
        this.recibidos.push(e)
    }
}

async function servicioConEvento() {
    const id = await crearServicioFila({ cliente_id: await crearClienteFila() })
    await new CambiarEstadoServicio().execute(
        { servicioId: id, nuevo: 'suspendido', motivo: 'bus' },
        contextoPrueba(),
    )
    const fila = await db
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [id])
        .firstOrFail()
    return { servicioId: id, outboxId: Number(fila.id) }
}

let grupoN = 0
const grupoUnico = () => `prueba-${process.pid}-${++grupoN}`

test.group('Bus de eventos · relay del outbox', (group) => {
    group.setup(async () => {
        const relay = new RelayOutbox()
        await redis().del(nombreStream(), relay.claveLock)
    })

    test('publica pendientes en orden con id, evento, payload y request_id, y marca publicado_en', async ({
        assert,
    }) => {
        const { servicioId, outboxId } = await servicioConEvento()
        const relay = new RelayOutbox({ lote: 50 })
        const publicados = await relay.publicarPendientes()
        assert.isAtLeast(publicados, 1)
        await relay.soltarLock()

        const fila = await db.from('audit.outbox').where('id', outboxId).firstOrFail()
        assert.isNotNull(fila.publicado_en)
        assert.equal(fila.intentos, 1)
        const pendientes = await db.from('audit.outbox').whereNull('publicado_en').count('* as n')
        assert.equal(Number(pendientes[0].n), 0)

        const entradas = (await redis().xrange(nombreStream(), '-', '+')) as Array<[string, string[]]>
        const eventos = entradas.map(([, campos]) => aEvento(campos)!)
        const mio = eventos.find((e) => e.id === outboxId)!
        assert.equal(mio.evento, 'servicio.estado_cambiado')
        assert.deepEqual(mio.payload, {
            servicio_id: servicioId,
            de: 'activo',
            a: 'suspendido',
            motivo: 'bus',
        })
        assert.equal(mio.requestId, fila.request_id)
        // en orden de id
        const ids = eventos.map((e) => Number(e.id))
        assert.deepEqual(
            ids,
            [...ids].sort((a, b) => a - b),
        )

        // nada pendiente: segunda pasada no publica
        assert.equal(await relay.publicarPendientes(), 0)
        await relay.soltarLock()
    })

    test('un solo relay activo: el segundo no publica mientras el primero tiene el lock', async ({
        assert,
    }) => {
        const primero = new RelayOutbox()
        const segundo = new RelayOutbox()
        assert.isTrue(await primero.tomarLock())
        assert.isFalse(await segundo.tomarLock())

        const { outboxId } = await servicioConEvento()
        assert.equal(await segundo.publicarPendientes(), 0)
        const fila = await db.from('audit.outbox').where('id', outboxId).firstOrFail()
        assert.isNull(fila.publicado_en)

        await primero.soltarLock()
        assert.isAtLeast(await segundo.publicarPendientes(), 1)
        await segundo.soltarLock()
    })

    test('iniciar/detener: el bucle publica lo que llega y suelta el lock al detenerse', async ({
        assert,
    }) => {
        const relay = new RelayOutbox({ esperaMs: 20 })
        relay.iniciar()
        try {
            const { outboxId } = await servicioConEvento()
            let publicado = null
            for (let i = 0; i < 100 && !publicado; i++) {
                await new Promise((r) => setTimeout(r, 20))
                const fila = await db.from('audit.outbox').where('id', outboxId).firstOrFail()
                publicado = fila.publicado_en
            }
            assert.isNotNull(publicado)
        } finally {
            await relay.detener()
        }
        assert.isNull(await redis().get(relay.claveLock))
    })
})

test.group('Bus de eventos · grupos de consumidores', (group) => {
    group.setup(async () => {
        await redis().del(nombreStream(), new RelayOutbox().claveLock)
    })

    test('XREADGROUP entrega a los consumidores que aceptan y confirma con XACK', async ({ assert }) => {
        const { servicioId } = await servicioConEvento()
        const relay = new RelayOutbox()
        await relay.publicarPendientes()
        await relay.soltarLock()

        const servicios = new Recolector((e) => e.startsWith('servicio.'))
        const ninguno = new Recolector(() => false)
        const ejecutor = new EjecutorGrupo({
            grupo: grupoUnico(),
            consumidores: [servicios, ninguno],
            bloqueoMs: 0,
        })
        try {
            const confirmadas = await ejecutor.procesarLote({ bloqueoMs: 0 })
            assert.isAtLeast(confirmadas, 1)
            assert.lengthOf(ninguno.recibidos, 0)
            assert.isTrue(
                servicios.recibidos.some(
                    (e) => e.evento === 'servicio.estado_cambiado' && e.payload.servicio_id === servicioId,
                ),
            )
            const pendientes = (await redis().xpending(nombreStream(), ejecutor.grupo)) as [number]
            assert.equal(pendientes[0], 0)
            // ya confirmado: otra pasada no entrega nada
            assert.equal(await ejecutor.procesarLote({ bloqueoMs: 0 }), 0)
        } finally {
            await ejecutor.detener()
        }
    })

    test('si un consumidor lanza no hay XACK; XAUTOCLAIM lo reentrega y entonces se confirma', async ({
        assert,
    }) => {
        await servicioConEvento()
        const relay = new RelayOutbox()
        await relay.publicarPendientes()
        await relay.soltarLock()

        const recolector = new Recolector()
        recolector.fallarRestantes = 1
        const ejecutor = new EjecutorGrupo({
            grupo: grupoUnico(),
            consumidores: [recolector],
            reclamarTrasMs: 0,
            lote: 1000,
        })
        try {
            const total = Number((await redis().xlen(nombreStream())) as number)
            const primera = await ejecutor.procesarLote({ bloqueoMs: 0 })
            assert.equal(primera, total - 1)
            const pendientes = (await redis().xpending(nombreStream(), ejecutor.grupo)) as [number]
            assert.equal(pendientes[0], 1)

            const segunda = await ejecutor.procesarLote({ bloqueoMs: 0 })
            assert.equal(segunda, 1)
            assert.lengthOf(recolector.recibidos, total)
            const despues = (await redis().xpending(nombreStream(), ejecutor.grupo)) as [number]
            assert.equal(despues[0], 0)
        } finally {
            await ejecutor.detener()
        }
    })

    test('grupo aaa-cache: un evento servicio.* reescribe aaa:user:<user_ppp> desde la base', async ({
        assert,
    }) => {
        const { servicioId } = await servicioConEvento()
        const { user_ppp: userPpp } = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        await redis().del(claveAaa(userPpp))

        const relay = new RelayOutbox()
        await relay.publicarPendientes()
        await relay.soltarLock()
        const ejecutor = new EjecutorGrupo({
            grupo: grupoUnico(),
            consumidores: [new ConsumidorAaaCache()],
            lote: 1000,
        })
        try {
            await ejecutor.procesarLote({ bloqueoMs: 0 })
        } finally {
            await ejecutor.detener()
        }
        const registro = JSON.parse((await redis().get(claveAaa(userPpp)))!)
        assert.equal(registro.servicio_id, servicioId)
        assert.equal(registro.estado, 'suspendido')

        const consumidor = new ConsumidorAaaCache()
        assert.isTrue(consumidor.acepta('servicio.config_cambiada'))
        assert.isTrue(consumidor.acepta('asignacion.cambiada'))
        assert.isFalse(consumidor.acepta('pago.registrado'))
    })

    test('aEvento descarta entradas ilegibles; el import viejo de notify sigue funcionando', ({ assert }) => {
        assert.isNull(aEvento(['evento', 'x']))
        assert.isNull(aEvento(['id', '1', 'evento', 'x', 'payload', '{roto']))
        assert.deepEqual(
            aEvento(['id', '7', 'evento', 'pago.registrado', 'payload', '{}', 'request_id', '']),
            {
                id: 7,
                evento: 'pago.registrado',
                payload: {},
                requestId: null,
            },
        )
        const consumidor: ConsumidorDesdeNotify = new Recolector()
        assert.equal(consumidor.nombre, 'recolector')
    })
})
