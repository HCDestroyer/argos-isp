import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { usarFuenteCuentasDeposito, type CuentaDeposito } from '#portal/cuentas_deposito'
import { renderizarHtml } from '#portal/documentos/render'
import { vistaDeEjemplo } from '#portal/documentos/variables'

/**
 * Configuración de empresa (tarea 9) contra Postgres real. Las cuentas para depósito vienen de A3
 * (`billing.cuentas_bancarias`); aquí se usa una fuente falsa.
 */

const CUENTAS: CuentaDeposito[] = [
    { banco: 'Banco Industrial', alias: 'Monetaria ArgosIsp', numero: '123-456789-0', moneda: 'GTQ' },
]

test.group('Empresa: configuración editable', (group) => {
    group.each.setup(() => {
        const previo = process.env.PORTAL_REDIS_PREFIJO
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-empresa')
        return async () => {
            usarFuenteCuentasDeposito(undefined)
            if (previo === undefined) delete process.env.PORTAL_REDIS_PREFIJO
            else process.env.PORTAL_REDIS_PREFIJO = previo
            await db.from('core.empresa').delete()
        }
    })

    test('sin guardar: valores por defecto con versión 0 y sin cuentas inventadas', async ({
        client,
        assert,
    }) => {
        const publica = await estado(client.get('/api/v1/portal/empresa'), 200)
        assert.deepEqual(publica.body().cuentas_deposito, [])
        assert.isNull(publica.body().whatsapp)
        assert.notProperty(publica.body(), 'version')

        const { token } = await usuarioConRoles(['lectura'])
        const panel = await estado(client.get('/api/v1/empresa').bearerToken(token), 200)
        assert.equal(panel.body().version, 0)
    })

    test('admin la guarda con auditoría y diff; /portal/empresa y los documentos la usan', async ({
        client,
        assert,
    }) => {
        usarFuenteCuentasDeposito({ activas: async () => CUENTAS })
        const { token } = await usuarioConRoles(['admin'])
        const guardada = await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({
                version: 0,
                nombre: 'Red Altiplano',
                nit: '1234567-8',
                telefono: '7765-4321',
                whatsapp: '5555-0000',
                correo: 'cobros@redaltiplano.example',
                horario: 'Lunes a sábado de 8:00 a 18:00',
                instrucciones_pago: 'Escribe tu NIT en la boleta.',
            }),
            200,
        )
        assert.equal(guardada.body().version, 1)

        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'empresa')
            .orderBy('id', 'desc')
            .limit(20)
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'nit', 'telefono', 'whatsapp', 'correo', 'horario', 'instrucciones_pago'],
        )
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'empresa.editar')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.include(accion, { resultado: 'ok', canal: 'api', entidad_tipo: 'empresa' })

        const publica = await estado(client.get('/api/v1/portal/empresa'), 200)
        assert.include(publica.body(), {
            nombre: 'Red Altiplano',
            whatsapp: '5555-0000',
            horario: 'Lunes a sábado de 8:00 a 18:00',
        })
        assert.deepEqual(publica.body().cuentas_deposito, CUENTAS)

        const html = renderizarHtml(
            '<p>{{empresa.nombre}} · {{empresa.instrucciones_pago}}</p>',
            await vistaDeEjemplo(),
        )
        assert.include(html, 'Red Altiplano · Escribe tu NIT en la boleta.')

        const segunda = await estado(
            client
                .put('/api/v1/empresa')
                .bearerToken(token)
                .json({ version: 1, whatsapp: '', horario: null }),
            200,
        )
        assert.include(segunda.body(), { version: 2, whatsapp: null, horario: null, nombre: 'Red Altiplano' })
        await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 1, nombre: 'Tarde' }),
            409,
        )
    })

    test('versión 0 cuando ya existe responde 409; datos inválidos 422; sin permiso 403', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 0, nombre: 'Uno' }),
            200,
        )
        await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 0, nombre: 'Dos' }),
            409,
        )
        await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 1, correo: 'no-es-correo' }),
            422,
        )
        // Un nombre vacío llega como null (bodyparser) y no borra el nombre.
        const vacio = await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 1, nombre: '' }),
            200,
        )
        assert.equal(vacio.body().nombre, 'Uno')
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.put('/api/v1/empresa').bearerToken(cajero.token).json({ version: 1, nombre: 'X' }),
            403,
        )
        await estado(client.get('/api/v1/empresa').bearerToken(cajero.token), 403)
    })
})
