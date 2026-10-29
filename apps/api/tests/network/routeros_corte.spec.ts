import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { diagnosticoCorte, vistaPreviaReconciliar } from '#network/routeros/diagnostico'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { ENTRADA_SUSPENDIDOS } from '#network/routeros/corte_router'
import type { ObjetoRouterOS, RutaRouterOS } from '#network/routeros/cliente'

/**
 * Corte de nivel router (`contratos/control-velocidad.md` §10): el reconciliador deja en un router
 * «virgen» la lista de interfaces, el perfil `suspendido`, las listas del portal y del walled garden, las
 * reglas `argosisp:top` al inicio (antes de FastTrack) y las cadenas de corte y NAT, con los mismos
 * comentarios que `lab.rsc`. Correr dos veces no cambia nada; un orden roto se corrige con `move`.
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

const ENTORNO = {
    ROUTERS_SERVICIO_PORTAL_V4: '192.0.2.20',
    ROUTERS_SERVICIO_PORTAL_V6: '2001:db8:ffff::20',
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: 'app.recurrente.com',
    ROUTERS_SERVICIO_DNS_V4: '192.0.2.53',
    ROUTERS_SERVICIO_CLIENTES_V4: '10.10.0.0/16',
    PORTAL_URL_PUBLICA: 'http://portal.argosisp.example/corte',
}

test.group('RouterOS · corte de nivel router', (group) => {
    let falso: RouterOSFalso
    let routerId: number
    let red: string
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
        red = `${esc.base}.0/24`
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
        // Como un router con defconf: FastTrack y accept established al inicio de forward.
        falso.tabla('/ip/firewall/filter').push(
            {
                '.id': '*D0',
                chain: 'forward',
                action: 'passthrough',
                comment: 'special dummy rule to show fasttrack counters',
                dynamic: 'true',
            },
            {
                '.id': '*F1',
                chain: 'forward',
                action: 'fasttrack-connection',
                'connection-state': 'established,related',
                comment: 'defconf: fasttrack',
            },
            {
                '.id': '*F2',
                chain: 'forward',
                action: 'accept',
                'connection-state': 'established,related',
                comment: 'defconf: accept established',
            },
        )
        return async () => {
            for (const [k, v] of Object.entries(previo)) {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            await falso.cerrar()
        }
    })

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())
    const comentarios = (ruta: RutaRouterOS) =>
        falso
            .tabla(ruta)
            .filter((o: ObjetoRouterOS) => o.dynamic !== 'true')
            .map((o) => o.comment ?? '')

    test('router virgen: termina con el corte puesto y los saltos antes de FastTrack', async ({ assert }) => {
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.isDefined(falso.tabla('/interface/list').find((o) => o.name === 'suspendidos'))
        assert.containsSubset(
            falso.tabla('/ppp/profile').find((o) => o.name === 'suspendido'),
            { 'rate-limit': '256k/256k', 'address-list': 'suspendidos', 'interface-list': 'suspendidos' },
        )
        const lista4 = falso.tabla('/ip/firewall/address-list')
        assert.containsSubset(lista4, [
            { list: 'suspendidos', address: ENTRADA_SUSPENDIDOS },
            { list: 'argos-portal', address: '192.0.2.20', comment: 'argosisp: portal IP' },
            { list: 'argos-portal', address: 'portal.argosisp.example' },
            { list: 'argos-walled', address: 'app.recurrente.com' },
            { list: 'argos-dns', address: '192.0.2.53' },
            { list: 'argos-clientes', address: '10.10.0.0/16' },
            { list: 'argos-clientes', address: red, comment: 'argosisp: clientes WISP' },
        ])
        // Los saltos van al inicio (antes de defconf), en el orden de lab.rsc.
        const filtro = comentarios('/ip/firewall/filter')
        assert.deepEqual(filtro.slice(0, 7), [
            'argosisp:top corte input por address-list',
            'argosisp:top corte input por interface-list',
            'argosisp:top corte por address-list',
            'argosisp:top corte por interface-list',
            'argosisp:top Filter-Id de RADIUS/CoA',
            'argosisp:top sin fasttrack: clientes con colas (subida)',
            'argosisp:top sin fasttrack: clientes con colas (bajada)',
        ])
        assert.isBelow(
            filtro.indexOf('argosisp:top sin fasttrack: clientes con colas (bajada)'),
            filtro.indexOf('defconf: fasttrack'),
        )
        assert.isAbove(filtro.indexOf('argosisp: corte portal'), filtro.indexOf('argosisp: corte DNS tcp'))
        assert.isBelow(filtro.indexOf('argosisp: corte portal'), filtro.indexOf('argosisp: corte TCP reset'))
        assert.includeMembers(comentarios('/ipv6/firewall/filter'), [
            'argosisp: corte-in ICMPv6',
            'argosisp: corte-in DHCPv6',
        ])
        const nat = falso.tabla('/ip/firewall/nat')
        assert.deepEqual(
            nat.slice(0, 2).map((o) => o.comment),
            ['argosisp:top corte NAT por address-list', 'argosisp:top corte NAT por interface-list'],
        )
        assert.containsSubset(nat, [
            {
                comment: 'argosisp: corte-nat HTTP a /corte',
                action: 'dst-nat',
                'to-addresses': '192.0.2.20',
                'to-ports': '80',
            },
        ])
        // Cada comando quedó en audit.red
        const filas = await db.from('audit.red').where('router_id', routerId).where('tipo', 'routeros')
        assert.isAbove(filas.length, 40)
        assert.isTrue(filas.some((f) => f.comando.comando === 'move'))
    })

    test('dos veces seguidas: la segunda no cambia nada', async ({ assert }) => {
        await reconciliar()
        const escrituras = falso.escrituras.length
        const otra = await reconciliar()
        assert.deepEqual(
            otra.correcciones.map((c) => `${c.accion} ${c.ruta} ${c.comment}`),
            [],
        )
        assert.equal(falso.escrituras.length, escrituras)
    })

    test('un salto movido a mano detrás de FastTrack vuelve al inicio; lo borrado a mano se repone', async ({
        assert,
    }) => {
        await reconciliar()
        const tabla = falso.tabla('/ip/firewall/filter')
        const salto = tabla.findIndex((o) => o.comment === 'argosisp:top corte por address-list')
        const [regla] = tabla.splice(salto, 1)
        tabla.push(regla!)
        falso.borrarAMano('/ip/firewall/filter', (o) => o.comment === 'argosisp: corte portal')
        const r = await reconciliar()
        assert.includeMembers(
            r.correcciones.map((c) => `${c.accion} ${c.comment}`),
            ['creado argosisp: corte portal', 'movido argosisp:top corte por address-list'],
        )
        const filtro = comentarios('/ip/firewall/filter')
        assert.equal(filtro[2], 'argosisp:top corte por address-list')
        assert.isBelow(
            filtro.indexOf('argosisp: corte portal'),
            filtro.indexOf('argosisp: corte walled garden'),
        )
    })

    test('lo que dejó lab.rsc no se toca; sin FastTrack en la estrategia se quitan sus dos accept', async ({
        assert,
    }) => {
        await reconciliar()
        // Una regla del script que no es de ArgosIsp (CoA desde aaa) queda arriba y no se mueve.
        falso.tabla('/ip/firewall/filter').unshift({
            '.id': '*AA',
            chain: 'input',
            action: 'accept',
            protocol: 'udp',
            'dst-port': '3799',
            comment: 'argosisp:top CoA desde aaa nodo 1',
            dynamic: 'false',
        })
        const fila = await db.from('network.routers').where('id', routerId).firstOrFail()
        const sin = fila.estrategia_velocidad
        for (const tipo of ['pppoe', 'ip_estatica', 'dhcp_fija']) sin[tipo].extras.excluir_fasttrack = false
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ estrategia_velocidad: JSON.stringify(sin) })
        const r = await reconciliar()
        assert.sameMembers(
            r.correcciones.map((c) => `${c.accion} ${c.comment}`),
            [
                'borrado argosisp:top sin fasttrack: clientes con colas (subida)',
                'borrado argosisp:top sin fasttrack: clientes con colas (bajada)',
                'borrado argosisp:top sin fasttrack: clientes con colas (subida)',
                'borrado argosisp:top sin fasttrack: clientes con colas (bajada)',
            ],
        )
        assert.equal(comentarios('/ip/firewall/filter')[0], 'argosisp:top CoA desde aaa nodo 1')
    })

    test('diagnóstico de corte: en un router virgen dice qué falta y que «Reconciliar ahora» lo arregla', async ({
        assert,
    }) => {
        const antes = await diagnosticoCorte(routerId, OPCIONES)
        assert.isFalse(antes.ok)
        const codigos = antes.problemas.map((p) => p.codigo)
        assert.includeMembers(codigos, [
            'faltan_reglas',
            'fasttrack',
            'falta_perfil_suspendido',
            'walled_garden',
        ])
        // Sin nadie suspendido, que no exista la lista no es un problema (antes daba un falso positivo).
        assert.notInclude(codigos, 'falta_lista_suspendidos')
        assert.match(
            antes.problemas.find((p) => p.codigo === 'faltan_reglas')!.mensaje,
            /incluir configuración de servicio/,
        )
        assert.isTrue(antes.problemas.every((p) => p.reconciliar))
        assert.isTrue(antes.portal.alcanzable)
        // La vista previa de «Reconciliar» muestra los mismos objetos de nivel router, sin escribir.
        const escrituras = falso.escrituras.length
        const vista = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.isNull(vista.error)
        assert.isTrue(vista.cambios.some((c) => c.grupo === 'corte' && c.clave === 'argosisp: corte portal'))
        assert.equal(falso.escrituras.length, escrituras)

        await reconciliar()
        const despues = await diagnosticoCorte(routerId, OPCIONES)
        assert.deepEqual(despues.problemas, [])
        assert.isTrue(despues.ok)
        const otra = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.lengthOf(otra.cambios, 0)
    })

    test('diagnóstico de corte: el router no llega al portal (p. ej. Argos en WSL)', async ({ assert }) => {
        await reconciliar()
        falso.alcanzables = new Set(['otro.example'])
        const d = await diagnosticoCorte(routerId, OPCIONES)
        assert.isFalse(d.portal.alcanzable)
        const problema = d.problemas.find((p) => p.codigo === 'portal_inalcanzable')!
        assert.match(
            problema.mensaje,
            /El router no llega a http:\/\/192\.0\.2\.20:80\/corte \(destino del NAT de corte\)/,
        )
        assert.match(problema.mensaje, /mirrored/)
        assert.isFalse(problema.reconciliar)
        // El /tool/fetch quedó en audit.red
        const fila = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'ruta' = '/tool/fetch'`)
            .orderBy('id', 'desc')
            .first()
        assert.isFalse(fila.ok)
    })
})
