import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearCliente, crearFactura, crearServicio } from '#tests/notify/ayudas_notify'
import { PLANTILLAS_BASE } from '#notify/plantillas_base'
import { ejemploDeEvento, eventosConPlantilla, vistaPrevia } from '#notify/catalogo'
import { cargarDestinatario, construirVariables, type Variables } from '#notify/variables'

/**
 * Catálogo de eventos y vista previa de plantillas (pedido de A4): `GET /notificaciones/eventos` y
 * `POST /notificaciones/plantillas/vista-previa`. Las variables del catálogo son las del aviso real
 * (se comparan con `construirVariables`) y cada plantilla de fábrica se renderiza sin variables
 * desconocidas.
 */

const AHORA = DateTime.fromISO('2027-03-07T15:00:00Z', { zone: 'utc' })

function claves(valor: unknown, prefijo = ''): string[] {
    if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
        return Object.entries(valor).flatMap(([k, v]) => claves(v, prefijo ? `${prefijo}.${k}` : k))
    }
    return [prefijo]
}

async function realesDe(evento: string, payload: Record<string, unknown>, clienteId: number) {
    const destinatario = (await cargarDestinatario(db.connection(), clienteId))!
    return construirVariables(db.connection(), evento, payload, destinatario, AHORA)
}

test.group('notify · catálogo de eventos y vista previa', () => {
    test('GET /notificaciones/eventos: todos los eventos con plantilla, con sus variables', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const respuesta = await estado(client.get('/api/v1/notificaciones/eventos').bearerToken(token), 200)
        const eventos = respuesta.body() as Array<{
            evento: string
            nombre: string
            grupo: string
            tipo_aviso: string | null
            canales: string[]
            variables: Array<{
                grupo: string
                variables: Array<{ nombre: string; tipo: string; ejemplo: string }>
            }>
        }>
        assert.deepEqual(
            eventos.map((e) => e.evento),
            [...new Set(PLANTILLAS_BASE.map((p) => p.evento))],
        )
        const factura = eventos.find((e) => e.evento === 'factura.emitida')!
        assert.containsSubset(factura, {
            nombre: 'Factura emitida',
            grupo: 'cliente',
            tipo_aviso: 'factura',
            canales: ['correo', 'telegram'],
        })
        assert.deepEqual(
            factura.variables.map((g) => g.grupo),
            ['evento', 'empresa', 'cliente', 'servicio', 'factura'],
        )
        const total = factura.variables
            .find((g) => g.grupo === 'factura')!
            .variables.find((x) => x.nombre === 'factura.total_q')
        assert.deepEqual(total, { nombre: 'factura.total_q', tipo: 'texto', ejemplo: 'Q 200.00' })
        const vencida = factura.variables
            .find((g) => g.grupo === 'factura')!
            .variables.find((x) => x.nombre === 'factura.vencida')
        assert.equal(vencida!.tipo, 'booleano')

        const recordatorio = eventos.find((e) => e.evento === 'recordatorio.1')!
        assert.containsSubset(recordatorio, { grupo: 'recordatorio', tipo_aviso: 'recordatorio' })

        const alerta = eventos.find((e) => e.evento === 'alerta.libro.integridad_rota')!
        assert.equal(alerta.grupo, 'alerta')
        assert.isNull(alerta.tipo_aviso)
        assert.sameMembers(alerta.canales, ['telegram', 'correo'])
        const deAlerta = alerta.variables.find((g) => g.grupo === 'alerta')!.variables.map((x) => x.nombre)
        assert.includeMembers(deAlerta, ['alerta.sello', 'alerta.esperado', 'alerta.obtenido'])
    })

    test('cada plantilla de fábrica se renderiza sin variables desconocidas', async ({ assert }) => {
        for (const p of PLANTILLAS_BASE) {
            const r = await vistaPrevia(
                db.connection(),
                { evento: p.evento, canal: p.canal, asunto: p.asunto, cuerpo: p.cuerpo },
                null,
                AHORA,
            )
            assert.deepEqual(r.variables_desconocidas, [], `${p.evento} (${p.canal})`)
            assert.isAbove(r.cuerpo.length, 0, `${p.evento} (${p.canal})`)
        }
    })

    test('las variables del catálogo son las mismas que arma el aviso real', async ({ assert }) => {
        const clienteId = await crearCliente({ email: 'catalogo@prueba.local' })
        const servicioId = await crearServicio(clienteId)
        const facturaId = await crearFactura(clienteId, servicioId, { vence: '2027-03-10' })
        const casos: Array<[string, Record<string, unknown>]> = [
            ['factura.emitida', { factura_id: facturaId, servicio_id: servicioId, cliente_id: clienteId }],
            [
                'recordatorio.1',
                { factura_id: facturaId, servicio_id: servicioId, cliente_id: clienteId, orden: 1, dias: -3 },
            ],
            [
                'servicio.estado_cambiado',
                {
                    servicio_id: servicioId,
                    cliente_id: clienteId,
                    de: 'activo',
                    a: 'suspendido',
                    motivo: 'x',
                },
            ],
            [
                'servicio.instalacion_activada',
                {
                    servicio_id: servicioId,
                    cliente_id: clienteId,
                    de: 'pendiente_instalacion',
                    a: 'activo',
                    motivo: 'instalacion',
                },
            ],
            [
                'promesa.creada',
                {
                    promesa_id: 1,
                    servicio_id: servicioId,
                    cliente_id: clienteId,
                    monto: '10.00',
                    vence: '2027-03-12T05:59:00Z',
                },
            ],
            [
                'lealtad.puntos_por_vencer',
                { cliente_id: clienteId, empresa_id: 1, puntos: 5, vence_en: '2027-04-01' },
            ],
            [
                'sorteo.ganador_notificado',
                { cliente_id: clienteId, empresa_id: 1, sorteo_id: 1, posicion: 1 },
            ],
        ]
        for (const [evento, payload] of casos) {
            const reales = await realesDe(evento, payload, clienteId)
            const ejemplo: Variables = await ejemploDeEvento(db.connection(), evento, null, AHORA)
            assert.deepEqual(claves(ejemplo).sort(), claves(reales).sort(), evento)
        }
        // pago.registrado sin cobro_id no trae `cobro`; el catálogo lo lista porque el cobro en caja sí
        const pago = await realesDe(
            'pago.registrado',
            { pago_id: 1, cliente_id: clienteId, monto: '5.00', facturas: [] },
            clienteId,
        )
        const ejemploPago = claves(await ejemploDeEvento(db.connection(), 'pago.registrado', null, AHORA))
        assert.deepEqual(ejemploPago.filter((c) => !c.startsWith('cobro.')).sort(), claves(pago).sort())
    })

    test('POST vista previa: renderiza sin guardar, mensaje de Telegram y variables desconocidas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const antes = await db.from('notify.plantillas').count('* as n').first()
        const correo = await estado(
            client.post('/api/v1/notificaciones/plantillas/vista-previa').bearerToken(token).json({
                evento: 'factura.emitida',
                canal: 'correo',
                asunto: 'Factura {{factura.numero}}',
                cuerpo: 'Hola {{cliente.nombre}}: {{factura.total_q}}{{#factura.vencida}} vencida{{/factura.vencida}} {{factura.inventada}}',
            }),
            200,
        )
        assert.containsSubset(correo.body(), {
            evento: 'factura.emitida',
            canal: 'correo',
            asunto: 'Factura A1B2C3D4-1234567890',
            cuerpo: 'Hola María López: Q 200.00',
            mensaje: 'Hola María López: Q 200.00',
            variables_desconocidas: ['factura.inventada'],
        })

        const telegram = await estado(
            client.post('/api/v1/notificaciones/plantillas/vista-previa').bearerToken(token).json({
                evento: 'sorteo.ganador_notificado',
                canal: 'telegram',
                asunto: '¡Ganaste!',
                cuerpo: '{{#sorteo}}Código {{codigo}}{{/sorteo}} · {{empresa.nombre}}',
            }),
            200,
        )
        const cuerpo = telegram.body() as { mensaje: string; variables_desconocidas: string[] }
        assert.match(cuerpo.mensaje, /^¡Ganaste!\n\nCódigo GAN-7Q4X · \S/)
        assert.deepEqual(cuerpo.variables_desconocidas, [], 'los nombres relativos a una sección resuelven')

        const invalida = await estado(
            client
                .post('/api/v1/notificaciones/plantillas/vista-previa')
                .bearerToken(token)
                .json({ evento: 'pago.inventado', canal: 'correo', cuerpo: 'Hola {{#cliente}}' }),
            422,
        )
        const campos = (invalida.body() as { errors: Array<{ field: string }> }).errors.map((e) => e.field)
        assert.sameMembers(campos, ['evento', 'cuerpo'])

        const despues = await db.from('notify.plantillas').count('* as n').first()
        assert.equal(despues!.n, antes!.n, 'la vista previa no guarda')
    })

    test('lista de eventos sin duplicados y nombres en español', ({ assert }) => {
        const eventos = eventosConPlantilla()
        assert.equal(new Set(eventos).size, eventos.length)
    })
})
