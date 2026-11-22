import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { eventosDe, unicoBd } from '#tests/billing/ayudas_billing'

/**
 * Catálogo único de bancos de origen (decisión del PM 23): el admin agrega y edita; cada empresa oculta
 * los que no usa y `GET /bancos` ya no se los ofrece.
 */

test.group('billing · bancos de origen (decisión 23)', () => {
    test('admin agrega y edita; contabilidad oculta y vuelve a mostrar en su empresa', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { token: contabilidad } = await usuarioConRoles(['contabilidad'])
        const nombre = await unicoBd('Banco Prueba')

        await estado(client.post('/api/v1/bancos-origen').bearerToken(contabilidad).json({ nombre }), 403)
        const creado = await estado(
            client.post('/api/v1/bancos-origen').bearerToken(admin).json({ nombre }),
            201,
        )
        const banco = creado.body()
        assert.equal(banco.nombre, nombre)
        assert.isTrue(banco.activo)
        assert.isFalse(banco.oculto)
        assert.isBelow(banco.orden, 1000, 'antes de «Otro»')
        const [evento] = await eventosDe('banco_origen.cambiado', 'banco_id', banco.id)
        assert.isTrue(evento.payload.creado)
        const dup = await estado(
            client.post('/api/v1/bancos-origen').bearerToken(admin).json({ nombre: nombre.toUpperCase() }),
            409,
        )
        assert.match(dup.body().type, /banco_duplicado$/)

        const editado = await estado(
            client
                .put(`/api/v1/bancos-origen/${banco.id}`)
                .bearerToken(admin)
                .json({ version: banco.version, nombre: `${nombre} GT` }),
            200,
        )
        assert.equal(editado.body().nombre, `${nombre} GT`)
        await estado(
            client
                .put(`/api/v1/bancos-origen/${banco.id}`)
                .bearerToken(admin)
                .json({ version: banco.version, orden: 5 }),
            409,
        )

        const ids = async () => {
            const r = await estado(client.get('/api/v1/bancos').bearerToken(contabilidad), 200)
            return r.body().map((b: { id: number }) => b.id) as number[]
        }
        assert.include(await ids(), banco.id)
        const oculto = await estado(
            client.post(`/api/v1/bancos-origen/${banco.id}/ocultar`).bearerToken(contabilidad),
            200,
        )
        assert.isTrue(oculto.body().oculto)
        // idempotente
        await estado(client.post(`/api/v1/bancos-origen/${banco.id}/ocultar`).bearerToken(contabilidad), 200)
        const fila = await db.from('billing.bancos_ocultos').where('banco_id', banco.id)
        assert.lengthOf(fila, 1)
        assert.notInclude(await ids(), banco.id)
        const catalogo = await estado(client.get('/api/v1/bancos-origen').bearerToken(contabilidad), 200)
        assert.isTrue(catalogo.body().find((b: { id: number }) => b.id === banco.id).oculto)

        const visible = await estado(
            client.post(`/api/v1/bancos-origen/${banco.id}/mostrar`).bearerToken(contabilidad),
            200,
        )
        assert.isFalse(visible.body().oculto)
        assert.include(await ids(), banco.id)
        const eventos = await eventosDe('banco_origen.cambiado', 'banco_id', banco.id)
        assert.deepEqual(
            eventos.map((x) => [x.payload.campos, x.payload.oculto]),
            [
                [['nombre', 'orden', 'activo'], null],
                [['nombre'], null],
                [['oculto'], true],
                [['oculto'], false],
            ],
        )
        // el cajero no oculta
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.post(`/api/v1/bancos-origen/${banco.id}/ocultar`).bearerToken(cajero), 403)
    })
})
