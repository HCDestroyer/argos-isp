import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import { normalizarValor } from '#network/routeros/normalizar'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, verificarQos, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentPlan, nombreNodo, type EstadoVelocidad } from '#network/routeros/velocidad_router'
import {
    CADENA_RESTO,
    cadenaPlan,
    costoQos,
    marcaConexion,
    nombreHoja,
    objetosClasificacion,
    QOS_MAX_HOJAS,
    SEMILLAS_QOS,
    validarPerfil,
    type ClaseQos,
    type PerfilQosRouter,
} from '#network/qos'
import {
    estrategiasDeControl,
    validarEstrategias,
    type EstrategiasRouter,
} from '#network/estrategia_velocidad'
import { DesactivarClaseQos } from '#network/actions/cambiar_estado_clase_qos'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * QoS por clases en el árbol (`contratos/qos.md`): reglas del perfil, matriz, objetos de RouterOS y
 * costo (puras); dispatcher y reconciliador contra el RouterOS falso; API con Postgres real.
 */

/** Clases de la semilla con ids 1…5 (como en un perfil recién migrado). */
function semilla(): ClaseQos[] {
    const ids = new Map(SEMILLAS_QOS.map((s, i) => [s.clave, i + 1]))
    return SEMILLAS_QOS.map((s, i) => ({
        id: i + 1,
        nombre: s.nombre,
        orden: s.orden,
        prioridad: s.prioridad,
        garantizado_pct: s.garantizado_pct,
        tope_pct: s.tope_pct,
        es_resto: s.es_resto,
        reglas: s.reglas,
        bytes_minimo: s.bytes_minimo,
        reclasifica_de: s.reclasifica_de.map((c) => ids.get(c)!),
        activa: true,
    }))
}

const conQosEn = (e: EstrategiasRouter, qos = true): EstrategiasRouter => ({
    pppoe: { ...e.pppoe, extras: { ...e.pppoe.extras, qos } },
    ip_estatica: { ...e.ip_estatica, extras: { ...e.ip_estatica.extras, qos } },
    dhcp_fija: { ...e.dhcp_fija, extras: { ...e.dhcp_fija.extras, qos } },
})

