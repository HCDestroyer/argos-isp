import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { vistaPreviaReconciliar } from '#network/routeros/diagnostico'
import { leerInventarioAcceso } from '#network/routeros/inventario_acceso'
import type { EventoEntrante } from '#shared/eventos_bus'
import {
    commentPerfilServidor,
    commentServidor,
    commentVlan,
    detectarConflictos,
    estadoRedAcceso,
    inventarioDe,
    nombrePerfilServidor,
    sobrantesAcceso,
    type MenuAcceso,
    type ServidorArgos,
    type VlanArgos,
} from '#network/routeros/red_acceso'
import type { ObjetoRouterOS } from '#network/routeros/cliente'

/** Red de acceso en RouterOS (`contratos/red-acceso.md` §6): funciones puras. */

const obj = (props: Record<string, string>): ObjetoRouterOS =>
    ({ '.id': `*${Math.random()}`, ...props }) as ObjetoRouterOS

const vlanArgos = (id: number, est: VlanArgos['estado'] = 'administrado'): VlanArgos => ({
    id,
    nombre: `vlan${100 + id}`,
    vlan_id: 100 + id,
    interfaz_padre: 'sfp1',
    mtu: null,
    estado: est,
})

const servidor = (id: number, datos: Partial<ServidorArgos> = {}): ServidorArgos => ({
    id,
    nombre: `fibra-${id}`,
    interfaz: `vlan${100 + id}`,
    service_name: `fibra-${id}`,
    estado: 'administrado',
    activo: true,
    perfil_base: 'default',
    max_mtu: 1480,
    max_mru: 1480,
    mrru: null,
    autenticacion: ['pap', 'chap', 'mschap1', 'mschap2'],
    keepalive_timeout: 10,
    una_sesion_por_host: true,
    max_sesiones: null,
    local_address: `10.${id}.0.1`,
    ...datos,
})

