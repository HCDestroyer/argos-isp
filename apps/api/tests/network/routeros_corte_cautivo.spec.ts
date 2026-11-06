import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import {
    clientesUsanDnsRouter,
    REGLA_DNS_TCP,
    REGLA_DNS_UDP,
    REGLA_NAT_HTTP,
    revisarDnsRouter,
} from '#network/routeros/corte_router'
import { esIpDocumentacion } from '#network/conexion/dns'
import { diagnosticoCorte, HOST_SONDA } from '#network/routeros/diagnostico'
import type { ObjetoRouterOS, RutaRouterOS } from '#network/routeros/cliente'
import { SimuladorFirewall, type Paquete } from '#tests/network/simulador_firewall'

/**
 * Bug de producción v1.9.0 (5 nov): «el portal de corte no aparece; en varios dispositivos sale "sin
 * conexión a internet" en vez de "iniciar sesión"». Causa: `argos-corte` solo aceptaba DNS hacia
 * `argos-dns` (el router y `ROUTERS_SERVICIO_DNS_V4`). Un cliente con otro resolver (8.8.8.8 en el
 * perfil PPP, en el CPE o en el teléfono) no resolvía el host de la sonda, nunca pedía el HTTP que el
 * dst-nat lleva a /corte y el sistema concluía «sin internet» (Chrome: DNS_PROBE_STARTED).
 *
 * Se reproduce recorriendo, con las reglas que el reconciliador deja en el RouterOS falso, cada
 * paquete del suspendido: DNS a cualquier resolver, la sonda HTTP (IPv4 e IPv6), HTTPS, DoT y QUIC.
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

const PORTAL_V4 = '192.0.2.20'
const PORTAL_V6 = '2001:db8:ffff::20'
const ENTORNO = {
    ROUTERS_SERVICIO_PORTAL_V4: PORTAL_V4,
    ROUTERS_SERVICIO_PORTAL_V6: PORTAL_V6,
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: 'app.recurrente.com',
    ROUTERS_SERVICIO_DNS_V4: '',
    ROUTERS_SERVICIO_DNS_V6: '',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    PORTAL_URL_PUBLICA: 'http://portal.argosisp.example',
}

/** Lo que resuelve el router para las entradas por FQDN de las address-lists. */
const DNS_ROUTER = {
    'portal.argosisp.example': [PORTAL_V4, PORTAL_V6],
    'app.recurrente.com': ['203.0.113.80'],
}

// Hosts de las sondas (IPs reales de ejemplo; solo importan para el recorrido)
const GSTATIC_V4 = '142.250.65.163'
const GSTATIC_V6 = '2607:f8b0:4005:80b::2003'
const APPLE_V4 = '17.253.119.201'
const MSFT_V6 = '2a01:111:2003::52'
const GOOGLE_DNS_V4 = '8.8.8.8'
const GOOGLE_DNS_V6 = '2001:4860:4860::8888'

const CLIENTE_V4 = '10.10.0.5'
const CLIENTE_V6 = '2001:db8:300:100::1234'

/** Suspendido por PPPoE: el perfil `suspendido` lo pone en la lista de interfaces y en `suspendidos`. */
const suspendido4 = (p: Partial<Paquete>): Paquete => ({
    familia: 4,
    src: CLIENTE_V4,
    dst: GSTATIC_V4,
    protocol: 'tcp',
    interfaz: '<pppoe-cliente>',
    listasInterfaz: ['suspendidos'],
    listasDinamicas: ['suspendidos'],
    ...p,
})
const suspendido6 = (p: Partial<Paquete>): Paquete => ({
    ...suspendido4({}),
    familia: 6,
    src: CLIENTE_V6,
    dst: GSTATIC_V6,
    ...p,
})
const activo4 = (p: Partial<Paquete>): Paquete => ({
    ...suspendido4(p),
    listasInterfaz: [],
    listasDinamicas: [],
})
const activo6 = (p: Partial<Paquete>): Paquete => ({
    ...suspendido6(p),
    listasInterfaz: [],
    listasDinamicas: [],
})

