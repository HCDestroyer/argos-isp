import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { descifrar } from '#shared/cifrado'
import { asignarIpv4, liberarIpv4 } from '#network/ipam_v4'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearRouterFila, crearServicioFila, ipUnica, redUnica } from '#tests/core/fabricas'

test.group('Routers', () => {
    test('crear, ver, listar y editar; las credenciales se cifran y nunca salen', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const nasIp = ipUnica()
        const nombre = unico('MK Centro')
        const creado = await estado(
            client.post('/api/v1/routers').bearerToken(token).json({
                nombre,
                host: 'mk-centro.lab',
                api_usuario: 'argos',
                api_password: 'api-secreta',
                radius_secret: 'radius-secreto',
                nas_ip: nasIp,
            }),
            201,
        )
        const router = creado.body()
        assert.containsSubset(router, {
            nombre,
            nas_ip: nasIp,
            tiene_api_password: true,
            tiene_radius_secret: true,
            modo_seguridad: 'radius',
            modo_velocidad: 'simple',
            activo: true,
            version: 1,
        })
        assert.notProperty(router, 'api_password')
        assert.notProperty(router, 'radius_secret')

        const fila = await db.from('network.routers').where('id', router.id).firstOrFail()
        assert.match(fila.radius_secret, /^v1\./)
        assert.equal(descifrar(fila.radius_secret), 'radius-secreto')
        assert.equal(descifrar(fila.api_password), 'api-secreta')

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: router.id })
        assert.isFalse(JSON.stringify(cambios).includes('secreto'))

        await estado(client.get(`/api/v1/routers/${router.id}`).bearerToken(token), 200)
        const lista = await estado(client.get('/api/v1/routers').qs({ limit: 200 }).bearerToken(token), 200)
        assert.isTrue(lista.body().data.some((r: { id: number }) => r.id === router.id))

        const editado = await estado(
            client
                .put(`/api/v1/routers/${router.id}`)
                .bearerToken(token)
                .json({ version: 1, radius_secret: 'otro-secreto', modo_velocidad: 'pcq' }),
            200,
        )
        assert.equal(editado.body().modo_velocidad, 'pcq')
        const despues = await db.from('network.routers').where('id', router.id).firstOrFail()
        assert.equal(descifrar(despues.radius_secret), 'otro-secreto')
        const cambioSecreto = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'router', entidad_id: router.id, campo: 'radius_secret' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambioSecreto.antes, cambioSecreto.despues], ['***', '***'])

        await estado(
            client.put(`/api/v1/routers/${router.id}`).bearerToken(token).json({ version: 1, activo: false }),
            409,
        )
        await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(token)
                .json({ nombre: unico('Dup'), host: 'x', nas_ip: nasIp }),
            409,
        )
    })

    test('cajero no ve routers; alcance por router filtra la lista y el detalle', async ({
        client,
        assert,
    }) => {
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/routers').bearerToken(cajero.token), 403)

        const r1 = await crearRouterFila()
        const r2 = await crearRouterFila()
        const { token, usuario } = await usuarioConRoles([])
        const rol = await db.from('core.roles').where('nombre', 'tecnico').firstOrFail()
        await db
            .table('core.usuarios_roles')
            .insert({ usuario_id: usuario.id, role_id: rol.id, alcance_tipo: 'router', alcance_id: r1 })

        const lista = await estado(client.get('/api/v1/routers').qs({ limit: 200 }).bearerToken(token), 200)
        assert.deepEqual(
            lista.body().data.map((r: { id: number }) => r.id),
            [r1],
        )
        await estado(client.get(`/api/v1/routers/${r2}`).bearerToken(token), 403)
        await estado(client.get(`/api/v1/routers/${r2}/redes-ipv4`).bearerToken(token), 403)
    })
})

