import { test } from '@japa/runner'
import {
    gatewayUnico,
    localAddressPerfil,
    localAddressSecret,
    type RedGateway,
} from '#network/routeros/local_address'
import {
    estadoVelocidadRouter,
    objetoAlDia,
    porQuitar,
    PROPIEDADES_PERFIL_BASE,
    quitarDePerfil,
    type LecturaVelocidad,
    type PlanRouter,
    type RouterVelocidad,
} from '#network/routeros/velocidad_router'
import { estrategiasDeFila } from '#network/estrategia_velocidad'
import { SIN_HIJOS } from '#network/velocidad'
import type { ObjetoRouterOS } from '#network/routeros/cliente'

/**
 * `local-address` derivado del gateway de la red IPv4 (pedido del PM del 5 nov): nunca se copia del
 * perfil `default` del router. Funciones puras.
 */

const red = (id: number, gateway: string | null, cidr = `10.${id}.0.0/24`): RedGateway => ({
    red_id: id,
    cidr,
    gateway,
})

const velocidad = {
    bajada_kbps: 20000,
    subida_kbps: 5000,
    bajada_limitada_kbps: 2000,
    subida_limitada_kbps: 1000,
    reuso: 1,
    garantizado_pct: 25,
    rafaga_bajada_kbps: null,
    rafaga_subida_kbps: null,
    rafaga_umbral_pct: null,
    rafaga_segundos: null,
    prioridad: 8,
    rate_limit_override: null,
} as unknown as PlanRouter['velocidad']

function routerCon(redes: RedGateway[], modo: 'radius' | 'api' = 'radius'): RouterVelocidad {
    return {
        router_id: 1,
        control: 'simple',
        estrategias: estrategiasDeFila(null, 'simple'),
        capacidad_bajada_kbps: null,
        capacidad_subida_kbps: null,
        routeros_version: '7.24.5',
        modo_seguridad: modo,
        redes_ipv4: redes,
    }
}

function planPerfil(redes: PlanRouter['redes']): PlanRouter {
    const e = {
        aplicacion: 'perfil_ppp',
        padre: 'ninguno',
        tipo_cola: 'default',
        extras: { rafaga: true, prioridad: true, garantizado: true, excluir_fasttrack: true },
    } as PlanRouter['estrategia']
    return {
        plan_id: 7,
        familia: 'simple',
        velocidad,
        estrategia: e,
        servicios: 1,
        activos: 1,
        limitados: 0,
        dinamicos: { activos: 0, limitados: 0 },
        al_router: { estaticos: SIN_HIJOS, dinamicos: SIN_HIJOS },
        en_activo: 1,
        en_limitado: 0,
        hijas: [],
        pcq: null,
        perfil: e,
        tipos_hoja: [],
        redes,
    }
}

/** Perfil `default` con un local-address que nadie conoce (lo puso el script de conexión). */
const lecturaConDefault = (): LecturaVelocidad =>
    new Map([
        [
            '/ppp/profile',
            [
                {
                    '.id': '*0',
                    name: 'default',
                    'local-address': '10.10.0.1',
                    'dns-server': '10.10.0.1',
                } as ObjetoRouterOS,
            ],
        ],
    ])

