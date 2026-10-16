import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import { escenario, estadoServicio, generar } from '#tests/billing/ayudas_billing'
import { EnviadorFalso, cookieDeSesion, nitAleatorio } from '#tests/portal/ayudas_portal'
import { aTexto, dec } from '#ledger/dinero'
import { usarEnviadorCodigo } from '#portal/acceso/envio_codigo'
import { esCorregible, fechaLegible, motivoParaCliente, venceAlFinalDelDia } from '#portal/promesas'
import { normalizarReglasPromesa, type ReglasPromesaParciales } from '#billing/reglas_promesa'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import type { ResultadoEvaluacion } from '#billing/promesas'

/**
 * Tarea 4: promesa de pago desde `/corte` (por IP) y desde `/cuenta` (por sesión), contra
 * Postgres real. La decisión es de `CrearPromesaPago` (A3); aquí se prueba la identificación, la
 * respuesta sin datos internos, el motivo legible, el límite y la idempotencia.
 *
 * Las fechas son relativas a hoy (la ruta usa la hora real): el servicio se instala hace 75 días,
 * así siempre tiene al menos dos facturas vencidas y queda cortado.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

const hoy = () => DateTime.now().setZone('America/Guatemala').startOf('day')
const dia = (dias: number) => hoy().plus({ days: dias }).toISODate()!

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.101.${(ipSecuencia % 250) + 1}`
}

let enviador: EnviadorFalso

/** Servicio cortado con su sesión de red en `ip`. Por defecto sin la regla de siguiente facturación. */
async function cortado(reglas: ReglasPromesaParciales = {}, cliente: Record<string, unknown> = {}) {
    const routerId = await crearRouterFila()
    const datos = await escenario({
        fecha_instalacion: dia(-75),
        plantilla: {
            hora_corte: '00:00',
            reglas_promesa: JSON.stringify(
                normalizarReglasPromesa({ no_exceder_siguiente_facturacion: false, ...reglas }),
            ),
        },
        servicio: { router_id: routerId },
    })
    if (Object.keys(cliente).length > 0) {
        await db.from('core.clientes').where('id', datos.clienteId).update(cliente)
    }
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
    const deuda = await db
        .from('billing.facturas')
        .where('servicio_id', datos.servicioId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .select(db.raw('sum(total - pagado)::numeric(14,2)::text as pendiente'))
        .first()
    return { ...datos, ip, deuda: String(deuda.pendiente) }
}

/** Entra al portal como el cliente con `nit` y devuelve la cookie. */
async function entrar(client: ApiClient, nit: string): Promise<string> {
    const ip = ipNueva()
    const pedido = await client
        .post('/api/v1/portal/codigo')
        .header('X-Forwarded-For', ip)
        .json({ identificador: nit })
    const verificado = await client
        .post('/api/v1/portal/verificar')
        .header('X-Forwarded-For', ip)
        .json({ solicitud: pedido.body().solicitud, codigo: enviador.ultimoCodigo() })
    verificado.assertStatus(200)
    return cookieDeSesion(verificado)!
}

test.group('Portal: solicitar promesa de pago', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-promesas')
        delete process.env.PORTAL_LIMITE_PETICIONES
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('por IP: condiciones con el plazo del canal portal y la deuda, sin datos personales', async ({
        client,
        assert,
    }) => {
        const s = await cortado({}, { nombre: 'Juana Inés Coyoy', email: 'juana@example.com' })

        const respuesta = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.deepEqual(respuesta.body(), {
            disponible: true,
            motivo: null,
            promesa_abierta: null,
            fecha_minima: dia(0),
            fecha_maxima: dia(3),
            plazo_max_dias: 3,
            monto_maximo: s.deuda,
            monto_sugerido: s.deuda,
            abono_inicial: null,
            deuda_maxima: null,
            pago_previo: null,
            requiere_aprobacion: false,
        })
        assert.equal(respuesta.header('cache-control'), 'no-store')
        const texto = JSON.stringify(respuesta.body())
        for (const dato of ['Juana', 'Coyoy', 'example.com', s.ip]) assert.notInclude(texto, dato)
    })

    test('condiciones: abono inicial y aprobación de la plantilla; fecha máxima antes de facturar', async ({
        client,
        assert,
    }) => {
        const s = await cortado({
            abono_inicial_pct: 50,
            no_exceder_siguiente_facturacion: true,
            canales: { portal: { requiere_aprobacion: true, plazo_max_dias: 60 } },
        })
        const respuesta = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        const cuerpo = respuesta.body()
        assert.isTrue(cuerpo.disponible)
        assert.isTrue(cuerpo.requiere_aprobacion)
        assert.equal(cuerpo.plazo_max_dias, 60)
        // 60 días siempre cruzan la siguiente factura (día 1 del mes): vale el día anterior.
        const siguiente = hoy().plus({ months: 1 }).startOf('month')
        assert.equal(cuerpo.fecha_maxima, siguiente.minus({ days: 1 }).toISODate())
        assert.deepEqual(cuerpo.abono_inicial, {
            porcentaje: 50,
            requerido: aTexto(dec(s.deuda).div(2)),
            abonado: '0.00',
            faltante: aTexto(dec(s.deuda).div(2)),
        })
        // sin abonar, la promesa no se aprobaría: el portal no deja enviar
        assert.equal(cuerpo.pago_previo, aTexto(dec(s.deuda).div(2)))
    })

    test('condiciones de limitesPromesa (A3): deuda máxima y pago previo, iguales a lo que decide crear', async ({
        client,
        assert,
    }) => {
        const s = await cortado({ deuda_maxima: '100.00' })
        const leidas = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        const cuerpo = leidas.body()
        assert.isTrue(cuerpo.disponible)
        const exceso = aTexto(dec(s.deuda).minus('100.00'))
        assert.deepEqual(cuerpo.deuda_maxima, { maximo: '100.00', vencida: s.deuda, faltante: exceso })
        assert.equal(cuerpo.pago_previo, exceso)

        // lo que anunció el portal es lo que decide CrearPromesaPago
        const promesa = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: cuerpo.fecha_maxima, monto: cuerpo.monto_sugerido }),
            201,
        )
        assert.equal(promesa.body().resultado, 'rechazada')
        assert.include(promesa.body().motivo, 'saldo vencido es mayor que el permitido')
    })

    test('condiciones: cupo del periodo agotado → no disponible con el motivo', async ({
        client,
        assert,
    }) => {
        const s = await cortado({ canales: { portal: { max_por_periodo: 0 } } })
        const leidas = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        const cuerpo = leidas.body()
        assert.isFalse(cuerpo.disponible)
        assert.include(cuerpo.motivo, 'Ya usaste las promesas de pago disponibles para este periodo')
        assert.isNull(cuerpo.fecha_maxima)
    })

    test('por IP: aprobada reactiva el servicio y /portal/estado lo ve; auditoría como sistema/portal', async ({
        client,
        assert,
    }) => {
        const s = await cortado({}, { nombre: 'Pedro Pablo Ajú' })
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')

        const respuesta = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(2), monto: s.deuda }),
            201,
        )
        const cuerpo = respuesta.body()
        assert.deepEqual(Object.keys(cuerpo).sort(), [
            'corregible',
            'id',
            'monto',
            'motivo',
            'resultado',
            'servicio_estado',
            'vence_en',
        ])
        assert.include(cuerpo, {
            resultado: 'aprobada',
            monto: s.deuda,
            servicio_estado: 'activo',
            motivo: 'Tu promesa de pago fue aprobada.',
        })
        assert.equal(new Date(cuerpo.vence_en).toISOString(), venceAlFinalDelDia(dia(2)).toISOString())
        assert.notInclude(JSON.stringify(cuerpo), 'Pedro')

        const promesa = await db.from('billing.promesas').where('id', cuerpo.id).firstOrFail()
        assert.include(promesa, { estado: 'activa', canal: 'portal', servicio_id: s.servicioId })

        const vivo = await estado(client.get('/api/v1/portal/estado').header('X-Forwarded-For', s.ip), 200)
        assert.equal(vivo.body().estado, 'activo')

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'promesas.crear')
            .where('entidad_tipo', 'promesa')
            .where('entidad_id', cuerpo.id)
            .firstOrFail()
        assert.include(auditoria, { actor_tipo: 'sistema', canal: 'portal', resultado: 'ok' })
        assert.isNull(auditoria.actor_id)
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'promesa.creada')
            .whereRaw(`(payload->>'promesa_id')::bigint = ?`, [cuerpo.id])
        assert.lengthOf(eventos, 1)
    })

    test('rechazada: motivo legible para el cliente, nunca el código de la regla', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const respuesta = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(10), monto: '50.00' }),
            201,
        )
        assert.include(respuesta.body(), {
            resultado: 'rechazada',
            servicio_estado: null,
            motivo: 'La fecha de pago debe estar dentro de los próximos 3 días.',
            corregible: true,
        })
        assert.notInclude(JSON.stringify(respuesta.body()), 'plazo_max_dias')
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')
    })

    test('pendiente de aprobación cuando el canal portal la exige', async ({ client, assert }) => {
        const s = await cortado({ canales: { portal: { requiere_aprobacion: true } } })
        const respuesta = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '100.00' }),
            201,
        )
        assert.include(respuesta.body(), {
            resultado: 'pendiente_aprobacion',
            motivo: 'Un asesor revisará tu solicitud y te avisaremos cuando quede aprobada.',
        })
        assert.equal(await estadoServicio(s.servicioId), 'suspendido')

        const condiciones = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.include(condiciones.body(), {
            disponible: false,
            motivo: 'Ya tienes una promesa de pago esperando aprobación.',
        })
        assert.equal(condiciones.body().promesa_abierta.estado, 'pendiente_aprobacion')

        const repetida = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '100.00' }),
            409,
        )
        assert.equal(repetida.body().type, 'urn:argosisp:problema:promesa_abierta')
        assert.equal(repetida.body().detail, 'Ya tienes una promesa de pago en curso.')
    })

    test('IP desconocida: 422 no_identificado y nada guardado', async ({ client, assert }) => {
        const respuesta = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', '203.0.113.250')
                .json({ vence_el: dia(1), monto: '100.00' }),
            422,
        )
        assert.equal(respuesta.body().type, 'urn:argosisp:problema:no_identificado')
        await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', '203.0.113.250'),
            422,
        )
    })

    test('monto mayor que la deuda o fecha pasada: 422 por campo', async ({ client, assert }) => {
        const s = await cortado()
        const mucho = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '99999.00' }),
            422,
        )
        assert.equal(mucho.body().errors[0].field, 'monto')
        const ayer = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(-1), monto: '10.00' }),
            422,
        )
        assert.equal(ayer.body().errors[0].field, 'vence_en')
        const n = await db.from('billing.promesas').where('servicio_id', s.servicioId).count('* as n')
        assert.equal(Number(n[0].n), 0)
    })

    test('Idempotency-Key: el reintento devuelve la misma promesa sin crear otra', async ({
        client,
        assert,
    }) => {
        const s = await cortado()
        const clave = randomUUID()
        const pedir = () =>
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .header('Idempotency-Key', clave)
                .json({ vence_el: dia(1), monto: '100.00' })
        const primera = await estado(pedir(), 201)
        const segunda = await estado(pedir(), 201)
        assert.equal(segunda.header('idempotent-replayed'), 'true')
        assert.deepEqual(segunda.body(), primera.body())
        const n = await db.from('billing.promesas').where('servicio_id', s.servicioId).count('* as n')
        assert.equal(Number(n[0].n), 1)
    })

    test('con límite de peticiones: 429 con Retry-After', async ({ client, assert }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '1'
        const s = await cortado()
        await estado(client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip), 200)
        await estado(client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip), 429)
        await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '10.00' }),
            201,
        )
        const otra = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '10.00' }),
            429,
        )
        assert.isString(otra.header('retry-after'))
    })

    test('por sesión: servicio_id exige la cookie y que el servicio sea del cliente', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        const s = await cortado({}, { nit_cui: nit, email: 'cliente@example.com' })
        const ajeno = await cortado()

        // Sin cookie, servicio_id no sirve aunque la IP sea la del servicio.
        await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', s.ip)
                .json({ vence_el: dia(1), monto: '10.00', servicio_id: s.servicioId }),
            401,
        )

        const cookie = await entrar(client, nit)
        const otraIp = ipNueva()
        await estado(
            client
                .get(`/api/v1/portal/promesas/condiciones?servicio_id=${ajeno.servicioId}`)
                .header('X-Forwarded-For', otraIp)
                .header('Cookie', cookie),
            404,
        )
        const condiciones = await estado(
            client
                .get(`/api/v1/portal/promesas/condiciones?servicio_id=${s.servicioId}`)
                .header('X-Forwarded-For', otraIp)
                .header('Cookie', cookie),
            200,
        )
        assert.isTrue(condiciones.body().disponible)

        const creada = await estado(
            client
                .post('/api/v1/portal/promesas')
                .header('X-Forwarded-For', otraIp)
                .header('Cookie', cookie)
                .json({ vence_el: dia(1), monto: s.deuda, servicio_id: s.servicioId }),
            201,
        )
        assert.equal(creada.body().resultado, 'aprobada')
        assert.equal(await estadoServicio(s.servicioId), 'activo')
        assert.equal(await estadoServicio(ajeno.servicioId), 'suspendido')

        const lista = await estado(client.get('/api/v1/portal/promesas').header('Cookie', cookie), 200)
        assert.equal(lista.body().data[0].id, creada.body().id)
    })
})