test.group('Redes IPv4', () => {
    test('crear y listar; normaliza, valida gateway y rechaza traslapes', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila()
        const cidr = redUnica()
        const base = cidr.replace('.0/24', '')

        const creada = await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr, gateway: `${base}.1`, tipo: 'estatico' }),
            201,
        )
        assert.containsSubset(creada.body(), {
            router_id: routerId,
            cidr,
            gateway: `${base}.1`,
            tipo: 'estatico',
        })

        const lista = await estado(
            client.get(`/api/v1/routers/${routerId}/redes-ipv4`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista.body().map((r: { cidr: string }) => r.cidr),
            [cidr],
        )

        const traslape = await estado(
            client
                .post(`/api/v1/routers/${await crearRouterFila()}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr: `${base}.128/25`, tipo: 'pool' }),
            409,
        )
        assert.equal(traslape.body().type, 'urn:argosisp:problema:red_traslapada')

        const otra = redUnica()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr: otra.replace('.0/24', '.5/24'), tipo: 'pool' }),
            422,
        )
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr: otra, gateway: '192.0.2.1', tipo: 'pool' }),
            422,
        )
        await estado(
            client
                .post('/api/v1/routers/999999/redes-ipv4')
                .bearerToken(token)
                .json({ cidr: otra, tipo: 'pool' }),
            404,
        )
    })
})

async function ipDe(asignacion: Promise<{ ip: string }>): Promise<string> {
    const resultado = await asignacion
    return resultado.ip
}

test.group('IPAM IPv4', () => {
    async function escenario(tipo: 'estatico' | 'pool' = 'estatico', cidr = redUnica()) {
        const routerId = await crearRouterFila()
        const base = cidr.split('/')[0]!.split('.').slice(0, 3).join('.')
        const [red] = (await db
            .table('network.redes_ipv4')
            .insert({ router_id: routerId, cidr, gateway: `${base}.1`, tipo })
            .returning('id')) as Array<{ id: number }>
        const clienteId = await crearClienteFila()
        const servicio = () => crearServicioFila({ cliente_id: clienteId, router_id: routerId })
        return { routerId, redId: red!.id, base, servicio }
    }

    test('asigna la primera libre sin red ni gateway; conserva la vigente; historial al liberar', async ({
        assert,
    }) => {
        const { routerId, base, servicio } = await escenario()
        const s1 = await servicio()
        const s2 = await servicio()

        await db.transaction(async (trx) => {
            const a1 = await asignarIpv4(trx, { servicioId: s1, routerId })
            const a2 = await asignarIpv4(trx, { servicioId: s2, routerId })
            assert.equal(a1.ip, `${base}.2`)
            assert.equal(a2.ip, `${base}.3`)
            // repetir no cambia la IP
            assert.equal(await ipDe(asignarIpv4(trx, { servicioId: s1, routerId })), `${base}.2`)
            assert.equal(await liberarIpv4(trx, s1), `${base}.2`)
            // la liberada se reutiliza
            const s3 = await servicio()
            assert.equal(await ipDe(asignarIpv4(trx, { servicioId: s3, routerId })), `${base}.2`)
        })

        const historial = await db.from('network.ipv4_asignaciones').where('servicio_id', s1)
        assert.lengthOf(historial, 1)
        assert.isNotNull(historial[0].fin)
    })

    test('IP pedida: debe ser de una red del router, no reservada y libre', async ({ assert }) => {
        const { routerId, base, servicio } = await escenario()
        const s1 = await servicio()
        const s2 = await servicio()
        await db.transaction(async (trx) => {
            assert.equal(
                await ipDe(asignarIpv4(trx, { servicioId: s1, routerId, ip: `${base}.50` })),
                `${base}.50`,
            )
            await assert.rejects(
                () => asignarIpv4(trx, { servicioId: s2, routerId, ip: `${base}.50` }),
                /ya está asignada/,
            )
        })
        await db.transaction(async (trx) => {
            await assert.rejects(
                () => asignarIpv4(trx, { servicioId: s2, routerId, ip: `${base}.1` }),
                /gateway/,
            )
            await assert.rejects(
                () => asignarIpv4(trx, { servicioId: s2, routerId, ip: `${base}.255` }),
                /broadcast/,
            )
            await assert.rejects(
                () => asignarIpv4(trx, { servicioId: s2, routerId, ip: '192.0.2.9' }),
                /ninguna red/,
            )
        })
        // cambiar a otra IP pedida cierra la anterior
        await db.transaction(async (trx) => {
            await asignarIpv4(trx, { servicioId: s1, routerId, ip: `${base}.51` })
        })
        const vigentes = await db.from('network.ipv4_asignaciones').where('servicio_id', s1).whereNull('fin')
        assert.lengthOf(vigentes, 1)
        assert.equal(vigentes[0].ip, `${base}.51`)
    })

    test('red llena → 422 sin IPv4 libres; prefiere redes estatico sobre pool', async ({ assert }) => {
        const n = redUnica().split('.')
        const chica = `${n[0]}.${n[1]}.${n[2]}.0/30`
        const { routerId, servicio } = await escenario('estatico', chica)
        const s1 = await servicio()
        const s2 = await servicio()
        await db.transaction(async (trx) => {
            // /30 con gateway .1: solo queda .2
            assert.equal(
                await ipDe(asignarIpv4(trx, { servicioId: s1, routerId })),
                `${n[0]}.${n[1]}.${n[2]}.2`,
            )
            await assert.rejects(() => asignarIpv4(trx, { servicioId: s2, routerId }), /no tiene IPv4 libres/)
        })

        const pool = redUnica()
        const est = redUnica()
        const r = await crearRouterFila()
        await db.table('network.redes_ipv4').insert({ router_id: r, cidr: pool, tipo: 'pool' })
        await db.table('network.redes_ipv4').insert({ router_id: r, cidr: est, tipo: 'estatico' })
        const s3 = await crearServicioFila({ cliente_id: await crearClienteFila(), router_id: r })
        await db.transaction(async (trx) => {
            const asignada = await asignarIpv4(trx, { servicioId: s3, routerId: r })
            assert.equal(asignada.ip, est.replace('.0/24', '.1'))
        })
    })
})