test.group('local-address · derivado del gateway de la red', () => {
    test('el perfil base nunca copia local-address', ({ assert }) => {
        assert.notInclude([...PROPIEDADES_PERFIL_BASE] as string[], 'local-address')
    })

    test('secret: el local-address de la regla de A1; sin gateway en su red, aviso', ({ assert }) => {
        assert.deepEqual(localAddressSecret(1, '10.1.0.1', red(1, '10.1.0.1')), {
            gateway: '10.1.0.1',
            red_id: 1,
            aviso: null,
        })
        const sinGw = localAddressSecret(9, null, red(3, null, '10.3.0.0/24'))
        assert.isNull(sinGw.gateway)
        assert.include(sinGw.aviso!, 'servicio 9')
        assert.include(sinGw.aviso!, '10.3.0.0/24 no tiene gateway')
        // sin red (pool del router, sin servidor): nada que avisar (lo da el servidor PPPoE)
        assert.deepEqual(localAddressSecret(1, null, null), { gateway: null, red_id: null, aviso: null })
    })

    test('gateway único: uno sí; varios o una red sin gateway, no', ({ assert }) => {
        assert.equal(gatewayUnico([red(1, '10.1.0.1'), red(1, '10.1.0.1')], 'x').gateway, '10.1.0.1')
        const varios = gatewayUnico([red(1, '10.1.0.1'), red(2, '10.2.0.1')], 'perfil plan-7')
        assert.isNull(varios.gateway)
        assert.include(varios.aviso!, 'gateways distintos (10.1.0.1, 10.2.0.1)')
        assert.include(gatewayUnico([red(1, '10.1.0.1'), red(2, null)], 'x').aviso!, 'no tiene gateway')
        assert.isNull(gatewayUnico([], 'x').aviso)
    })

    test('perfil: redes de sus servicios → router; en api sin aviso por varios gateways', ({ assert }) => {
        const router = [red(5, '10.5.0.1')]
        assert.equal(
            localAddressPerfil(7, { servicios: [red(1, '10.1.0.1')], router }, 'radius').gateway,
            '10.1.0.1',
        )
        assert.equal(localAddressPerfil(7, { servicios: [], router }, 'radius').gateway, '10.5.0.1')
        const dos = { servicios: [red(1, '10.1.0.1'), red(2, '10.2.0.1')], router }
        assert.include(localAddressPerfil(7, dos, 'radius').aviso!, 'perfil plan-7')
        // sin RADIUS cada secret lleva el suyo: varias redes no son un problema
        assert.deepEqual(localAddressPerfil(7, dos, 'api'), { gateway: null, red_id: null, aviso: null })
    })

    test('estado RADIUS: el perfil plan-<id> lleva el gateway, no el local-address de default', ({
        assert,
    }) => {
        const router = routerCon([red(1, '10.1.0.1')])
        const estado = estadoVelocidadRouter(
            router,
            [planPerfil({ servicios: [red(1, '10.1.0.1')], router: router.redes_ipv4! })],
            lecturaConDefault(),
        )
        const perfil = estado.presentes.find((o) => o.ruta === '/ppp/profile')!
        assert.equal(perfil.propiedades['local-address'], '10.1.0.1')
        assert.equal(perfil.propiedades['dns-server'], '10.10.0.1') // lo demás sí se copia
        // Nada de `local-address` que quitar; sí lo que depende de la estrategia y el perfil no pone.
        assert.notInclude(perfil.quitar!, 'local-address')
        assert.deepEqual(perfil.quitar, quitarDePerfil(perfil.propiedades))
    })

    test('estado RADIUS con dos gateways: sin local-address, se quita el viejo y queda el aviso', ({
        assert,
    }) => {
        const redes = [red(1, '10.1.0.1'), red(2, '10.2.0.1')]
        const estado = estadoVelocidadRouter(
            routerCon(redes),
            [planPerfil({ servicios: redes, router: redes })],
            lecturaConDefault(),
        )
        const perfil = estado.presentes.find((o) => o.ruta === '/ppp/profile')!
        assert.notProperty(perfil.propiedades, 'local-address')
        assert.deepEqual(perfil.quitar, quitarDePerfil(perfil.propiedades, ['local-address']))
        assert.isTrue(estado.avisos.some((a) => a.includes('gateways distintos')))
        // un perfil con el local-address copiado de antes no está al día
        const viejo = { '.id': '*9', ...perfil.propiedades, 'local-address': '10.10.0.1' } as ObjetoRouterOS
        assert.deepEqual(porQuitar(perfil, viejo), ['local-address'])
        assert.isFalse(objetoAlDia(perfil, viejo))
        assert.isTrue(objetoAlDia(perfil, { '.id': '*9', ...perfil.propiedades } as ObjetoRouterOS))
    })

    test('RADIUS con servidores de gateways distintos: plan-<id>-s<srv> por servidor, mismo padre', ({
        assert,
    }) => {
        const redes = [red(1, '10.1.0.1'), red(2, '10.2.0.1')]
        const router = {
            ...routerCon(redes),
            servidores_pppoe: [
                { id: 1, local_address: '10.1.0.1' },
                { id: 2, local_address: '10.2.0.1' },
                { id: 3, local_address: '10.3.0.1' },
            ],
        }
        const plan = { ...planPerfil({ servicios: redes, router: redes }), servidores: [1, 2] }
        const estado = estadoVelocidadRouter(router, [plan], lecturaConDefault())
        const perfiles = estado.presentes.filter((o) => o.ruta === '/ppp/profile')
        assert.deepEqual(
            perfiles.map((p) => p.propiedades.name),
            ['plan-7', 'plan-7-s1', 'plan-7-s2'],
        )
        assert.equal(perfiles[1]!.propiedades['local-address'], '10.1.0.1')
        assert.equal(perfiles[1]!.clave.comment, 'argosisp:plan:7:s1')
        assert.equal(perfiles[2]!.propiedades['local-address'], '10.2.0.1')
        assert.equal(perfiles[1]!.propiedades['rate-limit'], perfiles[0]!.propiedades['rate-limit'])
        // sin variante para el servidor 3 (el plan no tiene servicios ahí) y sin aviso: lo cubren las variantes
        assert.isFalse(estado.avisos.some((a) => a.includes('gateways distintos')))
        // un solo gateway entre servidores: nada por servidor
        const uno = estadoVelocidadRouter(
            { ...router, servidores_pppoe: [{ id: 1, local_address: '10.1.0.1' }] },
            [plan],
            lecturaConDefault(),
        )
        assert.lengthOf(
            uno.presentes.filter((o) => o.ruta === '/ppp/profile'),
            1,
        )
    })

    test('estado sin RADIUS: plan-<id> y -limitado con el gateway; sin redes, nada', ({ assert }) => {
        const redes = [red(1, '10.1.0.1')]
        const estado = estadoVelocidadRouter(
            routerCon(redes, 'api'),
            [planPerfil({ servicios: redes, router: redes })],
            lecturaConDefault(),
        )
        const perfiles = estado.presentes.filter((o) => o.ruta === '/ppp/profile')
        assert.lengthOf(perfiles, 2)
        for (const p of perfiles) assert.equal(p.propiedades['local-address'], '10.1.0.1')

        const vacio = estadoVelocidadRouter(
            routerCon([], 'api'),
            [planPerfil({ servicios: [], router: [] })],
            lecturaConDefault(),
        )
        for (const p of vacio.presentes.filter((o) => o.ruta === '/ppp/profile')) {
            assert.notProperty(p.propiedades, 'local-address')
            assert.deepEqual(p.quitar, quitarDePerfil(p.propiedades, ['local-address']))
        }
        assert.lengthOf(vacio.avisos, 0)
    })
})
