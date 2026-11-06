import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { Problema } from '#shared/errores'
import { contextoPrueba, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, routerConTipo } from '#tests/core/fabricas'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import RetirarServicio from '#core/actions/retirar_servicio'
import CambiarControlVelocidad from '#network/actions/cambiar_control_velocidad'
import CambiarTipoConexionRouter from '#network/actions/cambiar_tipo_conexion_router'
import { RouterOSFalso } from '#network/routeros/falso'
import { RUTAS, type ObjetoRouterOS, type RutaRouterOS } from '#network/routeros/cliente'
import { clienteDeRouter } from '#network/routeros/router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { ejecutarCambioControl } from '#network/routeros/cambio_control'
import { ejecutarCronRouterOS } from '#network/routeros/jobs'
import AplicarRedServicio from '#network/routeros/actions/aplicar_red_servicio'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { commentServicio } from '#network/routeros/estado_deseado'
import type { ControlVelocidad } from '#network/velocidad'
import type { TipoConexion } from '#core/consultas/servicios'
import type { EventoEntrante } from '#shared/eventos_bus'

/**
 * Reúso y limpieza de lo que ArgosIsp administra en RouterOS (pedido del PM del 5 nov, «a prueba de
 * bugs»), con Postgres real y el RouterOS falso:
 *
 * 1. Identidad estable por `comment = argosisp:<tipo>:<id>`: duplicados, renombrados a mano, cambio
 *    de router.
 * 2. Transiciones en cadena (A → B → A) y una prueba de propiedad: N transiciones al azar con semilla
 *    fija terminan con el router exactamente igual que uno limpio configurado directo al estado final.
 * 3. Fallos a mitad de camino: la siguiente pasada converge y una segunda no escribe nada.
 * 4. Concurrencia: dos aplicar del mismo servicio o router a la vez no duplican.
 * 5. Reúso de nombres e IPs: el objeto viejo con su comment se borra antes, nunca se reutiliza.
 */

const OPCIONES: OpcionesDispatcher = {
    clientes: (router) =>
        clienteDeRouter(router, {
            clave: claveDesdeTexto(env.get('AAA_PPP_KEY')),
            bitacora: bitacoraRed,
            timeoutMs: 1000,
            reintentos: 1,
            esperaMs: 2,
        }),
    red: { interfaz_clientes: 'ether-clientes', dhcp_servidor: 'dhcp-clientes' },
}

/** Menús con orden (las reglas de firewall): ahí el orden cuenta al comparar. */
const ORDENADOS = new Set<RutaRouterOS>([
    '/ip/firewall/filter',
    '/ip/firewall/nat',
    '/ipv6/firewall/filter',
    '/ipv6/firewall/nat',
])

