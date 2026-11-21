import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { predeterminadosDeRoles } from '#core/accesos_rapidos'

/** Accesos rápidos por usuario (contrato `.claude/integration/contratos/accesos-rapidos.md`). */

test.group('Accesos rápidos', () => {
    test('predeterminados por rol: cajero, admin y unión sin repetidos', async ({ client, assert }) => {
        const cajero = await usuarioConRoles(['cajero'])
        const r = await estado(client.get('/api/v1/me/accesos-rapidos').bearerToken(cajero.token), 200)
        assert.deepEqual(r.body(), {
            secciones: ['cobro', 'caja', 'clientes', 'comprobantes'],
            predeterminados: true,
            maximo: 12,
            version: null,
        })
        const admin = await usuarioConRoles(['admin'])
        const a = await estado(client.get('/api/v1/me/accesos-rapidos').bearerToken(admin.token), 200)
        assert.deepEqual(a.body().secciones, ['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion'])

        assert.deepEqual(predeterminadosDeRoles(['cajero', 'soporte']), [
            'cobro',
            'caja',
            'clientes',
            'comprobantes',
            'servicios',
            'promesas',
            'routers',
        ])
        assert.deepEqual(predeterminadosDeRoles([]), ['clientes', 'servicios', 'facturas'])
    })

    test('guardar, 409 con versión vieja, lista vacía y volver a predeterminados; cada usuario la suya', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['cajero'])
        const otro = await usuarioConRoles(['cajero'])

        const g = await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: ['caja', 'cobro', 'notas-credito'] }),
            200,
        )
        assert.deepEqual(g.body(), { secciones: ['caja', 'cobro', 'notas-credito'], predeterminados: false, maximo: 12, version: 1 })

        const otroLee = await estado(client.get('/api/v1/me/accesos-rapidos').bearerToken(otro.token), 200)
        assert.isTrue(otroLee.body().predeterminados)

        await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: ['caja'], version: 1 }),
            200,
        )
        await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: ['cobro'], version: 1 }),
            409,
        )
        const vacia = await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: [] }),
            200,
        )
        assert.deepEqual(vacia.body().secciones, [])
        assert.isFalse(vacia.body().predeterminados)

        const vuelta = await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: null }),
            200,
        )
        assert.include(vuelta.body(), { predeterminados: true, version: null })
        assert.deepEqual(vuelta.body().secciones, ['cobro', 'caja', 'clientes', 'comprobantes'])

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'accesos_rapidos.editar')
            .where('entidad_tipo', 'usuario')
            .where('entidad_id', usuario.id)
            .select('resultado')
        assert.deepEqual(auditoria.map((a) => a.resultado).sort(), ['error', 'ok', 'ok', 'ok', 'ok'])
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'usuario')
            .where('entidad_id', usuario.id)
            .where('campo', 'accesos_rapidos')
            .count('* as n')
            .first()
        assert.equal(Number(cambios.n), 4)
    })

    test('validación: más de 12, repetidos o patrón inválido → 422; sin sesión 401', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const trece = Array.from({ length: 13 }, (_, i) => `seccion-${i}`)
        await estado(client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: trece }), 422)
        await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: ['caja', 'caja'] }),
            422,
        )
        const patron = await estado(
            client.put('/api/v1/me/accesos-rapidos').bearerToken(token).json({ secciones: ['Caja Rápida'] }),
            422,
        )
        assert.match(patron.body().errors[0].field, /^secciones/)
        await estado(client.get('/api/v1/me/accesos-rapidos'), 401)
    })
})
