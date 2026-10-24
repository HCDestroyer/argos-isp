import { test } from '@japa/runner'
import { construirOpenApi } from '#shared/openapi/documento'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CrearCliente from '#core/actions/crear_cliente'
import CrearServicio from '#core/actions/crear_servicio'
import { ROLES_BASE } from '#core/permisos'

/**
 * Pedidos del panel (A4, `a4.md`): `Rol.base`, `TokenApi.alcances` tipado y `externo` en
 * `Cliente` y `Servicio` (fila 60) desde `core.ids_externos`.
 */

type Esquema = { required?: string[]; properties?: Record<string, any>; additionalProperties?: boolean }

async function esquemas(): Promise<Record<string, Esquema>> {
    return JSON.parse(await construirOpenApi()).components.schemas
}

test.group('Pedidos del panel', () => {
    test('Rol.base: true en los seis roles base, false en uno propio', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const propio = await estado(
            client
                .post('/api/v1/roles')
                .bearerToken(token)
                .json({ nombre: unico('rol').replace('-', '_'), permisos: ['clientes.ver'] }),
            201,
        )
        assert.isFalse(propio.body().base)
        const roles = await estado(client.get('/api/v1/roles').bearerToken(token), 200)
        const base = roles
            .body()
            .filter((r: { base: boolean }) => r.base)
            .map((r: { nombre: string }) => r.nombre)
        assert.sameMembers(base, Object.keys(ROLES_BASE))
        const todos = await esquemas()
        assert.include(todos.Rol!.required, 'base')
    })

    test('TokenApi.alcances tipado y la respuesta lo cumple', async ({ client, assert }) => {
        const todos = await esquemas()
        const alcances = todos.AlcancesToken!
        assert.isFalse(alcances.additionalProperties)
        assert.sameMembers(Object.keys(alcances.properties!), ['permisos', 'routers', 'zonas', 'cajas'])
        assert.equal(todos.TokenApi!.properties!.alcances.$ref, '#/components/schemas/AlcancesToken')

        const { token, usuario } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const creado = await estado(
            client
                .post('/api/v1/tokens')
                .bearerToken(token)
                .json({
                    usuario_id: usuario.id,
                    nombre: 'Integración',
                    alcances: { permisos: ['clientes.ver'], routers: [routerId] },
                }),
            201,
        )
        assert.deepEqual(creado.body().datos.alcances, { permisos: ['clientes.ver'], routers: [routerId] })
        for (const clave of Object.keys(creado.body().datos.alcances)) {
            assert.property(alcances.properties!, clave)
        }
    })

    test('externo: { sistema, id } del importador en Cliente y Servicio; null si se creó en Argos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const idExterno = unico('mw')
        const importado = await new CrearCliente().execute(
            { nombre: 'Importado', externo: { sistema: 'mikrowisp', id: idExterno } },
            contextoPrueba(),
        )
        assert.deepEqual(importado.externo, { sistema: 'mikrowisp', id: idExterno })
        const visto = await estado(client.get(`/api/v1/clientes/${importado.id}`).bearerToken(token), 200)
        assert.deepEqual(visto.body().externo, { sistema: 'mikrowisp', id: idExterno })

        const { routerId } = await crearEscenarioRouter()
        const servicio = await new CrearServicio().execute(
            {
                cliente_id: importado.id,
                router_id: routerId,
                plan_id: await crearPlanFila(),
                externo: { sistema: 'mikrowisp', id: `${idExterno}-s` },
            },
            contextoPrueba(),
        )
        const servicioVisto = await estado(
            client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token),
            200,
        )
        assert.deepEqual(servicioVisto.body().externo, { sistema: 'mikrowisp', id: `${idExterno}-s` })

        const propio = await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Creado en Argos' }),
            201,
        )
        assert.isNull(propio.body().externo)
        const todos = await esquemas()
        assert.include(todos.Cliente!.required, 'externo')
        assert.include(todos.Servicio!.required, 'externo')
    })
})