test.group('red de acceso · RouterOS (puro)', () => {
    test('inventario: tipos de A1, sin dinámicos y con los valores de RouterOS', ({ assert }) => {
        const inv = inventarioDe({
            interfaces: [
                obj({ name: 'sfp1', type: 'ether' }),
                obj({ name: '<pppoe-x>', type: 'pppoe-in', dynamic: 'true' }),
            ],
            vlans: [obj({ name: 'vlan101', 'vlan-id': '101', interface: 'sfp1', comment: commentVlan(1) })],
            servidores: [
                obj({
                    'service-name': 'fibra',
                    interface: 'vlan101',
                    'default-profile': 'default',
                    authentication: 'pap,chap',
                    'max-sessions': 'unlimited',
                    mrru: 'disabled',
                    'one-session-per-host': 'yes',
                }),
            ],
            perfiles: [obj({ name: 'default', 'local-address': '10.10.0.1' })],
            pools_ipv4: [obj({ name: 'pool1', ranges: '10.0.0.2-10.0.0.254' })],
            pools_ipv6: [obj({ name: 'pd', prefix: '2001:db8::/40', 'prefix-length': '56' })],
        })
        assert.lengthOf(inv.interfaces, 1)
        assert.equal(inv.vlans[0]!.vlan_id, 101)
        assert.equal(inv.vlans[0]!.comment, commentVlan(1))
        assert.deepEqual(inv.servidores_pppoe[0]!.autenticacion, ['pap', 'chap'])
        assert.isNull(inv.servidores_pppoe[0]!.max_sesiones)
        assert.isNull(inv.servidores_pppoe[0]!.mrru)
        assert.isTrue(inv.servidores_pppoe[0]!.una_sesion_por_host)
        assert.isNull(inv.servidores_pppoe[0]!.comment)
        assert.equal(inv.perfiles[0]!.local_address, '10.10.0.1')
        assert.equal(inv.pools_ipv6[0]!.tamano_prefijo, 56)
    })

    test('estado deseado: solo lo administrado; perfil del servidor con el gateway y sin direcciones de default', ({
        assert,
    }) => {
        const perfiles = [
            obj({
                name: 'default',
                'local-address': '10.10.0.1',
                'remote-address': 'pool-x',
                'dns-server': '8.8.8.8',
            }),
        ]
        const { presentes, avisos } = estadoRedAcceso(
            [vlanArgos(1), vlanArgos(2, 'adoptado')],
            [
                servidor(1),
                servidor(2, { estado: 'adoptado' }),
                servidor(3, { local_address: null, activo: false }),
            ],
            perfiles,
        )
        assert.deepEqual(
            presentes.map((p) => `${p.ruta}|${p.comment}`),
            [
                `/interface/vlan|${commentVlan(1)}`,
                `/ppp/profile|${commentPerfilServidor(1)}`,
                `/interface/pppoe-server/server|${commentServidor(1)}`,
                `/ppp/profile|${commentPerfilServidor(3)}`,
                `/interface/pppoe-server/server|${commentServidor(3)}`,
            ],
        )
        const perfil1 = presentes[1]!
        assert.equal(perfil1.propiedades.name, nombrePerfilServidor(1))
        assert.equal(perfil1.propiedades['local-address'], '10.1.0.1')
        assert.equal(perfil1.propiedades['dns-server'], '8.8.8.8')
        assert.notProperty(perfil1.propiedades, 'remote-address')
        assert.equal(presentes[2]!.propiedades['default-profile'], nombrePerfilServidor(1))
        assert.equal(presentes[2]!.propiedades.authentication, 'chap,mschap1,mschap2,pap')
        // sin gateway: sin local-address (se quita) y aviso; inactivo: deshabilitado
        assert.deepEqual(presentes[3]!.quitar, ['local-address'])
        assert.equal(presentes[4]!.propiedades.disabled, 'yes')
        assert.isTrue(avisos.some((a) => a.includes('servidor PPPoE 3')))
    })

    test('sobrantes: solo con comment de la red de acceso; nunca default ni lo ajeno', ({ assert }) => {
        const lectura = new Map<MenuAcceso, ObjetoRouterOS[]>([
            [
                '/interface/vlan',
                [
                    obj({ name: 'vlan101', comment: commentVlan(1) }),
                    obj({ name: 'vlan9', comment: commentVlan(9) }),
                    obj({ name: 'tecnico' }),
                ],
            ],
            [
                '/interface/pppoe-server/server',
                [obj({ interface: 'ether5' }), obj({ interface: 'vlan9', comment: commentServidor(9) })],
            ],
            [
                '/ppp/profile',
                [
                    obj({ name: 'default' }),
                    obj({ name: 'plan-3', comment: 'argosisp:plan:3' }),
                    obj({ name: 'argosisp-pppoe-9', comment: commentPerfilServidor(9) }),
                ],
            ],
        ])
        const { presentes } = estadoRedAcceso([vlanArgos(1)], [], [])
        const sobra = sobrantesAcceso(presentes, lectura).map((s) => `${s.ruta}|${s.objeto.comment}`)
        assert.deepEqual(sobra, [
            `/interface/pppoe-server/server|${commentServidor(9)}`,
            `/ppp/profile|${commentPerfilServidor(9)}`,
            `/interface/vlan|${commentVlan(9)}`,
        ])
    })

    test('conflictos: RADIUS + colas API, árbol + simples, perfiles con rate-limit + colas', ({ assert }) => {
        const colas = [
            obj({ name: 'cliente-juan', target: '10.0.0.5/32' }),
            obj({ name: 'argosisp-plan-3', target: '10.0.0.6/32', comment: 'argosisp:plan:3' }),
            obj({ name: '<pppoe-ana>', target: '10.0.0.7/32', dynamic: 'true' }),
        ]
        const perfiles = [
            obj({ name: 'default', 'rate-limit': '1M/1M' }),
            obj({ name: 'vip', 'rate-limit': '5M/5M' }),
        ]
        const codigos = detectarConflictos({
            pppoe_por_radius: true,
            usa_arbol: true,
            usa_simples: false,
            colas_simples: colas,
            arbol: [],
            perfiles,
        }).map((c) => c.codigo)
        assert.sameMembers(codigos, [
            'radius_y_colas_api',
            'arbol_y_simples',
            'perfil_con_rate_limit_y_colas',
            'perfil_de_fabrica_con_rate_limit',
        ])
        // lo de Argos y lo dinámico no cuenta
        assert.deepEqual(
            detectarConflictos({
                pppoe_por_radius: true,
                usa_arbol: false,
                usa_simples: true,
                colas_simples: colas.slice(1),
                arbol: [],
                perfiles: [],
            }),
            [],
        )
    })
})