test.group('RouterOS · corte y portal cautivo (bug v1.9.0)', (group) => {
    let falso: RouterOSFalso
    let routerId: number
    const previo: Record<string, string | undefined> = {}

    group.each.setup(async () => {
        for (const [k, v] of Object.entries(ENTORNO)) {
            previo[k] = process.env[k]
            process.env[k] = v
        }
        falso = new RouterOSFalso()
        await falso.levantar()
        const esc = await crearEscenarioRouter()
        routerId = esc.routerId
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        return async () => {
            for (const [k, v] of Object.entries(previo)) {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            await falso.cerrar()
        }
    })

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute(
            { router_id: routerId, motivo: 'periodico' },
            contextoPrueba(),
        )
    const sim = () => new SimuladorFirewall(falso, DNS_ROUTER)

    /**
     * Las reglas de corte como las dejaba v1.9.0 (lab.rsc y el reconciliador): DNS solo hacia
     * `argos-dns`. Con una regla ajena (del operador) en medio, que no se debe tocar.
     */
    function routerConReglasV190(): void {
        const filtro = falso.tabla('/ip/firewall/filter')
        const filtro6 = falso.tabla('/ipv6/firewall/filter')
        const regla = (id: string, comment: string, p: Record<string, string>): ObjetoRouterOS => ({
            '.id': id,
            chain: 'argos-corte',
            comment,
            disabled: 'false',
            dynamic: 'false',
            ...p,
        })
        for (const [tabla, pre] of [
            [filtro, '*E'],
            [filtro6, '*F'],
        ] as const) {
            tabla.push(
                regla(`${pre}1`, 'argosisp: corte DNS udp', {
                    protocol: 'udp',
                    'dst-port': '53',
                    'dst-address-list': 'argos-dns',
                    action: 'accept',
                }),
                regla(`${pre}2`, 'argosisp: corte DNS tcp', {
                    protocol: 'tcp',
                    'dst-port': '53',
                    'dst-address-list': 'argos-dns',
                    action: 'accept',
                }),
                {
                    '.id': `${pre}9`,
                    chain: 'forward',
                    action: 'accept',
                    'src-address': '192.0.2.250',
                    comment: 'regla del operador',
                    disabled: 'false',
                    dynamic: 'false',
                },
            )
        }
    }

    const comentarios = (ruta: RutaRouterOS) => falso.tabla(ruta).map((o) => o.comment ?? '')

    test('reproduce el bug: con las reglas de v1.9.0, el DNS a 8.8.8.8 del suspendido se rechaza', async ({
        assert,
    }) => {
        await reconciliar()
        // Se vuelve a poner el estado de v1.9.0 (lo que tienen hoy los routers en producción).
        for (const ruta of ['/ip/firewall/filter', '/ipv6/firewall/filter'] as const) {
            falso.borrarAMano(ruta, (o) => o.comment === REGLA_DNS_UDP || o.comment === REGLA_DNS_TCP)
            const tabla = falso.tabla(ruta)
            const portal = tabla.findIndex((o) => o.comment === 'argosisp: corte portal')
            tabla.splice(
                portal,
                0,
                {
                    '.id': `*V${ruta.length}1`,
                    chain: 'argos-corte',
                    protocol: 'udp',
                    'dst-port': '53',
                    'dst-address-list': 'argos-dns',
                    action: 'accept',
                    comment: 'argosisp: corte DNS udp',
                },
                {
                    '.id': `*V${ruta.length}2`,
                    chain: 'argos-corte',
                    protocol: 'tcp',
                    'dst-port': '53',
                    'dst-address-list': 'argos-dns',
                    action: 'accept',
                    comment: 'argosisp: corte DNS tcp',
                },
            )
        }
        const antes = sim().recorrer(suspendido4({ protocol: 'udp', dst: GOOGLE_DNS_V4, dport: 53 }))
        assert.deepEqual(antes.filtro, {
            accion: 'reject',
            rechazo: 'icmp-admin-prohibited',
            regla: 'argosisp: corte rechazo del resto',
        })
        const antes6 = sim().recorrer(suspendido6({ protocol: 'udp', dst: GOOGLE_DNS_V6, dport: 53 }))
        assert.equal(antes6.filtro.accion, 'reject')

        // La siguiente reconciliación (la periódica, sin pulsar nada) lo corrige.
        const r = await reconciliar()
        assert.includeMembers(
            r.correcciones.map((c) => `${c.accion} ${c.ruta} ${c.comment}`),
            [
                `creado /ip/firewall/filter ${REGLA_DNS_UDP}`,
                `creado /ip/firewall/filter ${REGLA_DNS_TCP}`,
                'borrado /ip/firewall/filter argosisp: corte DNS udp',
                'borrado /ip/firewall/filter argosisp: corte DNS tcp',
                'borrado /ipv6/firewall/filter argosisp: corte DNS udp',
            ],
        )
        const despues = sim().recorrer(suspendido4({ protocol: 'udp', dst: GOOGLE_DNS_V4, dport: 53 }))
        assert.deepEqual(despues.filtro, { accion: 'accept', regla: REGLA_DNS_UDP })
        assert.isNull(despues.nat, 'la consulta va a su resolver: respuestas reales, sin NAT')
    })

    test('suspendido con DNS 8.8.8.8: resuelve y su HTTP termina en /corte; HTTPS, DoT y QUIC con rechazo inmediato', async ({
        assert,
    }) => {
        const r = await reconciliar()
        assert.isNull(r.error)
        const s = sim()

        // DNS (UDP y TCP) a cualquier resolver, IPv4 e IPv6
        for (const p of [
            suspendido4({ protocol: 'udp', dst: GOOGLE_DNS_V4, dport: 53 }),
            suspendido4({ protocol: 'tcp', dst: '1.1.1.1', dport: 53 }),
            suspendido4({ protocol: 'udp', dst: '10.10.0.1', dport: 53 }),
            suspendido6({ protocol: 'udp', dst: GOOGLE_DNS_V6, dport: 53 }),
            suspendido6({ protocol: 'tcp', dst: GOOGLE_DNS_V6, dport: 53 }),
        ]) {
            const rec = s.recorrer(p)
            assert.equal(rec.filtro.accion, 'accept', `${p.dst}:${p.protocol}/53`)
            assert.isNull(rec.nat)
        }

        // Sondas HTTP (Android, Apple, Windows IPv6): dst-nat al portal y el filtro lo deja pasar
        for (const p of [
            suspendido4({ dst: GSTATIC_V4, dport: 80 }),
            suspendido4({ dst: APPLE_V4, dport: 80 }),
        ]) {
            const rec = s.recorrer(p)
            assert.deepEqual(rec.nat, { dst: PORTAL_V4, dport: 80, regla: REGLA_NAT_HTTP })
            assert.deepEqual(rec.filtro, { accion: 'accept', regla: 'argosisp: corte portal' })
        }
        for (const p of [
            suspendido6({ dst: GSTATIC_V6, dport: 80 }),
            suspendido6({ dst: MSFT_V6, dport: 80 }),
        ]) {
            const rec = s.recorrer(p)
            assert.deepEqual(rec.nat, { dst: PORTAL_V6, dport: 80, regla: REGLA_NAT_HTTP })
            assert.deepEqual(rec.filtro, { accion: 'accept', regla: 'argosisp: corte portal' })
        }

        // El portal (HTTPS tras el 302) y la pasarela (walled garden) sin NAT y aceptados
        for (const p of [
            suspendido4({ dst: PORTAL_V4, dport: 443 }),
            suspendido6({ dst: PORTAL_V6, dport: 443 }),
            suspendido4({ dst: '203.0.113.80', dport: 443 }),
        ]) {
            const rec = s.recorrer(p)
            assert.isNull(rec.nat)
            assert.equal(rec.filtro.accion, 'accept', p.dst)
        }

        // HTTPS (la sonda HTTPS de Android), DoT (853) y DoH: reset TCP al instante, nunca drop
        for (const p of [
            suspendido4({ dst: GSTATIC_V4, dport: 443 }),
            suspendido4({ dst: GOOGLE_DNS_V4, dport: 853 }),
            suspendido4({ dst: GOOGLE_DNS_V4, dport: 443 }),
            suspendido6({ dst: GSTATIC_V6, dport: 443 }),
            suspendido6({ dst: GOOGLE_DNS_V6, dport: 853 }),
        ]) {
            assert.deepEqual(s.recorrer(p).filtro, {
                accion: 'reject',
                rechazo: 'tcp-reset',
                regla: 'argosisp: corte TCP reset',
            })
        }
        // QUIC (UDP/443): rechazo ICMP, cae a TCP
        assert.deepEqual(s.recorrer(suspendido4({ protocol: 'udp', dst: GSTATIC_V4, dport: 443 })).filtro, {
            accion: 'reject',
            rechazo: 'icmp-admin-prohibited',
            regla: 'argosisp: corte rechazo del resto',
        })

        // Ninguna regla de corte descarta (drop) nada
        for (const ruta of ['/ip/firewall/filter', '/ipv6/firewall/filter'] as const) {
            assert.notInclude(
                falso
                    .tabla(ruta)
                    .filter((o) => (o.comment ?? '').startsWith('argosisp'))
                    .map((o) => o.action),
                'drop',
            )
        }
    })

    test('suspendido por CoA (sin reconectar): IPv4 por la address-list del CoA; IPv6 bloqueado con rechazo rápido', async ({
        assert,
    }) => {
        await reconciliar()
        // CoA: `Mikrotik-Address-List` mete la IPv4 en suspendidos; `Filter-Id` crea `ppp → argos-corte`.
        for (const ruta of ['/ip/firewall/filter', '/ipv6/firewall/filter'] as const) {
            falso.tabla(ruta).push({
                '.id': `*P${ruta.length}`,
                chain: 'ppp',
                'in-interface': '<pppoe-cliente>',
                action: 'jump',
                'jump-target': 'argos-corte',
                dynamic: 'true',
            })
        }
        const coa4 = (p: Partial<Paquete>) => suspendido4({ listasInterfaz: [], ...p })
        const coa6 = (p: Partial<Paquete>) => suspendido6({ listasInterfaz: [], listasDinamicas: [], ...p })
        const s = sim()
        assert.equal(
            s.recorrer(coa4({ protocol: 'udp', dst: GOOGLE_DNS_V4, dport: 53 })).filtro.accion,
            'accept',
        )
        assert.deepEqual(s.recorrer(coa4({ dport: 80 })).nat?.dst, PORTAL_V4)
        // IPv6 por CoA: DNS responde y el HTTP recibe reset (el equipo cae a IPv4). Por eso
        // `COA_SUSPENDER_CON_IPV6=disconnect` es el valor por defecto: al reconectar entra al NAT IPv6.
        assert.equal(
            s.recorrer(coa6({ protocol: 'udp', dst: GOOGLE_DNS_V6, dport: 53 })).filtro.accion,
            'accept',
        )
        const http6 = s.recorrer(coa6({ dport: 80 }))
        assert.isNull(http6.nat)
        assert.deepEqual(http6.filtro, {
            accion: 'reject',
            rechazo: 'tcp-reset',
            regla: 'argosisp: corte TCP reset',
        })
    })

    test('un cliente activo no se ve afectado', async ({ assert }) => {
        await reconciliar()
        const s = sim()
        for (const p of [
            activo4({ protocol: 'udp', dst: GOOGLE_DNS_V4, dport: 53 }),
            activo4({ dst: GSTATIC_V4, dport: 80 }),
            activo4({ dst: GSTATIC_V4, dport: 443 }),
            activo4({ dst: GOOGLE_DNS_V4, dport: 853 }),
            activo6({ dst: GSTATIC_V6, dport: 80 }),
            activo6({ dst: GSTATIC_V6, dport: 443 }),
        ]) {
            const rec = s.recorrer(p)
            assert.isNull(rec.nat, `${p.dst}:${p.dport}`)
            assert.deepEqual(rec.filtro, { accion: 'accept', regla: null })
        }
    })

    test('router existente con reglas de v1.9.0: la reconciliación corrige solo lo de argosisp:, la segunda no cambia nada', async ({
        assert,
    }) => {
        routerConReglasV190()
        const r = await reconciliar()
        assert.isNull(r.error)
        for (const ruta of ['/ip/firewall/filter', '/ipv6/firewall/filter'] as const) {
            const c = comentarios(ruta)
            assert.notInclude(c, 'argosisp: corte DNS udp')
            assert.notInclude(c, 'argosisp: corte DNS tcp')
            assert.includeMembers(c, [REGLA_DNS_UDP, REGLA_DNS_TCP, 'regla del operador'])
            // La del operador queda intacta
            assert.containsSubset(
                falso.tabla(ruta).find((o) => o.comment === 'regla del operador'),
                {
                    chain: 'forward',
                    action: 'accept',
                    'src-address': '192.0.2.250',
                },
            )
            // DNS antes del portal y del reset en argos-corte
            assert.isBelow(c.indexOf(REGLA_DNS_UDP), c.indexOf('argosisp: corte TCP reset'))
        }
        // NAT IPv6 creado, con los saltos al inicio
        const nat6 = falso.tabla('/ipv6/firewall/nat')
        assert.deepEqual(
            nat6.slice(0, 2).map((o) => o.comment),
            ['argosisp:top corte NAT por address-list', 'argosisp:top corte NAT por interface-list'],
        )
        assert.containsSubset(nat6, [
            {
                comment: REGLA_NAT_HTTP,
                action: 'dst-nat',
                'to-address': `${PORTAL_V6}/128`,
                'to-ports': '80',
            },
        ])
        const escrituras = falso.escrituras.length
        const otra = await reconciliar()
        assert.deepEqual(otra.correcciones, [])
        assert.equal(falso.escrituras.length, escrituras)
    })

    test('sin IPv6 del portal: no hay NAT IPv6 (se quita el que hubiera), HTTP por IPv6 con reset y aviso', async ({
        assert,
    }) => {
        await reconciliar()
        assert.isNotEmpty(falso.tabla('/ipv6/firewall/nat'))
        process.env.ROUTERS_SERVICIO_PORTAL_V6 = ''
        const r = await reconciliar()
        assert.isTrue(r.avisos.some((a) => /sin IPv6 del portal/.test(a)))
        assert.deepEqual(
            falso.tabla('/ipv6/firewall/nat').filter((o) => (o.comment ?? '').startsWith('argosisp')),
            [],
        )
        const http6 = sim().recorrer(suspendido6({ dport: 80 }))
        assert.isNull(http6.nat)
        assert.equal(http6.filtro.rechazo, 'tcp-reset')
        // IPv4 sigue igual
        assert.equal(sim().recorrer(suspendido4({ dport: 80 })).nat?.dst, PORTAL_V4)
    })

    test('DNS de documentación en /ip dns (router del PM): diagnóstico en rojo y routeros.fallido; nunca se cambia', async ({
        assert,
    }) => {
        falso.dns = {
            servers: '192.0.2.53,198.51.100.53,2001:db8:ffff::53',
            'dynamic-servers': '',
            'allow-remote-requests': 'true',
        }
        const r = await reconciliar()
        assert.isTrue(r.avisos.some((a) => /direcciones de documentación/.test(a)))
        const fallidos = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .whereRaw(`payload->>'router_id' = ?`, [String(routerId)])
        assert.isTrue(
            fallidos.some((f) => f.payload.operacion === 'dns del router (dns_router_documentacion)'),
        )
        assert.isFalse(
            falso.escrituras.some((e) => e.ruta.includes('/ip/dns')),
            'los DNS son del operador',
        )

        const d = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => ({ status: 302, location: 'http://portal.argosisp.example/corte' }),
        })
        const dns = d.chequeos.find((c) => c.clave === 'dns_router')!
        assert.isFalse(dns.ok)
        assert.equal(dns.codigo, 'dns_router_documentacion')
        assert.match(dns.detalle, /192\.0\.2\.53, 198\.51\.100\.53, 2001:db8:ffff::53/)
        assert.include(dns.comandos.join('\n'), '/ip dns set servers=')
        assert.isFalse(d.ok)
        assert.include(
            d.problemas.map((p) => p.codigo),
            'dns_router_documentacion',
        )

        // Vacío: otro error; con DNS reales, verde.
        falso.dns = { servers: '', 'dynamic-servers': '', 'allow-remote-requests': 'true' }
        const vacio = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => ({ status: 302, location: '/corte' }),
        })
        assert.equal(
            vacio.chequeos.find((c) => c.clave === 'dns_router')!.codigo,
            'dns_router_sin_servidores',
        )
        falso.dns = { servers: '1.1.1.1,8.8.8.8', 'dynamic-servers': '', 'allow-remote-requests': 'true' }
        const bienDns = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => ({ status: 302, location: '/corte' }),
        })
        assert.isTrue(bienDns.chequeos.find((c) => c.clave === 'dns_router')!.ok)
    })

    test('revisarDnsRouter: documentación, vacío y allow-remote-requests solo si los clientes usan el router', ({
        assert,
    }) => {
        assert.isTrue(esIpDocumentacion('203.0.113.9'))
        assert.isTrue(esIpDocumentacion('2001:DB8::53'))
        assert.isFalse(esIpDocumentacion('8.8.8.8'))
        assert.isFalse(esIpDocumentacion('2001:4860:4860::8888'))
        assert.deepEqual(
            revisarDnsRouter(
                { servers: '', 'dynamic-servers': '10.0.0.1', 'allow-remote-requests': 'true' },
                true,
            ),
            [],
        )
        const sinRemotas = { servers: '1.1.1.1', 'allow-remote-requests': 'false' }
        assert.deepEqual(revisarDnsRouter(sinRemotas, false), [])
        assert.deepEqual(
            revisarDnsRouter(sinRemotas, true).map((p) => p.codigo),
            ['dns_router_sin_remotas'],
        )
        const perfiles = [{ '.id': '*1', name: 'default', 'dns-server': '10.66.1.1' }]
        assert.isTrue(clientesUsanDnsRouter(perfiles, ['10.66.1.1']))
        assert.isFalse(
            clientesUsanDnsRouter([{ '.id': '*1', name: 'default', 'dns-server': '8.8.8.8' }], ['10.66.1.1']),
        )
    })

    test('destino del NAT detrás de un proxy que no acepta cualquier Host (NPM): diagnóstico en rojo', async ({
        assert,
    }) => {
        await reconciliar()
        const pedidas: Array<[string, string]> = []
        const npm = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async (url, host) => {
                pedidas.push([url, host])
                return { status: 404, location: null }
            },
        })
        assert.deepEqual(pedidas, [[`http://${PORTAL_V4}/generate_204`, HOST_SONDA]])
        const host = npm.chequeos.find((c) => c.clave === 'portal_host')!
        assert.isFalse(host.ok)
        assert.equal(host.codigo, 'portal_no_acepta_host')
        assert.match(host.detalle, /Nginx Proxy Manager/)
        assert.include(
            npm.problemas.map((p) => p.codigo),
            'portal_no_acepta_host',
        )
        // Página por defecto del proxy (200): también mal
        const pagina = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => ({ status: 200, location: null }),
        })
        assert.equal(pagina.chequeos.find((c) => c.clave === 'portal_host')!.codigo, 'portal_no_acepta_host')
        // El portal de Argos: 302 a /corte → verde, y el diagnóstico completo en verde
        const portal = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => ({ status: 302, location: 'http://portal.argosisp.example/corte' }),
        })
        assert.isTrue(portal.chequeos.find((c) => c.clave === 'portal_host')!.ok)
        assert.deepEqual(portal.problemas, [])
        // Argos no llega a esa IP: no se puede comprobar (no es un problema)
        const sinRuta = await diagnosticoCorte(routerId, {
            ...OPCIONES,
            sondaPortal: async () => {
                throw new Error('connect ETIMEDOUT')
            },
        })
        assert.isNull(sinRuta.chequeos.find((c) => c.clave === 'portal_host')!.ok)
    })

    test('destino del NAT = IP del propio router (Argos detrás de este MikroTik): diagnóstico en rojo', async ({
        assert,
    }) => {
        await reconciliar()
        const sonda = { ...OPCIONES, sondaPortal: async () => ({ status: 302, location: '/corte' }) }
        const antes = await diagnosticoCorte(routerId, sonda)
        assert.isTrue(antes.chequeos.find((c) => c.clave === 'portal_en_router')!.ok)
        falso
            .lectura('/ip/address')
            .push({ '.id': '*A1', address: `${PORTAL_V4}/24`, interface: 'ether1-wan' })
        const d = await diagnosticoCorte(routerId, sonda)
        const c = d.chequeos.find((x) => x.clave === 'portal_en_router')!
        assert.isFalse(c.ok)
        assert.match(c.detalle, /dirección del propio router \(ether1-wan\)/)
        assert.include(
            d.problemas.map((p) => p.codigo),
            'portal_en_router',
        )
    })
})
