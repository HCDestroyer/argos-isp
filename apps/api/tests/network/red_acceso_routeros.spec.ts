import { test } from '@japa/runner'
import {
    commentPerfilServidor,
    commentServidor,
    commentVlan,
    detectarConflictos,
    estadoRedAcceso,
    inventarioDe,
    marcaArgos,
    nombrePerfilServidor,
    sobrantesAcceso,
    type MenuAcceso,
    type ServidorArgos,
    type VlanArgos,
} from '#network/routeros/red_acceso'
import type { ObjetoRouterOS } from '#network/routeros/cliente'

/** Red de acceso en RouterOS (`contratos/red-acceso.md` §6): funciones puras. */

const o = (props: Record<string, string>): ObjetoRouterOS =>
    ({ '.id': `*${Math.random()}`, ...props }) as ObjetoRouterOS

const vlan = (id: number, estado: VlanArgos['estado'] = 'administrado'): VlanArgos => ({
    id,
    nombre: `vlan${100 + id}`,
    vlan_id: 100 + id,
    interfaz_padre: 'sfp1',
    mtu: null,
    estado,
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
    test('marca de Argos por comment', ({ assert }) => {
        assert.deepEqual(marcaArgos(o({ comment: commentVlan(7) })), {
            de_argos: true,
            entidad: 'vlan',
            id: 7,
        })
        assert.deepEqual(marcaArgos(o({ comment: commentServidor(3) })), {
            de_argos: true,
            entidad: 'servidor_pppoe',
            id: 3,
        })
        assert.equal(marcaArgos(o({ comment: 'argosisp:plan:4:limitado' })).entidad, 'plan')
        assert.deepEqual(marcaArgos(o({ comment: 'del técnico' })), {
            de_argos: false,
            entidad: null,
            id: null,
        })
    })

    test('inventario: sin dinámicos, con la marca de Argos y valores de RouterOS', ({ assert }) => {
        const inv = inventarioDe(
            9,
            {
                interfaces: [
                    o({ name: 'sfp1', type: 'ether' }),
                    o({ name: '<pppoe-x>', type: 'pppoe-in', dynamic: 'true' }),
                ],
                vlans: [o({ name: 'vlan101', 'vlan-id': '101', interface: 'sfp1', comment: commentVlan(1) })],
                servidores: [
                    o({
                        'service-name': 'fibra',
                        interface: 'vlan101',
                        'default-profile': 'default',
                        authentication: 'pap,chap',
                        'max-sessions': 'unlimited',
                        mrru: 'disabled',
                        'one-session-per-host': 'yes',
                    }),
                ],
                perfiles: [o({ name: 'default', 'local-address': '10.10.0.1' })],
                pools_ipv4: [o({ name: 'pool1', ranges: '10.0.0.2-10.0.0.254' })],
                pools_ipv6: [o({ name: 'pd', prefix: '2001:db8::/40', 'prefix-length': '56' })],
            },
            new Date('2026-11-05T00:00:00Z'),
        )
        assert.lengthOf(inv.interfaces, 1)
        assert.equal(inv.vlans[0]!.vlan_id, 101)
        assert.equal(inv.vlans[0]!.argos.entidad, 'vlan')
        assert.deepEqual(inv.servidores_pppoe[0]!.autenticacion, ['pap', 'chap'])
        assert.isNull(inv.servidores_pppoe[0]!.max_sesiones)
        assert.isNull(inv.servidores_pppoe[0]!.mrru)
        assert.isTrue(inv.servidores_pppoe[0]!.una_sesion_por_host)
        assert.isFalse(inv.servidores_pppoe[0]!.argos.de_argos)
        assert.isTrue(inv.perfiles[0]!.de_fabrica)
        assert.equal(inv.pools_ipv6[0]!.tamano_entrega, 56)
    })

    test('estado deseado: solo lo administrado; perfil del servidor con el gateway y sin direcciones de default', ({
        assert,
    }) => {
        const perfiles = [
            o({
                name: 'default',
                'local-address': '10.10.0.1',
                'remote-address': 'pool-x',
                'dns-server': '8.8.8.8',
            }),
        ]
        const { presentes, avisos } = estadoRedAcceso(
            [vlan(1), vlan(2, 'adoptado')],
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
                    o({ name: 'vlan101', comment: commentVlan(1) }),
                    o({ name: 'vlan9', comment: commentVlan(9) }),
                    o({ name: 'tecnico' }),
                ],
            ],
            [
                '/interface/pppoe-server/server',
                [o({ interface: 'ether5' }), o({ interface: 'vlan9', comment: commentServidor(9) })],
            ],
            [
                '/ppp/profile',
                [
                    o({ name: 'default' }),
                    o({ name: 'plan-3', comment: 'argosisp:plan:3' }),
                    o({ name: 'argosisp-pppoe-9', comment: commentPerfilServidor(9) }),
                ],
            ],
        ])
        const { presentes } = estadoRedAcceso([vlan(1)], [], [])
        const sobra = sobrantesAcceso(presentes, lectura).map((s) => `${s.ruta}|${s.objeto.comment}`)
        assert.deepEqual(sobra, [
            `/interface/pppoe-server/server|${commentServidor(9)}`,
            `/ppp/profile|${commentPerfilServidor(9)}`,
            `/interface/vlan|${commentVlan(9)}`,
        ])
    })

    test('conflictos: RADIUS + colas API, árbol + simples, perfiles con rate-limit + colas', ({ assert }) => {
        const colas = [
            o({ name: 'cliente-juan', target: '10.0.0.5/32' }),
            o({ name: 'argosisp-plan-3', target: '10.0.0.6/32', comment: 'argosisp:plan:3' }),
            o({ name: '<pppoe-ana>', target: '10.0.0.7/32', dynamic: 'true' }),
        ]
        const perfiles = [
            o({ name: 'default', 'rate-limit': '1M/1M' }),
            o({ name: 'vip', 'rate-limit': '5M/5M' }),
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