test.group('QoS · perfil, matriz y objetos (puras)', () => {
    test('la semilla es válida y avisa del tope por cliente', ({ assert }) => {
        const r = validarPerfil(semilla())
        assert.deepEqual(r.errores, [])
        assert.include(
            r.advertencias.map((a) => a.regla),
            'tope_por_cliente',
        )
    })

    test('reglas del perfil: resto, garantizado, puertos sin protocolo y reclasificación', ({ assert }) => {
        const base = semilla()
        const sinResto = base.map((c) => (c.es_resto ? { ...c, activa: false } : c))
        assert.include(
            validarPerfil(sinResto).errores.map((e) => e.rule),
            'qos_resto',
        )
        const mucho = base.map((c) => (c.id === 1 ? { ...c, garantizado_pct: 80 } : c))
        assert.include(
            validarPerfil(mucho).errores.map((e) => e.rule),
            'qos_garantizado',
        )
        const puertos = base.map((c) =>
            c.id === 3 ? { ...c, reglas: [{ ...c.reglas[0]!, protocolo: null }] } : c,
        )
        const e = validarPerfil(puertos).errores.find((x) => x.rule === 'qos_puertos')!
        assert.equal(e.field, 'clases.3.reglas.0.puertos_destino')
        const malos = base.map((c) =>
            c.id === 3 ? { ...c, reglas: [{ ...c.reglas[0]!, puertos_destino: '80-20' }] } : c,
        )
        assert.include(
            validarPerfil(malos).errores.map((x) => x.rule),
            'qos_puertos',
        )
        // Web ya la reclasifica Descargas: una segunda clase de descargas desde Web depende del orden.
        const otra: ClaseQos = { ...base[3]!, id: 9, nombre: 'Otra', reclasifica_de: [3] }
        assert.include(
            validarPerfil([...base, otra]).errores.map((x) => x.message),
            'Web ya la reclasifica otra clase de descargas: el resultado dependería del orden',
        )
        const sinOrigen = base.map((c) => (c.id === 4 ? { ...c, reclasifica_de: [] } : c))
        assert.include(
            validarPerfil(sinOrigen).errores.map((x) => x.rule),
            'qos_reclasifica',
        )
    })

    test('clasificación: cadenas por posición, salto final a resto, descargas e icmpv6', ({ assert }) => {
        const perfil: PerfilQosRouter = { perfil_id: 1, clases: semilla() }
        const objetos = objetosClasificacion(perfil)
        const v4 = objetos.filter((o) => o.ruta === '/ip/firewall/mangle')
        const v6 = objetos.filter((o) => o.ruta === '/ipv6/firewall/mangle')
        assert.equal(v4.length, v6.length)
        const por = (comment: string) => v4.find((o) => o.clave.comment === comment)!.propiedades
        // Interactivo (orden 1) en argosisp-qos-1, Streaming (2) en -2, Web (3) en -3
        assert.containsSubset(por('argosisp:qos:clase:1:0'), {
            chain: 'argosisp-qos-1',
            protocol: 'udp',
            'dst-port': '53,123',
            action: 'mark-connection',
            'new-connection-mark': marcaConexion(1),
        })
        assert.equal(por('argosisp:qos:clase:3:0').chain, 'argosisp-qos-3')
        assert.containsSubset(por('argosisp:qos:salto:3'), {
            chain: 'argosisp-qos-3',
            'connection-mark': 'no-mark',
            'jump-target': CADENA_RESTO,
        })
        assert.containsSubset(por('argosisp:qos:entrada'), {
            chain: 'prerouting',
            'connection-state': 'new',
            'jump-target': 'argosisp-qos-1',
        })
        assert.containsSubset(por('argosisp:qos:clase:5'), { chain: CADENA_RESTO })
        // Descargas (4) desde Web (3) y Resto (5), sin reglas propias: una regla por origen
        assert.containsSubset(por('argosisp:qos:pesada:4:3:0'), {
            chain: 'argosisp-qos-pesadas',
            'connection-mark': marcaConexion(3),
            'connection-bytes': '10000000-0',
            'new-connection-mark': marcaConexion(4),
        })
        assert.isDefined(v4.find((o) => o.clave.comment === 'argosisp:qos:pesada:4:5:0'))
        // ICMP en IPv6 es icmpv6
        assert.equal(
            v6.find((o) => o.clave.comment === 'argosisp:qos:clase:1:4')!.propiedades.protocol,
            'icmpv6',
        )
        assert.equal(por('argosisp:qos:clase:1:4').protocol, 'icmp')
        // La entrada va después de las cadenas (orden de creación)
        assert.isAbove(
            v4.findIndex((o) => o.clave.comment === 'argosisp:qos:entrada'),
            v4.findIndex((o) => o.clave.comment === 'argosisp:qos:salto:3'),
        )
    })

    test('costo: hojas = planes × 4 × clases', ({ assert }) => {
        const perfil: PerfilQosRouter = { perfil_id: 1, clases: semilla() }
        const c = costoQos(perfil, 10)
        assert.equal(c.hojas, 200)
        assert.equal(c.tipos_cola, 40)
        assert.equal(c.reglas_mangle, objetosClasificacion(perfil).length / 2 + 4 * 10 * 6)
        assert.equal(costoQos(perfil, 0).reglas_mangle, 0)
    })

    test('matriz: qos solo en el árbol, exige excluir_fasttrack y respeta el costo', ({ assert }) => {
        const base = {
            planes: [],
            routeros_version: '7.24',
            capacidad_bajada_kbps: 1000,
            capacidad_subida_kbps: 1000,
        }
        const simple = validarEstrategias({ ...base, estrategias: conQosEn(estrategiasDeControl('simple')) })
        assert.include(
            simple.errores.map((e) => e.rule),
            'qos_familia',
        )
        const arbol = conQosEn(estrategiasDeControl('arbol_pcq'))
        assert.deepEqual(validarEstrategias({ ...base, estrategias: arbol }).errores, [])
        const sinFt = {
            ...arbol,
            pppoe: { ...arbol.pppoe, extras: { ...arbol.pppoe.extras, excluir_fasttrack: false } },
        }
        assert.include(
            validarEstrategias({ ...base, estrategias: sinFt }).errores.map((e) => e.rule),
            'qos_fasttrack',
        )
        const planes = Array.from({ length: 60 }, (_, i) => ({ plan_id: i + 1, reuso: 4, excepcion: null }))
        const caro = validarEstrategias({ ...base, estrategias: arbol, planes, qos_clases: 5 })
        assert.include(
            caro.errores.map((e) => e.rule),
            'qos_costo',
        )
        assert.isAbove(60 * 4 * 5, QOS_MAX_HOJAS)
        // Un plan con qos apagado por excepción no cuenta
        const pocos = planes.map((p) => ({
            ...p,
            excepcion: {
                pppoe: { extras: { qos: false } },
                ip_estatica: { extras: { qos: false } },
                dhcp_fija: { extras: { qos: false } },
            },
        }))
        assert.deepEqual(
            validarEstrategias({ ...base, estrategias: arbol, planes: pocos, qos_clases: 5 }).errores,
            [],
        )
        // Padre ninguno: advertencia
        const ninguno = conQosEn(
            Object.fromEntries(
                Object.entries(estrategiasDeControl('arbol_pcq')).map(([k, e]) => [
                    k,
                    { ...e, padre: 'ninguno' },
                ]),
            ) as EstrategiasRouter,
        )
        assert.include(
            validarEstrategias({ ...base, estrategias: ninguno }).advertencias.map((a) => a.regla),
            'qos_sin_cuello',
        )
    })
})

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

