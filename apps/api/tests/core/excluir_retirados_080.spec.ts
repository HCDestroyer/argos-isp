import { test } from '@japa/runner'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Contrato Iris 0.8.0 (punto 26): `excluir_retirados=true` en `GET /clientes` (solo clientes con al
 * menos un servicio no retirado) y en `GET /servicios` (sin `retirado`). Por defecto, sin cambio.
 */

async function escenario() {
    const planId = await crearPlanFila()
    const marca = unico('Retiros')
    const conActivo = await crearClienteFila({ nombre: `${marca} A` })
    const soloRetirado = await crearClienteFila({ nombre: `${marca} B` })
    const sinServicios = await crearClienteFila({ nombre: `${marca} C` })
    const activo = await crearServicioFila({ cliente_id: conActivo, plan_id: planId })
    const retiradoA = await crearServicioFila({ cliente_id: conActivo, plan_id: planId, estado: 'retirado' })
    const retiradoB = await crearServicioFila({
        cliente_id: soloRetirado,
        plan_id: planId,
        estado: 'retirado',
    })
    return { planId, marca, conActivo, soloRetirado, sinServicios, activo, retiradoA, retiradoB }
}

const ids = (r: any) => (r.body().data as Array<{ id: number }>).map((f) => f.id).sort((a, b) => a - b)

test.group('Iris 0.8.0 · excluir_retirados', () => {
    test('GET /servicios: sin los retirados; por defecto, todos', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()
        const url = `/api/v1/servicios?plan_id=${e.planId}&limit=200`
        assert.deepEqual(
            ids(await estado(client.get(url).bearerToken(token), 200)),
            [e.activo, e.retiradoA, e.retiradoB].sort((a, b) => a - b),
        )
        assert.deepEqual(
            ids(await estado(client.get(`${url}&excluir_retirados=false`).bearerToken(token), 200)),
            [e.activo, e.retiradoA, e.retiradoB].sort((a, b) => a - b),
        )
        assert.deepEqual(
            ids(await estado(client.get(`${url}&excluir_retirados=true`).bearerToken(token), 200)),
            [e.activo],
        )
        await estado(client.get(`${url}&excluir_retirados=talvez`).bearerToken(token), 422)
    })

    test('GET /clientes: solo con algún servicio no retirado', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()
        const url = `/api/v1/clientes?q=${encodeURIComponent(e.marca)}&limit=200`
        assert.deepEqual(
            ids(await estado(client.get(url).bearerToken(token), 200)),
            [e.conActivo, e.soloRetirado, e.sinServicios].sort((a, b) => a - b),
        )
        assert.deepEqual(
            ids(await estado(client.get(`${url}&excluir_retirados=true`).bearerToken(token), 200)),
            [e.conActivo],
        )
        // con plan_id, el mismo servicio debe ser del plan y no estar retirado
        const otroPlan = await crearPlanFila()
        await crearServicioFila({ cliente_id: e.soloRetirado, plan_id: otroPlan })
        assert.deepEqual(
            ids(
                await estado(
                    client.get(`${url}&excluir_retirados=true&plan_id=${e.planId}`).bearerToken(token),
                    200,
                ),
            ),
            [e.conActivo],
        )
        assert.deepEqual(
            ids(await estado(client.get(`${url}&excluir_retirados=true`).bearerToken(token), 200)),
            [e.conActivo, e.soloRetirado].sort((a, b) => a - b),
        )
    })
})
