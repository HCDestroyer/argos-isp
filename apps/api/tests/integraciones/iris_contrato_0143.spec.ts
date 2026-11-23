import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila, crearEmpresaFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { conectorIris, tokenIris } from '#tests/core/ayudas_iris_0100'
import { eventoOutbox } from '#tests/notify/ayudas_notify'
import type { PayloadFallaGeneral } from '#shared/eventos'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import { CONTRATO_IRIS, contratoArgos } from '#integraciones/iris/configuracion'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { EVENTOS_A_IRIS, EVENTOS_DESDE_0130 } from '#integraciones/iris/envios'

/**
 * Contrato Iris 0.14.3 anunciado (`CONTRATO_IRIS`): Iris ya puede informar hasta 0.14.3 y lo que faltaba
 * del lado de Argos entre 0.12.0 y 0.14.3: `red.falla_general_*` a Iris (0.13.0, A50), la lectura
 * auditada de los servicios de un incidente (0.13.0 §3.11, ajuste e) y `numero` null en `factura.*` de
 * una factura sin DTE (aclarado en 0.14.3 §2.3).
 */

const consumidor = new ConsumidorIris()

async function reenviar(outboxId: number) {
    const fila = await db.from('audit.outbox').where('id', outboxId).first()
    const payload = typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload
    await consumidor.procesar({ id: outboxId, evento: fila.evento, payload })
    const envio = await db
        .from('integraciones.iris_envios')
        .where('evento_id', `argos-evt-${outboxId}`)
        .first()
    return envio ? (JSON.parse(envio.cuerpo).payload as Record<string, unknown>) : null
}

function falla(empresaId: number, extra: Partial<PayloadFallaGeneral> = {}): PayloadFallaGeneral {
    return {
        incidente_id: 9_100_000 + Math.floor(Math.random() * 100_000),
        empresa_id: empresaId,
        alcance: 'router',
        alcance_id: 77,
        servicios_afectados: { cantidad: 3, ids: [11, 12, 13] },
        origen: 'manual',
        desde: '2026-11-23T15:00:00.000Z',
        hasta: null,
        ...extra,
    }
}

