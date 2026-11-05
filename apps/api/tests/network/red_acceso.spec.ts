import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    bloqueV6Unico,
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
    redUnica,
} from '#tests/core/fabricas'
import { registrosAaaPorServicio } from '#core/aaa'
import { registrarLectorInventario, type InventarioRedAcceso } from '#network/red_acceso/inventario'

/** Cuerpo de una respuesta con el status esperado. */
async function cuerpo(peticion: PromiseLike<any>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

/**
 * Red de acceso (`contratos/red-acceso.md`): OLT, puertos PON, VLAN, servidores PPPoE, el
 * `local-address` que sale del gateway, el servidor del servicio PPPoE, descubrir y adoptar.
 */

type Cliente = any

async function crearRed(routerId: number, gateway: boolean | string = true) {
    const cidr = redUnica()
    const base = cidr.replace('.0/24', '')
    const [fila] = (await db
        .table('network.redes_ipv4')
        .insert({
            router_id: routerId,
            cidr,
            tipo: 'estatico',
            gateway: gateway === true ? `${base}.1` : gateway === false ? null : gateway,
        })
        .returning('id')) as Array<{ id: number }>
    return { id: Number(fila!.id), base }
}

async function crearPools(routerId: number) {
    const bloque = bloqueV6Unico()
    const raiz = bloque.replace('00::/40', '')
    const [b] = (await db
        .table('network.ipv6_bloques')
        .insert({ router_id: routerId, prefijo: bloque })
        .returning('id')) as Array<{ id: number }>
    const filas = (await db
        .table('network.ipv6_pools')
        .multiInsert([
            { bloque_id: b!.id, prefijo: `${raiz}00::/48`, tipo: 'enlace', tamano_entrega: 64 },
            { bloque_id: b!.id, prefijo: `${raiz}01::/48`, tipo: 'enlace', tamano_entrega: 64 },
            { bloque_id: b!.id, prefijo: `${raiz}10::/44`, tipo: 'delegacion', tamano_entrega: 56 },
            { bloque_id: b!.id, prefijo: `${raiz}20::/44`, tipo: 'delegacion', tamano_entrega: 56 },
        ])
        .returning('id')) as Array<{ id: number }>
    return { raiz, enlace: [filas[0]!.id, filas[1]!.id], delegacion: [filas[2]!.id, filas[3]!.id] }
}

const eventos = (evento: string, campo: string, id: number) =>
    db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>'${campo}')::bigint = ?`, [id])
        .orderBy('id')

async function crearServidor(
    client: Cliente,
    token: string,
    routerId: number,
    datos: Record<string, unknown>,
) {
    const r = await estado(
        client
            .post(`/api/v1/routers/${routerId}/servidores-pppoe`)
            .bearerToken(token)
            .json({ nombre: unico('srv'), ...datos }),
        201,
    )
    return r.body()
}

test.group('Red de acceso · OLT y puertos PON', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })

    test('crear OLT, puertos, duplicados 409 y eliminar con VLAN 409', async ({ client, assert }) => {
        const nombre = unico('OLT')
        const olt = await cuerpo(
            client
                .post('/api/v1/olts')
                .bearerToken(tecnico)
                .json({ nombre, marca: 'Huawei', modelo: 'MA5800' }),
            201,
        )
        assert.equal(olt.marca, 'Huawei')
        assert.deepEqual(olt.puertos, [])
        const dup = await client
            .post('/api/v1/olts')
            .bearerToken(tecnico)
            .json({ nombre: nombre.toUpperCase() })
        dup.assertStatus(409)
        assert.equal(dup.body().type.split(':').pop(), 'olt_duplicada')

        const puerto = await cuerpo(
            client
                .post(`/api/v1/olts/${olt.id}/puertos-pon`)
                .bearerToken(tecnico)
                .json({ identificador: '0/1/3' }),
            201,
        )
        await estado(
            client
                .post(`/api/v1/olts/${olt.id}/puertos-pon`)
                .bearerToken(tecnico)
                .json({ identificador: '0/1/3' }),
            409,
        )
        await estado(
            client
                .post(`/api/v1/olts/${olt.id}/puertos-pon`)
                .bearerToken(tecnico)
                .json({ identificador: 'pon3' }),
            422,
        )
        const editado = await cuerpo(
            client
                .put(`/api/v1/puertos-pon/${puerto.id}`)
                .bearerToken(tecnico)
                .json({ version: puerto.version, descripcion: 'Sector norte' }),
            200,
        )
        assert.equal(editado.descripcion, 'Sector norte')
        await estado(
            client
                .put(`/api/v1/puertos-pon/${puerto.id}`)
                .bearerToken(tecnico)
                .json({ version: puerto.version }),
            409,
        )

        const routerId = await crearRouterFila()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/vlans`)
                .bearerToken(tecnico)
                .json({ interfaz_padre: 'sfp1', vlan_id: 101, puerto_pon_id: puerto.id }),
            201,
        )
        const conVlans = await client.delete(`/api/v1/olts/${olt.id}`).bearerToken(tecnico)
        conVlans.assertStatus(409)
        assert.equal(conVlans.body().type.split(':').pop(), 'olt_con_vlans')

        const otra = await cuerpo(
            client
                .post('/api/v1/olts')
                .bearerToken(tecnico)
                .json({ nombre: unico('OLT') }),
            201,
        )
        await estado(
            client
                .post(`/api/v1/olts/${otra.id}/puertos-pon`)
                .bearerToken(tecnico)
                .json({ identificador: '0/0' }),
            201,
        )
        await estado(client.delete(`/api/v1/olts/${otra.id}`).bearerToken(tecnico), 204)
        assert.isNull(await db.from('network.olts').where('id', otra.id).first())
        const auditoria = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'olt', entidad_id: otra.id, campo: 'nombre' })
        assert.lengthOf(auditoria, 2)
        assert.lengthOf(
            await eventos('red_acceso.cambiada', 'entidad_id', olt.id).where(
                'payload',
                '@>',
                JSON.stringify({ entidad: 'olt' }),
            ),
            1,
        )
    })

    test('soporte ve pero no crea', async ({ client }) => {
        const { token } = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/olts').bearerToken(token), 200)
        await estado(
            client
                .post('/api/v1/olts')
                .bearerToken(token)
                .json({ nombre: unico('OLT') }),
            403,
        )
        const routerId = await crearRouterFila()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/vlans`)
                .bearerToken(token)
                .json({ interfaz_padre: 'e1', vlan_id: 5 }),
            403,
        )
    })
})

test.group('Red de acceso · VLAN', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })

    test('máximo 2 VLAN por puerto PON, únicas por interfaz y nombre, evento por outbox', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const olt = await cuerpo(
            client
                .post('/api/v1/olts')
                .bearerToken(tecnico)
                .json({ nombre: unico('OLT') }),
            201,
        )
        const puerto = await cuerpo(
            client
                .post(`/api/v1/olts/${olt.id}/puertos-pon`)
                .bearerToken(tecnico)
                .json({ identificador: '0/2/1' }),
            201,
        )
        const crear = (datos: Record<string, unknown>) =>
            client.post(`/api/v1/routers/${routerId}/vlans`).bearerToken(tecnico).json(datos)
        const v1 = await cuerpo(
            crear({ interfaz_padre: 'sfp1', vlan_id: 101, puerto_pon_id: puerto.id }),
            201,
        )
        assert.equal(v1.nombre, 'vlan101')
        assert.equal(v1.estado, 'administrado')
        assert.equal(v1.comment, `argosisp:vlan:${v1.id}`)
        assert.deepEqual(v1.puerto_pon, {
            id: puerto.id,
            identificador: '0/2/1',
            olt_id: olt.id,
            olt_nombre: olt.nombre,
        })
        await estado(crear({ interfaz_padre: 'sfp1', vlan_id: 102, puerto_pon_id: puerto.id }), 201)
        const lleno = await crear({ interfaz_padre: 'sfp1', vlan_id: 103, puerto_pon_id: puerto.id })
        lleno.assertStatus(422)
        assert.equal(lleno.body().type.split(':').pop(), 'puerto_pon_lleno')

        const dup = await crear({ interfaz_padre: 'sfp1', vlan_id: 101 })
        dup.assertStatus(409)
        assert.equal(dup.body().type.split(':').pop(), 'vlan_duplicada')
        const nombre = await crear({ interfaz_padre: 'sfp2', vlan_id: 101 })
        nombre.assertStatus(409)
        assert.equal(nombre.body().type.split(':').pop(), 'nombre_interfaz_duplicado')
        await estado(crear({ interfaz_padre: 'sfp2', vlan_id: 101, nombre: 'vlan101-b' }), 201)
        await estado(crear({ interfaz_padre: 'sfp2', vlan_id: 4095 }), 422)

        const [evento] = await eventos('red_acceso.cambiada', 'entidad_id', v1.id).where(
            'payload',
            '@>',
            JSON.stringify({ entidad: 'vlan' }),
        )
        assert.deepInclude(evento.payload, {
            router_id: routerId,
            entidad: 'vlan',
            accion: 'creada',
            estado: 'administrado',
        })
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'vlans.crear', entidad_id: v1.id })
            .first()
        assert.isNotNull(accion)

        const filtradas = await cuerpo(
            client.get(`/api/v1/routers/${routerId}/vlans?puerto_pon_id=${puerto.id}`).bearerToken(tecnico),
            200,
        )
        assert.lengthOf(filtradas, 2)
        const porOlt = await cuerpo(
            client.get(`/api/v1/routers/${routerId}/vlans?olt_id=${olt.id}`).bearerToken(tecnico),
            200,
        )
        assert.lengthOf(porOlt, 2)
    })
})

test.group('Red de acceso · servidores PPPoE y local-address', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })

    test('red obligatoria y con gateway; uno por VLAN; local-address del gateway', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const red = await crearRed(routerId)
        const sinGateway = await crearRed(routerId, false)
        const vlan = await cuerpo(
            client
                .post(`/api/v1/routers/${routerId}/vlans`)
                .bearerToken(tecnico)
                .json({ interfaz_padre: 'sfp1', vlan_id: 200 }),
            201,
        )
        const url = `/api/v1/routers/${routerId}/servidores-pppoe`
        const sinRed = await client.post(url).bearerToken(tecnico).json({ nombre: 'a', vlan_id: vlan.id })
        sinRed.assertStatus(422)
        assert.equal(sinRed.body().errors[0].rule, 'red_requerida')
        const malaRed = await client
            .post(url)
            .bearerToken(tecnico)
            .json({ nombre: 'a', vlan_id: vlan.id, red_ipv4_id: sinGateway.id })
        malaRed.assertStatus(422)
        assert.equal(malaRed.body().errors[0].rule, 'red_sin_gateway')
        const sinInterfaz = await client
            .post(url)
            .bearerToken(tecnico)
            .json({ nombre: 'a', red_ipv4_id: red.id })
        sinInterfaz.assertStatus(422)

        const srv = await crearServidor(client, tecnico, routerId, {
            nombre: 'fibra-200',
            vlan_id: vlan.id,
            red_ipv4_id: red.id,
        })
        assert.equal(srv.interfaz, 'vlan200')
        assert.equal(srv.service_name, 'fibra-200')
        assert.equal(srv.local_address, `${red.base}.1`)
        assert.equal(srv.perfil, `argosisp-pppoe-${srv.id}`)
        assert.equal(srv.comment, `argosisp:pppoe:${srv.id}`)
        assert.equal(srv.max_mtu, 1480)
        assert.deepEqual(srv.autenticacion, ['pap', 'chap', 'mschap1', 'mschap2'])
        assert.isTrue(srv.una_sesion_por_host)

        const otro = await client
            .post(url)
            .bearerToken(tecnico)
            .json({ nombre: 'b', vlan_id: vlan.id, red_ipv4_id: red.id })
        otro.assertStatus(409)
        assert.equal(otro.body().type.split(':').pop(), 'vlan_con_servidor')
        const mismaInterfaz = await client
            .post(url)
            .bearerToken(tecnico)
            .json({ nombre: 'b', interfaz: 'VLAN200', red_ipv4_id: red.id })
        mismaInterfaz.assertStatus(409)
        assert.equal(mismaInterfaz.body().type.split(':').pop(), 'interfaz_con_servidor')

        // la VLAN con servidor no se borra
        const borrar = await client.delete(`/api/v1/vlans/${vlan.id}`).bearerToken(tecnico)
        borrar.assertStatus(409)

        // Quitar el gateway de la red del servidor: 422; cambiarlo: evento con local_address
        const filaRed = await db.from('network.redes_ipv4').where('id', red.id).firstOrFail()
        const quitar = await client
            .put(`/api/v1/redes-ipv4/${red.id}`)
            .bearerToken(tecnico)
            .json({ version: filaRed.version, gateway: null })
        quitar.assertStatus(422)
        assert.equal(quitar.body().errors[0].rule, 'red_con_servidor_pppoe')
        await estado(
            client
                .put(`/api/v1/redes-ipv4/${red.id}`)
                .bearerToken(tecnico)
                .json({ version: filaRed.version, gateway: `${red.base}.254` }),
            200,
        )
        const visto = await cuerpo(client.get(`/api/v1/servidores-pppoe/${srv.id}`).bearerToken(tecnico), 200)
        assert.equal(visto.local_address, `${red.base}.254`)
        const cambios = await eventos('red_acceso.cambiada', 'entidad_id', srv.id).where(
            'payload',
            '@>',
            JSON.stringify({ entidad: 'servidor_pppoe', campos: ['local_address'] }),
        )
        assert.lengthOf(cambios, 1)

        // editar: versión vieja 409; campos y evento
        await estado(
            client
                .put(`/api/v1/servidores-pppoe/${srv.id}`)
                .bearerToken(tecnico)
                .json({ version: srv.version, max_mtu: 1492 }),
            200,
        )
        await estado(
            client
                .put(`/api/v1/servidores-pppoe/${srv.id}`)
                .bearerToken(tecnico)
                .json({ version: srv.version, max_mtu: 1400 }),
            409,
        )

        const arbol = await cuerpo(
            client.get(`/api/v1/routers/${routerId}/red-acceso`).bearerToken(tecnico),
            200,
        )
        assert.lengthOf(arbol.vlans, 1)
        assert.lengthOf(arbol.servidores_pppoe, 1)
        assert.equal(arbol.servidores_pppoe[0].max_mtu, 1492)

        await estado(client.delete(`/api/v1/servidores-pppoe/${srv.id}`).bearerToken(tecnico), 204)
        await estado(client.delete(`/api/v1/vlans/${vlan.id}`).bearerToken(tecnico), 204)
        const eliminado = await eventos('red_acceso.cambiada', 'entidad_id', srv.id).where(
            'payload',
            '@>',
            JSON.stringify({ entidad: 'servidor_pppoe', accion: 'eliminada' }),
        )
        assert.lengthOf(eliminado, 1)
    })
})

test.group('Red de acceso · servicio PPPoE con servidor', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })

    test('se deriva, toma la IPv4 de su red y los prefijos de sus pools; varios → 422', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const redA = await crearRed(routerId)
        const redB = await crearRed(routerId)
        const pools = await crearPools(routerId)
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const srvB = await crearServidor(client, tecnico, routerId, {
            interfaz: 'ether2',
            red_ipv4_id: redB.id,
            ipv6_pool_enlace_id: pools.enlace[1],
            ipv6_pool_delegacion_id: pools.delegacion[1],
        })
        const alta = (datos: Record<string, unknown> = {}) =>
            client
                .post('/api/v1/servicios')
                .bearerToken(tecnico)
                .json({
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    plantilla_facturacion_id: null,
                    ipv6_modo: 'radius_servicio',
                    ...datos,
                })
        const uno = await cuerpo(alta(), 201)
        assert.equal(uno.servidor_pppoe_id, srvB.id)
        assert.match(uno.ipv4, new RegExp(`^${redB.base.replaceAll('.', '\\.')}\\.`))
        assert.equal(uno.local_address, `${redB.base}.1`)
        assert.isTrue(uno.prefijo_enlace_v6.startsWith(`${pools.raiz}01:`))
        assert.isTrue(uno.prefijo_delegado_v6.startsWith(`${pools.raiz}2`))
        const [aaa] = await registrosAaaPorServicio([uno.id])
        assert.deepEqual(aaa!.red_acceso, { servidor_pppoe_id: srvB.id, local_address: `${redB.base}.1` })

        const srvA = await crearServidor(client, tecnico, routerId, {
            interfaz: 'ether1',
            red_ipv4_id: redA.id,
        })
        const ambigua = await alta()
        ambigua.assertStatus(422)
        assert.equal(ambigua.body().type.split(':').pop(), 'servidor_pppoe_requerido')
        // con la red pedida se deriva
        const porRed = await cuerpo(alta({ red_ipv4_id: redA.id }), 201)
        assert.equal(porRed.servidor_pppoe_id, srvA.id)
        // otro tipo con servidor: 422
        await estado(
            alta({ tipo_conexion: 'ip_estatica', servidor_pppoe_id: srvA.id, ipv6_modo: 'ninguno' }),
            422,
        )

        // cambiar de servidor: IP pasa a la red nueva y el evento trae servidor_pppoe
        const cambiado = await cuerpo(
            client
                .put(`/api/v1/servicios/${uno.id}`)
                .bearerToken(tecnico)
                .json({ version: uno.version, servidor_pppoe_id: srvA.id }),
            200,
        )
        assert.equal(cambiado.servidor_pppoe_id, srvA.id)
        assert.match(cambiado.ipv4, new RegExp(`^${redA.base.replaceAll('.', '\\.')}\\.`))
        assert.equal(cambiado.local_address, `${redA.base}.1`)
        const [config] = await eventos('servicio.config_cambiada', 'servicio_id', uno.id)
        assert.includeMembers(config.payload.campos, ['servidor_pppoe', 'ips'])
        // editar otra cosa no cambia el servidor
        const otraEdicion = await cuerpo(
            client
                .put(`/api/v1/servicios/${uno.id}`)
                .bearerToken(tecnico)
                .json({ version: cambiado.version, direccion: 'Zona 1' }),
            200,
        )
        assert.equal(otraEdicion.servidor_pppoe_id, srvA.id)

        // con servicios, el servidor no se elimina
        const borrar = await client.delete(`/api/v1/servidores-pppoe/${srvA.id}`).bearerToken(tecnico)
        borrar.assertStatus(409)
        assert.equal(borrar.body().type.split(':').pop(), 'servidor_con_servicios')
    })

    test('IP a mano en una red sin gateway con servidor administrado: 422 red_sin_gateway', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const red = await crearRed(routerId)
        const sinGateway = await crearRed(routerId, false)
        await crearServidor(client, tecnico, routerId, { interfaz: 'ether1', red_ipv4_id: red.id })
        const r = await client
            .post('/api/v1/servicios')
            .bearerToken(tecnico)
            .json({
                cliente_id: await crearClienteFila(),
                router_id: routerId,
                plan_id: await crearPlanFila(),
                plantilla_facturacion_id: null,
                ipv6_modo: 'ninguno',
                ipv4: `${sinGateway.base}.10`,
            })
        r.assertStatus(422)
        assert.equal(r.body().errors[0].rule, 'red_sin_gateway')
    })

    test('router sin servidores: el servicio queda sin servidor, como antes', async ({ client, assert }) => {
        const routerId = await crearRouterFila()
        await crearRed(routerId, false)
        const r = await cuerpo(
            client
                .post('/api/v1/servicios')
                .bearerToken(tecnico)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: await crearPlanFila(),
                    plantilla_facturacion_id: null,
                    ipv6_modo: 'ninguno',
                }),
            201,
        )
        assert.isNull(r.servidor_pppoe_id)
        assert.isNull(r.local_address)
    })
})

test.group('Red de acceso · descubrir y adoptar', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })
    group.each.teardown(() => registrarLectorInventario(null))

    const inventario = (gateway: string): InventarioRedAcceso => ({
        interfaces: [{ nombre: 'sfp1', tipo: 'ether', deshabilitada: false }],
        vlans: [
            {
                ros_id: '*A',
                nombre: 'vlan300',
                interfaz_padre: 'sfp1',
                vlan_id: 300,
                mtu: 1500,
                deshabilitada: false,
                comment: null,
            },
            {
                ros_id: '*B',
                nombre: 'vlan301',
                interfaz_padre: 'sfp1',
                vlan_id: 301,
                mtu: 1500,
                deshabilitada: false,
                comment: null,
            },
        ],
        servidores_pppoe: [
            {
                ros_id: '*1',
                service_name: 'fibra300',
                interfaz: 'vlan300',
                perfil: 'perfil-fibra',
                max_mtu: 1492,
                max_mru: 1492,
                mrru: null,
                autenticacion: ['chap', 'mschap2'],
                keepalive_timeout: 30,
                una_sesion_por_host: true,
                max_sesiones: null,
                deshabilitado: false,
                comment: null,
            },
        ],
        perfiles: [
            {
                ros_id: '*P',
                nombre: 'perfil-fibra',
                local_address: gateway,
                remote_address: 'pool1',
                comment: null,
            },
        ],
        pools_ipv4: [{ ros_id: '*Q', nombre: 'pool1', rangos: '100.64.0.2-100.64.0.254' }],
        pools_ipv6: [],
    })

    test('sin lector: 501; con lector marca nuevo, adopta sin tocar el router y protege lo adoptado', async ({
        client,
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const red = await crearRed(routerId)
        const url = `/api/v1/routers/${routerId}/red-acceso`
        const sinLector = await client.get(`${url}/descubrir`).bearerToken(tecnico)
        sinLector.assertStatus(501)
        assert.equal(sinLector.body().type.split(':').pop(), 'descubrir_no_disponible')

        registrarLectorInventario(async () => inventario(`${red.base}.1`))
        const visto = await cuerpo(client.get(`${url}/descubrir`).bearerToken(tecnico), 200)
        assert.equal(visto.vlans[0].argos.estado, 'nuevo')
        assert.equal(visto.servidores_pppoe[0].red_ipv4_sugerida_id, red.id)

        const adoptado = await cuerpo(
            client
                .post(`${url}/adoptar`)
                .bearerToken(tecnico)
                .json({ servidores_pppoe: [{ ros_id: '*1', red_ipv4_id: red.id }] }),
            200,
        )
        // la VLAN del servidor se adoptó con él
        assert.lengthOf(adoptado.vlans, 1)
        assert.equal(adoptado.vlans[0].estado, 'adoptado')
        assert.isNull(adoptado.vlans[0].comment)
        const srv = adoptado.servidores_pppoe[0]
        assert.equal(srv.estado, 'adoptado')
        assert.equal(srv.vlan_id, adoptado.vlans[0].id)
        assert.equal(srv.perfil, 'perfil-fibra')
        assert.equal(srv.max_mtu, 1492)
        assert.deepEqual(srv.autenticacion, ['chap', 'mschap2'])
        assert.equal(srv.local_address, `${red.base}.1`)
        const [evento] = await eventos('red_acceso.cambiada', 'entidad_id', srv.id).where(
            'payload',
            '@>',
            JSON.stringify({ entidad: 'servidor_pppoe' }),
        )
        assert.deepInclude(evento.payload, { accion: 'adoptada', estado: 'adoptado' })

        // otra vez: ya registrado; uno que ya no está: inventario_cambio
        const otraVez = await client
            .post(`${url}/adoptar`)
            .bearerToken(tecnico)
            .json({ servidores_pppoe: [{ ros_id: '*1' }] })
        otraVez.assertStatus(409)
        assert.equal(otraVez.body().type.split(':').pop(), 'ya_registrado')
        const fantasma = await client
            .post(`${url}/adoptar`)
            .bearerToken(tecnico)
            .json({ vlans: [{ ros_id: '*Z' }] })
        fantasma.assertStatus(409)
        assert.equal(fantasma.body().type.split(':').pop(), 'inventario_cambio')

        // adoptado: campos de RouterOS no se editan; los de Argos sí
        const mtu = await client
            .put(`/api/v1/servidores-pppoe/${srv.id}`)
            .bearerToken(tecnico)
            .json({ version: srv.version, max_mtu: 1400 })
        mtu.assertStatus(422)
        assert.equal(mtu.body().errors[0].rule, 'adoptado_solo_lectura')
        await estado(
            client
                .put(`/api/v1/servidores-pppoe/${srv.id}`)
                .bearerToken(tecnico)
                .json({ version: srv.version, descripcion: 'Torre norte' }),
            200,
        )

        const despues = await cuerpo(client.get(`${url}/descubrir`).bearerToken(tecnico), 200)
        const v300 = despues.vlans.find((v: { nombre: string }) => v.nombre === 'vlan300')
        assert.deepInclude(v300.argos, { estado: 'adoptado', id: adoptado.vlans[0].id })
        assert.equal(despues.servidores_pppoe[0].argos.estado, 'adoptado')
        assert.deepEqual(despues.sin_router, [])
    })
})

test.group('Red de acceso · unir routers', (group) => {
    let tecnico: string
    group.setup(async () => {
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
    })

    test('VLAN y servidores pasan al que queda; los repetidos se resuelven a los suyos', async ({
        client,
        assert,
    }) => {
        const queda = await crearRouterFila()
        const absorbido = await crearRouterFila()
        const redQueda = await crearRed(queda)
        const redAbs = await crearRed(absorbido)
        const vlanRepetida = (url: number) =>
            cuerpo(
                client
                    .post(`/api/v1/routers/${url}/vlans`)
                    .bearerToken(tecnico)
                    .json({ interfaz_padre: 'sfp1', vlan_id: 500 }),
                201,
            )
        const vQueda = await vlanRepetida(queda)
        const vAbs = await vlanRepetida(absorbido)
        const vSola = await cuerpo(
            client
                .post(`/api/v1/routers/${absorbido}/vlans`)
                .bearerToken(tecnico)
                .json({ interfaz_padre: 'sfp1', vlan_id: 501 }),
            201,
        )
        const sQueda = await crearServidor(client, tecnico, queda, {
            vlan_id: vQueda.id,
            red_ipv4_id: redQueda.id,
        })
        const sAbs = await crearServidor(client, tecnico, absorbido, {
            vlan_id: vAbs.id,
            red_ipv4_id: redAbs.id,
        })
        const sSolo = await crearServidor(client, tecnico, absorbido, {
            vlan_id: vSola.id,
            red_ipv4_id: redAbs.id,
        })
        const servicioId = await crearServicioFila({
            cliente_id: await crearClienteFila(),
            router_id: absorbido,
            ipv6_modo: 'ninguno',
            servidor_pppoe_id: sAbs.id,
        })
        const { token: admin } = await usuarioConRoles(['admin'])
        const router = await db.from('network.routers').where('id', queda).firstOrFail()
        await estado(
            client
                .post(`/api/v1/routers/${queda}/unir`)
                .bearerToken(admin)
                .json({ version: router.version, absorber_id: absorbido }),
            200,
        )
        const servicio = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        assert.equal(Number(servicio.router_id), queda)
        assert.equal(Number(servicio.servidor_pppoe_id), sQueda.id)
        assert.isNull(await db.from('network.servidores_pppoe').where('id', sAbs.id).first())
        assert.isNull(await db.from('network.vlans').where('id', vAbs.id).first())
        const movido = await db.from('network.servidores_pppoe').where('id', sSolo.id).firstOrFail()
        assert.equal(Number(movido.router_id), queda)
        const vlanMovida = await db.from('network.vlans').where('id', vSola.id).firstOrFail()
        assert.equal(Number(vlanMovida.router_id), queda)
    })
})