/**
 * Integración con Postgres real, la API de A1 y el RouterOS falso: crear y borrar en Argos llega al
 * router por `red_acceso.cambiada`; lo adoptado y lo ajeno no se tocan; descubrir lee el router.
 */
const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 500,
            reintentos: 1,
            esperaMs: 5,
        }),
}

test.group('red de acceso · RouterOS (integración)', (group) => {
    let falso: RouterOSFalso
    let tecnico: string
    let routerId: number
    let base: string
    let redId: number

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token: tecnico } = await usuarioConRoles(['tecnico']))
        ;({ routerId, base } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        const red = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
        redId = Number(red.id)
        // `default` con direcciones que nadie conoce, y objetos ajenos que nunca se tocan
        Object.assign(falso.tabla('/ppp/profile')[0]!, {
            'local-address': '10.10.0.1',
            'remote-address': 'pool-x',
            'dns-server': '8.8.8.8',
        })
        falso
            .tabla('/interface/vlan')
            .push({ '.id': '*V9', name: 'vlan-tecnico', 'vlan-id': '900', interface: 'sfp1' })
        falso.tabla('/interface/pppoe-server/server').push({
            '.id': '*S9',
            'service-name': 'viejo',
            interface: 'ether9',
            'default-profile': 'default',
        })
        return () => falso.cerrar()
    })

    async function entregar(requestId: string) {
        const consumidor = new ConsumidorRouterOS(OPCIONES)
        const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
        for (const f of filas) {
            const e: EventoEntrante = {
                id: Number(f.id),
                evento: f.evento,
                payload: f.payload,
                requestId: f.request_id,
            }
            if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
        }
    }

    async function crear(client: any) {
        let req = unico('req')
        const rVlan = await estado(
            client
                .post(`/api/v1/routers/${routerId}/vlans`)
                .bearerToken(tecnico)
                .header('X-Request-Id', req)
                .json({ interfaz_padre: 'sfp1', vlan_id: 101 }),
            201,
        )
        const vlan = rVlan.body()
        await entregar(req)
        req = unico('req')
        const rSrv = await estado(
            client
                .post(`/api/v1/routers/${routerId}/servidores-pppoe`)
                .bearerToken(tecnico)
                .header('X-Request-Id', req)
                .json({ nombre: 'fibra-101', vlan_id: vlan.id, red_ipv4_id: redId }),
            201,
        )
        const srv = rSrv.body()
        await entregar(req)
        return { vlan, srv }
    }

    const uno = (ruta: Parameters<RouterOSFalso['conComment']>[0], comment: string) =>
        falso.conComment(ruta, comment)

    test('crear en Argos → VLAN, perfil del servidor con el gateway y servidor PPPoE; idempotente', async ({
        client,
        assert,
    }) => {
        const { vlan, srv } = await crear(client)
        const [v] = uno('/interface/vlan', commentVlan(vlan.id))
        assert.containsSubset(v, { name: vlan.nombre, 'vlan-id': '101', interface: 'sfp1' })
        const [perfil] = uno('/ppp/profile', commentPerfilServidor(srv.id))
        assert.equal(perfil!.name, nombrePerfilServidor(srv.id))
        assert.equal(perfil!['local-address'], `${base}.1`)
        assert.equal(perfil!['dns-server'], '8.8.8.8')
        assert.notProperty(perfil!, 'remote-address')
        const [s] = uno('/interface/pppoe-server/server', commentServidor(srv.id))
        assert.containsSubset(s, {
            'service-name': srv.service_name,
            interface: vlan.nombre,
            'default-profile': nombrePerfilServidor(srv.id),
            'max-mtu': '1480',
        })
        // cada escritura en audit.red
        const red = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'metodo' = 'PUT'`)
        assert.isAtLeast(red.length, 3)

        // otra pasada no escribe nada; lo ajeno y `default` intactos
        const antes = falso.escrituras.length
        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isNull(r.error)
        assert.isFalse(r.correcciones.some((c) => c.ruta.startsWith('/interface')))
        assert.isFalse(falso.escrituras.slice(antes).some((e) => e.ruta.includes('/interface/')))
        assert.isDefined(falso.tabla('/interface/vlan').find((x) => x.name === 'vlan-tecnico'))
        assert.isDefined(
            falso.tabla('/interface/pppoe-server/server').find((x) => x['service-name'] === 'viejo'),
        )
        assert.equal(
            falso.tabla('/ppp/profile').find((p) => p.name === 'default')!['local-address'],
            '10.10.0.1',
        )

        // deriva: alguien cambió el servidor a mano → la vista previa lo muestra y reconciliar lo corrige
        uno('/interface/pppoe-server/server', commentServidor(srv.id))[0]!['max-mtu'] = '1400'
        const vista = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.isTrue(
            vista.red_acceso.some((c) => c.accion === 'actualizar' && c.clave === commentServidor(srv.id)),
        )
        await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.equal(uno('/interface/pppoe-server/server', commentServidor(srv.id))[0]!['max-mtu'], '1480')
    })

    test('borrar en Argos: servidor → perfil → VLAN; con sesiones vivas el servidor se conserva', async ({
        client,
        assert,
    }) => {
        const { vlan, srv } = await crear(client)
        // un cliente conectado a ese servidor
        falso.lectura('/interface/pppoe-server').push({
            '.id': '*P1',
            name: '<pppoe-ana>',
            service: srv.service_name,
            dynamic: 'true',
        } as ObjetoRouterOS)
        await db.from('network.servidores_pppoe').where('id', srv.id).delete()
        await db.from('network.vlans').where('id', vlan.id).delete()
        const r = await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'red_acceso' },
            contextoPrueba(),
        )
        assert.lengthOf(uno('/interface/pppoe-server/server', commentServidor(srv.id)), 1)
        assert.lengthOf(uno('/ppp/profile', commentPerfilServidor(srv.id)), 1)
        assert.lengthOf(uno('/interface/vlan', commentVlan(vlan.id)), 1)
        assert.isTrue(r.avisos.some((a) => a.includes('sesiones vivas')))

        // ya sin sesiones: se borra todo lo suyo, en orden, y nada ajeno
        falso.lectura('/interface/pppoe-server').length = 0
        await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'red_acceso' },
            contextoPrueba(),
        )
        assert.lengthOf(uno('/interface/pppoe-server/server', commentServidor(srv.id)), 0)
        assert.lengthOf(uno('/ppp/profile', commentPerfilServidor(srv.id)), 0)
        assert.lengthOf(uno('/interface/vlan', commentVlan(vlan.id)), 0)
        assert.isDefined(falso.tabla('/interface/vlan').find((x) => x.name === 'vlan-tecnico'))
        const borrados = falso.escrituras.filter((e) => e.metodo === 'DELETE').map((e) => e.ruta)
        const i = (s: string) => borrados.findIndex((r2) => r2.includes(s))
        assert.isBelow(i('/interface/pppoe-server/server'), i('/ppp/profile'))
        assert.isBelow(i('/ppp/profile'), i('/interface/vlan'))
    })

    test('lo adoptado nunca se escribe; red_acceso.cambiada de un adoptado no reconcilia', async ({
        assert,
    }) => {
        await db.table('network.vlans').insert({
            router_id: routerId,
            interfaz_padre: 'sfp1',
            vlan_id: 900,
            nombre: 'vlan-tecnico',
            estado: 'adoptado',
            ros_id: '*V9',
        })
        const antes = falso.escrituras.length
        const consumidor = new ConsumidorRouterOS(OPCIONES)
        await consumidor.procesar({
            id: 1,
            evento: 'red_acceso.cambiada',
            requestId: unico('req'),
            payload: {
                router_id: routerId,
                entidad: 'vlan',
                entidad_id: 1,
                accion: 'adoptada',
                estado: 'adoptado',
                campos: [],
            },
        })
        assert.equal(falso.escrituras.length, antes)
        await new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
        assert.isFalse(falso.escrituras.slice(antes).some((e) => e.ruta.includes('/interface/vlan')))
    })

    test('descubrir: lee los seis menús (GET en audit.red), sin escribir; router caído → 502', async ({
        client,
        assert,
    }) => {
        falso
            .lectura('/ip/pool')
            .push({ '.id': '*Q1', name: 'pool1', ranges: '10.0.0.2-10.0.0.254' } as ObjetoRouterOS)
        const antes = falso.escrituras.length
        const req = unico('req')
        const inv = await leerInventarioAcceso(routerId, req, OPCIONES)
        assert.equal(falso.escrituras.length, antes)
        assert.isDefined(inv.vlans.find((v) => v.nombre === 'vlan-tecnico'))
        assert.equal(inv.servidores_pppoe[0]!.service_name, 'viejo')
        assert.equal(inv.perfiles.find((p) => p.nombre === 'default')!.local_address, '10.10.0.1')
        assert.equal(inv.pools_ipv4[0]!.rangos, '10.0.0.2-10.0.0.254')
        const gets = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'operacion' = 'inventario_acceso'`)
            .whereRaw(`comando->>'request_id' = ?`, [req])
        assert.lengthOf(gets, 6)

        // por la API de A1 (import dinámico del lector)
        const visto = await estado(
            client.get(`/api/v1/routers/${routerId}/red-acceso/descubrir`).bearerToken(tecnico),
            200,
        )
        assert.equal(
            visto.body().vlans.find((v: { nombre: string }) => v.nombre === 'vlan-tecnico').argos.estado,
            'nuevo',
        )

        await falso.caer()
        const caido = await client
            .get(`/api/v1/routers/${routerId}/red-acceso/descubrir`)
            .bearerToken(tecnico)
        caido.assertStatus(502)
        assert.equal(caido.body().type.split(':').pop(), 'router_no_responde')
    })

    test('vista previa: conflictos de formas de limitar (RADIUS + colas ajenas)', async ({ assert }) => {
        falso
            .tabla('/queue/simple')
            .push({ '.id': '*C1', name: 'cliente-juan', target: '10.9.9.9/32' } as ObjetoRouterOS)
        falso.tabla('/ppp/profile')[0]!['rate-limit'] = '1M/1M'
        const vista = await vistaPreviaReconciliar(routerId, OPCIONES)
        const codigos = vista.conflictos.map((c) => c.codigo)
        assert.include(codigos, 'radius_y_colas_api')
        assert.include(codigos, 'perfil_de_fabrica_con_rate_limit')
        assert.include(
            vista.conflictos.find((c) => c.codigo === 'radius_y_colas_api')!.objetos,
            '/queue/simple cliente-juan',
        )
        // solo informa: no se borró nada
        assert.isDefined(falso.tabla('/queue/simple').find((x) => x.name === 'cliente-juan'))
    })
})