async function eventosDe(requestId: string): Promise<EventoEntrante[]> {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        payload: f.payload,
        requestId: f.request_id,
    }))
}

async function entregar(eventos: EventoEntrante[]) {
    const consumidor = new ConsumidorRouterOS(OPCIONES)
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

const igual = (a: unknown, b: unknown) => normalizarValor(a) === normalizarValor(b)

/** Cuerpo de una respuesta con el status esperado. */
async function json(peticion: Parameters<typeof estado>[0], status: number) {
    const r = await estado(peticion, status)
    return r.body()
}

/** Perfil propio con las clases de la semilla (para no tocar el predeterminado entre pruebas). */
async function perfilPropio(): Promise<{ id: number; clases: Map<string, number> }> {
    const [p] = (await db
        .table('network.qos_perfiles')
        .insert({ nombre: unico('QoS') })
        .returning('id')) as Array<{ id: number }>
    const clases = new Map<string, number>()
    for (const s of SEMILLAS_QOS) {
        const [c] = (await db
            .table('network.qos_clases')
            .insert({
                perfil_id: p!.id,
                nombre: s.nombre,
                orden: s.orden,
                prioridad: s.prioridad,
                garantizado_pct: s.garantizado_pct,
                tope_pct: s.tope_pct,
                es_resto: s.es_resto,
                reglas: JSON.stringify(s.reglas),
                bytes_minimo: s.bytes_minimo,
            })
            .returning('id')) as Array<{ id: number }>
        clases.set(s.clave, Number(c!.id))
    }
    await db
        .from('network.qos_clases')
        .where('id', clases.get('descargas')!)
        .update({ reclasifica_de: [clases.get('web')!, clases.get('resto')!] })
    return { id: Number(p!.id), clases }
}

test.group('QoS · RouterOS (falso)', (group) => {
    let falso: RouterOSFalso
    let token: string
    let routerId: number
    let raiz: string
    let clienteId: number
    let siguiente = 0

    group.each.setup(async () => {
        falso = new RouterOSFalso()
        await falso.levantar()
        ;({ token } = await usuarioConRoles(['soporte']))
        ;({ routerId, raiz } = await crearEscenarioRouter())
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                control_velocidad: 'arbol_pcq',
                estrategia_velocidad: JSON.stringify(conQosEn(estrategiasDeControl('arbol_pcq'))),
                capacidad_bajada_kbps: 100000,
                capacidad_subida_kbps: 50000,
            })
        clienteId = await crearClienteFila()
        return () => falso.cerrar()
    })

    async function crear(client: any, planId: number) {
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: clienteId,
                    router_id: routerId,
                    plan_id: planId,
                    tipo_conexion: 'ip_estatica',
                    ipv6_modo: 'estatico',
                    prefijo_delegado_v6: `${raiz}f${(siguiente++).toString(16)}::/56`,
                }),
            201,
        )
        return r.body() as { id: number; ipv4: string }
    }

    const reconciliar = () =>
        new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo: 'manual' }, contextoPrueba())

    test('plan con qos: clasificación, cadenas del plan, hojas por clase y verificación', async ({
        client,
        assert,
    }) => {
        const perfil = await perfilPropio()
        await db.from('network.routers').where('id', routerId).update({ qos_perfil_id: perfil.id })
        const planId = await crearPlanFila({
            bajada_kbps: 20000,
            subida_kbps: 5000,
            bajada_limitada_kbps: 2000,
            subida_limitada_kbps: 1000,
            reuso: 4,
        })
        for (let i = 0; i < 4; i++) await crear(client, planId)
        const r1 = await reconciliar()
        assert.deepEqual(r1.errores_velocidad, [])

        const id = (c: string) => perfil.clases.get(c)!
        const nodo = nombreNodo(planId, false, 'bajada')
        // El nodo del plan queda interno (sin packet-mark) y con sus límites de siempre
        const arbol = falso.tabla('/queue/tree')
        const nodoPlan = arbol.find((o) => o.name === nodo)!
        assert.equal(nodoPlan['packet-mark'], '')
        assert.isTrue(igual(nodoPlan['max-limit'], '20M'))
        // Una hoja por clase (5) en cada nodo del plan (4): 20
        const hojas = arbol.filter((o) => /-q\d+$/.test(o.name ?? ''))
        assert.lengthOf(hojas, 20)
        const interactivo = arbol.find((o) => o.name === nombreHoja(nodo, id('interactivo')))!
        assert.containsSubset(interactivo, {
            parent: nodo,
            'packet-mark': nombreHoja(nodo, id('interactivo')),
            queue: nombreHoja(nodo, id('interactivo')),
            priority: '1',
            comment: `${commentPlan(planId)}:bajada:qos:${id('interactivo')}`,
        })
        // garantizado 10 % y tope 30 % de 20M (MIR 20M × 4 / 4)
        assert.isTrue(igual(interactivo['limit-at'], '2M'))
        assert.isTrue(igual(interactivo['max-limit'], '6M'))
        const tipo = falso.tabla('/queue/type').find((o) => o.name === nombreHoja(nodo, id('interactivo')))!
        assert.isTrue(igual(tipo['pcq-rate'], '6M'))
        assert.equal(tipo['pcq-classifier'], 'dst-address')
        // Web sin tope usa el PCQ del plan
        const web = arbol.find((o) => o.name === nombreHoja(nodo, id('web')))!
        assert.equal(web.queue, nodo)
        assert.isTrue(igual(web['limit-at'], '6M'))
        assert.isTrue(igual(web['max-limit'], '0'))

        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle'] as const) {
            // Ya no está el mark-packet directo; en su lugar el salto a la cadena del plan
            assert.lengthOf(falso.conComment(ruta, `${commentPlan(planId)}:bajada`), 0)
            assert.containsSubset(falso.conComment(ruta, `${commentPlan(planId)}:bajada:qos`)[0], {
                chain: 'forward',
                action: 'jump',
                'dst-address-list': `argosisp-plan-${planId}`,
                'jump-target': cadenaPlan(nodo),
            })
            assert.containsSubset(
                falso.conComment(ruta, `${commentPlan(planId)}:bajada:qos:${id('resto')}`)[0],
                {
                    chain: cadenaPlan(nodo),
                    action: 'mark-packet',
                    'new-packet-mark': nombreHoja(nodo, id('resto')),
                    passthrough: 'true',
                },
            )
            assert.containsSubset(
                falso.conComment(ruta, `${commentPlan(planId)}:bajada:qos:${id('web')}`)[0],
                {
                    'connection-mark': marcaConexion(id('web')),
                    'new-packet-mark': nombreHoja(nodo, id('web')),
                    passthrough: 'false',
                },
            )
            assert.lengthOf(falso.conComment(ruta, 'argosisp:qos:entrada'), 1)
        }
        // Verificación en audit.red
        const fila = await db
            .from('audit.red')
            .where('router_id', routerId)
            .whereRaw(`comando->>'operacion' = 'verificar_qos'`)
            .orderBy('id', 'desc')
            .first()
        assert.isTrue(fila.ok)

        // Segunda pasada: nada que corregir
        const r2 = await reconciliar()
        assert.deepEqual(r2.correcciones, [])
    })

    test('desactivar una clase la quita del router; apagar qos vuelve al árbol de siempre', async ({
        client,
        assert,
    }) => {
        const perfil = await perfilPropio()
        await db.from('network.routers').where('id', routerId).update({ qos_perfil_id: perfil.id })
        const planId = await crearPlanFila({ bajada_kbps: 10000, subida_kbps: 2000, reuso: 2 })
        await crear(client, planId)
        await reconciliar()
        const nodo = nombreNodo(planId, false, 'bajada')
        const streaming = perfil.clases.get('streaming')!

        const ctx = contextoPrueba()
        const clase = await db.from('network.qos_clases').where('id', streaming).firstOrFail()
        await new DesactivarClaseQos().execute({ id: streaming, version: clase.version }, ctx)
        const eventos = await eventosDe(ctx.requestId)
        const evento = eventos.find((e) => e.evento === 'qos.config_cambiada')!
        assert.deepEqual(evento.payload.routers, [routerId])
        await entregar(eventos)
        assert.isUndefined(falso.tabla('/queue/tree').find((o) => o.name === nombreHoja(nodo, streaming)))
        assert.lengthOf(falso.conComment('/ip/firewall/mangle', `argosisp:qos:clase:${streaming}:0`), 0)
        // Web pasa a la posición 2
        assert.equal(
            falso.conComment('/ip/firewall/mangle', `argosisp:qos:clase:${perfil.clases.get('web')}:0`)[0]!
                .chain,
            'argosisp-qos-2',
        )

        // Apagar qos: el nodo vuelve a ser hoja con su marca y el mangle de siempre; nada de QoS queda.
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ estrategia_velocidad: JSON.stringify(estrategiasDeControl('arbol_pcq')) })
        await reconciliar()
        assert.equal(falso.tabla('/queue/tree').find((o) => o.name === nodo)!['packet-mark'], nodo)
        assert.lengthOf(falso.conComment('/ip/firewall/mangle', `${commentPlan(planId)}:bajada`), 1)
        for (const ruta of ['/ip/firewall/mangle', '/ipv6/firewall/mangle', '/queue/tree'] as const) {
            assert.lengthOf(
                falso.tabla(ruta).filter((o) => (o.comment ?? '').includes('qos')),
                0,
                ruta,
            )
        }
        assert.lengthOf(
            falso.tabla('/queue/type').filter((o) => /-q\d+$/.test(o.name ?? '')),
            0,
        )
    })

    test('verificarQos: lo que falta o difiere sale en la verificación', ({ assert }) => {
        const estadoQos: EstadoVelocidad = {
            presentes: [
                {
                    ruta: '/queue/tree',
                    clave: { comment: 'argosisp:plan:1:bajada:qos:2' },
                    propiedades: { name: 'argosisp-plan-1-bajada-q2', priority: '1' },
                },
                {
                    ruta: '/ip/firewall/mangle',
                    clave: { comment: 'argosisp:qos:entrada' },
                    propiedades: { chain: 'prerouting' },
                },
            ],
            avisos: [],
            conservar: [],
            errores: [],
        }
        const lectura = new Map([
            [
                '/queue/tree' as const,
                [{ '.id': '*1', comment: 'argosisp:plan:1:bajada:qos:2', priority: '8' }],
            ],
        ])
        const v = verificarQos(estadoQos, lectura as never)!
        assert.isFalse(v.ok)
        assert.deepEqual(v.faltan, ['/ip/firewall/mangle argosisp:qos:entrada'])
        assert.deepEqual(v.distintos[0]!.propiedades, ['name', 'priority'])
    })
})