/** Todo lo que hay en el router, sin `.id` (cambia entre routers), para comparar dos routers. */
function inventario(falso: RouterOSFalso): Record<string, string[]> {
    const salida: Record<string, string[]> = {}
    for (const ruta of RUTAS) {
        const filas = falso.tabla(ruta).map((o: ObjetoRouterOS) => {
            const resto: Record<string, string | undefined> = { ...o }
            delete resto['.id']
            return JSON.stringify(
                Object.fromEntries(Object.entries(resto).sort(([a], [b]) => a.localeCompare(b))),
            )
        })
        if (filas.length > 0) salida[ruta] = ORDENADOS.has(ruta) ? filas : filas.sort()
    }
    return salida
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

/** Lo que haría el bus (el cambio de modo, en línea en vez del job `cambiar_control`). */
async function entregar(eventos: EventoEntrante[]) {
    const consumidor = new ConsumidorRouterOS(OPCIONES, (entrada) =>
        ejecutarCambioControl(entrada, { ...OPCIONES, lote: 50, pausaMs: 0 }),
    )
    for (const e of eventos) if (consumidor.acepta(e.evento)) await consumidor.procesar(e)
}

/** PRNG con semilla (mulberry32): la misma semilla da la misma secuencia de transiciones. */
function azar(semilla: number) {
    let a = semilla >>> 0
    const siguiente = () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    return {
        entero: (n: number) => Math.floor(siguiente() * n),
        uno: <T>(lista: readonly T[]): T => lista[Math.floor(siguiente() * lista.length)]!,
    }
}

const reconciliar = (routerId: number, motivo: 'manual' | 'conexion' | 'periodico' = 'manual') =>
    new ReconciliarRouterOS(OPCIONES).execute({ router_id: routerId, motivo }, contextoPrueba())

test.group('RouterOS · reúso y limpieza de objetos administrados', (group) => {
    let token: string
    let clienteId: number
    let falsos: Map<number, RouterOSFalso>
    let routers: number[]
    let planes: number[]
    let siguienteMac = 0

    async function routerConFalso(datos: Record<string, unknown> = {}) {
        const falso = new RouterOSFalso()
        await falso.levantar()
        const esc = await crearEscenarioRouter()
        await db
            .from('network.routers')
            .where('id', esc.routerId)
            .update({
                host: falso.url,
                api_usuario: falso.usuario,
                api_password: cifrar(falso.password),
                capacidad_bajada_kbps: 200000,
                capacidad_subida_kbps: 100000,
                ...datos,
            })
        falsos.set(esc.routerId, falso)
        return { ...esc, falso }
    }

    group.each.setup(async () => {
        ;({ token } = await usuarioConRoles(['admin']))
        clienteId = await crearClienteFila()
        falsos = new Map()
        routers = []
        planes = [
            await crearPlanFila({
                bajada_kbps: 20000,
                subida_kbps: 5000,
                bajada_limitada_kbps: 2000,
                subida_limitada_kbps: 1000,
                reuso: 2,
            }),
            await crearPlanFila({
                bajada_kbps: 10000,
                subida_kbps: 2000,
                bajada_limitada_kbps: 1000,
                subida_limitada_kbps: 500,
            }),
        ]
        return async () => {
            for (const f of falsos.values()) await f.cerrar()
        }
    })

    function mac(): string {
        const n = (siguienteMac++ % 250).toString(16).padStart(2, '0')
        return `AA:BB:CC:7${Math.floor(siguienteMac / 250) % 10}:00:${n}`.toUpperCase()
    }

    async function crear(
        client: any,
        routerId: number,
        cuerpo: Record<string, unknown> = {},
    ): Promise<{ id: number; ipv4: string; user_ppp: string | null }> {
        const requestId = unico('req')
        const r = await client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .header('X-Request-Id', requestId)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planes[0],
                tipo_conexion: 'ip_estatica',
                mac: mac(),
                amarre_ip_mac: true,
                ...cuerpo,
            })
        if (r.status() !== 201) throw new Error(`alta ${r.status()}: ${JSON.stringify(r.body())}`)
        await entregar(await eventosDe(requestId))
        const fila = await db.from('core.servicios').where('id', r.body().id).firstOrFail()
        return { id: Number(fila.id), ipv4: r.body().ipv4, user_ppp: fila.user_ppp }
    }

    async function conEventos(fn: (ctx: ReturnType<typeof contextoPrueba>) => Promise<unknown>) {
        const ctx = contextoPrueba()
        await fn(ctx)
        await entregar(await eventosDe(ctx.requestId))
    }

    const leer = (tabla: string, id: number) => db.from(tabla).where('id', id).firstOrFail()
    const versionServicio = async (id: number) => {
        const { version } = await leer('core.servicios', id)
        return Number(version)
    }
    const versionRouter = async (id: number) => {
        const { version } = await leer('network.routers', id)
        return Number(version)
    }

    const cambiarEstado = (id: number, nuevo: 'activo' | 'limitado' | 'suspendido') =>
        conEventos((ctx) =>
            new CambiarEstadoServicio().execute({ servicioId: id, nuevo, motivo: 'prueba' }, ctx),
        )
    const editar = (id: number, cambios: Record<string, unknown>) =>
        conEventos(async (ctx) =>
            new EditarServicio().execute({ id, version: await versionServicio(id), ...cambios }, ctx),
        )
    const tipoRouter = (routerId: number, tipo: TipoConexion) =>
        conEventos(async (ctx) =>
            new CambiarTipoConexionRouter().execute(
                {
                    id: routerId,
                    version: await versionRouter(routerId),
                    tipo_conexion: tipo,
                    motivo: 'prueba',
                },
                ctx,
            ),
        )
    const control = (routerId: number, a: ControlVelocidad) =>
        conEventos(async (ctx) =>
            new CambiarControlVelocidad().execute(
                {
                    id: routerId,
                    version: await versionRouter(routerId),
                    control_velocidad: a,
                    motivo: 'prueba',
                },
                ctx,
            ),
        )

    /**
     * El mismo estado de Postgres en routers limpios (falsos nuevos), configurado de una vez por el
     * reconciliador. Devuelve los falsos limpios por router.
     */
    async function routersLimpios(): Promise<Map<number, RouterOSFalso>> {
        const limpios = new Map<number, RouterOSFalso>()
        for (const routerId of routers) {
            const limpio = new RouterOSFalso()
            await limpio.levantar()
            limpios.set(routerId, limpio)
            await db.from('network.routers').where('id', routerId).update({ host: limpio.url })
            const r = await reconciliar(routerId, 'conexion')
            if (r.error) throw new Error(`router limpio ${routerId}: ${r.error}`)
        }
        return limpios
    }

    async function devolverHosts() {
        for (const [routerId, falso] of falsos) {
            await db.from('network.routers').where('id', routerId).update({ host: falso.url })
        }
    }

    /** Ningún objeto de servicio u hoja colgando de algo que no existe; nada duplicado por comment. */
    function sinRestos(assert: any, falso: RouterOSFalso) {
        for (const ruta of RUTAS) {
            const comments = falso
                .tabla(ruta)
                .map((o) => o.comment)
                .filter((c): c is string => Boolean(c?.startsWith('argosisp:servicio:')))
            assert.equal(new Set(comments).size, comments.length, `duplicados en ${ruta}`)
        }
        const simples = new Set(falso.tabla('/queue/simple').map((o) => o.name))
        for (const q of falso.tabla('/queue/simple')) {
            if (q.parent && q.parent !== 'none') assert.isTrue(simples.has(q.parent), q.parent)
        }
        const perfiles = new Set(falso.tabla('/ppp/profile').map((o) => o.name))
        for (const s of falso.tabla('/ppp/secret')) assert.isTrue(perfiles.has(s.profile!), s.profile)
    }

    // ------------------------------------------------------------------------------------------
    // 2. Prueba de propiedad
    // ------------------------------------------------------------------------------------------

    // `REUSO_SEMILLAS=1-200` explora más semillas en local; en CI corren estas (la 15 encontró los perfiles
    // con propiedades de la estrategia anterior y la 4242 la IP reusada con el router caído).
    const semillas = process.env.REUSO_SEMILLAS
        ? (() => {
              const [desde, hasta] = process.env.REUSO_SEMILLAS!.split('-').map(Number)
              return Array.from({ length: hasta! - desde! + 1 }, (_, i) => desde! + i)
          })()
        : [20251105, 7, 15, 4242]
    for (const semilla of semillas) {
        test(`propiedad (semilla ${semilla}): N transiciones al azar = router limpio en el estado final`, async ({
            client,
            assert,
        }) => {
            for (let i = 0; i < 2; i++) {
                const r = await routerConFalso({ modo_seguridad: 'api', nas_ip: null, radius_secret: null })
                routers.push(r.routerId)
                await routerConTipo(r.routerId, 'ip_estatica')
            }
            const servicios: number[] = []
            for (const routerId of [routers[0]!, routers[0]!, routers[1]!]) {
                const { id } = await crear(client, routerId)
                servicios.push(id)
            }
            for (const routerId of routers) await reconciliar(routerId, 'conexion')

            const rnd = azar(semilla)
            const historia: string[] = []
            const tipos: TipoConexion[] = ['ip_estatica', 'dhcp_fija', 'pppoe']
            const estados = ['activo', 'limitado', 'suspendido'] as const
            const controles: ControlVelocidad[] = ['simple', 'arbol_pcq']
            const routerDe = async (s: number) => {
                const { router_id: routerId } = await leer('core.servicios', s)
                return Number(routerId)
            }
            // Router averiado durante varios pasos: los eventos fallan (`routeros.fallido`) y al volver
            // el job `recuperar` lo reconcilia, como en producción.
            let caida: { router: number; pasos: number } | null = null
            for (let paso = 0; paso < 40; paso++) {
                const tipo = rnd.entero(7)
                const s = rnd.uno(servicios)
                const r = rnd.uno(routers)
                // Avería (1 de cada 4 pasos): el router cae tras 0..3 escrituras y sigue caído 1..3 pasos.
                const averiado: number | null = !caida && rnd.entero(4) === 0 ? rnd.uno(routers) : null
                const tras = rnd.entero(4)
                const pasosCaido = 1 + rnd.entero(3)
                if (averiado) {
                    falsos.get(averiado)!.averiarTras(tras)
                    caida = { router: averiado, pasos: pasosCaido }
                }
                let descripcion = ''
                try {
                    if (tipo === 0) {
                        const e = rnd.uno(estados)
                        descripcion = `estado s${s} → ${e}`
                        await cambiarEstado(s, e)
                    } else if (tipo === 1) {
                        const p = rnd.uno(planes)
                        descripcion = `plan s${s} → p${p}`
                        await editar(s, { plan_id: p })
                    } else if (tipo === 2) {
                        const actual = await routerDe(s)
                        const otro = routers.find((x) => x !== actual)!
                        descripcion = `router s${s} → r${otro} (de r${actual})`
                        await editar(s, { router_id: otro })
                    } else if (tipo === 3) {
                        const t = rnd.uno(tipos)
                        descripcion = `tipo r${r} → ${t}`
                        await tipoRouter(r, t)
                    } else if (tipo === 4) {
                        const c = rnd.uno(controles)
                        descripcion = `control r${r} → ${c}`
                        await control(r, c)
                    } else {
                        // Retiro y alta de otro servicio en el mismo router: reúsa la IP (y la MAC) liberadas.
                        const routerId = await routerDe(s)
                        const fila = await db.from('core.servicios').where('id', s).firstOrFail()
                        const { tipo_conexion: tipoLeido } = await leer('network.routers', routerId)
                        const tipoActual = tipoLeido as TipoConexion
                        descripcion = `retirar s${s} y alta en r${routerId} (${tipoActual})`
                        await conEventos((ctx) =>
                            new RetirarServicio().execute({ id: s, motivo: 'prueba' }, ctx),
                        )
                        const nuevo = await crear(client, routerId, {
                            tipo_conexion: tipoActual,
                            plan_id: rnd.uno(planes),
                            mac: fila.mac ?? mac(),
                            // PPPoE: el retirado conserva su `user_ppp` (A1); el reúso de nombre se prueba aparte.
                            ...(tipoActual === 'pppoe' ? { amarre_ip_mac: false } : {}),
                        })
                        servicios.splice(servicios.indexOf(s), 1, nuevo.id)
                        descripcion += ` → s${nuevo.id} ${nuevo.ipv4}`
                    }
                    historia.push(
                        averiado
                            ? `${descripcion} [r${averiado} cae tras ${tras}, ${pasosCaido} pasos]`
                            : descripcion,
                    )
                } catch (error) {
                    if (!(error instanceof Problema)) throw error
                    historia.push(`${descripcion} (rechazado: ${(error as Error).message})`)
                } finally {
                    if (caida && --caida.pasos === 0) {
                        falsos.get(caida.router)!.sanar()
                        historia.push(`  r${caida.router} vuelve: recuperar`)
                        caida = null
                        await ejecutarCronRouterOS('recuperar', OPCIONES)
                    }
                }
            }
            if (caida) {
                falsos.get(caida.router)!.sanar()
                await ejecutarCronRouterOS('recuperar', OPCIONES)
            }
            if (process.env.REUSO_DEBUG) console.log(historia.join('\n'))
            const incremental = new Map([...falsos].map(([id, f]) => [id, inventario(f)]))
            for (const f of falsos.values()) sinRestos(assert, f)

            const limpios = await routersLimpios()
            try {
                for (const routerId of routers) {
                    if (process.env.REUSO_DEBUG) {
                        const a = incremental.get(routerId)!
                        const b = inventario(limpios.get(routerId)!)
                        for (const ruta of new Set([...Object.keys(a), ...Object.keys(b)])) {
                            const sobra = (a[ruta] ?? []).filter((x) => !(b[ruta] ?? []).includes(x))
                            const falta = (b[ruta] ?? []).filter((x) => !(a[ruta] ?? []).includes(x))
                            if (sobra.length || falta.length) console.log(routerId, ruta, { sobra, falta })
                        }
                    }
                    assert.deepEqual(
                        incremental.get(routerId),
                        inventario(limpios.get(routerId)!),
                        `router ${routerId} tras:\n${historia.join('\n')}`,
                    )
                }
                // Una segunda pasada sobre el limpio no escribe nada.
                for (const [routerId, limpio] of limpios) {
                    const antes = limpio.escrituras.length
                    await reconciliar(routerId)
                    assert.equal(limpio.escrituras.length, antes, `segunda pasada en ${routerId}`)
                }
            } finally {
                for (const f of limpios.values()) await f.cerrar()
                await devolverHosts()
            }
            // Y el reconciliador sobre el incremental tampoco tiene nada que corregir.
            for (const [routerId, falso] of falsos) {
                const antes = falso.escrituras.length
                await reconciliar(routerId)
                assert.deepEqual(
                    falso.escrituras.slice(antes),
                    [],
                    `reconciliar tras los eventos en ${routerId}:\n${historia.join('\n')}`,
                )
            }
        }).timeout(120_000)
    }

    // ------------------------------------------------------------------------------------------
    // Casos dirigidos
    // ------------------------------------------------------------------------------------------

    async function ultimoOutbox(): Promise<number> {
        const fila = await db.from('audit.outbox').max('id as id').first()
        return Number(fila?.id ?? 0)
    }

    async function fallidosDesde(id: number) {
        const filas = await db.from('audit.outbox').where('evento', 'routeros.fallido').where('id', '>', id)
        return filas.map((f) => f.payload as { servicio_id: number | null; operacion: string; error: string })
    }

    const deServicio = (falso: RouterOSFalso, id: number) =>
        RUTAS.flatMap((ruta) =>
            falso
                .tabla(ruta)
                .filter(
                    (o) =>
                        o.comment === commentServicio(id) || o.comment?.startsWith(`${commentServicio(id)}:`),
                )
                .map(() => ruta),
        )

    async function unRouter(datos: Record<string, unknown> = {}, tipo: TipoConexion = 'ip_estatica') {
        const r = await routerConFalso(datos)
        routers.push(r.routerId)
        await routerConTipo(r.routerId, tipo)
        await reconciliar(r.routerId, 'conexion')
        return r
    }

    /** Lo que queda en el router es lo mismo que en uno limpio y una segunda pasada no escribe. */
    async function comoLimpio(assert: any, routerId: number) {
        const falso = falsos.get(routerId)!
        const limpios = await routersLimpios()
        try {
            assert.deepEqual(inventario(falso), inventario(limpios.get(routerId)!))
        } finally {
            for (const f of limpios.values()) await f.cerrar()
            await devolverHosts()
        }
        const antes = falso.escrituras.length
        await reconciliar(routerId)
        assert.deepEqual(falso.escrituras.slice(antes), [])
    }

    test('IP y MAC de un retirado con el router caído: el alta que las reúsa converge al volver (recuperar)', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter()
        const viejo = await crear(client, routerId)
        await cambiarEstado(viejo.id, 'suspendido')
        const { mac: macVieja } = await leer('core.servicios', viejo.id)
        assert.sameMembers(deServicio(falso, viejo.id), [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/arp',
        ])

        await falso.caer()
        await conEventos((ctx) => new RetirarServicio().execute({ id: viejo.id, motivo: 'baja' }, ctx))
        const nuevo = await crear(client, routerId, { ipv4: viejo.ipv4, mac: macVieja })
        await cambiarEstado(nuevo.id, 'suspendido')
        assert.equal(nuevo.ipv4, viejo.ipv4)
        // Lo del retirado sigue en el router (no se pudo borrar) y el nuevo no tiene nada.
        assert.lengthOf(deServicio(falso, viejo.id), 3)
        assert.lengthOf(deServicio(falso, nuevo.id), 0)

        await falso.levantar()
        const desde = await ultimoOutbox()
        await ejecutarCronRouterOS('recuperar', OPCIONES)
        assert.deepEqual(await fallidosDesde(desde), [])
        assert.lengthOf(deServicio(falso, viejo.id), 0)
        assert.sameMembers(deServicio(falso, nuevo.id), [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/arp',
        ])
        assert.containsSubset(falso.conComment('/ip/arp', commentServicio(nuevo.id))[0], {
            address: viejo.ipv4,
            'mac-address': String(macVieja).toUpperCase(),
        })
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('IP y MAC reusadas: el evento del nuevo llega antes que la limpieza del viejo y borra el resto', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter()
        const viejo = await crear(client, routerId)
        await cambiarEstado(viejo.id, 'suspendido')
        const { mac: macVieja } = await leer('core.servicios', viejo.id)
        // El retiro se procesa más tarde (cola atrasada): su evento todavía no llegó.
        const ctxRetiro = contextoPrueba()
        await new RetirarServicio().execute({ id: viejo.id, motivo: 'baja' }, ctxRetiro)
        const desde = await ultimoOutbox()
        const nuevo = await crear(client, routerId, { ipv4: viejo.ipv4, mac: macVieja })
        await cambiarEstado(nuevo.id, 'suspendido')
        assert.deepEqual(await fallidosDesde(desde), [])
        // Lo que chocaba (la IP en `suspendidos`, el ARP) se borró; la cola del viejo no choca con nada
        // (su nombre lleva su id) y la borra su propio evento.
        assert.sameMembers(deServicio(falso, viejo.id), ['/queue/simple'])
        assert.sameMembers(deServicio(falso, nuevo.id), [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/arp',
        ])
        // Los borrados quedaron en audit.red con el motivo.
        const borrados = await db
            .from('audit.red')
            .where('servicio_id', nuevo.id)
            .whereRaw(`comando->>'metodo' = 'DELETE'`)
            .whereRaw(`comando->>'motivo' LIKE 'liberar %'`)
        assert.isAtLeast(borrados.length, 2)
        // El retiro atrasado ya no tiene nada que hacer y no toca lo del nuevo.
        await entregar(await eventosDe(ctxRetiro.requestId))
        assert.lengthOf(deServicio(falso, viejo.id), 0)
        assert.lengthOf(deServicio(falso, nuevo.id), 3)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('identidad por comment: duplicados y renombrados a mano se corrigen sin crear otro', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter()
        const s = await crear(client, routerId)
        await cambiarEstado(s.id, 'suspendido')
        const cola = falso.conComment('/queue/simple', commentServicio(s.id))[0]!
        // Una escritura repetida dejó un segundo objeto con el mismo comment.
        falso.tabla('/queue/simple').push({ ...cola, '.id': '*FF01', name: 'copia-repetida' })
        const lista = falso.conComment('/ip/firewall/address-list', commentServicio(s.id))[0]!
        falso.tabla('/ip/firewall/address-list').push({ ...lista, '.id': '*FF02', address: '192.0.2.77' })
        // Alguien renombró a mano la cola del servicio y el padre del plan.
        cola.name = 'renombrada-a-mano'
        const padre = falso.tabla('/queue/simple').find((o) => o.comment === `argosisp:plan:${planes[0]}`)
        if (padre) {
            padre.name = 'padre-renombrado'
            for (const h of falso.tabla('/queue/simple')) {
                if (h.parent === `argosisp-plan-${planes[0]}`) h.parent = 'padre-renombrado'
            }
        }
        const antes = falso.escrituras.length
        await reconciliar(routerId)
        const escrituras = falso.escrituras.slice(antes)
        assert.isFalse(
            escrituras.some((e) => e.metodo === 'PUT' && e.ruta.includes('queue/simple')),
            JSON.stringify(escrituras),
        )
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(s.id)), 1)
        assert.equal(
            falso.conComment('/queue/simple', commentServicio(s.id))[0]!.name,
            `argosisp-servicio-${s.id}`,
        )
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', commentServicio(s.id)), 1)
        assert.equal(falso.conComment('/ip/firewall/address-list', commentServicio(s.id))[0]!.address, s.ipv4)
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('cambio de router: se crea en el nuevo y se borra en el viejo; ida y vuelta sin restos', async ({
        client,
        assert,
    }) => {
        const r1 = await unRouter()
        const r2 = await unRouter()
        const s = await crear(client, r1.routerId)
        await cambiarEstado(s.id, 'suspendido')
        await editar(s.id, { router_id: r2.routerId })
        assert.lengthOf(deServicio(r1.falso, s.id), 0)
        assert.sameMembers(deServicio(r2.falso, s.id), [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/arp',
        ])
        await editar(s.id, { router_id: r1.routerId })
        assert.lengthOf(deServicio(r2.falso, s.id), 0)
        assert.sameMembers(deServicio(r1.falso, s.id), [
            '/queue/simple',
            '/ip/firewall/address-list',
            '/ip/arp',
        ])
        await comoLimpio(assert, r1.routerId)
        await comoLimpio(assert, r2.routerId)
    }).timeout(60_000)

    test('A → B → A: colas simples → árbol → colas simples, pppoe → ip_estatica → pppoe, plan 1 → 2 → 1', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter({
            modo_seguridad: 'api',
            nas_ip: null,
            radius_secret: null,
        })
        const a = await crear(client, routerId)
        const b = await crear(client, routerId)
        await cambiarEstado(b.id, 'limitado')
        const inicial = inventario(falso)
        await control(routerId, 'arbol_pcq')
        await control(routerId, 'simple')
        assert.deepEqual(inventario(falso), inicial)
        await editar(a.id, { plan_id: planes[1] })
        await editar(a.id, { plan_id: planes[0] })
        assert.deepEqual(inventario(falso), inicial)
        for (const e of ['limitado', 'suspendido', 'activo'] as const) await cambiarEstado(a.id, e)
        assert.deepEqual(inventario(falso), inicial)
        await tipoRouter(routerId, 'pppoe')
        assert.lengthOf(falso.tabla('/ppp/secret'), 2)
        await tipoRouter(routerId, 'ip_estatica')
        assert.lengthOf(falso.tabla('/ppp/secret'), 0)
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('500 en el tercer comando: la siguiente pasada converge, no duplica y una segunda no escribe', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter()
        const s = await crear(client, routerId)
        const desde = await ultimoOutbox()
        falso.averiarTras(2)
        await cambiarEstado(s.id, 'suspendido')
        await control(routerId, 'arbol_pcq')
        assert.isNotEmpty(await fallidosDesde(desde))
        falso.sanar()
        await ejecutarCronRouterOS('recuperar', OPCIONES)
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
        // Lo mismo con la respuesta perdida (el PUT llegó, el OK no): el reintento no duplica.
        falso.fallar(1, 500, { despues: true })
        await cambiarEstado(s.id, 'activo')
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('concurrencia: evento, cron y otro evento del mismo servicio y router a la vez no duplican', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter()
        const s = await crear(client, routerId)
        const otro = await crear(client, routerId)
        falso.borrarAMano('/queue/simple', (o) => o.comment === commentServicio(s.id))
        falso.borrarAMano('/ip/arp', () => true)
        falso.retrasoMs = 5
        await db.from('core.servicios').where('id', s.id).update({ estado: 'suspendido' })
        const aplicar = (id: number) =>
            new AplicarRedServicio(OPCIONES).execute(
                { servicio_id: id, evento_id: unico('ev'), evento: 'servicio.estado_cambiado' },
                contextoPrueba(),
            )
        await Promise.all([
            aplicar(s.id),
            aplicar(s.id),
            reconciliar(routerId, 'periodico'),
            aplicar(otro.id),
            aplicar(s.id),
        ])
        falso.retrasoMs = 0
        sinRestos(assert, falso)
        assert.lengthOf(falso.conComment('/queue/simple', commentServicio(s.id)), 1)
        assert.lengthOf(falso.conComment('/ip/firewall/address-list', commentServicio(s.id)), 1)
        assert.lengthOf(falso.tabla('/ip/arp'), 2)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('router api: el secret X de otro servicio de ArgosIsp se borra antes de crear el del nuevo', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter(
            { modo_seguridad: 'api', nas_ip: null, radius_secret: null },
            'pppoe',
        )
        const usuario = unico('juan').replace(/[^a-z0-9]/gi, '')
        const viejo = await crear(client, routerId, {
            tipo_conexion: 'pppoe',
            amarre_ip_mac: false,
            user_ppp: usuario,
        })
        assert.equal(falso.conComment('/ppp/secret', commentServicio(viejo.id))[0]!.name, usuario)
        falso.lectura('/ppp/active').push({ '.id': '*A1', name: usuario, address: viejo.ipv4, uptime: '1h' })
        // El viejo cambia de usuario y X queda libre; su evento llega después que el alta del nuevo.
        const ctxViejo = contextoPrueba()
        await new EditarServicio().execute(
            { id: viejo.id, version: await versionServicio(viejo.id), user_ppp: `${usuario}v2` },
            ctxViejo,
        )
        const desde = await ultimoOutbox()
        const nuevo = await crear(client, routerId, {
            tipo_conexion: 'pppoe',
            amarre_ip_mac: false,
            user_ppp: usuario,
        })
        assert.deepEqual(await fallidosDesde(desde), [])
        assert.lengthOf(
            falso.tabla('/ppp/secret').filter((o) => o.name === usuario),
            1,
        )
        assert.equal(falso.conComment('/ppp/secret', commentServicio(nuevo.id))[0]!.name, usuario)
        assert.lengthOf(falso.conComment('/ppp/secret', commentServicio(viejo.id)), 0)
        // La sesión del usuario X era del viejo: se quitó.
        assert.lengthOf(falso.lectura('/ppp/active'), 0)
        await entregar(await eventosDe(ctxViejo.requestId))
        assert.equal(falso.conComment('/ppp/secret', commentServicio(viejo.id))[0]!.name, `${usuario}v2`)
        assert.equal(falso.conComment('/ppp/secret', commentServicio(nuevo.id))[0]!.name, usuario)
        sinRestos(assert, falso)
        await comoLimpio(assert, routerId)
    }).timeout(60_000)

    test('router api: un secret X sin comment de ArgosIsp no se toca y el alta falla con routeros.fallido claro', async ({
        client,
        assert,
    }) => {
        const { routerId, falso } = await unRouter(
            { modo_seguridad: 'api', nas_ip: null, radius_secret: null },
            'pppoe',
        )
        const usuario = unico('mano').replace(/[^a-z0-9]/gi, '')
        falso
            .tabla('/ppp/secret')
            .push({ '.id': '*E1', name: usuario, password: 'x', profile: 'default', service: 'pppoe' })
        const desde = await ultimoOutbox()
        const nuevo = await crear(client, routerId, {
            tipo_conexion: 'pppoe',
            amarre_ip_mac: false,
            user_ppp: usuario,
        })
        const fallidos = await fallidosDesde(desde)
        assert.isNotEmpty(fallidos)
        assert.equal(fallidos[0]!.servicio_id, nuevo.id)
        assert.equal(fallidos[0]!.operacion, 'ppp/secret add')
        assert.include(
            fallidos[0]!.error,
            `el /ppp secret "${usuario}" ya existe en el router sin comment de ArgosIsp`,
        )
        assert.deepEqual(
            falso.tabla('/ppp/secret').filter((o) => o.name === usuario),
            [{ '.id': '*E1', name: usuario, password: 'x', profile: 'default', service: 'pppoe' }],
        )
        assert.lengthOf(falso.conComment('/ppp/secret', commentServicio(nuevo.id)), 0)
        // El reconciliador tampoco lo toca: lo deja en errores_secrets.
        const r = await reconciliar(routerId)
        assert.lengthOf(r.errores_secrets, 1)
        assert.include(r.errores_secrets[0]!, 'sin comment de ArgosIsp')
        assert.lengthOf(
            falso.tabla('/ppp/secret').filter((o) => o.name === usuario),
            1,
        )
    }).timeout(60_000)
})