test.group('Portal: motivo de la promesa en palabras del cliente', () => {
    const evaluacion = (
        regla: string,
        limite: unknown,
        valor: unknown = null,
        detalle = '',
    ): ResultadoEvaluacion =>
        ({
            resultado: 'rechazada',
            regla,
            motivo: `motivo interno de ${regla}`,
            reglas: [{ regla, ok: false, limite, valor, detalle, origen: 'general' }],
        }) as unknown as ResultadoEvaluacion

    test('cada regla tiene su texto y ninguno lleva el código', ({ assert }) => {
        const casos: Array<[ResultadoEvaluacion, string]> = [
            [evaluacion('plazo_max_dias', 1), 'La fecha de pago debe ser hoy o mañana.'],
            [
                evaluacion('no_exceder_siguiente_facturacion', '2026-11-01'),
                'La fecha de pago debe ser antes del 1 de noviembre, cuando se emite tu próxima factura.',
            ],
            [
                evaluacion('abono_inicial_pct', '150.00', '20.5'),
                'Antes de solicitar la promesa debes abonar Q150.00 (llevas Q20.50).',
            ],
            [
                evaluacion(
                    'bloqueo_tras_incumplida_dias',
                    30,
                    3,
                    'Incumplió una promesa hace 3 días; puede volver a prometer desde el 2026-11-12',
                ),
                'Tuviste una promesa sin cumplir hace poco. Podrás solicitar otra a partir del 12 de noviembre.',
            ],
        ]
        for (const [entrada, texto] of casos) assert.equal(motivoParaCliente(entrada), texto)

        for (const regla of [
            'habilitadas',
            'canal_permitido',
            'sin_deuda',
            'deuda_maxima',
            'antiguedad_minima_dias',
            'cumplimiento_minimo_pct',
            'max_por_periodo',
        ]) {
            const texto = motivoParaCliente(evaluacion(regla, null))
            assert.notInclude(texto, regla)
            assert.notInclude(texto, 'motivo interno')
        }
        // Una regla nueva de A3 cae en su motivo (ya legible), no en el código.
        assert.equal(motivoParaCliente(evaluacion('regla_futura', null)), 'motivo interno de regla_futura')
        assert.equal(fechaLegible('2026-01-31'), '31 de enero')
    })

    test('solo el plazo y la próxima factura se corrigen cambiando la fecha o el monto', ({ assert }) => {
        assert.isTrue(esCorregible(evaluacion('plazo_max_dias', 3)))
        assert.isTrue(esCorregible(evaluacion('no_exceder_siguiente_facturacion', '2026-11-01')))
        for (const regla of [
            'max_por_periodo',
            'habilitadas',
            'canal_permitido',
            'sin_deuda',
            'deuda_maxima',
            'abono_inicial_pct',
            'antiguedad_minima_dias',
            'cumplimiento_minimo_pct',
            'bloqueo_tras_incumplida_dias',
            'regla_futura',
        ]) {
            assert.isFalse(esCorregible(evaluacion(regla, null)), regla)
        }
        const aprobada = { ...evaluacion('plazo_max_dias', 3), resultado: 'aprobada' } as ResultadoEvaluacion
        assert.isFalse(esCorregible(aprobada))
    })
})
