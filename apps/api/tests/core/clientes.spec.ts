import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cuiValido, nitValido, normalizarNitCui } from '#core/nit_cui'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila, crearZonaFila } from '#tests/core/fabricas'

test.group('NIT y CUI', () => {
    test('NIT con dígito verificador módulo 11 (incluida la K)', ({ assert }) => {
        assert.isTrue(nitValido('1234567-9'))
        assert.isTrue(nitValido('12345679'))
        assert.isTrue(nitValido('6-k'))
        assert.isFalse(nitValido('12345678'))
        assert.isFalse(nitValido('6-5'))
        assert.isFalse(nitValido('abc'))
    })

    test('CUI de 13 dígitos con departamento y municipio', ({ assert }) => {
        assert.isTrue(cuiValido('1234567890101'))
        assert.isTrue(cuiValido('1234 56789 0101'))
        // el verificador del CUI no se aplica: no hay fuente oficial (#core/nit_cui)
        assert.isTrue(cuiValido('1234567800101'), 'verificador')
        assert.isFalse(cuiValido('1234567892301'), 'departamento 23')
        assert.isFalse(cuiValido('1234567890100'), 'municipio 00')
    })

    test('normaliza a mayúsculas sin guiones ni espacios', ({ assert }) => {
        assert.equal(normalizarNitCui('1234567-9'), '12345679')
        assert.equal(normalizarNitCui('6-k'), '6K')
        assert.equal(normalizarNitCui(' cf '), 'CF')
        assert.equal(normalizarNitCui('1234 56789 0101'), '1234567890101')
        assert.isNull(normalizarNitCui(null))
        assert.throws(() => normalizarNitCui('1234567-0'), /no son válidos/)
    })
})

