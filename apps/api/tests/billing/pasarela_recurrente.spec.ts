import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { estadoServicio, lineasAsiento, servicioCortado } from '#tests/billing/ayudas_billing'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { hoyGuatemala } from '#ledger/fechas'
import {
    CABECERAS_SVIX,
    PasarelaRecurrente,
    aCentavos,
    firmarSvix,
    type ConfigRecurrente,
    type FetchLike,
} from '#billing/pasarelas/recurrente'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import ProcesarWebhookPasarela from '#billing/actions/procesar_webhook_pasarela'
import ConciliarPasarela from '#billing/actions/conciliar_pasarela'

/**
 * Adaptador de Recurrente (decisión del PM) con respuestas simuladas según la documentación oficial
 * (https://docs.recurrente.com): checkout, webhook Svix firmado, conciliación y comisión. La prueba
 * contra el Sandbox real se salta sola sin `RECURRENTE_SECRET_KEY=sk_test_…`.
 */

const SECRETO = `whsec_${Buffer.from('secreto-de-prueba-recurrente-32b!').toString('base64')}`
const CONFIG: ConfigRecurrente = {
    secretKey: 'sk_test_simulada',
    webhookSecret: SECRETO,
    urlBase: 'https://recurrente.simulado/api',
    expiraHoras: 24,
}

interface Llamada {
    url: string
    init: RequestInit
}