test.group('QoS · API', () => {
    test('predeterminado, copiar perfil, crear y editar clase con auditoría, evento y 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const lista = await estado(client.get('/api/v1/qos/perfiles?limit=200').bearerToken(token), 200)
        const pred = (lista.body().data as Array<{ predeterminado: boolean; clases: unknown[] }>).find(
            (p) => p.predeterminado,
        )!
        assert.lengthOf(pred.clases, 5)

        const perfil = await json(
            client
                .post('/api/v1/qos/perfiles')
                .bearerToken(token)
                .json({ nombre: unico('Perfil') }),
            201,
        )
        assert.lengthOf(perfil.clases, 5)
        const descargas = perfil.clases.find((c: { nombre: string }) => c.nombre === 'Descargas')
        const web = perfil.clases.find((c: { nombre: string }) => c.nombre === 'Web')
        const resto = perfil.clases.find((c: { es_resto: boolean }) => c.es_resto)
        // Las referencias de descargas apuntan a las copias
        assert.sameMembers(descargas.reclasifica_de, [web.id, resto.id])

        const requestId = unico('req')
        const clase = await json(
            client
                .post(`/api/v1/qos/perfiles/${perfil.id}/clases`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({
                    nombre: 'Videollamadas',
                    orden: 2,
                    prioridad: 2,
                    garantizado_pct: 10,
                    reglas: [{ protocolo: 'udp', puertos_destino: '3478-3481,8801-8810' }],
                }),
            201,
        )
        assert.containsSubset(clase, { perfil_id: perfil.id, prioridad: 2, activa: true, tope_pct: null })
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.equal(accion.accion, 'qos.gestionar')
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'qos_clase')
            .where('entidad_id', clase.id)
        assert.isAbove(cambios.length, 0)
        const outbox = await db
            .from('audit.outbox')
            .where('request_id', requestId)
            .where('evento', 'qos.config_cambiada')
        assert.lengthOf(outbox, 1)
        assert.containsSubset(outbox[0].payload, { perfil_id: perfil.id, clase_id: clase.id, routers: [] })

        // Editar: 200 con version, 409 con la vieja
        const editada = await json(
            client
                .put(`/api/v1/qos/clases/${clase.id}`)
                .bearerToken(token)
                .json({ version: clase.version, tope_pct: 20 }),
            200,
        )
        assert.equal(editada.tope_pct, 20)
        await estado(
            client
                .put(`/api/v1/qos/clases/${clase.id}`)
                .bearerToken(token)
                .json({ version: clase.version, prioridad: 3 }),
            409,
        )
        // Σ garantizado > 100 → 422
        const r = await estado(
            client
                .put(`/api/v1/qos/clases/${clase.id}`)
                .bearerToken(token)
                .json({ version: editada.version, garantizado_pct: 50 }),
            422,
        )
        assert.equal(r.body().errors[0].rule, 'qos_garantizado')
        // Puertos sin protocolo → 422 con el campo de la petición
        const p = await estado(
            client
                .put(`/api/v1/qos/clases/${clase.id}`)
                .bearerToken(token)
                .json({ version: editada.version, reglas: [{ puertos_destino: '80' }] }),
            422,
        )
        assert.equal(p.body().errors[0].field, 'reglas.0.puertos_destino')
        // Resto no se desactiva
        const d = await estado(
            client
                .post(`/api/v1/qos/clases/${resto.id}/desactivar`)
                .bearerToken(token)
                .json({ version: resto.version }),
            422,
        )
        assert.equal(d.body().errors[0].rule, 'qos_resto')
        // Nombre repetido → 409
        await estado(
            client
                .post(`/api/v1/qos/perfiles/${perfil.id}/clases`)
                .bearerToken(token)
                .json({ nombre: 'web', orden: 5, prioridad: 5, reglas: [{ protocolo: 'tcp' }] }),
            409,
        )
        // Detalle con el uso en routers
        const detalle = await json(client.get(`/api/v1/qos/perfiles/${perfil.id}`).bearerToken(token), 200)
        assert.deepEqual(detalle.routers, [])
    })

    test('permisos: soporte no gestiona; asignar perfil al router con evento y matriz 422', async ({
        client,
        assert,
    }) => {
        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(
            client
                .post('/api/v1/qos/perfiles')
                .bearerToken(soporte)
                .json({ nombre: unico('P') }),
            403,
        )
        await estado(client.get('/api/v1/qos/perfiles').bearerToken(soporte), 403)

        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        await db
            .from('network.routers')
            .where('id', routerId)
            .update({
                control_velocidad: 'arbol_pcq',
                estrategia_velocidad: JSON.stringify(conQosEn(estrategiasDeControl('arbol_pcq'))),
            })
        const planId = await crearPlanFila({ bajada_kbps: 10000, subida_kbps: 2000 })
        await db.table('network.planes_routers').insert({ plan_id: planId, router_id: routerId })
        const perfil = await perfilPropio()
        const router = await json(client.get(`/api/v1/routers/${routerId}`).bearerToken(token), 200)
        assert.isNull(router.qos_perfil_id)
        assert.isTrue(router.estrategia_velocidad.pppoe.extras.qos)

        const requestId = unico('req')
        const despues = await json(
            client
                .post(`/api/v1/routers/${routerId}/qos-perfil`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ version: router.version, qos_perfil_id: perfil.id }),
            200,
        )
        assert.equal(despues.qos_perfil_id, perfil.id)
        const evento = await db
            .from('audit.outbox')
            .where('request_id', requestId)
            .where('evento', 'qos.config_cambiada')
            .firstOrFail()
        assert.containsSubset(evento.payload, {
            router_id: routerId,
            routers: [routerId],
            campos: ['qos_perfil_id'],
        })
        const detalle = await json(client.get(`/api/v1/qos/perfiles/${perfil.id}`).bearerToken(token), 200)
        assert.containsSubset(detalle.routers, [{ router_id: routerId, planes_qos: 1, clases: 5, hojas: 20 }])

        // qos en colas simples → 422 qos_familia; sin qos en la petición conserva el del router
        const simple = estrategiasDeControl('simple')
        const r = await estado(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(token)
                .json({ version: despues.version, estrategia_velocidad: conQosEn(simple) }),
            422,
        )
        assert.include(
            r.body().errors.map((e: { rule: string }) => e.rule),
            'qos_familia',
        )
        const arbolSinCampo = estrategiasDeControl('arbol_pcq')
        for (const t of ['pppoe', 'ip_estatica', 'dhcp_fija'] as const) {
            delete (arbolSinCampo[t].extras as Partial<typeof arbolSinCampo.pppoe.extras>).qos
        }
        const igualQueAntes = await json(
            client
                .post(`/api/v1/routers/${routerId}/cambiar-estrategia-velocidad`)
                .bearerToken(token)
                .json({ version: despues.version, estrategia_velocidad: arbolSinCampo }),
            200,
        )
        assert.isTrue(igualQueAntes.estrategia_velocidad.ip_estatica.extras.qos)
        assert.equal(igualQueAntes.version, despues.version)
        // La matriz publica el extra qos apagado por defecto
        const matriz = await json(client.get('/api/v1/red/control-velocidad/matriz').bearerToken(token), 200)
        assert.deepInclude(matriz.extras, { valor: 'qos', por_defecto: false })
    })
})
