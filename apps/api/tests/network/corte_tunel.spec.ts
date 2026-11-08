import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import {
    REGLA_NAT_HTTP,
    REGLA_SRCNAT_TUNEL,
    REGLA_SRCNAT_TUNEL_RESTO,
    configCorte,
    estadoCorteRouter,
} from '#network/routeros/corte_router'
import { diagnosticoCorte } from '#network/routeros/diagnostico'
import { valoresServicio } from '#network/conexion/servicio'
import {
    corteTunelDeRouter,
    destinoTunel,
    listarPeersConRedes,
    peersConRedes,
    puertoCorte,
} from '#network/conexion/tunel_corte'

/**
 * Corte por el túnel WireGuard (`contratos/corte-identificacion.md` §5 ter, decisiones del PM P6 y P7): un
 * router en modo `ip` registrado en el túnel manda el HTTP del suspendido a `10.255.0.1:PORTAL_CORTE_PUERTO`
 * sin masquerade, y el peer del servidor acepta sus redes de clientes (AllowedIPs). Postgres real y el
 * RouterOS falso.
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
    red: { interfaz_clientes: 'ether-clientes', dhcp_servidor: 'dhcp-clientes' },
}

const ENTORNO: Record<string, string> = {
    ARGOSISP_WIREGUARD: '1',
    ARGOSISP_WG_RED: '10.255.0.0/16',
    PORTAL_CORTE_PUERTO: '8088',
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: '',
    ROUTERS_SERVICIO_DNS_V4: '',
    ROUTERS_SERVICIO_CLIENTES_V4: '',
    PORTAL_URL_PUBLICA: 'https://portal.argosisp.example',
}
const VARIABLES = [...Object.keys(ENTORNO), 'PORTAL_CORTE_TUNEL', 'ARGOSISP_WG_REDES_EXCLUIDAS']

const TOKEN_INTERNO = () => env.get('INTERNAL_TOKEN')

/** Clave pública WireGuard sintética válida (44 caracteres, `=` final). */
function clave(): string {
    return `${unico('k')
        .replace(/[^A-Za-z0-9]/g, '')
        .padEnd(42, 'A')
        .slice(0, 42)}A=`
}

async function registrarEnTunel(routerId: number): Promise<string> {
    const ip = `10.255.${200 + (routerId % 50)}.${(routerId % 250) + 2}`
    await db.from('network.routers_conexion').where('router_id', routerId).delete()
    await db.table('network.routers_conexion').insert({
        router_id: routerId,
        ip_tunel: `${ip}/32`,
        public_key: clave(),
        estado: 'conectado',
        registrado_en: new Date().toISOString(),
    })
    return ip
}