/** `fetch` simulado: responde por ruta con el JSON dado y guarda las llamadas. */
function simulado(rutas: Record<string, { status?: number; cuerpo: unknown }>) {
    const llamadas: Llamada[] = []
    const http: FetchLike = async (url, init) => {
        llamadas.push({ url, init })
        const ruta = Object.keys(rutas).find((r) => url.endsWith(r))
        const r = ruta ? rutas[ruta]! : { status: 404, cuerpo: { error: 'no encontrado' } }
        return new Response(JSON.stringify(r.cuerpo), {
            status: r.status ?? 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }
    return { http, llamadas }
}

function webhook(
    cuerpo: Record<string, unknown>,
    opciones: { id?: string; marca?: number; secreto?: string } = {},
) {
    const texto = JSON.stringify(cuerpo)
    const id = opciones.id ?? `msg_${Math.random().toString(36).slice(2)}`
    const marca = opciones.marca ?? Math.floor(Date.now() / 1000)
    return {
        cuerpo: texto,
        cabeceras: {
            [CABECERAS_SVIX.id]: id,
            [CABECERAS_SVIX.marca]: String(marca),
            [CABECERAS_SVIX.firma]: `v1,firmaVieja= ${firmarSvix(opciones.secreto ?? SECRETO, id, marca, texto)}`,
        },
    }
}

const pagado = (checkout: string, centavos: number, fee: number) => ({
    type: 'payment',
    event_type: 'intent.succeeded',
    id: 'in_prueba',
    status: 'succeeded',
    checkout: { id: checkout, status: 'paid' },
    amount_in_cents: centavos,
    currency: 'GTQ',
    details: { fee },
})

test.group('billing · pasarela Recurrente (simulada)', () => {
    test('crearCobro: POST /checkouts con X-SECRET-KEY, ítem en GTQ en centavos, retorno y referencia', async ({
        assert,
    }) => {
        const { http, llamadas } = simulado({
            '/checkouts': {
                status: 201,
                cuerpo: {
                    id: 'ch_abc123',
                    status: 'unpaid',
                    checkout_url: 'https://app.recurrente.com/checkout-session/ch_abc123',
                    expires_at: '2026-10-25T18:00:00Z',
                },
            },
        })
        const adaptador = new PasarelaRecurrente(CONFIG, http)
        const cobro = await adaptador.crearCobro({
            referencia: '42',
            monto: '150.25',
            descripcion: 'Internet octubre',
            cliente: { id: 7, nombre: 'Ana' },
            url_retorno: 'https://portal.isp.gt/corte?pago=42',
        })
        assert.deepEqual(cobro, {
            id_proveedor: 'ch_abc123',
            url_pago: 'https://app.recurrente.com/checkout-session/ch_abc123',
            expira_en: new Date('2026-10-25T18:00:00Z'),
        })
        assert.lengthOf(llamadas, 1)
        assert.equal(llamadas[0]!.url, 'https://recurrente.simulado/api/checkouts')
        assert.equal(llamadas[0]!.init.method, 'POST')
        assert.equal(
            (llamadas[0]!.init.headers as Record<string, string>)['X-SECRET-KEY'],
            'sk_test_simulada',
        )
        const cuerpo = JSON.parse(String(llamadas[0]!.init.body))
        assert.deepInclude(cuerpo.items[0], {
            name: 'Internet octubre',
            currency: 'GTQ',
            amount_in_cents: 15025,
            quantity: 1,
            charge_type: 'one_time',
        })
        assert.equal(cuerpo.success_url, 'https://portal.isp.gt/corte?pago=42&estado=pagado')
        assert.equal(cuerpo.cancel_url, 'https://portal.isp.gt/corte?pago=42&estado=pendiente')
        assert.deepEqual(cuerpo.metadata, { referencia: '42', cliente_id: 7 })
        assert.isString(cuerpo.expires_at)
        assert.equal(aCentavos('0.10'), 10)
    })

    test('crearCobro: bajo Q5.00 es 422 y un error del proveedor es 502', async ({ assert }) => {
        const { http } = simulado({ '/checkouts': { status: 400, cuerpo: { error: 'Invalid items' } } })
        const adaptador = new PasarelaRecurrente(CONFIG, http)
        const entrada = { referencia: '1', descripcion: 'x', cliente: { id: 1, nombre: 'x' } }
        try {
            await adaptador.crearCobro({ ...entrada, monto: '4.99' })
            assert.fail('debía fallar')
        } catch (error) {
            const e = error as {
                status: number
                errores: Array<{ field: string; rule: string; message: string }>
            }
            assert.equal(e.status, 422)
            assert.deepInclude(e.errores[0]!, { field: 'monto', rule: 'minimo_pasarela' })
            assert.include(e.errores[0]!.message, 'Q5.00')
        }
        try {
            await adaptador.crearCobro({ ...entrada, monto: '10.00' })
            assert.fail('debía fallar')
        } catch (error) {
            assert.include(error as object, { status: 502 })
            assert.include((error as Error).message, 'Invalid items')
        }
        const sinLlave = new PasarelaRecurrente({ ...CONFIG, secretKey: '' }, http)
        await assert.rejects(
            () => sinLlave.crearCobro({ ...entrada, monto: '10.00' }),
            /RECURRENTE_SECRET_KEY/,
        )
    })

    test('verificarWebhook: firma Svix (varias firmas), ventana, monto y comisión en centavos', async ({
        assert,
    }) => {
        const adaptador = new PasarelaRecurrente(CONFIG, simulado({}).http)
        const w = webhook(pagado('ch_1', 30000, 1050), { id: 'msg_1' })
        const aviso = adaptador.verificarWebhook(w)
        assert.include(aviso, {
            id_evento: 'msg_1',
            id_proveedor: 'ch_1',
            estado: 'pagado',
            monto: '300.00',
            comision: '10.50',
        })
        // legacy: payment_intent.succeeded con `fee` en la raíz
        const legacy = adaptador.verificarWebhook(
            webhook({
                event_type: 'payment_intent.succeeded',
                checkout: { id: 'ch_2' },
                amount_in_cents: 500,
                fee: 25,
            }),
        )
        assert.include(legacy, { estado: 'pagado', monto: '5.00', comision: '0.25' })
        const fallido = adaptador.verificarWebhook(
            webhook({ event_type: 'intent.failed', checkout: { id: 'ch_3' }, amount_in_cents: 500 }),
        )
        assert.equal(fallido.estado, 'fallido')

        assert.throws(
            () => adaptador.verificarWebhook({ ...w, cuerpo: w.cuerpo.replace('30000', '1') }),
            'La firma no coincide',
        )
        assert.throws(
            () =>
                adaptador.verificarWebhook(
                    webhook(pagado('ch_1', 1, 0), {
                        secreto: `whsec_${Buffer.from('otro').toString('base64')}`,
                    }),
                ),
            'La firma no coincide',
        )
        assert.throws(
            () =>
                adaptador.verificarWebhook(
                    webhook(pagado('ch_1', 1, 0), { marca: Math.floor(Date.now() / 1000) - 600 }),
                ),
            /fuera de la ventana/,
        )
        assert.throws(() => adaptador.verificarWebhook({ cuerpo: '{}', cabeceras: {} }), /svix-id/)
    })

    test('consultar: checkout pagado con la comisión de su intent; expirado y pendiente', async ({
        assert,
    }) => {
        const { http, llamadas } = simulado({
            '/checkouts/ch_pagado': {
                cuerpo: {
                    id: 'ch_pagado',
                    status: 'paid',
                    total_in_cents: 30000,
                    currency: 'GTQ',
                    payment: { id: 'in_9' },
                },
            },
            '/intents/in_9': {
                cuerpo: {
                    id: 'in_9',
                    status: 'succeeded',
                    details: { fee: 1050 },
                    created_at: '2026-10-24T15:00:00Z',
                },
            },
            '/checkouts/ch_vencido': {
                cuerpo: { id: 'ch_vencido', status: 'expired', total_in_cents: 1000 },
            },
            '/checkouts/ch_espera': {
                cuerpo: { id: 'ch_espera', status: 'payment_in_progress', total_in_cents: 1000 },
            },
        })
        const adaptador = new PasarelaRecurrente(CONFIG, http)
        assert.deepEqual(await adaptador.consultar('ch_pagado'), {
            id_proveedor: 'ch_pagado',
            estado: 'pagado',
            monto: '300.00',
            monto_pagado: '300.00',
            comision: '10.50',
            pagado_en: new Date('2026-10-24T15:00:00Z'),
        })
        assert.include(await adaptador.consultar('ch_vencido'), { estado: 'expirado', monto_pagado: null })
        assert.include(await adaptador.consultar('ch_espera'), { estado: 'pendiente' })
        assert.equal(llamadas.filter((l) => l.init.method === 'GET').length, 4)
    })

    test('flujo: cobro → webhook firmado → pago con comisión que reactiva; repetido no duplica; conciliación', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        const anterior = {
            proveedor: env.get('PASARELA_PROVEEDOR'),
            llave: env.get('RECURRENTE_SECRET_KEY'),
            secreto: env.get('RECURRENTE_WEBHOOK_SECRETO'),
            url: env.get('RECURRENTE_API_URL'),
        }
        const fetchOriginal = globalThis.fetch
        const { http } = simulado({
            '/checkouts': {
                status: 201,
                cuerpo: {
                    id: 'ch_flujo',
                    checkout_url: 'https://app.recurrente.com/checkout-session/ch_flujo',
                },
            },
            '/checkouts/ch_flujo': {
                cuerpo: {
                    id: 'ch_flujo',
                    status: 'paid',
                    total_in_cents: 30000,
                    payment: { id: 'in_flujo' },
                },
            },
            '/intents/in_flujo': { cuerpo: { id: 'in_flujo', details: { fee: 1050 } } },
        })
        try {
            env.set('PASARELA_PROVEEDOR', 'recurrente')
            env.set('RECURRENTE_SECRET_KEY', CONFIG.secretKey)
            env.set('RECURRENTE_WEBHOOK_SECRETO', SECRETO)
            env.set('RECURRENTE_API_URL', CONFIG.urlBase)
            globalThis.fetch = ((url: string, init: RequestInit) => http(String(url), init)) as typeof fetch
            const ctx = contextoSistema('portal')
            const cobro = await new CrearCobroPasarela().execute({ cliente_id: datos.clienteId }, ctx)
            assert.include(cobro, { proveedor: 'recurrente', id_proveedor: 'ch_flujo', monto: '300.00' })

            const w = webhook(pagado('ch_flujo', 30000, 1050), { id: 'msg_flujo' })
            const procesar = () =>
                new ProcesarWebhookPasarela().execute(
                    { proveedor: 'recurrente', ...w },
                    contextoSistema('webhook'),
                )
            const primero = await procesar()
            assert.isFalse(primero.duplicado)
            assert.equal(await estadoServicio(datos.servicioId), 'activo')
            assert.deepEqual(await lineasAsiento('pago', primero.pago_id!), [
                ['1.1.02.01', '289.50', '0.00', null],
                ['5.1.02', '10.50', '0.00', null],
                ['1.1.03', '0.00', '300.00', datos.clienteId],
            ])
            const pago = await db.from('billing.pagos').where('id', primero.pago_id!).firstOrFail()
            assert.include(pago, {
                metodo: 'pasarela',
                pasarela: 'recurrente',
                comision: '10.50',
                referencia: 'ch_flujo',
            })

            const repetido = await procesar()
            assert.isTrue(repetido.duplicado)
            assert.equal(repetido.pago_id, primero.pago_id)
            const pagos = await db
                .from('billing.pagos')
                .where('referencia', 'ch_flujo')
                .count('* as n')
                .firstOrFail()
            assert.equal(Number(pagos.n), 1)

            const conciliacion = await new ConciliarPasarela().execute(
                { fecha: hoyGuatemala() },
                contextoSistema('cron'),
            )
            assert.include(conciliacion.cobros_conciliados, cobro.id)
            assert.deepEqual(
                conciliacion.diferencias.filter((d) => d.cobro_id === cobro.id),
                [],
            )
            await afirmarLibroCuadrado(assert)
        } finally {
            globalThis.fetch = fetchOriginal
            env.set('PASARELA_PROVEEDOR', anterior.proveedor ?? '')
            env.set('RECURRENTE_SECRET_KEY', anterior.llave ?? '')
            env.set('RECURRENTE_WEBHOOK_SECRETO', anterior.secreto ?? '')
            env.set('RECURRENTE_API_URL', anterior.url ?? '')
        }
    })
})

const LLAVE_SANDBOX = process.env.RECURRENTE_SECRET_KEY ?? ''
const SIN_SANDBOX = !LLAVE_SANDBOX.startsWith('sk_test_')
const MOTIVO_SIN_SANDBOX =
    'Sin RECURRENTE_SECRET_KEY=sk_test_… (llave de un Sandbox de Recurrente): la prueba real no corre; nunca con sk_live_'

test.group('billing · pasarela Recurrente (Sandbox real)', (group) => {
    group.setup(() => {
        // el motivo queda visible en la salida de la suite, no solo como «skipped»
        if (SIN_SANDBOX) console.warn(`[pasarela_recurrente] prueba real saltada: ${MOTIVO_SIN_SANDBOX}`)
    })
    test('crea un checkout de Q5.00 en el Sandbox y lo consulta', async ({ assert }) => {
        const adaptador = new PasarelaRecurrente({
            secretKey: LLAVE_SANDBOX,
            webhookSecret: process.env.RECURRENTE_WEBHOOK_SECRETO ?? '',
            urlBase: (process.env.RECURRENTE_API_URL || 'https://app.recurrente.com/api').replace(/\/$/, ''),
            expiraHoras: 1,
        })
        const cobro = await adaptador.crearCobro({
            referencia: `prueba-${Date.now()}`,
            monto: '5.00',
            descripcion: 'ArgosIsp · prueba de integración',
            cliente: { id: 0, nombre: 'Prueba' },
        })
        assert.match(cobro.id_proveedor, /^ch_/)
        assert.match(cobro.url_pago, /^https:\/\//)
        const remoto = await adaptador.consultar(cobro.id_proveedor)
        assert.include(remoto, { estado: 'pendiente', monto: '5.00' })
    })
        .skip(SIN_SANDBOX, MOTIVO_SIN_SANDBOX)
        .timeout(30000)
})
