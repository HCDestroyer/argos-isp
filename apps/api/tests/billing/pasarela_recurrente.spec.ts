import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { estadoServicio, eventosDe, lineasAsiento, servicioCortado } from '#tests/billing/ayudas_billing'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { hoyGuatemala } from '#ledger/fechas'
import { aTexto, dec } from '#ledger/dinero'
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
import RegistrarPago from '#billing/actions/registrar_pago'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'

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

/** Corre `fn` con Recurrente como proveedor configurado y `fetch` simulado; restaura todo al final. */
async function conRecurrente<T>(
    rutas: Record<string, { status?: number; cuerpo: unknown }>,
    fn: () => Promise<T>,
) {
    const anterior = {
        proveedor: env.get('PASARELA_PROVEEDOR'),
        llave: env.get('RECURRENTE_SECRET_KEY'),
        secreto: env.get('RECURRENTE_WEBHOOK_SECRETO'),
        url: env.get('RECURRENTE_API_URL'),
    }
    const fetchOriginal = globalThis.fetch
    const { http } = simulado(rutas)
    try {
        env.set('PASARELA_PROVEEDOR', 'recurrente')
        env.set('RECURRENTE_SECRET_KEY', CONFIG.secretKey)
        env.set('RECURRENTE_WEBHOOK_SECRETO', SECRETO)
        env.set('RECURRENTE_API_URL', CONFIG.urlBase)
        globalThis.fetch = ((url: string, init: RequestInit) => http(String(url), init)) as typeof fetch
        return await fn()
    } finally {
        globalThis.fetch = fetchOriginal
        env.set('PASARELA_PROVEEDOR', anterior.proveedor ?? '')
        env.set('RECURRENTE_SECRET_KEY', anterior.llave ?? '')
        env.set('RECURRENTE_WEBHOOK_SECRETO', anterior.secreto ?? '')
        env.set('RECURRENTE_API_URL', anterior.url ?? '')
    }
}

/** Cobro de Recurrente (el checkout lo simula `rutasDe`) por la deuda de un servicio cortado. */
async function cobroRecurrente() {
    const datos = await servicioCortado()
    const cobro = await new CrearCobroPasarela().execute(
        { cliente_id: datos.clienteId },
        contextoSistema('portal'),
    )
    return { datos, cobro }
}

const procesar = (w: { cuerpo: string; cabeceras: Record<string, string> }) =>
    new ProcesarWebhookPasarela().execute({ proveedor: 'recurrente', ...w }, contextoSistema('webhook'))

const rutasDe = (checkout: string, extra: Record<string, { status?: number; cuerpo: unknown }> = {}) => ({
    '/checkouts': {
        status: 201,
        cuerpo: { id: checkout, checkout_url: `https://app.recurrente.com/checkout-session/${checkout}` },
    },
    ...extra,
})

/** Aviso `refund.*` (campos de https://docs.recurrente.com/referencia-api/api-reference/refunds/get-refund.md). */
const reembolsoDe = (
    checkout: string,
    id: string,
    centavos: number,
    opciones: { cuenta?: number; devolverComision?: boolean } = {},
) => ({
    event_type: 'refund.update',
    refund: {
        id,
        status: 'succeeded',
        customer_refunded_amount_in_cents: centavos,
        ...(opciones.cuenta === undefined
            ? {}
            : {
                  account_refunded_amount_in_cents: opciones.cuenta,
                  refund_application_fee: opciones.devolverComision ?? false,
              }),
    },
    intentable: { checkout: { id: checkout } },
})

/** Saldo (debe − haber) de una cuenta en todo el libro. */
async function saldoDe(codigo: string) {
    const fila = await db
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.codigo', codigo)
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as s'))
        .firstOrFail()
    return fila.s as string
}

/** Deuda vigente (total − pagado) de las facturas del cliente. */
async function deudaDe(clienteId: number) {
    const fila = await db
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'anulada')
        .select(db.raw('sum(total - pagado)::numeric(14,2)::text as s'))
        .firstOrFail()
    return fila.s as string
}