test.group('Iris 0.14.3 · versión anunciada', (group) => {
    group.each.teardown(async () => {
        await db.from('integraciones.iris_envios').delete()
        await db.from('integraciones.iris_conector').delete()
        await soloEmpresaPrincipal()
    })

    test('Argos habla 0.14.3: Iris lo informa; una versión mayor es 422 contrato_no_soportado', async ({
        client,
        assert,
    }) => {
        assert.equal(CONTRATO_IRIS, '0.14.3')
        assert.equal(contratoArgos(), '0.14.3')
        const token = await tokenIris()
        await conectorIris('0.14.2')
        const poner = (contrato: string) =>
            client
                .put('/api/v1/integraciones/iris/contrato')
                .bearerToken(token)
                .json({ contrato, vinculos_cargados: 0 })
        const mayor = await estado(poner('0.14.4'), 422)
        assert.match(mayor.body().type, /contrato_no_soportado$/)
        const r = await estado(poner('0.14.3'), 200)
        assert.include(r.body(), { contrato_iris: '0.14.3', contrato: '0.14.3' })
        const fila = await db.from('integraciones.iris_conector').where('id', 1).firstOrFail()
        assert.equal(fila.contrato, '0.14.3')
    })

    test('0.13.0 (A50): red.falla_general_* sale a Iris ≥ 0.13.0, lista cerrada y por empresa del alcance', async ({
        assert,
    }) => {
        for (const e of EVENTOS_DESDE_0130) {
            assert.include(EVENTOS_A_IRIS as readonly string[], e)
            assert.isTrue(consumidor.acepta(e))
        }
        const B = await crearEmpresaFila()
        const C = await crearEmpresaFila()
        await tokenIris([B])

        const abierta = falla(B)
        const idAbierta = await eventoOutbox('red.falla_general_abierta', { ...abierta })
        await conectorIris('0.12.1')
        assert.isNull(await reenviar(idAbierta))

        await conectorIris('0.13.0')
        const enviado = await reenviar(idAbierta)
        assert.deepEqual(enviado, {
            incidente_id: abierta.incidente_id,
            empresa_id: B,
            alcance: 'router',
            alcance_id: 77,
            servicios_afectados: { cantidad: 3, ids: [11, 12, 13] },
            desde: '2026-11-23T15:00:00.000Z',
            hasta: null,
        })

        // el mismo incidente cerrado: `hasta` con fecha
        const cerrada = { ...abierta, hasta: '2026-11-23T16:30:00.000Z' }
        const enviadoCierre = await reenviar(await eventoOutbox('red.falla_general_cerrada', { ...cerrada }))
        assert.include(enviadoCierre!, {
            incidente_id: abierta.incidente_id,
            hasta: '2026-11-23T16:30:00.000Z',
        })
        assert.notProperty(enviadoCierre!, 'origen')

        // el evento de otra empresa (mismo incidente) no sale a un conector que no la tiene
        const otra = await eventoOutbox('red.falla_general_abierta', {
            ...falla(C, { incidente_id: abierta.incidente_id }),
        })
        assert.isNull(await reenviar(otra))

        // más de 5000 afectados: la cantidad real y como mucho 5000 ids
        const muchos = Array.from({ length: 5003 }, (_, i) => i + 1)
        const grande = await reenviar(
            await eventoOutbox('red.falla_general_abierta', {
                ...falla(B, { servicios_afectados: { cantidad: 5003, ids: muchos } }),
            }),
        )
        const afectados = grande!.servicios_afectados as { cantidad: number; ids: number[] }
        assert.equal(afectados.cantidad, 5003)
        assert.lengthOf(afectados.ids, 5000)
    })

    test('0.14.3 §2.3: numero de factura.* es el del DTE o null; a un Iris anterior sale el id', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await tokenIris()
        const visita = (await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Visita técnica' })
            .select('id')
            .firstOrFail()) as { id: number }
        const cargo = (await new EmitirCargoUnico().execute(
            {
                cliente_id: await crearClienteFila(),
                empresa_id: e.B,
                lineas: [{ concepto_id: Number(visita.id), precio_unitario: '112.00' }],
                origen_tipo: 'iris_orden',
                origen_id: randomUUID(),
            },
            { ...e.ctx, empresaId: e.B },
        )) as { id: number }
        const fila = await db
            .from('audit.outbox')
            .where('evento', 'factura.emitida')
            .whereRaw(`(payload->>'factura_id')::bigint = ?`, [cargo.id])
            .orderBy('id', 'desc')
            .firstOrFail()
        const outboxId = Number(fila.id)

        await conectorIris('0.14.2')
        assert.equal((await reenviar(outboxId))!.numero, String(cargo.id))
        await conectorIris('0.14.3')
        assert.isNull((await reenviar(outboxId))!.numero)

        // certificada: serie-número del DTE, con cualquier contrato
        await db.table('fiscal.dte').insert({
            empresa_id: e.B,
            documento_tipo: 'factura',
            documento_id: cargo.id,
            tipo_dte: 'FACT',
            estado: 'certificado',
            proveedor: 'infile',
            ambiente: 'pruebas',
            identificador: randomUUID(),
            autorizacion: randomUUID().toUpperCase(),
            serie: 'A1B2C3D4',
            numero: '1234567890',
            certificado_en: new Date(),
            receptor: JSON.stringify({ nit: 'CF' }),
            total: '112.00',
            iva: '12.00',
        })
        await conectorIris('0.14.3')
        assert.equal((await reenviar(outboxId))!.numero, 'A1B2C3D4-1234567890')
    })

    test('0.13.0 §3.11: GET /incidentes-red/:id/servicios con el token de Iris queda auditada, también el 404', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const servicio = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(admin.token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: await crearPlanFila(),
                }),
            201,
        )
        const s = servicio.body() as { id: number; empresa_id: number }
        const incidente = await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(admin.token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'corte de fibra' }),
            201,
        )
        const incidenteId = Number(incidente.body().id)
        const otra = await crearEmpresaFila()
        const token = await tokenIris([s.empresa_id])
        const ruta = `/api/v1/incidentes-red/${incidenteId}/servicios`

        const r = await estado(client.get(ruta).qs({ empresa_id: s.empresa_id }).bearerToken(token), 200)
        assert.deepEqual(r.body(), { data: [s.id], nextCursor: null })
        await estado(client.get(ruta).qs({ empresa_id: otra }).bearerToken(token), 404)

        const filas = await db
            .from('audit.acciones')
            .where({ accion: 'incidentes_red.leer', entidad_tipo: 'incidente_red', entidad_id: incidenteId })
            .orderBy('id')
        assert.lengthOf(filas, 2)
        assert.containSubset(filas[0], { actor_tipo: 'token', resultado: 'ok', empresa_id: s.empresa_id })
        assert.containSubset(filas[1], { actor_tipo: 'token', resultado: 'error' })

        await estado(
            client
                .post(`/api/v1/incidentes-red/${incidenteId}/cerrar`)
                .bearerToken(admin.token)
                .json({ motivo: 'reparado' }),
            200,
        )
    })
})
