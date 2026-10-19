import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { codigoReferidoDe, referidoDeCliente } from '#core/referidos'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Lealtad, parte de A1 (`contratos/lealtad.md` §3 y §4): códigos de referido por cliente y empresa
 * y `codigo_referido` en el alta de cliente (422 `referido_invalido`).
 */

test.group('Referidos · códigos y alta de cliente', (group) => {
    group.teardown(soloEmpresaPrincipal)

    test('el primer servicio en una empresa crea el código del cliente; se ve en GET /clientes/:id', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clienteId = await crearClienteFila()
        const sinServicio = await estado(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(token), 200)
        assert.deepEqual(sinServicio.body().codigos_referido, [])

        await crearServicioFila({ cliente_id: clienteId })
        await crearServicioFila({ cliente_id: clienteId })
        const codigo = await codigoReferidoDe(clienteId, 1)
        assert.match(codigo!, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
        const ver = await estado(client.get(`/api/v1/clientes/${clienteId}`).bearerToken(token), 200)
        assert.deepEqual(ver.body().codigos_referido, [{ empresa_id: 1, codigo }])

        // multiempresa: un servicio en otra empresa le da otro código
        const empresa = await crearEmpresaFila()
        await crearServicioFila({ cliente_id: clienteId, empresa_id: empresa })
        const otro = await codigoReferidoDe(clienteId, empresa)
        assert.isString(otro)
        assert.notEqual(otro, codigo)
        assert.lengthOf(await db.from('core.codigos_referido').where('cliente_id', clienteId), 2)
        await soloEmpresaPrincipal()
    })

    test('alta con codigo_referido: guarda referidor y empresa del código, con auditoría', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const referidor = await crearClienteFila({ nit_cui: '12345679', tipo_documento_fiscal: 'nit' })
        await crearServicioFila({ cliente_id: referidor })
        const codigo = (await codigoReferidoDe(referidor, 1))!
        const escrito = `${codigo.slice(0, 4).toLowerCase()}-${codigo.slice(4)}`

        const r = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Cliente referido', codigo_referido: escrito }),
            201,
        )
        assert.equal(r.body().referido_por_id, referidor)
        assert.equal(r.body().referido_empresa_id, 1)
        assert.deepEqual(r.body().codigos_referido, [])
        assert.deepEqual(await referidoDeCliente(r.body().id), {
            referido_por_id: referidor,
            referido_empresa_id: 1,
        })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: r.body().id, campo: 'referido_por_id' })
            .firstOrFail()
        assert.equal(Number(cambio.despues), referidor)
        const campos = (await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: r.body().id })
            .select('campo')) as Array<{ campo: string }>
        assert.notInclude(
            campos.map((c) => c.campo),
            'codigos_referido',
        )

        // sin código: nada cambia
        const normal = await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Sin referido' }),
            201,
        )
        assert.isNull(normal.body().referido_por_id)
        assert.isNull(await referidoDeCliente(normal.body().id))
    })

    test('referido inválido: 422 referido_invalido (inexistente, formato, mismo NIT o CUI)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const referidor = await crearClienteFila({ nit_cui: '1234567890101', tipo_documento_fiscal: 'cui' })
        await crearServicioFila({ cliente_id: referidor })
        const codigo = (await codigoReferidoDe(referidor, 1))!
        const antes = await db.from('core.clientes').count('* as n').first()

        const casos: Array<Record<string, unknown>> = [
            {
                nombre: 'Código que no existe',
                codigo_referido: codigo === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ',
            },
            { nombre: 'Código con ambiguos', codigo_referido: 'ABCD01IO' },
            { nombre: 'Código corto', codigo_referido: 'ABC' },
            { nombre: 'Mismo CUI', nit_cui: '1234567890101', codigo_referido: codigo },
        ]
        for (const cuerpo of casos) {
            const r = await estado(client.post('/api/v1/clientes').bearerToken(token).json(cuerpo), 422)
            assert.match(r.body().type, /referido_invalido$/, String(cuerpo.nombre))
            assert.equal(r.body().status, 422)
        }
        const despues = await db.from('core.clientes').count('* as n').first()
        assert.equal(Number(despues.n), Number(antes.n))

        // mismo NIT que otro cliente distinto del referidor no importa
        await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Otro documento', nit_cui: '12345679', codigo_referido: codigo }),
            201,
        )
    })
})