test.group('billing · pasarela Recurrente (simulada)', (group) => {
    // la prueba de H61 crea empresas propias: se desactivan al terminar
    group.each.teardown(() => soloEmpresaPrincipal())
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
        assert.equal(aCentavos('0.10'), '10')
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
            const enviar = () =>
                new ProcesarWebhookPasarela().execute(
                    { proveedor: 'recurrente', ...w },
                    contextoSistema('webhook'),
                )
            const primero = await enviar()
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

            const repetido = await enviar()
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
    test('H51: la retención de IVA de la emisora va a 1.1.05 y el banco queda por el neto', async ({
        assert,
    }) => {
        const checkout = `ch_ret_${Date.now()}`
        await conRecurrente(rutasDe(checkout), async () => {
            const { cobro } = await cobroRecurrente()
            const r = await procesar(
                webhook({
                    event_type: 'payment_intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: 30000,
                    fee: 1050,
                    vat_withheld: 482,
                    vat_withheld_currency: 'GTQ',
                }),
            )
            assert.isNumber(r.pago_id)
            const pago = await db.from('billing.pagos').where('id', r.pago_id!).firstOrFail()
            assert.deepEqual(await lineasAsiento('pago', r.pago_id!), [
                ['1.1.02.01', '284.68', '0.00', null],
                ['5.1.02', '10.50', '0.00', null],
                ['1.1.05', '4.82', '0.00', null],
                ['1.1.03', '0.00', '300.00', pago.cliente_id],
            ])
            assert.include(pago, { monto: '300.00', retenido: '4.82' })
            assert.equal(cobro.monto, '300.00')
            await afirmarLibroCuadrado(assert)
        })
    })

    test('monto distinto del cobro: no registra el pago y la conciliación lo reporta', async ({ assert }) => {
        const checkout = `ch_monto_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 29000 },
                },
            }),
            async () => {
                const { cobro } = await cobroRecurrente()
                const r = await procesar(webhook(pagado(checkout, 29000, 0)))
                assert.include(r, { pago_id: null, ignorado: 'monto_distinto' })
                const fila = await db.from('billing.pasarela_cobros').where('id', cobro.id).firstOrFail()
                assert.equal(fila.estado, 'pendiente')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.deepEqual(
                    c.diferencias.filter((d) => d.cobro_id === cobro.id).map((d) => d.tipo),
                    ['pago_sin_registrar'],
                )
            },
        )
    })

    test('refund.* anula el pago (la deuda vuelve); dispute.* solo se registra y se lista para contabilidad', async ({
        assert,
    }) => {
        const checkout = `ch_reemb_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                assert.equal(await estadoServicio(datos.servicioId), 'activo')

                const disputa = await procesar(
                    webhook({
                        event_type: 'dispute.create',
                        id: 'dp_1',
                        status: 'needs_response',
                        reason: 'fraudulent',
                    }),
                )
                assert.equal(disputa.ignorado, 'disputa')
                const conCheckout = await procesar(
                    webhook({
                        event_type: 'dispute.update',
                        id: 'dp_1',
                        checkout: { id: checkout },
                        status: 'under_review',
                    }),
                )
                assert.include(conCheckout, { ignorado: 'disputa', cobro_id: cobro.id })
                // pago.disputa_abierta una vez por pago, en la transacción del aviso
                await procesar(
                    webhook({
                        event_type: 'dispute.update',
                        id: 'dp_1',
                        checkout: { id: checkout },
                        status: 'needs_response',
                        reason: 'fraudulent',
                    }),
                )
                const disputas = await eventosDe('pago.disputa_abierta', 'pago_id', pago.pago_id!)
                assert.lengthOf(disputas, 1)
                assert.deepInclude(disputas[0]!.payload, {
                    pago_id: pago.pago_id,
                    cobro_id: cobro.id,
                    cliente_id: datos.clienteId,
                    monto: '300.00',
                    proveedor: 'recurrente',
                    motivo: null,
                })
                const vigente = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(vigente.estado, 'registrado')

                const pendiente = await procesar(
                    webhook({
                        event_type: 'refund.create',
                        refund: { id: 're_1', status: 'pending' },
                        intentable: { checkout: { id: checkout } },
                    }),
                )
                assert.equal(pendiente.estado, 'pendiente')
                const reembolso = await procesar(
                    webhook({
                        event_type: 'refund.update',
                        refund: { id: 're_1', status: 'succeeded', customer_refunded_amount_in_cents: 30000 },
                        intentable: { checkout: { id: checkout } },
                    }),
                )
                assert.include(reembolso, { estado: 'reembolsado', pago_id: pago.pago_id })
                const anulado = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(anulado.estado, 'anulado')
                assert.include(anulado.motivo_anulacion, 're_1')
                assert.notEqual(await estadoServicio(datos.servicioId), 'activo')
                const otra = await procesar(
                    webhook({
                        event_type: 'refund.update',
                        refund: { id: 're_1', status: 'succeeded' },
                        intentable: { checkout: { id: checkout } },
                    }),
                )
                assert.equal(otra.ignorado, 'reembolso_ya_aplicado')

                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                const deEste = c.diferencias.filter(
                    (d) => d.cobro_id === cobro.id || d.id_proveedor === 'disputa:dp_1',
                )
                assert.sameMembers(
                    deEste.map((d) => d.tipo),
                    ['disputa', 'disputa', 'disputa'],
                )
                await afirmarLibroCuadrado(assert)
            },
        )
    })
    test('H60: un reembolso parcial anula el pago y registra otro por lo que queda; repetido no se aplica dos veces', async ({
        assert,
    }) => {
        const checkout = `ch_parcial_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                const reembolso = {
                    event_type: 'refund.update',
                    refund: {
                        id: 're_parcial',
                        status: 'succeeded',
                        customer_refunded_amount_in_cents: 10000,
                    },
                    intentable: { checkout: { id: checkout } },
                }
                const r = await procesar(webhook(reembolso))
                assert.equal(r.pago_id, pago.pago_id)
                assert.isNumber(r.pago_reemplazo_id)
                const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(original.estado, 'anulado')
                const nuevo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
                assert.include(nuevo, {
                    estado: 'registrado',
                    monto: '200.00',
                    comision: '10.50',
                    referencia: `${checkout}:reembolso:re_parcial`,
                })
                // la deuda vuelve solo por lo reembolsado
                const pendiente = await db
                    .from('billing.facturas')
                    .where('cliente_id', datos.clienteId)
                    .whereNot('estado', 'anulada')
                    .select(db.raw('sum(total - pagado)::numeric(14,2)::text as s'))
                    .firstOrFail()
                assert.equal(pendiente.s, '100.00')
                const fila = await db.from('billing.pasarela_cobros').where('id', cobro.id).firstOrFail()
                assert.equal(Number(fila.pago_id), r.pago_reemplazo_id)

                const otraVez = await procesar(webhook(reembolso))
                assert.equal(otraVez.ignorado, 'reembolso_ya_aplicado')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H65: un reembolso que deja menos que la comisión se aplica: reemplazo por lo que queda, la comisión sigue y el banco queda negativo', async ({
        assert,
    }) => {
        const checkout = `ch_casi_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                const r = await procesar(webhook(reembolsoDe(checkout, 're_casi', 29600)))
                assert.isUndefined(r.ignorado, r.error)
                assert.isNumber(r.pago_reemplazo_id)
                const nuevo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
                assert.include(nuevo, {
                    estado: 'registrado',
                    monto: '4.00',
                    comision: '10.50',
                    retenido: '0.00',
                })
                // Q4.00 a la deuda, Q10.50 de gasto: el banco devuelve Q6.50 (la pasarela lo descuenta)
                assert.deepEqual(await lineasAsiento('pago', r.pago_reemplazo_id!), [
                    ['1.1.02.01', '0.00', '6.50', null],
                    ['5.1.02', '10.50', '0.00', null],
                    ['1.1.03', '0.00', '4.00', Number(nuevo.cliente_id)],
                ])
                assert.equal(await deudaDe(datos.clienteId), '296.00')
                const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(original.estado, 'anulado')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H65: si lo que queda no supera lo retenido, la constancia se conserva en proporción (§15 #105)', async ({
        assert,
    }) => {
        const checkout = `ch_ret_casi_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                await procesar(
                    webhook({
                        ...pagado(checkout, 30000, 1050),
                        vat_withheld: 482,
                        vat_withheld_currency: 'GTQ',
                    }),
                )
                const r = await procesar(webhook(reembolsoDe(checkout, 're_ret', 29700)))
                assert.isUndefined(r.ignorado, r.error)
                const nuevo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
                // queda Q3.00 ≤ Q4.82 retenido: la constancia va por 4.82 × 3 / 300 = 0.05
                assert.include(nuevo, { monto: '3.00', retenido: '0.05', comision: '10.50' })
                assert.deepEqual(await lineasAsiento('pago', r.pago_reemplazo_id!), [
                    ['1.1.02.01', '0.00', '7.55', null],
                    ['5.1.02', '10.50', '0.00', null],
                    ['1.1.05', '0.05', '0.00', null],
                    ['1.1.03', '0.00', '3.00', Number(nuevo.cliente_id)],
                ])
                assert.equal(await deudaDe(datos.clienteId), '297.00')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H65: el reembolso total anula el pago sin reemplazo y la conciliación lo da por bueno; uno rechazado por negocio se reporta', async ({
        assert,
    }) => {
        const checkout = `ch_total_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                const r = await procesar(webhook(reembolsoDe(checkout, 're_total', 30000)))
                assert.isUndefined(r.ignorado, r.error)
                assert.isUndefined(r.pago_reemplazo_id)
                const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(original.estado, 'anulado')
                assert.equal(await deudaDe(datos.clienteId), '300.00')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                await afirmarLibroCuadrado(assert)
            },
        )

        // un aviso de reembolso que se rechazó por una regla de negocio no se da por conciliado
        const otro = `ch_rech_${Date.now()}`
        await conRecurrente(
            rutasDe(otro, {
                [`/checkouts/${otro}`]: { cuerpo: { id: otro, status: 'paid', total_in_cents: 30000 } },
            }),
            async () => {
                const { cobro } = await cobroRecurrente()
                await procesar(webhook(pagado(otro, 30000, 1050)))
                await db.table('billing.pasarela_eventos').insert({
                    proveedor: 'recurrente',
                    id_evento: `msg_rech_${Date.now()}`,
                    id_proveedor: otro,
                    estado: 'reembolsado',
                    payload: JSON.stringify(reembolsoDe(otro, 're_rech', 1000)),
                    resultado: JSON.stringify({
                        ignorado: 'error_de_negocio',
                        error: 'periodo_cerrado: prueba',
                    }),
                })
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.notInclude(c.cobros_conciliados, cobro.id)
                const d = c.diferencias.find((x) => x.cobro_id === cobro.id)
                assert.equal(d?.tipo, 'reembolso_sin_aplicar')
                assert.include(d?.detalle ?? '', 're_rech')
            },
        )
    })

    test('H70: en un reembolso parcial la constancia se prorratea siempre por lo que queda / pago', async ({
        assert,
    }) => {
        const checkout = `ch_h70_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                await cobroRecurrente()
                await procesar(
                    webhook({
                        ...pagado(checkout, 30000, 1050),
                        vat_withheld: 482,
                        vat_withheld_currency: 'GTQ',
                    }),
                )
                const r = await procesar(webhook(reembolsoDe(checkout, 're_h70', 10000)))
                const nuevo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
                // queda Q200.00 > Q4.82 retenido: aun así 4.82 × 200 / 300 = 3.21
                assert.include(nuevo, { monto: '200.00', retenido: '3.21' })
                const constancia = await db
                    .from('ledger.constancias_retencion')
                    .where({ pago_id: nuevo.id, direccion: 'recibida' })
                    .firstOrFail()
                assert.equal(constancia.monto, '3.21')
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H71: el banco baja por lo debitado a la cuenta y la diferencia con lo devuelto al cliente es comisión devuelta', async ({
        assert,
    }) => {
        const checkout = `ch_h71_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos, cobro } = await cobroRecurrente()
                await procesar(webhook(pagado(checkout, 30000, 1050)))
                const antes = await saldoDe('1.1.02.01')
                const comisionAntes = await saldoDe('5.1.02')
                const r = await procesar(
                    webhook(reembolsoDe(checkout, 're_h71', 10000, { cuenta: 9500, devolverComision: true })),
                )
                assert.isUndefined(r.ignorado, r.error)
                const nuevo = await db.from('billing.pagos').where('id', r.pago_reemplazo_id!).firstOrFail()
                assert.include(nuevo, { monto: '200.00', comision: '5.50' })
                assert.equal(await deudaDe(datos.clienteId), '100.00')
                assert.equal(aTexto(dec(await saldoDe('1.1.02.01')).minus(antes)), '-95.00')
                assert.equal(aTexto(dec(await saldoDe('5.1.02')).minus(comisionAntes)), '-5.00')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.include(c.cobros_conciliados, cobro.id)
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H71: reembolso total sin devolver la comisión: se anula el pago y la comisión queda de gasto contra el banco', async ({
        assert,
    }) => {
        const checkout = `ch_h71t_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { datos } = await cobroRecurrente()
                const antes = await saldoDe('1.1.02.01')
                const comisionAntes = await saldoDe('5.1.02')
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                const r = await procesar(webhook(reembolsoDe(checkout, 're_h71t', 30000, { cuenta: 30000 })))
                assert.isUndefined(r.ignorado, r.error)
                assert.isUndefined(r.pago_reemplazo_id)
                const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(original.estado, 'anulado')
                assert.equal(await deudaDe(datos.clienteId), '300.00')
                // recibió 289.50 y le debitaron 300.00: −10.50 en el banco, 10.50 de comisión
                assert.equal(aTexto(dec(await saldoDe('1.1.02.01')).minus(antes)), '-10.50')
                assert.equal(aTexto(dec(await saldoDe('5.1.02')).minus(comisionAntes)), '10.50')
                await afirmarLibroCuadrado(assert)
            },
        )
    })

    test('H71: si la comisión devuelta no cabe en la del pago, el aviso no se aplica y la conciliación lo reporta', async ({
        assert,
    }) => {
        const checkout = `ch_h71x_${Date.now()}`
        await conRecurrente(
            rutasDe(checkout, {
                [`/checkouts/${checkout}`]: {
                    cuerpo: { id: checkout, status: 'paid', total_in_cents: 30000 },
                },
            }),
            async () => {
                const { cobro } = await cobroRecurrente()
                const pago = await procesar(webhook(pagado(checkout, 30000, 1050)))
                const r = await procesar(webhook(reembolsoDe(checkout, 're_h71x', 10000, { cuenta: 5000 })))
                assert.equal(r.ignorado, 'error_de_negocio')
                assert.include(r.error ?? '', 'reembolso_monto_cuenta')
                const original = await db.from('billing.pagos').where('id', pago.pago_id!).firstOrFail()
                assert.equal(original.estado, 'registrado')
                const c = await new ConciliarPasarela().execute(
                    { fecha: hoyGuatemala() },
                    contextoSistema('cron'),
                )
                assert.equal(
                    c.diferencias.find((x) => x.cobro_id === cobro.id)?.tipo,
                    'reembolso_sin_aplicar',
                )
            },
        )
    })

    test('H61: un error de negocio responde 2xx con la alerta y no deja nada a medias', async ({
        assert,
    }) => {
        const checkout = `ch_error_${Date.now()}`
        await conRecurrente(rutasDe(checkout), async () => {
            const { datos, cobro } = await cobroRecurrente()
            // otro pago por pasarela ya usa esa referencia: RegistrarPago responde 409
            await new RegistrarPago().execute(
                {
                    cliente_id: datos.clienteId,
                    metodo: 'pasarela',
                    monto: '10.00',
                    pasarela: 'recurrente',
                    referencia: checkout,
                },
                contextoSistema('consola'),
            )
            const r = await procesar(webhook(pagado(checkout, 30000, 1050)))
            assert.include(r, { ignorado: 'error_de_negocio', pago_id: null })
            assert.match(r.error!, /referencia|duplicad/i)
            const fila = await db.from('billing.pasarela_cobros').where('id', cobro.id).firstOrFail()
            assert.equal(fila.estado, 'pendiente')
            await afirmarLibroCuadrado(assert)
        })
    })

    test('H61: con proveedor de cobro, la retención va a 1.1.05 y la liquidación suma el pago menos lo retenido', async ({
        assert,
    }) => {
        // en una empresa propia: el proveedor de cobro queda activo (con pagos ya no se desactiva)
        const e = await prepararEmpresasGt()
        const ctx = e.ctx
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'recurrente',
                nombre: 'Recurrente',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
            },
            ctx,
        )
        const checkout = `ch_pc_${Date.now()}`
        await conRecurrente(rutasDe(checkout), async () => {
            const s = await servicioFacturado(e.B, '2026-10-01', {
                precio: '300.00',
                instalacion: '2026-10-01',
            })
            await new CrearCobroPasarela().execute({ cliente_id: s.clienteId }, contextoSistema('portal'))
            const r = await procesar(
                webhook({
                    event_type: 'intent.succeeded',
                    checkout: { id: checkout },
                    amount_in_cents: 30000,
                    details: { fee: 1050, vat_withheld: 482 },
                }),
            )
            assert.isNumber(r.pago_id, JSON.stringify(r))
            const movimientos = await lineasAsiento('pago', r.pago_id!)
            assert.deepInclude(movimientos, [proveedor.cuenta_codigo, '295.18', '0.00', null])
            assert.deepInclude(movimientos, ['1.1.05', '4.82', '0.00', null])
            const liquidacion = await new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: `LIQ-${checkout}`,
                    bruto: '295.18',
                    comision: '10.50',
                    pagos: [r.pago_id!],
                },
                ctx,
            )
            assert.equal(liquidacion.neto, '284.68')
        })
        // inv. 5 y 13 del auditor todavía piden el puente por el bruto (fila en a3.md): aquí el cuadre
        await afirmarLibroCuadrado(assert)
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