test.group('Corte por el túnel: reglas puras', () => {
    test('peersConRedes: /32 primero, descarta traslapes con el túnel, compose y otro peer', ({ assert }) => {
        const entorno = { ARGOSISP_WG_RED: '10.255.0.0/16', ARGOSISP_WG_REDES_EXCLUIDAS: '172.30.0.0/24' }
        const peers = peersConRedes(
            [
                {
                    router_id: 7,
                    public_key: 'b',
                    ip_tunel: '10.255.0.7',
                    redes: ['10.66.0.0/16', '10.66.5.0/24'],
                },
                {
                    router_id: 3,
                    public_key: 'a',
                    ip_tunel: '10.255.0.3',
                    redes: [
                        '10.66.1.0/24',
                        '10.70.0.5/24',
                        '10.255.9.0/24',
                        '172.30.0.0/25',
                        '0.0.0.0/0',
                        'x',
                    ],
                },
                { router_id: 9, public_key: 'c', ip_tunel: '10.255.0.9', redes: [] },
            ],
            entorno,
        )
        // Ordenados por router; gana el de menor id
        assert.deepEqual(
            peers.map((p) => p.router_id),
            [3, 7, 9],
        )
        assert.deepEqual(peers[0]!.allowed_ips, ['10.255.0.3/32', '10.66.1.0/24', '10.70.0.0/24'])
        assert.lengthOf(peers[0]!.avisos, 4)
        assert.match(peers[0]!.avisos.join('\n'), /red del túnel/)
        assert.match(peers[0]!.avisos.join('\n'), /ARGOSISP_WG_REDES_EXCLUIDAS/)
        assert.match(peers[0]!.avisos.join('\n'), /más ancha que \/8/)
        assert.match(peers[0]!.avisos.join('\n'), /no es una red IPv4/)
        // 10.66.0.0/16 contiene la 10.66.1.0/24 del router 3: no entra; la /24 suya sí
        assert.deepEqual(peers[1]!.allowed_ips, ['10.255.0.7/32', '10.66.5.0/24'])
        assert.match(peers[1]!.avisos[0]!, /router 3/)
        assert.deepEqual(peers[2]!.allowed_ips, ['10.255.0.9/32'])
    })

    test('destino: WireGuard activo y PORTAL_CORTE_TUNEL distinto de 0', ({ assert }) => {
        assert.isNull(destinoTunel({ ARGOSISP_WIREGUARD: '0' }))
        assert.isNull(destinoTunel({ ARGOSISP_WIREGUARD: '1', PORTAL_CORTE_TUNEL: '0' }))
        assert.deepEqual(destinoTunel({ ARGOSISP_WIREGUARD: '1', ARGOSISP_WG_RED: '10.200.0.0/16' }), {
            ip: '10.200.0.1',
            puerto: 8088,
        })
        assert.equal(puertoCorte({ PORTAL_CORTE_PUERTO: '9090' }), 9090)
        assert.equal(puertoCorte({ PORTAL_CORTE_PUERTO: 'x' }), 8088)
    })

    test('estado deseado con túnel: dst-nat al túnel, srcnat accept arriba, masquerade de respaldo y argos-portal', ({
        assert,
    }) => {
        const config = configCorte(ENTORNO)
        const tunel = { ip: '10.255.0.1', puerto: 8088 }
        const e = estadoCorteRouter(config, { fasttrack: false, redes_v4: ['10.66.0.0/16'], tunel }, [])
        const nat = (comment: string) =>
            e.reglas.find((r) => r.ruta === '/ip/firewall/nat' && r.comment === comment)
        assert.containsSubset(nat(REGLA_NAT_HTTP)?.propiedades, {
            action: 'dst-nat',
            'to-addresses': '10.255.0.1',
            'to-ports': '8088',
        })
        assert.containsSubset(nat(REGLA_SRCNAT_TUNEL), {
            arriba: true,
            propiedades: {
                chain: 'srcnat',
                'src-address-list': 'argos-clientes',
                'dst-address': '10.255.0.1',
                action: 'accept',
            },
        })
        assert.containsSubset(nat(REGLA_SRCNAT_TUNEL_RESTO)?.propiedades, {
            chain: 'srcnat',
            'connection-nat-state': 'dstnat',
            action: 'masquerade',
        })
        assert.deepInclude(e.entradas, {
            ruta: '/ip/firewall/address-list',
            list: 'argos-portal',
            address: '10.255.0.1',
            comment: 'argosisp: portal tunel',
        })
        // El IPv6 no cambia (el túnel no lleva IPv6)
        assert.isUndefined(
            e.reglas.find((r) => r.ruta === '/ipv6/firewall/nat' && r.comment === REGLA_SRCNAT_TUNEL),
        )

        // En modo código no hay túnel: manda el proxy del router; sin túnel, portal_v4 y sin srcnat
        for (const sin of [
            estadoCorteRouter(
                config,
                { fasttrack: false, redes_v4: [], tunel, identificacion: 'codigo' },
                [],
            ),
            estadoCorteRouter(config, { fasttrack: false, redes_v4: [] }, []),
        ]) {
            assert.isUndefined(sin.reglas.find((r) => r.comment === REGLA_SRCNAT_TUNEL))
            assert.isFalse(sin.entradas.some((x) => x.comment === 'argosisp: portal tunel'))
            // El grupo se administra siempre: al salir del túnel se borra la entrada
            assert.isTrue(sin.grupos.some((g) => g.comment === 'argosisp: portal tunel'))
            assert.isTrue(sin.propias.get('/ip/firewall/nat')!.has(REGLA_SRCNAT_TUNEL))
            assert.isTrue(sin.propias.get('/ip/firewall/nat')!.has(REGLA_SRCNAT_TUNEL_RESTO))
        }
        const ip = estadoCorteRouter(config, { fasttrack: false, redes_v4: [] }, [])
        assert.equal(
            ip.reglas.find((r) => r.ruta === '/ip/firewall/nat' && r.comment === REGLA_NAT_HTTP)?.propiedades[
                'to-addresses'
            ],
            '192.0.2.20',
        )
    })

    test('script de conexión: corte_tunel_ip y corte_tunel_puerto solo en modo ip', ({ assert }) => {
        const portal = { portal_v4: '192.0.2.20', portal_v6: null, portal_puerto: 8088 }
        const entorno = {
            ...ENTORNO,
            ROUTERS_SERVICIO_POOL_V4_RANGOS: '10.10.0.10-10.10.0.250',
            ROUTERS_SERVICIO_WAN_INTERFAZ: 'ether1',
            ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
            ROUTERS_SERVICIO_POOL_V6_ENLACE_PREFIJO: '2001:db8:100::/48',
            ROUTERS_SERVICIO_POOL_V6_PD_PREFIJO: '2001:db8:200::/40',
            ROUTERS_SERVICIO_PORTAL_V6: '2001:db8::20',
        }
        const tunel = { ip: '10.255.0.1', puerto: 8088 }
        const router = { interfaz_clientes: 'ether2' }
        const conTunel = valoresServicio(
            router,
            ['10.10.0.1'],
            entorno,
            { ...portal, portal_v6: '2001:db8::20' },
            {
                identificacion: 'ip',
                url: null,
                tunel,
            },
        )
        assert.equal(conTunel.corte_tunel_ip, '10.255.0.1')
        assert.equal(conTunel.corte_tunel_puerto, '8088')
        const codigo = valoresServicio(
            router,
            ['10.10.0.1'],
            entorno,
            { ...portal, portal_v6: '2001:db8::20' },
            {
                identificacion: 'codigo',
                url: null,
                tunel,
            },
        )
        assert.equal(codigo.corte_tunel_ip, '')
        assert.equal(codigo.corte_tunel_puerto, '')
    })
})