test.group('Clientes', () => {
    test('crear con datos fiscales y campos personalizados; queda auditado', async ({ client, assert }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const zonaId = await crearZonaFila()
        const requestId = unico('req')

        const respuesta = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .header('X-Canal', 'panel')
                .json({
                    nombre: 'Ana López',
                    tipo: 'persona',
                    nit_cui: '1234567-9',
                    nombre_fiscal: 'ANA LOPEZ',
                    direccion_fiscal: 'Ciudad',
                    telefono: '5555-1234',
                    zona_id: zonaId,
                    coordenadas: '14.6349,-90.5069',
                    campos_personalizados: { referido_por: 'vecino', antena: 'LiteBeam' },
                }),
            201,
        )
        const cliente = respuesta.body()
        assert.containsSubset(cliente, {
            nombre: 'Ana López',
            nit_cui: '12345679',
            nombre_fiscal: 'ANA LOPEZ',
            zona_id: zonaId,
            canal_preferido: 'correo',
            campos_personalizados: { referido_por: 'vecino', antena: 'LiteBeam' },
            version: 1,
        })
        assert.notProperty(cliente, 'saldo')

        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.containsSubset(accion, {
            accion: 'clientes.crear',
            actor_id: usuario.id,
            canal: 'panel',
            entidad_tipo: 'cliente',
            entidad_id: cliente.id,
            resultado: 'ok',
        })
        const filasCambios = await db.from('audit.cambios').where('request_id', requestId)
        const campos = filasCambios.map((c) => c.campo)
        assert.includeMembers(campos, ['nombre', 'nit_cui', 'campos_personalizados'])

        const visto = await estado(client.get(`/api/v1/clientes/${cliente.id}`).bearerToken(token), 200)
        assert.deepEqual(visto.body(), cliente)
    })

    test('NIT o CUI inválido → 422 en nit_cui; zona inexistente → 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const malo = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Mal NIT', nit_cui: '1234567-0' }),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'nit_cui')
        await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Mal CUI', nit_cui: '1234567892302' }),
            422,
        )
        await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Sin zona', zona_id: 999999 }),
            422,
        )
        const cui = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: 'Con CUI', nit_cui: '1234567890101' }),
            201,
        )
        assert.equal(cui.body().nit_cui, '1234567890101')
    })

    test('editar con version; la segunda sesión con la misma version recibe 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const id = await crearClienteFila({ nombre: 'Para editar' })

        const editado = await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 1, telefono: '4444-0000', nit_cui: 'cf', campos_personalizados: { a: 1 } }),
            200,
        )
        assert.containsSubset(editado.body(), {
            nombre: 'Para editar',
            telefono: '+502 4444-0000',
            nit_cui: 'CF',
            version: 2,
            campos_personalizados: { a: 1 },
        })
        const conflicto = await estado(
            client.put(`/api/v1/clientes/${id}`).bearerToken(token).json({ version: 1, telefono: '1' }),
            409,
        )
        assert.equal(conflicto.body().type, 'urn:argosisp:problema:conflicto_version')

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: id })
            .select('campo', 'antes', 'despues')
        assert.sameDeepMembers(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['telefono', null, '+502 4444-0000'],
                ['nit_cui', null, 'CF'],
                ['campos_personalizados', {}, { a: 1 }],
            ],
        )
    })

    test('buscar por nombre, NIT, teléfono, user_ppp e IP', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const marca = unico('Búsqueda').replace('-', '')
        const id = await crearClienteFila({
            nombre: `Pedro ${marca}`,
            nit_cui: '12345679',
            telefono: '+502 7777-6655',
        })
        const otro = await crearClienteFila({ nombre: unico('Otro') })
        const userPpp = unico('pedro.ppp')
        const servicioId = await crearServicioFila({ cliente_id: id, user_ppp: userPpp })

        const ids = async (q: string) => {
            const r = await estado(
                client.get('/api/v1/clientes').qs({ q, limit: 200 }).bearerToken(token),
                200,
            )
            return r.body().data.map((c: { id: number }) => c.id) as number[]
        }

        assert.include(await ids(marca.toLowerCase()), id)
        assert.include(await ids('1234567-9'), id)
        assert.include(await ids('77776655'), id)
        assert.include(await ids(userPpp.toUpperCase()), id)
        assert.notInclude(await ids(marca), otro)
        // los comodines de LIKE se buscan literalmente
        assert.notInclude(await ids('%'), id)

        // IP: IPv4 vigente y IPv6 dentro de un prefijo vigente
        const servicio = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        const routerId = servicio.router_id
        const [red] = (await db
            .table('network.redes_ipv4')
            .insert({ router_id: routerId, cidr: '198.18.77.0/24', tipo: 'estatico' })
            .returning('id')) as Array<{ id: number }>
        await db
            .table('network.ipv4_asignaciones')
            .insert({ servicio_id: servicioId, red_id: red!.id, ip: '198.18.77.20' })
        await db.table('network.ipv6_asignaciones').insert({
            servicio_id: servicioId,
            prefijo: '2001:db8:77:100::/56',
            tipo: 'delegacion',
        })
        assert.deepEqual(await ids('198.18.77.20'), [id])
        assert.deepEqual(await ids('2001:db8:77:1ab::1'), [id])
        assert.deepEqual(await ids('198.18.77.21'), [])
    })

    test('el teléfono se busca solo con una búsqueda con forma de teléfono, no por los dígitos de un texto', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        // ocho dígitos únicos de la corrida para que ningún otro cliente los tenga
        const digitos = String(Date.now()).slice(-8)
        const id = await crearClienteFila({
            nombre: unico('Telefono'),
            telefono: `${digitos.slice(0, 4)}-${digitos.slice(4)}`,
        })
        const ids = async (q: string) => {
            const r = await estado(
                client.get('/api/v1/clientes').qs({ q, limit: 200 }).bearerToken(token),
                200,
            )
            return r.body().data.map((c: { id: number }) => c.id) as number[]
        }
        assert.include(await ids(digitos), id)
        assert.include(await ids(`${digitos.slice(0, 4)} ${digitos.slice(4)}`), id)
        assert.include(await ids(`(${digitos.slice(0, 4)}).${digitos.slice(4)}`), id)
        // un texto con esos dígitos mezclados (como la marca de otra prueba) no lo trae
        assert.notInclude(await ids(`Pagina${digitos}ab`), id)
        assert.notInclude(await ids(`${digitos}x`), id)
    })

    test('paginación por cursor', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const marca = unico('Pagina').replace('-', '')
        for (let i = 0; i < 3; i++) await crearClienteFila({ nombre: `${marca} ${i}` })
        const primera = await estado(
            client.get('/api/v1/clientes').qs({ q: marca, limit: 2 }).bearerToken(token),
            200,
        )
        assert.lengthOf(primera.body().data, 2)
        assert.isString(primera.body().nextCursor)
        const segunda = await estado(
            client
                .get('/api/v1/clientes')
                .qs({ q: marca, limit: 2, cursor: primera.body().nextCursor })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(segunda.body().data, 1)
        assert.isNull(segunda.body().nextCursor)
    })

    test('alcance por zona: solo ve y edita clientes de su zona', async ({ client, assert }) => {
        const zonaA = await crearZonaFila()
        const zonaB = await crearZonaFila()
        const { token, usuario } = await usuarioConRoles([])
        const rol = await db.from('core.roles').where('nombre', 'soporte').firstOrFail()
        const soporte = rol.id
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: usuario.id, role_id: soporte, alcance_tipo: 'zona', alcance_id: zonaA })

        const marca = unico('Alcance').replace('-', '')
        const enA = await crearClienteFila({ nombre: `${marca} A`, zona_id: zonaA })
        const enB = await crearClienteFila({ nombre: `${marca} B`, zona_id: zonaB })

        const lista = await estado(client.get('/api/v1/clientes').qs({ q: marca }).bearerToken(token), 200)
        assert.deepEqual(
            lista.body().data.map((c: { id: number }) => c.id),
            [enA],
        )
        await estado(client.get(`/api/v1/clientes/${enA}`).bearerToken(token), 200)
        await estado(client.get(`/api/v1/clientes/${enB}`).bearerToken(token), 403)
        await estado(
            client
                .put(`/api/v1/clientes/${enB}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Otro nombre' }),
            403,
        )
        await estado(
            client.put(`/api/v1/clientes/${enA}`).bearerToken(token).json({ version: 1, zona_id: zonaB }),
            403,
        )
        await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Fuera', zona_id: zonaB }),
            403,
        )
    })

    test('Idempotency-Key: repetir el alta devuelve el mismo cliente', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const clave = unico('idem')
        const cuerpo = { nombre: unico('Idem') }
        const a = await estado(
            client.post('/api/v1/clientes').bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        const b = await estado(
            client.post('/api/v1/clientes').bearerToken(token).header('Idempotency-Key', clave).json(cuerpo),
            201,
        )
        assert.equal(b.header('idempotent-replayed'), 'true')
        assert.equal(a.body().id, b.body().id)
        assert.lengthOf(await db.from('core.clientes').where('nombre', cuerpo.nombre), 1)
    })

    test('cajero ve clientes pero no los crea', async ({ client }) => {
        const { token } = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/clientes').bearerToken(token), 200)
        await estado(client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'No' }), 403)
    })
})

test.group('Zonas', () => {
    test('crear, listar y renombrar con version', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const nombre = unico('Zona Norte')
        const creada = await estado(client.post('/api/v1/zonas').bearerToken(token).json({ nombre }), 201)
        assert.equal(creada.body().nombre, nombre)
        await estado(client.post('/api/v1/zonas').bearerToken(token).json({ nombre }), 409)

        const lista = await estado(client.get('/api/v1/zonas').bearerToken(token), 200)
        assert.isTrue(lista.body().some((z: { id: number }) => z.id === creada.body().id))

        const renombrada = await estado(
            client
                .put(`/api/v1/zonas/${creada.body().id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: `${nombre} B` }),
            200,
        )
        assert.equal(renombrada.body().version, 2)
        await estado(
            client
                .put(`/api/v1/zonas/${creada.body().id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Otra' }),
            409,
        )
    })
})
