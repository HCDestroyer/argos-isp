import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import { escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'
import { sesionDirecta } from '#tests/portal/ayudas_portal'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'

/**
 * Pago en línea desde el portal (semana 2) con la pasarela falsa, contra Postgres real: inicio por
 * IP y por sesión, monto por defecto (lo vencido), idempotencia, aislamiento entre clientes (404) y
 * el retorno (`GET /portal/pagos/en-linea/:id` + `GET /portal/estado`) tras el webhook.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

const hoy = () => DateTime.now().setZone('America/Guatemala').startOf('day')
const dia = (dias: number) => hoy().plus({ days: dias }).toISODate()!

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.103.${(ipSecuencia % 250) + 1}`
}

/** Servicio cortado (facturas vencidas y la del mes en curso sin vencer) con su sesión de red en `ip`. */
async function cortado() {
    const routerId = await crearRouterFila()
    const datos = await escenario({
        fecha_instalacion: dia(-75),
        plantilla: { hora_corte: '00:00' },
        servicio: { router_id: routerId },
    })
    await db.from('core.clientes').where('id', datos.clienteId).update({ nombre: 'Rosa Elvira Tzul' })
    await generar(datos.servicioId, dia(0))
    await new VencerFacturas().execute({ servicio_id: datos.servicioId, hasta: dia(0) }, contextoPrueba())
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    const ip = ipNueva()
    await db.table('network.sesiones').insert({
        servicio_id: datos.servicioId,
        router_id: routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: unico('ppp'),
        ipv4: ip,
    })
    return { ...datos, ip }
}

/** Facturas con saldo del servicio, separadas en vencidas y por vencer. */
async function pendientes(servicioId: number) {
    const filas = (await db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .orderBy('id')
        .select(
            'id',
            'estado',
            db.raw('(total - pagado)::text as saldo'),
            db.raw(
                `(estado = 'vencida' OR vence_en < (now() AT TIME ZONE 'America/Guatemala')::date) as vencida`,
            ),
        )) as Array<{ id: number; estado: string; saldo: string; vencida: boolean }>
    return {
        vencidas: filas.filter((f) => f.vencida),
        todas: filas,
    }
}

const suma = (filas: Array<{ saldo: string }>) =>
    filas.reduce((total, f) => total + Math.round(Number(f.saldo) * 100), 0) / 100

test.group('Portal: pago en línea', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-pago-en-linea')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('por IP: cobra lo vencido, sin datos internos, auditado con canal portal; tras pagar, el retorno ve "activo"', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        // una factura por vencer (según el día del mes, la del periodo en curso puede estar vencida)
        await db.table('billing.facturas').insert({
            cliente_id: s.clienteId,
            servicio_id: s.servicioId,
            periodo: '2099-01-01',
            clave_unica: `${s.servicioId}-2099-01-01`,
            vence_en: '2099-01-10',
            estado: 'emitida',
            subtotal: '100.00',
            iva: '0.00',
            total: '100.00',
            pagado: '0.00',
        })
        const { vencidas, todas } = await pendientes(s.servicioId)
        assert.isAbove(vencidas.length, 0)
        assert.isAbove(todas.length, vencidas.length, 'el escenario tiene una factura sin vencer')

        const inicio = await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', s.ip)
                .header('Idempotency-Key', unico('clave'))
                .json({}),
            201,
        )
        const cuerpo = inicio.body()
        assert.sameMembers(Object.keys(cuerpo), [
            'id',
            'estado',
            'monto',
            'url_pago',
            'expira_en',
            'pagado_en',
        ])
        assert.equal(cuerpo.estado, 'pendiente')
        assert.equal(Number(cuerpo.monto), suma(vencidas))
        assert.match(cuerpo.url_pago, /\/api\/v1\/pasarela\/falsa\/falsa_[0-9a-f]+$/)
        assert.notInclude(JSON.stringify(cuerpo), 'Rosa')

        const fila = await db
            .from('billing.pasarela_cobros')
            .where('id', cuerpo.id)
            .select('cliente_id', 'servicio_id', 'canal', db.raw('facturas::int[] as facturas'))
            .firstOrFail()
        assert.equal(Number(fila.cliente_id), s.clienteId)
        assert.equal(Number(fila.servicio_id), s.servicioId)
        assert.equal(fila.canal, 'portal')
        assert.sameMembers(
            fila.facturas,
            vencidas.map((f) => Number(f.id)),
        )

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'pasarela.crear_cobro')
            .where('entidad_id', cuerpo.id)
            .firstOrFail()
        assert.equal(auditoria.canal, 'portal')
        assert.equal(auditoria.actor_tipo, 'sistema')

        const antes = await estado(
            client.get(`/api/v1/portal/pagos/en-linea/${cuerpo.id}`).header('X-Forwarded-For', s.ip),
            200,
        )
        assert.equal(antes.body().estado, 'pendiente')
        assert.equal(antes.body().url_pago, cuerpo.url_pago)

        // el cliente paga en la página simulada: el webhook firmado registra el pago y reactiva
        const idProveedor = String(cuerpo.url_pago).split('/').at(-1)
        await estado(client.post(`/api/v1/pasarela/falsa/${idProveedor}/pagar`).json({}), 200)
        assert.equal(await estadoServicio(s.servicioId), 'activo')

        const despues = await estado(
            client.get(`/api/v1/portal/pagos/en-linea/${cuerpo.id}`).header('X-Forwarded-For', s.ip),
            200,
        )
        assert.equal(despues.body().estado, 'pagado')
        assert.isNull(despues.body().url_pago)
        assert.isNotNull(despues.body().pagado_en)
        const vivo = await estado(client.get('/api/v1/portal/estado').header('X-Forwarded-For', s.ip), 200)
        assert.equal(vivo.body().estado, 'activo')
    })

    test('idempotencia: la misma Idempotency-Key devuelve el mismo cobro y no crea otro', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const clave = unico('clave')
        const pedir = () =>
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', s.ip)
                .header('Idempotency-Key', clave)
                .json({})
        const primero = await estado(pedir(), 201)
        const segundo = await estado(pedir(), 201)
        assert.equal(segundo.body().id, primero.body().id)
        assert.equal(segundo.body().url_pago, primero.body().url_pago)
        const cobros = await db
            .from('billing.pasarela_cobros')
            .where('cliente_id', s.clienteId)
            .count('* as n')
        assert.equal(Number(cobros[0].n), 1)
    })

    test('otro cliente: servicio, facturas o cobro ajenos responden 404', async ({ client, assert }) => {
        const propio = await cortado()
        const ajeno = await cortado()
        const { cookie } = await sesionDirecta(propio.clienteId)
        const ipSinServicio = ipNueva()

        // servicio de otro cliente con la sesión propia
        await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', ipSinServicio)
                .header('Cookie', cookie)
                .json({ servicio_id: ajeno.servicioId }),
            404,
        )
        // facturas de otro cliente con la sesión propia
        const delAjeno = await pendientes(ajeno.servicioId)
        const facturasAjenas = delAjeno.todas.map((f) => Number(f.id))
        await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', ipSinServicio)
                .header('Cookie', cookie)
                .json({ facturas: facturasAjenas.slice(0, 1) }),
            404,
        )
        // facturas concretas sin sesión
        await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', propio.ip)
                .json({ facturas: facturasAjenas.slice(0, 1) }),
            401,
        )
        const cobrosAjenos = await db
            .from('billing.pasarela_cobros')
            .where('cliente_id', ajeno.clienteId)
            .count('* as n')
        assert.equal(Number(cobrosAjenos[0].n), 0)

        // cobro del otro cliente: ni por la IP propia ni por la sesión propia
        const cobroAjeno = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', ajeno.ip).json({}),
            201,
        )
        await estado(
            client
                .get(`/api/v1/portal/pagos/en-linea/${cobroAjeno.body().id}`)
                .header('X-Forwarded-For', propio.ip),
            404,
        )
        await estado(
            client
                .get(`/api/v1/portal/pagos/en-linea/${cobroAjeno.body().id}`)
                .header('X-Forwarded-For', ipSinServicio)
                .header('Cookie', cookie),
            404,
        )
        // inexistente: el mismo 404
        await estado(
            client.get('/api/v1/portal/pagos/en-linea/999999999').header('X-Forwarded-For', ajeno.ip),
            404,
        )
    })

    test('por sesión: facturas concretas del cliente; el retorno se lee con la sesión desde otra red', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const { cookie } = await sesionDirecta(s.clienteId)
        const { todas } = await pendientes(s.servicioId)
        const elegida = todas.at(-1)!
        const ip = ipNueva()

        const inicio = await estado(
            client
                .post('/api/v1/portal/pagos/iniciar')
                .header('X-Forwarded-For', ip)
                .header('Cookie', cookie)
                .json({ facturas: [Number(elegida.id)] }),
            201,
        )
        assert.equal(inicio.body().monto, elegida.saldo)
        const leido = await estado(
            client
                .get(`/api/v1/portal/pagos/en-linea/${inicio.body().id}`)
                .header('X-Forwarded-For', ip)
                .header('Cookie', cookie),
            200,
        )
        assert.equal(leido.body().estado, 'pendiente')

        // el proveedor rechaza la tarjeta: el retorno muestra el error, el servicio sigue cortado
        const idProveedor = String(inicio.body().url_pago).split('/').at(-1)
        await estado(
            client.post(`/api/v1/pasarela/falsa/${idProveedor}/pagar`).json({ estado: 'fallido' }),
            200,
        )
        const fallido = await estado(
            client
                .get(`/api/v1/portal/pagos/en-linea/${inicio.body().id}`)
                .header('X-Forwarded-For', ip)
                .header('Cookie', cookie),
            200,
        )
        assert.equal(fallido.body().estado, 'fallido')
        assert.isNull(fallido.body().url_pago)
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')
    })

    test('sin deuda: 422 sin_deuda; IP desconocida: 422 no_identificado; empresa anuncia el pago en línea', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        await db
            .from('billing.facturas')
            .where('servicio_id', s.servicioId)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .update({ estado: 'anulada' })
        const sinDeuda = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', s.ip).json({}),
            422,
        )
        assert.match(sinDeuda.body().type, /sin_deuda$/)
        assert.include(sinDeuda.body().detail, 'No tienes saldo pendiente')

        const anonimo = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', ipNueva()).json({}),
            422,
        )
        assert.match(anonimo.body().type, /no_identificado$/)

        const empresa = await estado(
            client.get('/api/v1/portal/empresa').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.isTrue(empresa.body().pago_en_linea)
    })
})