test.group('Corte por el túnel: routers, peers y reconciliador', (group) => {
    let falso: RouterOSFalso
    let routerId: number
    let base: string
    const previo: Record<string, string | undefined> = {}

    group.each.setup(async () => {
        for (const k of VARIABLES) previo[k] = process.env[k]
        for (const [k, v] of Object.entries(ENTORNO)) process.env[k] = v
        delete process.env.PORTAL_CORTE_TUNEL
        falso = new RouterOSFalso()
        await falso.levantar()
        const esc = await crearEscenarioRouter()
        routerId = esc.routerId
        base = esc.base
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        return async () => {
            for (const k of VARIABLES) {
                if (previo[k] === undefined) delete process.env[k]
                else process.env[k] = previo[k]
            }
            await falso.cerrar()
        }
    })

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())

    test('corteTunelDeRouter: solo registrado en el túnel, activo y en modo ip efectivo', async ({
        assert,
    }) => {
        assert.isNull(await corteTunelDeRouter(routerId), 'sin registrar en el túnel')
        await registrarEnTunel(routerId)
        assert.deepEqual(await corteTunelDeRouter(routerId), { ip: '10.255.0.1', puerto: 8088 })
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'codigo' })
        assert.isNull(await corteTunelDeRouter(routerId), 'modo código con API')
        // `codigo` sin credenciales de API = el reconciliador no escribe el proxy: va por el túnel
        await db.from('network.routers').where('id', routerId).update({ api_password: null })
        assert.isNotNull(await corteTunelDeRouter(routerId))
        process.env.PORTAL_CORTE_TUNEL = '0'
        assert.isNull(await corteTunelDeRouter(routerId), 'PORTAL_CORTE_TUNEL=0')
    })

    test('GET /internal/wireguard/peers: redes de clientes en AllowedIPs solo con el corte por el túnel', async ({
        client,
        assert,
    }) => {
        const ip = await registrarEnTunel(routerId)
        const peer = async () => {
            const r = await estado(
                client.get('/api/v1/internal/wireguard/peers').bearerToken(TOKEN_INTERNO()),
                200,
            )
            return r.body().data.find((p: { router_id: number }) => p.router_id === routerId)
        }
        const conTunel = await peer()
        assert.deepEqual(conTunel.allowed_ips, [`${ip}/32`, `${base}.0/24`])
        assert.deepEqual(conTunel.avisos, [])
        // Modo código: solo su /32
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'codigo' })
        const enCodigo = await peer()
        assert.deepEqual(enCodigo.allowed_ips, [`${ip}/32`])
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        // Túnel de corte apagado: solo su /32
        process.env.PORTAL_CORTE_TUNEL = '0'
        const peers = await listarPeersConRedes()
        assert.deepEqual(peers.find((p) => p.router_id === routerId)?.allowed_ips, [`${ip}/32`])
    })

    test('reconciliar: dst-nat al túnel, srcnat accept y masquerade; al apagar el túnel vuelve a portal_v4', async ({
        assert,
    }) => {
        await registrarEnTunel(routerId)
        const nat = () => falso.tabla('/ip/firewall/nat')
        const regla = (comment: string) => nat().find((o) => o.comment === comment)
        await reconciliar()
        assert.containsSubset(regla(REGLA_NAT_HTTP), { 'to-addresses': '10.255.0.1', 'to-ports': '8088' })
        assert.containsSubset(regla(REGLA_SRCNAT_TUNEL), {
            chain: 'srcnat',
            'src-address-list': 'argos-clientes',
            'dst-address': '10.255.0.1',
            action: 'accept',
        })
        assert.containsSubset(regla(REGLA_SRCNAT_TUNEL_RESTO), {
            'connection-nat-state': 'dstnat',
            action: 'masquerade',
        })
        // El accept queda antes que cualquier regla que no sea argosisp:top (antes de un masquerade del operador)
        const tabla = nat().filter((o) => o.dynamic !== 'true')
        const primeraNoTop = tabla.findIndex((o) => !(o.comment ?? '').startsWith('argosisp:top'))
        assert.isBelow(tabla.indexOf(regla(REGLA_SRCNAT_TUNEL)!), primeraNoTop)
        assert.isTrue(
            falso
                .tabla('/ip/firewall/address-list')
                .some(
                    (o) =>
                        o.list === 'argos-portal' &&
                        o.address === '10.255.0.1' &&
                        o.comment === 'argosisp: portal tunel',
                ),
        )
        // argos-clientes nuevo en un router con túnel → router.redes_cambiadas (respaldo, §5 ter.10)
        const emitidos = await db
            .from('audit.outbox')
            .where('evento', 'router.redes_cambiadas')
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
        assert.lengthOf(emitidos, 1)
        assert.deepEqual(emitidos[0].payload, { router_id: routerId, empresa_id: null })
        // Otra pasada sin cambios: nada que corregir ni otro evento
        await reconciliar()
        assert.lengthOf(
            await db
                .from('audit.outbox')
                .where('evento', 'router.redes_cambiadas')
                .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId]),
            1,
        )

        process.env.PORTAL_CORTE_TUNEL = '0'
        await reconciliar()
        assert.containsSubset(regla(REGLA_NAT_HTTP), { 'to-addresses': '192.0.2.20' })
        assert.isUndefined(regla(REGLA_SRCNAT_TUNEL))
        assert.isUndefined(regla(REGLA_SRCNAT_TUNEL_RESTO))
        assert.isFalse(
            falso.tabla('/ip/firewall/address-list').some((o) => o.comment === 'argosisp: portal tunel'),
        )
    })

    test('diagnóstico portal_ip_cliente con túnel: prueba el primer salto (la IP del túnel)', async ({
        assert,
    }) => {
        await registrarEnTunel(routerId)
        await reconciliar()
        const gateway = `${base}.1`
        falso.eco = (src) => JSON.stringify({ ip: src, infraestructura: null })
        let d = await diagnosticoCorte(routerId, OPCIONES)
        let chequeo = d.chequeos.find((c) => c.clave === 'portal_ip_cliente')!
        assert.isTrue(chequeo.ok, chequeo.detalle)
        const pedido = falso.peticiones.find(
            (p) => p.ruta === '/rest/tool/fetch' && p.cuerpo?.output === 'user',
        )
        assert.containsSubset(pedido?.cuerpo, {
            url: 'http://10.255.0.1:8088/api/v1/portal/eco-ip',
            'src-address': gateway,
        })
        // Ve la IP del router en el túnel: falta el accept o la red no está en el peer
        falso.eco = () => JSON.stringify({ ip: '10.255.200.9', infraestructura: 'ip_de_router' })
        d = await diagnosticoCorte(routerId, OPCIONES)
        chequeo = d.chequeos.find((c) => c.clave === 'portal_ip_cliente')!
        assert.isFalse(chequeo.ok)
        assert.equal(chequeo.codigo, 'portal_ve_otra_ip')
        assert.include(chequeo.detalle, 'túnel WireGuard')
    })
})
