import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
    contextoPrueba,
    estado,
    restablecerEmpresaPrincipal,
    soloEmpresaPrincipal,
    unico,
    usuarioConRoles,
} from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { usarFuenteCuentasDeposito, type CuentaDeposito } from '#portal/cuentas_deposito'
import CrearCuentaBancaria from '#billing/actions/crear_cuenta_bancaria'
import { bancoId } from '#tests/billing/ayudas_billing'
import { renderizarHtml } from '#portal/documentos/render'
import { vistaDeEjemplo } from '#portal/documentos/variables'

/**
 * Configuración de empresa (tarea 9) contra Postgres real. Las cuentas para depósito vienen de A3
 * (`billing.cuentas_bancarias`); aquí se usa una fuente falsa.
 */

const CUENTAS: CuentaDeposito[] = [
    { id: 1, banco: 'Banco Industrial', alias: 'Monetaria ArgosIsp', numero: '123-456789-0', moneda: 'GTQ' },
]

test.group('Empresa: configuración editable', (group) => {
    group.each.setup(async () => {
        // Una sola empresa activa (otras pruebas dejan empresas creadas): se comporta como siempre.
        await soloEmpresaPrincipal()
        const previo = process.env.PORTAL_REDIS_PREFIJO
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-empresa')
        return async () => {
            usarFuenteCuentasDeposito(undefined)
            if (previo === undefined) delete process.env.PORTAL_REDIS_PREFIJO
            else process.env.PORTAL_REDIS_PREFIJO = previo
            await restablecerEmpresaPrincipal()
        }
    })

    test('sin guardar: valores por defecto con versión 0 y sin cuentas inventadas', async ({
        client,
        assert,
    }) => {
        usarFuenteCuentasDeposito({ activas: async () => [] })
        const publica = await estado(client.get('/api/v1/portal/empresa'), 200)
        assert.deepEqual(publica.body().cuentas_deposito, [])
        assert.isNull(publica.body().whatsapp)
        // Sin guardar no hay nombre legal: nunca el nombre por defecto del entorno.
        assert.isNull(publica.body().razon_social)
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

    test('cuentas reales de A3: solo activas y en quetzales, sin datos del libro', async ({
        client,
        assert,
    }) => {
        const crear = async (banco: string, datos: { moneda?: 'GTQ' | 'USD'; activa?: boolean }) =>
            new CrearCuentaBancaria().execute(
                { banco_id: await bancoId(banco), numero: unico('300'), alias: unico('Deposito'), ...datos },
                contextoPrueba(),
            )
        const visible = await crear('Banrural', {})
        const inactiva = await crear('Banrural', { activa: false })
        const dolares = await crear('Banrural', { moneda: 'USD' })

        const publica = await estado(client.get('/api/v1/portal/empresa'), 200)
        const cuentas = publica.body().cuentas_deposito as CuentaDeposito[]
        const numeros = cuentas.map((c) => c.numero)
        assert.include(numeros, visible.numero)
        assert.notInclude(numeros, inactiva.numero)
        assert.notInclude(numeros, dolares.numero)
        assert.deepEqual(
            cuentas.find((c) => c.numero === visible.numero),
            {
                id: visible.id,
                banco: 'Banrural',
                alias: visible.alias,
                numero: visible.numero,
                moneda: 'GTQ',
            },
        )
        for (const cuenta of cuentas) {
            assert.equal(cuenta.moneda, 'GTQ')
            assert.sameMembers(Object.keys(cuenta), ['id', 'banco', 'alias', 'numero', 'moneda'])
        }
    })
})

/** Usuario con esos roles acotado a esas empresas (sin alcance global). */
async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

test.group('Empresa: configuración con dos empresas (empresa activa)', (group) => {
    let sur: number

    group.each.setup(async () => {
        await soloEmpresaPrincipal()
        await restablecerEmpresaPrincipal()
        sur = await crearEmpresaFila({ nombre_comercial: unico('Fibra Sur'), telefono: '7700-0002' })
        return async () => {
            await db.from('core.empresas').where('id', sur).update({ activa: false })
            await restablecerEmpresaPrincipal()
        }
    })

    test('sin empresa activa: 422 empresa_requerida al leer y al guardar, sin tocar la empresa 1', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const ver = await estado(client.get('/api/v1/empresa').bearerToken(token), 422)
        assert.equal(ver.body().type.split(':').pop(), 'empresa_requerida')
        const guardar = await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 0, nombre: 'Silencio' }),
            422,
        )
        assert.equal(guardar.body().type.split(':').pop(), 'empresa_requerida')
        const principal = await db.from('core.empresas').where('id', 1).firstOrFail()
        assert.include(principal, { nombre_comercial: 'ArgosIsp', version: 0 })
    })

    test('GET /portal/empresa?empresa_id: nombre legal (razón social) para las políticas del portal', async ({
        client,
        assert,
    }) => {
        await db
            .from('core.empresas')
            .where('id', sur)
            .update({ razon_social: 'Fibra Sur, Sociedad Anónima' })
        const publica = await estado(client.get(`/api/v1/portal/empresa?empresa_id=${sur}`), 200)
        assert.include(publica.body(), {
            id: sur,
            razon_social: 'Fibra Sur, Sociedad Anónima',
            telefono: '7700-0002',
        })

        await db.from('core.empresas').where('id', sur).update({ razon_social: null })
        const sinLegal = await estado(client.get(`/api/v1/portal/empresa?empresa_id=${sur}`), 200)
        assert.isNull(sinLegal.body().razon_social)
        assert.match(sinLegal.body().nombre, /^Fibra Sur/)
    })

    test('X-Empresa-Id: lee y guarda esa empresa, con auditoría a su nombre; la 1 no cambia', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const leida = await estado(
            client.get('/api/v1/empresa').bearerToken(token).header('X-Empresa-Id', String(sur)),
            200,
        )
        assert.include(leida.body(), { telefono: '7700-0002', version: 1 })
        assert.match(leida.body().nombre, /^Fibra Sur/)

        const guardada = await estado(
            client
                .put('/api/v1/empresa')
                .bearerToken(token)
                .header('X-Empresa-Id', String(sur))
                .json({ version: 1, nombre: 'Fibra Sur Editada', horario: 'L-S 8 a 18' }),
            200,
        )
        assert.include(guardada.body(), { nombre: 'Fibra Sur Editada', horario: 'L-S 8 a 18', version: 2 })
        const fila = await db.from('core.empresas').where('id', sur).firstOrFail()
        assert.include(fila, { nombre_comercial: 'Fibra Sur Editada', horario: 'L-S 8 a 18', version: 2 })
        const principal = await db.from('core.empresas').where('id', 1).firstOrFail()
        assert.include(principal, { nombre_comercial: 'ArgosIsp', horario: null, version: 0 })

        const accion = await db
            .from('audit.acciones')
            .where('accion', 'empresa.editar')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.include(accion, { entidad_tipo: 'empresa', resultado: 'ok' })
        assert.equal(Number(accion.entidad_id), sur)
        assert.equal(Number(accion.empresa_id), sur)
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'empresa', entidad_id: sur })
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'horario'],
        )

        // La empresa 1, por su lado, sigue con su versión 0 y sus valores por defecto.
        const una = await estado(
            client.get('/api/v1/empresa').bearerToken(token).header('X-Empresa-Id', '1'),
            200,
        )
        assert.equal(una.body().version, 0)
        // La versión de otra empresa no sirve: 409.
        await estado(
            client
                .put('/api/v1/empresa')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ version: 2, nombre: 'Cruzada' }),
            409,
        )
    })

    test('alcance del usuario: su única empresa sin cabecera; otra empresa 403', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioEnEmpresas(['admin'], [sur])
        const leida = await estado(client.get('/api/v1/empresa').bearerToken(token), 200)
        assert.equal(leida.body().telefono, '7700-0002')
        await estado(
            client.put('/api/v1/empresa').bearerToken(token).json({ version: 1, whatsapp: '5555-0002' }),
            200,
        )
        const editada = await db.from('core.empresas').where('id', sur).firstOrFail()
        assert.equal(editada.whatsapp, '5555-0002')

        const ajena = await estado(
            client.get('/api/v1/empresa').bearerToken(token).header('X-Empresa-Id', '1'),
            403,
        )
        assert.equal(ajena.body().type.split(':').pop(), 'empresa_no_permitida')
        await estado(
            client
                .put('/api/v1/empresa')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ version: 0, nombre: 'Ajena' }),
            403,
        )
        const principal = await db.from('core.empresas').where('id', 1).firstOrFail()
        assert.equal(principal.version, 0)
    })

    test('el portal público sigue resolviendo la empresa por su cuenta', async ({ client, assert }) => {
        usarFuenteCuentasDeposito({ activas: async () => [] })
        const publica = await estado(client.get(`/api/v1/portal/empresa?empresa_id=${sur}`), 200)
        assert.match(publica.body().nombre, /^Fibra Sur/)
        assert.equal(publica.body().telefono, '7700-0002')
        // Sin empresa ni cliente: la principal, como siempre.
        const principal = await estado(client.get('/api/v1/portal/empresa'), 200)
        assert.equal(principal.body().nombre, process.env.NOTIFY_EMPRESA_NOMBRE || 'ArgosIsp')
        usarFuenteCuentasDeposito(undefined)
    })
})
