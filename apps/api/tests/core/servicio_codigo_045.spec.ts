import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'
import { conCodigoServicio, payloadParaIris } from '#integraciones/iris/envios'

/**
 * Código y nombre del servicio (contrato Iris 0.10.0 §3.7, pedido A45).
 */

async function alta(client: any, token: string, extra: Record<string, unknown> = {}) {
    const escenario = await crearEscenarioRouter()
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: escenario.routerId,
                plan_id: await crearPlanFila(),
                ...extra,
            }),
        201,
    )
    return r.body() as Record<string, any>
}

test.group('Servicios · código y nombre (A45)', () => {
    test('el alta recibe un código S-000000 creciente y único; el nombre es opcional', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const a = await alta(client, token, { nombre: 'Casa' })
        const b = await alta(client, token)
        assert.match(a.codigo, /^S-\d{6,}$/)
        assert.match(b.codigo, /^S-\d{6,}$/)
        assert.isAbove(Number(b.codigo.slice(2)), Number(a.codigo.slice(2)))
        assert.equal(a.nombre, 'Casa')
        assert.isNull(b.nombre)

        const lista = await estado(
            client.get(`/api/v1/servicios?cliente_id=${a.cliente_id}`).bearerToken(token),
            200,
        )
        assert.equal(lista.body().data[0].codigo, a.codigo)
        assert.equal(lista.body().data[0].nombre, 'Casa')
    })

    test('un código mandado en el cuerpo se ignora y la base no deja cambiarlo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await alta(client, token, { codigo: 'S-999999' })
        assert.notEqual(s.codigo, 'S-999999')
        await assert.rejects(
            () => db.from('core.servicios').where('id', s.id).update({ codigo: 'S-000001' }),
            /inmutable/,
        )
        // una fila insertada directo (importador, fixture) también recibe su código
        const id = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const fila = await db.from('core.servicios').where('id', id).select('codigo').first()
        assert.match(fila.codigo, /^S-\d{6,}$/)
    })

    test('editar el nombre audita y emite servicio.datos_cambiados con `nombre`; 61 caracteres es 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await alta(client, token)
        await estado(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, nombre: 'x'.repeat(61) }),
            422,
        )
        const r = await estado(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, nombre: 'Negocio' }),
            200,
        )
        assert.equal(r.body().nombre, 'Negocio')
        assert.equal(r.body().codigo, s.codigo)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'servicio.datos_cambiados')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
            .first()
        assert.deepEqual(evento.payload.campos, ['nombre'])
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'nombre' })
            .first()
        assert.equal(cambio.despues, 'Negocio')
    })

    test('los payloads hacia Iris con servicio_id llevan servicio_codigo y servicio_nombre', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await alta(client, token, { nombre: 'Cámaras' })
        const webhook = await payloadParaIris('servicio.creado', {
            servicio_id: s.id,
            empresa_id: s.empresa_id,
            cliente_id: s.cliente_id,
            router_id: s.router_id,
            plan_id: s.plan_id,
        })
        // sin el campo para un conector anterior a 0.10.0; con él para uno ≥ 0.10.0
        assert.notProperty(webhook!.payload, 'servicio_codigo')
        const conCodigo = await conCodigoServicio(webhook!.payload)
        assert.equal(conCodigo.servicio_codigo, s.codigo)
        assert.equal(conCodigo.servicio_nombre, 'Cámaras')
        const eliminado = await payloadParaIris('servicio.eliminado', {
            servicio_id: 999_999_999,
            empresa_id: 1,
            cliente_id: 1,
            router_id: 1,
        })
        const sinFila = await conCodigoServicio(eliminado!.payload)
        assert.isNull(sinFila.servicio_codigo)
    })
})
