import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, unico } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearServicioFila } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import ProbarConexion from '#network/conexion/actions/probar_conexion'
import { diagnosticoCorte, type DiagnosticoCorte } from '#network/routeros/diagnostico'
import { bitacoraRed, type FabricaClientes, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { REGLA_NAT_HTTP, type ResolverIPv4 } from '#network/routeros/corte_router'

/**
 * Corte con el portal por nombre y diagnóstico de corte (pedido del PM, 29 oct: «a los suspendidos no
 * se les redirige a la página de corte»): el reconciliador resuelve el FQDN del portal en cada pasada
 * para el `to-addresses` del dst-nat; si no resuelve, `routeros.fallido` y el chequeo en rojo. El
 * diagnóstico prueba el destino real del NAT con `/tool/fetch` y mira los suspendidos de verdad.
 */

const fabrica: FabricaClientes = (router) =>
    clienteDeRouter(router, {
        clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
        bitacora: bitacoraRed,
        timeoutMs: 500,
        reintentos: 0,
        esperaMs: 5,
    })

/** Lo normal en producción: el portal por nombre, sin `ROUTERS_SERVICIO_PORTAL_V4`. */
const ENTORNO = {
    PORTAL_URL_PUBLICA: 'https://portal.isp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: 'app.recurrente.com',
    ROUTERS_SERVICIO_DNS_V4: '192.0.2.53',
}
const BORRAR = [
    'ROUTERS_SERVICIO_PORTAL_V4',
    'ROUTERS_SERVICIO_PORTAL_FQDN',
    'ROUTERS_SERVICIO_PORTAL_PUERTO',
]

test.group('RouterOS · corte con el portal por FQDN y diagnóstico de corte', (group) => {
    let falso: RouterOSFalso
    let routerId: number
    let base: string
    let dns: Map<string, string[] | Error>
    const previo: Record<string, string | undefined> = {}

    const resolver: ResolverIPv4 = async (host) => {
        const r = dns.get(host)
        if (r instanceof Error) throw r
        return r ?? []
    }
    const opciones = (): OpcionesDispatcher => ({ clientes: fabrica, resolver })
    const noExiste = () => Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })

    group.each.setup(async () => {
        for (const k of [...Object.keys(ENTORNO), ...BORRAR]) previo[k] = process.env[k]
        Object.assign(process.env, ENTORNO)
        for (const k of BORRAR) delete process.env[k]
        dns = new Map([['portal.isp.example', ['198.51.100.7']]])
        falso = new RouterOSFalso()
        await falso.levantar()
        const esc = await crearEscenarioRouter()
        routerId = esc.routerId
        base = esc.base
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        falso.tabla('/ip/firewall/filter').push({
            '.id': '*F1',
            chain: 'forward',
            action: 'fasttrack-connection',
            'connection-state': 'established,related',
            comment: 'defconf: fasttrack',
        })
        return async () => {
            for (const [k, v] of Object.entries(previo)) {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            await falso.cerrar()
        }
    })

    const reconciliar = () =>
        new ReconciliarRouterOS(opciones()).execute(
            { router_id: routerId, motivo: 'manual' },
            contextoPrueba(),
        )
    const diagnostico = () => diagnosticoCorte(routerId, opciones(), 'req-prueba')
    const chequeo = (d: DiagnosticoCorte, clave: string) => d.chequeos.find((c) => c.clave === clave)!
    const natHttp = () => falso.tabla('/ip/firewall/nat').find((o) => o.comment === REGLA_NAT_HTTP)
    const fetches = () =>
        falso.peticiones.filter((p) => p.ruta === '/rest/tool/fetch').map((p) => p.cuerpo?.url as string)

    async function suspendidoPppoe(ipv4: string) {
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            tipo_conexion: 'pppoe',
            estado: 'suspendido',
        })
        await db.table('network.sesiones').insert({
            servicio_id: servicioId,
            router_id: routerId,
            nas_ip: '127.0.0.9',
            acct_session_id: unico('81b0'),
            user_ppp: unico('ppp'),
            ipv4,
        })
        return servicioId
    }

    test('FQDN que resuelve: el dst-nat va a la IP resuelta, se vuelve a resolver en cada pasada', async ({
        assert,
    }) => {
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.isNull(r.error_portal)
        assert.containsSubset(natHttp(), {
            action: 'dst-nat',
            'to-addresses': '198.51.100.7',
            'to-ports': '80',
            disabled: 'false',
        })
        assert.containsSubset(falso.tabla('/ip/firewall/address-list'), [
            { list: 'argos-portal', address: '198.51.100.7' },
            { list: 'argos-portal', address: 'portal.isp.example' },
        ])
        // La IP resuelta no se guarda en ningún lado: el router de Argos no tiene columna para ella.
        const fila = await db.from('network.routers').where('id', routerId).firstOrFail()
        assert.notInclude(JSON.stringify(fila), '198.51.100.7')

        const d = await diagnostico()
        assert.isTrue(d.ok, JSON.stringify(d.problemas))
        assert.containsSubset(d.portal, {
            fqdn: 'portal.isp.example',
            ipv4: '198.51.100.7',
            origen: 'dns',
            destino_nat: 'http://198.51.100.7:80/corte',
            alcanzable: true,
        })
        // /tool/fetch fue al destino real del NAT, no a PORTAL_URL_PUBLICA
        assert.deepEqual(fetches(), ['http://198.51.100.7:80/corte'])
        assert.lengthOf(d.limites, 3)
        assert.match(d.limites[0]!, /HTTPS \(puerto 443\) no se redirige/)
        assert.match(d.limites[1]!, /IPv6 no se redirige/)

        // El DNS cambia: la siguiente reconciliación corrige el NAT y la lista del portal.
        dns.set('portal.isp.example', ['198.51.100.8'])
        const otra = await reconciliar()
        assert.includeMembers(
            otra.correcciones.map((c) => `${c.accion} ${c.comment}`),
            [`actualizado ${REGLA_NAT_HTTP}`],
        )
        assert.equal(natHttp()!['to-addresses'], '198.51.100.8')
        assert.isUndefined(falso.tabla('/ip/firewall/address-list').find((o) => o.address === '198.51.100.7'))
    })

    test('FQDN que no resuelve: routeros.fallido, la regla que hubiera se conserva y el chequeo en rojo', async ({
        assert,
    }) => {
        dns.set('portal.isp.example', noExiste())
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.match(r.error_portal!, /No se pudo resolver portal\.isp\.example a IPv4.*el nombre no existe/)
        assert.match(r.error_portal!, /ROUTERS_SERVICIO_PORTAL_V4/)
        assert.isUndefined(natHttp())
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'routeros.fallido')
            .whereRaw(`(payload->>'router_id')::bigint = ?`, [routerId])
            .whereRaw(`payload->>'operacion' = 'resolver portal'`)
            .first()
        assert.isNotNull(evento)
        // Se audita aunque no haya corregido nada en el router
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'routeros.reconciliar', entidad_id: routerId })
            .first()
        assert.isNotNull(accion)

        const d = await diagnostico()
        assert.isFalse(d.ok)
        const portal = chequeo(d, 'portal_http')
        assert.isFalse(portal.ok)
        assert.equal(portal.codigo, 'portal_sin_ipv4')
        assert.match(portal.detalle, /No se pudo resolver portal\.isp\.example/)
        assert.match(portal.comandos[0]!, /^\/ip firewall nat add chain=argos-corte-nat .*action=dst-nat/)
        const reglas = chequeo(d, 'reglas')
        assert.equal(reglas.codigo, 'faltan_reglas')
        assert.include(reglas.detalle, REGLA_NAT_HTTP)
        assert.isNull(d.portal.alcanzable)
        assert.deepEqual(fetches(), [])

        // Con la regla puesta a mano (o por el script), un DNS caído no la borra.
        dns.set('portal.isp.example', ['198.51.100.7'])
        await reconciliar()
        dns.set('portal.isp.example', noExiste())
        const conservada = await reconciliar()
        assert.notInclude(
            conservada.correcciones.map((c) => c.comment),
            REGLA_NAT_HTTP,
        )
        assert.equal(natHttp()!['to-addresses'], '198.51.100.7')
        // y el diagnóstico prueba el destino que tiene el router
        const conRegla = await diagnostico()
        assert.equal(conRegla.portal.destino_nat, 'http://198.51.100.7:80/corte')
        assert.isTrue(chequeo(conRegla, 'portal_http').ok)
    })

    test('ROUTERS_SERVICIO_PORTAL_V4 manda sobre el DNS (IP pública distinta de la que ve el servidor)', async ({
        assert,
    }) => {
        process.env.ROUTERS_SERVICIO_PORTAL_V4 = '203.0.113.5'
        process.env.ROUTERS_SERVICIO_PORTAL_PUERTO = '8080'
        await reconciliar()
        assert.containsSubset(natHttp(), { 'to-addresses': '203.0.113.5', 'to-ports': '8080' })
        const d = await diagnostico()
        assert.equal(d.portal.origen, 'variable')
        assert.deepEqual(fetches(), ['http://203.0.113.5:8080/corte'])
    })

    test('NAT faltante o desactivada: falta_reglas y reglas_desactivadas con su comando', async ({
        assert,
    }) => {
        await reconciliar()
        falso.borrarAMano('/ip/firewall/nat', (o) => o.comment === REGLA_NAT_HTTP)
        const sin = await diagnostico()
        const reglas = chequeo(sin, 'reglas')
        assert.isFalse(reglas.ok)
        assert.equal(reglas.codigo, 'faltan_reglas')
        assert.isTrue(reglas.reconciliar)
        assert.include(
            reglas.comandos,
            '/ip firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat ' +
                'to-addresses=198.51.100.7 to-ports=80 comment="argosisp: corte-nat HTTP a /corte"',
        )
        // sin la regla en el router, el fetch prueba el destino deseado
        assert.equal(sin.portal.destino_nat, 'http://198.51.100.7:80/corte')
        assert.deepInclude(
            sin.problemas.map((p) => p.codigo),
            'faltan_reglas',
        )

        await reconciliar()
        natHttp()!.disabled = 'true'
        const apagada = await diagnostico()
        const r = chequeo(apagada, 'reglas')
        assert.equal(r.codigo, 'reglas_desactivadas')
        assert.deepEqual(r.comandos, [`/ip firewall nat enable [find comment="${REGLA_NAT_HTTP}"]`])
    })

    test('el destino del NAT responde 404 (no sirve /corte), 302 (redirección, vale) o no responde', async ({
        assert,
    }) => {
        await reconciliar()
        falso.respuestasFetch.set('198.51.100.7:80', '404, File not found')
        const d404 = await diagnostico()
        const portal = chequeo(d404, 'portal_http')
        assert.equal(portal.codigo, 'portal_sin_corte')
        assert.equal(d404.portal.http_status, 404)
        assert.match(portal.detalle, /cualquier encabezado Host/)
        assert.include(portal.comandos, '/tool fetch url="http://198.51.100.7:80/corte" output=none')

        falso.respuestasFetch.set('198.51.100.7:80', '302, Found')
        const d302 = await diagnostico()
        assert.isTrue(chequeo(d302, 'portal_http').ok)
        assert.equal(d302.portal.http_status, 302)

        falso.respuestasFetch.clear()
        falso.alcanzables = new Set(['otro.example'])
        const caido = await diagnostico()
        assert.equal(chequeo(caido, 'portal_http').codigo, 'portal_inalcanzable')
        assert.isFalse(caido.portal.alcanzable)
    })

    test('sesión suspendida fuera de la lista: cuántas faltan y cómo arreglarlo; dentro, en verde', async ({
        assert,
    }) => {
        await reconciliar()
        const ip = `${base}.77`
        const servicioId = await suspendidoPppoe(ip)
        const d = await diagnostico()
        const sesiones = chequeo(d, 'sesiones_suspendidas')
        assert.isFalse(sesiones.ok)
        assert.equal(sesiones.codigo, 'suspendidos_fuera_de_lista')
        assert.deepEqual(d.suspendidos, {
            total: 1,
            fuera_de_lista: 1,
            ejemplos: [{ servicio_id: servicioId, tipo_conexion: 'pppoe', ipv4: ip }],
        })
        assert.match(sesiones.detalle, /^1 de 1 suspendidos no están en la address-list «suspendidos»/)
        assert.deepEqual(sesiones.comandos, [`/ppp active remove [find address=${ip}]`])
        assert.isFalse(d.ok)

        // Lo que hace RouterOS con Mikrotik-Address-List: una entrada dinámica en la lista.
        falso.tabla('/ip/firewall/address-list').push({
            '.id': '*DD1',
            list: 'suspendidos',
            address: ip,
            dynamic: 'true',
            disabled: 'false',
        })
        const bien = await diagnostico()
        assert.isTrue(chequeo(bien, 'sesiones_suspendidas').ok)
        assert.equal(bien.suspendidos.fuera_de_lista, 0)
        assert.isTrue(bien.ok, JSON.stringify(bien.problemas))
    })

    test('sin suspendidos: la falta de la lista «suspendidos» no es un problema; con uno, sí', async ({
        assert,
    }) => {
        await reconciliar()
        falso.borrarAMano('/ip/firewall/address-list', (o) => o.list === 'suspendidos')
        const d = await diagnostico()
        const lista = chequeo(d, 'lista_suspendidos')
        assert.isTrue(lista.ok)
        assert.match(lista.detalle, /no hace falta: no hay nadie suspendido/)
        assert.isTrue(chequeo(d, 'sesiones_suspendidas').ok)
        assert.notInclude(
            d.problemas.map((p) => p.codigo),
            'falta_lista_suspendidos',
        )
        assert.isTrue(d.ok, JSON.stringify(d.problemas))

        await suspendidoPppoe(`${base}.78`)
        const con = await diagnostico()
        const falta = chequeo(con, 'lista_suspendidos')
        assert.equal(falta.codigo, 'falta_lista_suspendidos')
        assert.match(
            falta.comandos[0]!,
            /^\/ip firewall address-list add list=suspendidos address=192\.0\.2\.255/,
        )
    })

    test('FastTrack antes de los saltos de corte: chequeo fasttrack en rojo con los move', async ({
        assert,
    }) => {
        await reconciliar()
        const tabla = falso.tabla('/ip/firewall/filter')
        const i = tabla.findIndex((o) => o.comment === 'defconf: fasttrack')
        const [fast] = tabla.splice(i, 1)
        tabla.unshift(fast!)
        const d = await diagnostico()
        const f = chequeo(d, 'fasttrack')
        assert.isFalse(f.ok)
        assert.match(f.detalle, /FastTrack está antes de argosisp:top corte por address-list/)
        assert.include(
            f.comandos,
            '/ip firewall filter move [find comment="argosisp:top corte por address-list"] destination=([find where dynamic=no]->0)',
        )
        assert.equal(chequeo(d, 'reglas').codigo, 'reglas_desordenadas')
        await reconciliar()
        assert.isTrue(chequeo(await diagnostico(), 'fasttrack').ok)
    })

    test('«Probar conexión» suma el chequeo corte con el diagnóstico completo', async ({ assert }) => {
        const probar = () =>
            new ProbarConexion({ clientes: fabrica, resolver }).execute(
                { router_id: routerId },
                contextoPrueba(),
            )
        const antes = await probar()
        const corte = antes.chequeos.find((c) => c.clave === 'corte')!
        assert.isFalse(corte.ok)
        assert.isFalse(antes.ok)
        assert.isNotNull(corte.corte)
        assert.include(corte.detalle, 'Faltan')

        await reconciliar()
        const despues = await probar()
        const ok = despues.chequeos.find((c) => c.clave === 'corte')!
        assert.isTrue(ok.ok, ok.detalle)
        assert.match(ok.detalle, /^Corte listo/)
        assert.lengthOf(ok.corte!.limites, 3)
    })
})
