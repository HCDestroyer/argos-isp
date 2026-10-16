import { test } from '@japa/runner'
import { Queue } from 'bullmq'
import { contextoSistema } from '#shared/contexto'
import { redis } from '#shared/redis'
import { nombreStream } from '#shared/eventos_bus'
import { conexionRedis, prefijoColas } from '#notify/cola'
import { fijarTokenMetricas, quitarSeccionMetricas, registrarSeccionMetricas } from '#monitoreo/metricas'
import { Exposicion } from '#monitoreo/prometheus'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { unico } from '#tests/ayudas'

const TOKEN = 'token-metricas-de-prueba'

/** Valor de una muestra en el texto de exposición; null si no está. */
function valor(texto: string, nombre: string, etiquetas: Record<string, string> = {}): number | null {
    for (const linea of texto.split('\n')) {
        if (!linea.startsWith(nombre)) continue
        const resto = linea.slice(nombre.length)
        const coincide = Object.entries(etiquetas).every(([k, v]) => resto.includes(`${k}="${v}"`))
        if ((resto.startsWith('{') || resto.startsWith(' ')) && coincide) {
            return Number(linea.split(' ').at(-1))
        }
    }
    return null
}

test.group('monitoreo · /metrics', (group) => {
    group.each.setup(() => {
        fijarTokenMetricas(TOKEN)
        return () => fijarTokenMetricas(undefined)
    })

    test('sin METRICS_TOKEN responde 404; con token equivocado 401', async ({ client }) => {
        fijarTokenMetricas(null)
        const apagado = await client.get('/metrics').header('authorization', `Bearer ${TOKEN}`)
        apagado.assertStatus(404)
        fijarTokenMetricas(TOKEN)
        const sinToken = await client.get('/metrics')
        sinToken.assertStatus(401)
        const otro = await client.get('/metrics').header('authorization', 'Bearer otro')
        otro.assertStatus(401)
    })

    test('colas BullMQ, lag del stream por grupo y última ejecución de cada cron', async ({
        client,
        assert,
    }) => {
        // Un trabajo retrasado en la cola de envíos (prefijo propio de las pruebas)
        const cola = new Queue('notify-envios', { connection: conexionRedis(), prefix: prefijoColas() })
        const job = await cola.add('metricas', { envioId: 0 }, { delay: 3_600_000, jobId: unico('metricas') })

        // Un grupo nuevo en el stream de pruebas que aún no lee nada: su lag = entradas nuevas
        const stream = nombreStream()
        const grupo = unico('grupo-metricas')
        await redis().xadd(
            stream,
            '*',
            'id',
            '0',
            'evento',
            'prueba.metricas',
            'payload',
            '{}',
            'request_id',
            '',
        )
        await redis().xgroup('CREATE', stream, grupo, '$', 'MKSTREAM')
        await redis().xadd(
            stream,
            '*',
            'id',
            '0',
            'evento',
            'prueba.metricas',
            'payload',
            '{}',
            'request_id',
            '',
        )
        await redis().xadd(
            stream,
            '*',
            'id',
            '0',
            'evento',
            'prueba.metricas',
            'payload',
            '{}',
            'request_id',
            '',
        )

        await new RegistrarCorrida('facturas.generar').execute(
            { parametros: {}, resultado: { prueba: true } },
            contextoSistema('cron'),
        )
        try {
            const r = await client.get('/metrics').header('authorization', `Bearer ${TOKEN}`)
            r.assertStatus(200)
            assert.include(r.header('content-type'), 'text/plain; version=0.0.4')
            const texto = r.text()

            assert.isAtLeast(
                valor(texto, 'argosisp_cola_trabajos', { cola: 'notify-envios', estado: 'delayed' })!,
                1,
            )
            assert.isNotNull(
                valor(texto, 'argosisp_cola_trabajos', { cola: 'billing-cron', estado: 'waiting' }),
            )
            assert.equal(valor(texto, 'argosisp_eventos_lag', { grupo }), 2)
            assert.equal(valor(texto, 'argosisp_eventos_pendientes', { grupo }), 0)
            assert.isAtLeast(valor(texto, 'argosisp_eventos_stream_longitud')!, 3)
            assert.isNotNull(valor(texto, 'argosisp_outbox_sin_publicar'))
            const ultima = valor(texto, 'argosisp_cron_ultima_ejecucion_timestamp_seconds', {
                cron: 'facturas.generar',
            })!
            assert.closeTo(ultima, Date.now() / 1000, 30)
            for (const seccion of ['colas', 'eventos', 'outbox', 'crons', 'incidentes']) {
                assert.equal(valor(texto, 'argosisp_metricas_error', { seccion }), 0, seccion)
            }
            assert.isAbove(valor(texto, 'process_resident_memory_bytes')!, 0)
        } finally {
            await job.remove()
            await cola.close()
            await redis().xgroup('DESTROY', stream, grupo)
        }
    })

    test('sección registrada por otro módulo (colas simples por router de A2); si falla, solo marca error', async ({
        client,
        assert,
    }) => {
        registrarSeccionMetricas('routeros', async () => [
            {
                nombre: 'argosisp_routeros_colas_simples',
                ayuda: 'Colas simples por router',
                muestras: [
                    { etiquetas: { router_id: '7', router: 'Torre Norte' }, valor: 1203 },
                    { etiquetas: { router_id: '8', router: 'Torre Sur' }, valor: 40 },
                ],
            },
        ])
        try {
            const r = await client.get('/metrics').header('authorization', `Bearer ${TOKEN}`)
            r.assertStatus(200)
            assert.equal(valor(r.text(), 'argosisp_routeros_colas_simples', { router_id: '7' }), 1203)
            assert.equal(valor(r.text(), 'argosisp_routeros_colas_simples', { router: 'Torre Sur' }), 40)
            assert.equal(valor(r.text(), 'argosisp_metricas_error', { seccion: 'routeros' }), 0)

            registrarSeccionMetricas('routeros', async () => {
                throw new Error('sin datos')
            })
            const fallo = await client.get('/metrics').header('authorization', `Bearer ${TOKEN}`)
            fallo.assertStatus(200)
            assert.isNull(valor(fallo.text(), 'argosisp_routeros_colas_simples'))
            assert.equal(valor(fallo.text(), 'argosisp_metricas_error', { seccion: 'routeros' }), 1)
            assert.isNotNull(valor(fallo.text(), 'argosisp_outbox_sin_publicar'))
        } finally {
            quitarSeccionMetricas('routeros')
        }
    })

    test('formato: etiquetas escapadas y nombres válidos', ({ assert }) => {
        const texto = new Exposicion()
            .gauge('prueba_metrica', 'Ayuda\ncon salto', [{ etiquetas: { a: 'x"y\\z' }, valor: 1.5 }])
            .texto()
        assert.include(texto, '# HELP prueba_metrica Ayuda\\ncon salto')
        assert.include(texto, 'prueba_metrica{a="x\\"y\\\\z"} 1.5')
        assert.throws(() => new Exposicion().gauge('no-valida', 'x', []))
    })
})
