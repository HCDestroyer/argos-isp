import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { RouterOSFalso, type Paquete } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { diagnosticoCorte, vistaPreviaReconciliar } from '#network/routeros/diagnostico'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import {
    COLA_ANCLA,
    COLA_BYPASS,
    COMMENT_COLA_ANCLA,
    COMMENT_COLA_BYPASS,
    configCorte,
    estadoCorteRouter,
    LISTA_BYPASS,
    MARCA_BYPASS,
    PREFIJO_MANGLE_BYPASS,
    PUERTO_PROXY_CORTE,
} from '#network/routeros/corte_router'
import { commentServicio } from '#network/routeros/estado_deseado'
import IniciarSesion from '#network/sesiones/actions/iniciar_sesion'
import type { Aplicacion, Estrategia } from '#network/estrategia_velocidad'
import type { ObjetoRouterOS } from '#network/routeros/cliente'

/**
 * Bypass del portal de corte (pedido del PM: «si está suspendido la página de corte debe tener un bypass
 * para que vaya rápido»). El tráfico entre un suspendido y el portal (IPv4, IPv6, FQDN, URL de corte de la
 * empresa y el proxy 3346 del router en modo código) cae en una cola simple sin límite, antes de la cola
 * del suspendido; lo demás del suspendido sigue en su cola de 2M/2M y el firewall lo corta igual.
 *
 * Con el RouterOS falso se recorre cada paquete por el mangle y las colas simples en orden (gana la primera
 * que coincide), en cada modo de control de velocidad y con RADIUS o sin él (`api`).
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

const PORTAL_V4 = '192.0.2.20'
const PORTAL_V6 = '2001:db8:ffff::20'
const ENTORNO = {
    ROUTERS_SERVICIO_PORTAL_V4: PORTAL_V4,
    ROUTERS_SERVICIO_PORTAL_V6: PORTAL_V6,
    ROUTERS_SERVICIO_PORTAL_FQDN: 'portal.argosisp.example',
    ROUTERS_SERVICIO_WALLED_GARDEN: 'app.recurrente.com',
    ROUTERS_SERVICIO_DNS_V4: '',
    ROUTERS_SERVICIO_CLIENTES_V4: '',
    ROUTERS_SERVICIO_CLIENTES_V6: '',
    PORTAL_URL_PUBLICA: 'http://portal.argosisp.example/corte',
}

const EXTRAS = { rafaga: true, prioridad: true, garantizado: true, excluir_fasttrack: true, qos: false }
const e = (aplicacion: Aplicacion): Estrategia => ({
    aplicacion,
    padre: 'ninguno',
    tipo_cola: aplicacion === 'pcq_plan' || aplicacion === 'arbol_pcq' ? 'pcq' : 'default',
    extras: { ...EXTRAS },
})

type Tipo = 'pppoe' | 'ip_estatica'
type Modo = 'radius' | 'api'

test.group('RouterOS · bypass del portal de corte', (group) => {
    let falso: RouterOSFalso
    let tokenAdmin: string
    let routerId: number
    let base: string
    let raiz: string
    let clienteId: number
    const previo: Record<string, string | undefined> = {}

    group.each.setup(async () => {
        for (const [k, v] of Object.entries(ENTORNO)) {
            previo[k] = process.env[k]
            process.env[k] = v
        }
        falso = new RouterOSFalso()
        await falso.levantar()
        falso.dnsRouter.set('portal.argosisp.example', [PORTAL_V4, PORTAL_V6])
        falso.dnsRouter.set('app.recurrente.com', ['203.0.113.80'])
        ;({ token: tokenAdmin } = await usuarioConRoles(['admin']))
        ;({ routerId, base, raiz } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                nas_ip: `127.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
                capacidad_bajada_kbps: 1_000_000,
                capacidad_subida_kbps: 500_000,
            })
        clienteId = await crearClienteFila()
        return async () => {
            for (const [k, v] of Object.entries(previo)) {
                if (v === undefined) delete process.env[k]
                else process.env[k] = v
            }
            await db.from('core.empresas').whereNotNull('url_corte').update({ url_corte: null })
            await falso.cerrar()
        }
    })

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())

    async function estrategia(client: any, pppoe: Estrategia, wisp: Estrategia) {
        const router = await db.from('network.routers').where('id', routerId).firstOrFail()
        await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(tokenAdmin)
                .json({
                    version: router.version,
                    estrategia_velocidad: { pppoe, ip_estatica: wisp, dhcp_fija: wisp },
                }),
            200,
        )
    }

    let ip = 10
    /** Servicio directo en la base (con su IPv4 en la red del router). */
    async function servicio(planId: number, tipo: Tipo, estadoServicio: 'activo' | 'suspendido') {
        const userPpp = tipo === 'pppoe' ? unico('ppp') : null
        const ipv4 = `${base}.${ip++}`
        const filaRed = await db.from('network.redes_ipv4').where('router_id', routerId).firstOrFail()
        const red = filaRed.id
        let id = 0
        await db.transaction(async (trx) => {
            const [fila] = await trx
                .table('core.servicios')
                .insert({
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    tipo_conexion: tipo,
                    estado: estadoServicio,
                    ipv6_modo: 'ninguno',
                    ...(userPpp ? { user_ppp: userPpp, pass_ppp: cifrar('clave-larga-1') } : {}),
                })
                .returning('id')
            id = Number(fila.id)
            await trx.table('network.ipv4_asignaciones').insert({ servicio_id: id, ip: ipv4, red_id: red })
        })
        return { id, userPpp, ipv4 }
    }

    /** La sesión PPPoE del suspendido entra con el perfil de corte (RADIUS: `Mikrotik-Group`; api: el secret). */
    const conectarSuspendido = (s: { userPpp: string | null; ipv4: string }) =>
        falso.conectarPpp({ usuario: s.userPpp!, perfil: 'suspendido', address: s.ipv4 })

    const nombre = (o: ObjetoRouterOS | null) => o?.name ?? null
    const chequeoBypass = (d: Awaited<ReturnType<typeof diagnosticoCorte>>) => d.chequeos

    // Cada modo de control de velocidad válido para cada tipo de conexión y cada modo del router.
    const CASOS: Array<{ modo: Modo; tipo: Tipo; aplicacion: Aplicacion }> = [
        ...(['radius_rate_limit', 'perfil_ppp', 'cola_simple', 'pcq_plan', 'arbol_pcq'] as const).map(
            (aplicacion) => ({ modo: 'radius' as const, tipo: 'pppoe' as const, aplicacion }),
        ),
        ...(['perfil_ppp', 'cola_simple', 'arbol_pcq'] as const).map((aplicacion) => ({
            modo: 'api' as const,
            tipo: 'pppoe' as const,
            aplicacion,
        })),
        ...(['cola_simple', 'pcq_plan', 'arbol_pcq'] as const).map((aplicacion) => ({
            modo: 'radius' as const,
            tipo: 'ip_estatica' as const,
            aplicacion,
        })),
    ]

    for (const { modo, tipo, aplicacion } of CASOS) {
        test(`${modo} · ${tipo} con ${aplicacion}: el suspendido llega al portal sin límite y lo demás sigue limitado`, async ({
            client,
            assert,
        }) => {
            if (modo === 'api') {
                await db
                    .from('network.routers')
                    .where('id', routerId)
                    .update({ modo_seguridad: 'api', nas_ip: null, radius_secret: null })
            }
            const otro = e(aplicacion === 'arbol_pcq' ? 'cola_simple' : 'arbol_pcq')
            await estrategia(
                client,
                tipo === 'pppoe' ? e(aplicacion) : otro,
                tipo === 'pppoe' ? otro : e(aplicacion),
            )
            const plan = await crearPlanFila({
                bajada_kbps: 20000,
                subida_kbps: 5000,
                bajada_limitada_kbps: 2000,
                subida_limitada_kbps: 1000,
            })
            const activo = await servicio(plan, tipo, 'activo')
            const suspendido = await servicio(plan, tipo, 'suspendido')
            // Una cola y una marca del operador: no se tocan y el bypass queda antes que su cola. (En WISP la
            // cola estática del servicio se agrega al final, como siempre: una cola amplia del operador le
            // ganaría; eso no cambia con el bypass y no se prueba aquí.)
            if (tipo === 'pppoe') {
                falso.tabla('/queue/simple').push({
                    '.id': '*OP1',
                    name: 'total-clientes',
                    target: `${base}.0/24`,
                    'max-limit': '100M/100M',
                    dynamic: 'false',
                    disabled: 'false',
                })
            }
            falso.tabla('/ip/firewall/mangle').push({
                '.id': '*OP2',
                chain: 'forward',
                action: 'change-mss',
                'new-mss': 'clamp-to-pmtu',
                protocol: 'tcp',
                comment: 'mss del operador',
                dynamic: 'false',
                disabled: 'false',
            })

            const r = await reconciliar()
            assert.isNull(r.error)
            assert.deepEqual(r.errores, [])

            // Mangle al inicio (IPv4 e IPv6), con la marca y `passthrough=yes`; la regla del operador queda.
            const mangle = falso.tabla('/ip/firewall/mangle')
            assert.isTrue((mangle[0]!.comment ?? '').startsWith(PREFIJO_MANGLE_BYPASS))
            assert.isDefined(mangle.find((o) => o.comment === 'mss del operador'))
            for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
                const propias = falso
                    .tabla(ruta)
                    .filter((o) => (o.comment ?? '').startsWith(PREFIJO_MANGLE_BYPASS))
                assert.lengthOf(propias, 4)
                for (const o of propias) {
                    assert.containsSubset(o, {
                        action: 'mark-packet',
                        'new-packet-mark': MARCA_BYPASS,
                        passthrough: 'true',
                    })
                    // Nunca marca tráfico que no vaya o venga del portal.
                    assert.isTrue(
                        o['dst-address-list'] === LISTA_BYPASS || o['src-address-list'] === LISTA_BYPASS,
                    )
                }
            }
            // Colas: el bypass y el ancla antes de todo lo estático; el perfil de corte inserta antes del ancla.
            const estaticas = falso.tabla('/queue/simple').filter((o) => o.dynamic !== 'true')
            assert.deepEqual(
                estaticas.slice(0, 2).map((o) => o.comment),
                [COMMENT_COLA_BYPASS, COMMENT_COLA_ANCLA],
            )
            const bypass = estaticas[0]!
            assert.containsSubset(bypass, {
                name: COLA_BYPASS,
                'packet-marks': MARCA_BYPASS,
                'max-limit': '0/0',
                target: `${base}.0/24,${raiz}00::/40`,
            })
            assert.equal(
                falso.tabla('/ppp/profile').find((p) => p.name === 'suspendido')!['insert-queue-before'],
                COLA_ANCLA,
            )
            assert.sameMembers(
                falso
                    .tabla('/ip/firewall/address-list')
                    .filter((o) => o.list === LISTA_BYPASS)
                    .map((o) => o.address),
                [PORTAL_V4, 'portal.argosisp.example'],
            )

            // La sesión del suspendido entra con el perfil de corte: su cola dinámica va después del bypass.
            const iface = tipo === 'pppoe' ? conectarSuspendido(suspendido) : undefined
            const ifaceActivo =
                tipo === 'pppoe'
                    ? falso.conectarPpp({
                          usuario: activo.userPpp!,
                          perfil: 'default',
                          address: activo.ipv4,
                          rateLimit: '5M/20M',
                      })
                    : undefined
            const colaSuspendido =
                tipo === 'pppoe' ? `<pppoe-${suspendido.userPpp}>` : `argosisp-servicio-${suspendido.id}`
            if (tipo !== 'pppoe') {
                assert.lengthOf(falso.conComment('/queue/simple', commentServicio(suspendido.id)), 1)
            }
            const colas = falso.tabla('/queue/simple').map((o) => o.name)
            assert.isBelow(colas.indexOf(COLA_BYPASS), colas.indexOf(colaSuspendido))
            // PPPoE: entre el bypass y el ancla, por delante de las colas del operador (como hasta hoy).
            if (tipo === 'pppoe') {
                assert.isBelow(colas.indexOf(colaSuspendido), colas.indexOf(COLA_ANCLA))
                assert.isBelow(colas.indexOf(colaSuspendido), colas.indexOf('total-clientes'))
            }

            const sube = (dst: string, extra: Partial<Paquete> = {}): Paquete => ({
                cadena: 'forward',
                src: suspendido.ipv4,
                dst,
                entrada: iface,
                salida: 'ether1',
                ...extra,
            })
            const baja = (src: string): Paquete => ({
                cadena: 'forward',
                src,
                dst: suspendido.ipv4,
                entrada: 'ether1',
                salida: iface ?? 'ether-clientes',
            })
            // Al portal (IP y por el FQDN que resuelve el router) y de vuelta: cola sin límite, fuera del árbol.
            for (const p of [sube(PORTAL_V4, { puertoDestino: 80, dstnat: true }), baja(PORTAL_V4)]) {
                const camino = falso.recorrer(p)
                assert.equal(camino.marca, MARCA_BYPASS)
                assert.equal(nombre(camino.cola), COLA_BYPASS)
                assert.isNull(camino.arbol)
            }
            // DNS y walled garden: la cola del suspendido (2M/2M), como hoy.
            for (const p of [
                sube('8.8.8.8', { protocolo: 'udp', puertoDestino: 53 }),
                sube('203.0.113.80', { puertoDestino: 443 }),
                baja('203.0.113.80'),
            ]) {
                const camino = falso.recorrer(p)
                assert.isNull(camino.marca)
                assert.equal(nombre(camino.cola), colaSuspendido)
            }
            // Internet: sin marca (el firewall lo rechaza; el bypass nunca lo toca).
            assert.isNull(falso.recorrer(sube('1.1.1.1', { puertoDestino: 443 })).marca)
            // El activo hacia el portal no lleva la marca: el bypass es solo del suspendido.
            const delActivo = falso.recorrer({
                cadena: 'forward',
                src: activo.ipv4,
                dst: PORTAL_V4,
                entrada: ifaceActivo,
                salida: 'ether1',
            })
            assert.notEqual(delActivo.marca, MARCA_BYPASS)
            assert.notEqual(nombre(delActivo.cola), COLA_BYPASS)

            // Una segunda pasada no escribe nada (las colas dinámicas no se mueven).
            const escrituras = falso.escrituras.length
            const otra = await reconciliar()
            assert.deepEqual(otra.correcciones, [])
            assert.equal(falso.escrituras.length, escrituras)
            // El diagnóstico de corte lo ve en verde.
            const d = await diagnosticoCorte(routerId, OPCIONES)
            assert.containsSubset(
                d.chequeos.find((c) => c.clave === 'bypass_portal'),
                { ok: true, codigo: null },
            )
        })
    }

    test('modo código: el proxy de corte del router (3346) también va sin límite, IPv4 e IPv6', async ({
        assert,
    }) => {
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'codigo' })
        const plan = await crearPlanFila()
        const s = await servicio(plan, 'pppoe', 'suspendido')
        const r = await reconciliar()
        assert.isNull(r.error)
        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
            assert.containsSubset(falso.tabla(ruta), [
                {
                    comment: `${PREFIJO_MANGLE_BYPASS} proxy de corte entrada`,
                    chain: 'input',
                    'dst-port': PUERTO_PROXY_CORTE,
                    'connection-nat-state': 'dstnat',
                },
                {
                    comment: `${PREFIJO_MANGLE_BYPASS} proxy de corte salida`,
                    chain: 'output',
                    'src-port': PUERTO_PROXY_CORTE,
                    'connection-nat-state': 'dstnat',
                },
            ])
        }
        const iface = conectarSuspendido(s)
        const gateway = `${base}.1`
        // Cliente → proxy (input) y respuesta del proxy (output): sin límite.
        const entrada = falso.recorrer({
            cadena: 'input',
            src: s.ipv4,
            dst: gateway,
            entrada: iface,
            puertoDestino: 3346,
            dstnat: true,
        })
        const salida = falso.recorrer({
            cadena: 'output',
            src: gateway,
            dst: s.ipv4,
            salida: iface,
            puertoOrigen: 3346,
            dstnat: true,
        })
        assert.equal(nombre(entrada.cola), COLA_BYPASS)
        assert.equal(nombre(salida.cola), COLA_BYPASS)
        // DNS al router (input, 53) sigue en la cola del suspendido; una conexión directa al 3346 tampoco se marca.
        const dns = falso.recorrer({
            cadena: 'input',
            src: s.ipv4,
            dst: gateway,
            entrada: iface,
            protocolo: 'udp',
            puertoDestino: 53,
        })
        assert.equal(nombre(dns.cola), `<pppoe-${s.userPpp}>`)
        assert.isNull(
            falso.recorrer({
                cadena: 'input',
                src: s.ipv4,
                dst: gateway,
                entrada: iface,
                puertoDestino: 3346,
            }).marca,
        )
        // El tramo del router al portal (si el proxy saliera) no pasa por la cola del cliente.
        assert.isNull(
            falso.recorrer({ cadena: 'output', src: gateway, dst: PORTAL_V4, salida: 'ether1' }).cola,
        )
        // Al volver a modo ip se retiran las marcas del 3346 (y nada más del bypass).
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })
        const vuelta = await reconciliar()
        assert.includeMembers(
            vuelta.correcciones.filter((c) => c.accion === 'borrado').map((c) => c.comment),
            [
                `${PREFIJO_MANGLE_BYPASS} proxy de corte entrada`,
                `${PREFIJO_MANGLE_BYPASS} proxy de corte salida`,
            ],
        )
        assert.lengthOf(
            falso
                .tabla('/ip/firewall/mangle')
                .filter((o) => (o.comment ?? '').startsWith(PREFIJO_MANGLE_BYPASS)),
            4,
        )
    })

    test('IPv6 y URL de corte de la empresa: el portal por IPv6 y el host de la URL de corte van sin límite', async ({
        assert,
    }) => {
        await db
            .from('core.empresas')
            .where('id', 1)
            .update({ url_corte: 'https://pagos.miisp.example/aviso' })
        falso.dnsRouter.set('pagos.miisp.example', ['198.51.100.7', '2001:db8:77::7'])
        const plan = await crearPlanFila()
        const s = await servicio(plan, 'ip_estatica', 'suspendido')
        const prefijo = `${raiz}10:100::/56`
        await reconciliar()
        assert.sameMembers(
            falso
                .tabla('/ipv6/firewall/address-list')
                .filter((o) => o.list === LISTA_BYPASS)
                .map((o) => o.address),
            [PORTAL_V6, 'portal.argosisp.example', 'pagos.miisp.example'],
        )
        // El WISP suspendido con IPv6: su prefijo en `suspendidos` (como lo pone el dispatcher).
        falso.tabla('/ipv6/firewall/address-list').push({
            '.id': '*V6S',
            list: 'suspendidos',
            address: prefijo,
            comment: `argosisp:servicio:${s.id}:delegado`,
            dynamic: 'false',
            disabled: 'false',
        })
        const cliente6 = `${raiz}10:100::2`
        for (const p of [
            { cadena: 'forward' as const, src: cliente6, dst: PORTAL_V6 },
            { cadena: 'forward' as const, src: PORTAL_V6, dst: cliente6 },
            { cadena: 'forward' as const, src: '2001:db8:77::7', dst: cliente6 },
            { cadena: 'forward' as const, src: s.ipv4, dst: '198.51.100.7' },
        ]) {
            assert.equal(nombre(falso.recorrer(p).cola), COLA_BYPASS, `${p.src} → ${p.dst}`)
        }
        assert.notEqual(
            nombre(falso.recorrer({ cadena: 'forward', src: cliente6, dst: '2001:4860::8888' }).cola),
            COLA_BYPASS,
        )
        // Al quitar la URL de corte, su host sale de la lista.
        await db.from('core.empresas').where('id', 1).update({ url_corte: null })
        await reconciliar()
        assert.notInclude(
            falso
                .tabla('/ip/firewall/address-list')
                .filter((o) => o.list === LISTA_BYPASS)
                .map((o) => o.address),
            'pagos.miisp.example',
        )
    })

    test('diagnóstico «bypass del portal»: falta, sesiones con la cola antes, IP fuera de red y vista previa', async ({
        assert,
    }) => {
        const plan = await crearPlanFila()
        const s = await servicio(plan, 'pppoe', 'suspendido')
        const { nas_ip: nasIp } = await db.from('network.routers').where('id', routerId).firstOrFail()
        // Un router con el corte del script viejo: perfil suspendido sin insert-queue-before ni bypass.
        falso.tabla('/ppp/profile').push({
            '.id': '*P1',
            name: 'suspendido',
            'rate-limit': '2M/2M',
            'address-list': 'suspendidos',
            'interface-list': 'suspendidos',
            comment: 'argosisp: servicio suspendido',
            dynamic: 'false',
            disabled: 'false',
        })
        const antes = await diagnosticoCorte(routerId, OPCIONES)
        const chequeo = antes.chequeos.find((c) => c.clave === 'bypass_portal')!
        assert.containsSubset(chequeo, { ok: false, codigo: 'bypass_portal', reconciliar: true })
        assert.match(chequeo.detalle, /el corte del firewall no cambia/)
        assert.isTrue(chequeo.comandos.some((c) => c.includes(`insert-queue-before=${COLA_ANCLA}`)))
        const vista = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.includeMembers(
            vista.cambios.filter((c) => c.grupo === 'corte').map((c) => c.clave),
            [COMMENT_COLA_BYPASS, COMMENT_COLA_ANCLA, `${PREFIJO_MANGLE_BYPASS} subida por address-list`],
        )
        // La sesión entró antes de reconciliar: su cola dinámica quedó arriba de todo.
        conectarSuspendido(s)
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: nasIp,
                acct_session_id: unico('ses'),
                user_ppp: s.userPpp!,
                ipv4: s.ipv4,
                prefijo_enlace_v6: null,
                prefijo_delegado_v6: null,
                bytes_in: '0',
                bytes_out: '0',
                duracion_s: null,
                causa_fin: null,
                evento_en: new Date().toISOString(),
            },
            contextoPrueba(),
        )
        await reconciliar()
        const sesionAntes = chequeoBypass(await diagnosticoCorte(routerId, OPCIONES)).find(
            (c) => c.clave === 'bypass_portal',
        )!
        assert.containsSubset(sesionAntes, { ok: false, codigo: 'bypass_sesiones_antes', reconciliar: false })
        assert.deepEqual(sesionAntes.comandos, [`/ppp active remove [find name=${s.userPpp}]`])
        assert.notEqual(
            nombre(
                falso.recorrer({
                    cadena: 'forward',
                    src: s.ipv4,
                    dst: PORTAL_V4,
                    entrada: `<pppoe-${s.userPpp}>`,
                }).cola,
            ),
            COLA_BYPASS,
        )
        // Al reconectar entra después del bypass.
        falso.borrarAMano('/queue/simple', (o) => o.name === `<pppoe-${s.userPpp}>`)
        conectarSuspendido(s)
        assert.equal(
            nombre(
                falso.recorrer({
                    cadena: 'forward',
                    src: s.ipv4,
                    dst: PORTAL_V4,
                    entrada: `<pppoe-${s.userPpp}>`,
                }).cola,
            ),
            COLA_BYPASS,
        )
        const verde = chequeoBypass(await diagnosticoCorte(routerId, OPCIONES)).find(
            (c) => c.clave === 'bypass_portal',
        )!
        assert.isTrue(verde.ok)
        const vistaFinal = await vistaPreviaReconciliar(routerId, OPCIONES)
        assert.lengthOf(vistaFinal.cambios, 0)

        // Una sesión con una IP fuera de las redes del router: el bypass no la toma y lo dice.
        await new IniciarSesion().execute(
            {
                tipo: 'Start',
                nas_ip: nasIp,
                acct_session_id: unico('ses'),
                user_ppp: s.userPpp!,
                ipv4: '100.64.9.9',
                prefijo_enlace_v6: null,
                prefijo_delegado_v6: null,
                bytes_in: '0',
                bytes_out: '0',
                duracion_s: null,
                causa_fin: null,
                evento_en: new Date().toISOString(),
            },
            contextoPrueba(),
        )
        const fuera = chequeoBypass(await diagnosticoCorte(routerId, OPCIONES)).find(
            (c) => c.clave === 'bypass_portal',
        )!
        assert.containsSubset(fuera, { ok: false, codigo: 'bypass_fuera_de_red' })
        assert.match(fuera.detalle, /100\.64\.9\.9/)
    })

    test('sin redes de clientes no hay cola del bypass (ni marcas), pero sí el ancla del perfil', async ({
        assert,
    }) => {
        const corte = estadoCorteRouter(configCorte(process.env), { fasttrack: false, redes_v4: [] }, [])
        const comentarios = corte.reglas.map((r) => r.comment)
        assert.include(comentarios, COMMENT_COLA_ANCLA)
        assert.notInclude(comentarios, COMMENT_COLA_BYPASS)
        assert.isFalse(comentarios.some((c) => c.startsWith(PREFIJO_MANGLE_BYPASS)))
        assert.isTrue(corte.avisos.some((a) => a.includes('no se crea el bypass del portal')))
        const perfil = corte.nombrados.find((n) => n.ruta === '/ppp/profile')!
        assert.equal(perfil.propiedades['insert-queue-before'], COLA_ANCLA)
    })

    test('el ancla no se pudo crear: el perfil de corte se escribe igual, sin insert-queue-before', async ({
        assert,
    }) => {
        // Una cola del operador con el nombre del ancla (RouterOS: «already have such name»).
        falso.tabla('/queue/simple').push({
            '.id': '*OP9',
            name: COLA_ANCLA,
            target: '10.255.255.1/32',
            dynamic: 'false',
            disabled: 'false',
        })
        const r = await reconciliar()
        assert.isNull(r.error)
        assert.isTrue(r.errores.some((x) => x.operacion.includes(COMMENT_COLA_ANCLA)))
        const perfil = falso.tabla('/ppp/profile').find((p) => p.name === 'suspendido')!
        assert.equal(perfil['address-list'], 'suspendidos')
        assert.isUndefined(perfil['insert-queue-before'])
        // La cola ajena no se tocó.
        assert.equal(falso.tabla('/queue/simple').find((o) => o['.id'] === '*OP9')!.target, '10.255.255.1/32')
    })
})
