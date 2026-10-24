import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import { registrarContactoRouter, umbralEnLineaS } from '#network/contacto_router'

/**
 * `Router.en_linea` y `Router.ultimo_contacto` (pedido de A4): fuentes periódicas en
 * `network.routers_contacto` (accounting y sondeo, las escribe A2 con `registrarContactoRouter`) y
 * la última respuesta buena del router en `audit.red`.
 */

async function nasIp(routerId: number): Promise<string> {
    const fila = await db
        .from('network.routers')
        .where('id', routerId)
        .select(db.raw('host(nas_ip) AS ip'))
        .firstOrFail()
    return fila.ip as string
}

async function ver(client: ApiClient, token: string, id: number) {
    const respuesta = await estado(client.get(`/api/v1/routers/${id}`).bearerToken(token), 200)
    return respuesta.body()
}

test.group('Routers · contacto', () => {
    test('sin ninguna fuente: en_linea y ultimo_contacto null', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearRouterFila()
        const router = await ver(client, token, id)
        assert.isNull(router.en_linea)
        assert.isNull(router.ultimo_contacto)
    })

    test('una respuesta en audit.red da ultimo_contacto pero no en_linea', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearRouterFila()
        await db.table('audit.red').insert({
            tipo: 'coa',
            router_id: id,
            comando: JSON.stringify({ prueba: true }),
            respuesta: JSON.stringify({ code: 'CoA-ACK' }),
            ok: false,
            created_at: new Date(Date.now() - 60_000),
        })
        const sinRespuesta = await ver(client, token, id)
        assert.isNull(sinRespuesta.ultimo_contacto, 'una respuesta fallida no cuenta')
        const en = new Date(Date.now() - 30_000)
        await db.table('audit.red').insert({
            tipo: 'coa',
            router_id: id,
            comando: JSON.stringify({ prueba: true }),
            respuesta: JSON.stringify({ code: 'CoA-ACK' }),
            ok: true,
            created_at: en,
        })
        const router = await ver(client, token, id)
        assert.equal(new Date(router.ultimo_contacto).getTime(), en.getTime())
        assert.isNull(router.en_linea)
    })

    test('accounting reciente → en línea; viejo → fuera de línea; nunca retrocede', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const vivo = await crearRouterFila()
        const caido = await crearRouterFila()

        await registrarContactoRouter(db.connection(), { nasIp: await nasIp(vivo) }, 'accounting')
        const hace = new Date(Date.now() - (umbralEnLineaS() + 60) * 1000)
        await registrarContactoRouter(db.connection(), { routerId: caido }, 'sondeo', hace)

        const enLinea = await ver(client, token, vivo)
        assert.isTrue(enLinea.en_linea)
        assert.isAbove(new Date(enLinea.ultimo_contacto).getTime(), Date.now() - 60_000)

        const fuera = await ver(client, token, caido)
        assert.isFalse(fuera.en_linea)
        assert.equal(new Date(fuera.ultimo_contacto).getTime(), hace.getTime())

        // un paquete atrasado no pisa uno más nuevo
        await registrarContactoRouter(
            db.connection(),
            { routerId: caido },
            'accounting',
            new Date(hace.getTime() - 3_600_000),
        )
        const fila = await db.from('network.routers_contacto').where('router_id', caido).firstOrFail()
        assert.equal(new Date(fila.ultimo_contacto).getTime(), hace.getTime())
        assert.equal(fila.fuente, 'sondeo')

        // y uno nuevo lo vuelve a poner en línea
        await registrarContactoRouter(db.connection(), { routerId: caido }, 'accounting')
        const otraVez = await ver(client, token, caido)
        assert.isTrue(otraVez.en_linea)

        // la lista trae los mismos campos
        const lista = await estado(client.get('/api/v1/routers').qs({ limit: 200 }).bearerToken(token), 200)
        const enLista = lista.body().data.find((r: { id: number }) => r.id === vivo)
        assert.isTrue(enLista.en_linea)
    })

    test('un NAS desconocido no escribe nada', async ({ assert }) => {
        const antes = await db.from('network.routers_contacto').count('* as n').firstOrFail()
        await registrarContactoRouter(db.connection(), { nasIp: '198.51.100.254' }, 'accounting')
        const despues = await db.from('network.routers_contacto').count('* as n').firstOrFail()
        assert.equal(Number(despues.n), Number(antes.n))
    })
})
