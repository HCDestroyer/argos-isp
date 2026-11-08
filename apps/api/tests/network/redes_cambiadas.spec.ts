import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { bloqueV6Unico, crearEscenarioRouter, crearRouterFila, ipUnica, redUnica } from '#tests/core/fabricas'
import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import EditarRedIpv4 from '#network/actions/editar_red_ipv4'
import MigrarRedIpv4 from '#network/actions/migrar_red_ipv4'
import CrearBloqueIpv6 from '#network/actions/crear_bloque_ipv6'
import EditarBloqueIpv6 from '#network/actions/editar_bloque_ipv6'
import MigrarBloqueIpv6 from '#network/actions/migrar_bloque_ipv6'
import CrearPoolIpv6 from '#network/actions/crear_pool_ipv6'
import EditarPoolIpv6 from '#network/actions/editar_pool_ipv6'
import UnirRouters from '#network/actions/unir_routers'
import { verRouter } from '#network/consultas/routers'
import { corteTunelDeRouter, emitirRedesCambiadas, motivoSinCorteTunel } from '#network/conexion/tunel_corte'

/**
 * `router.redes_cambiadas` (`contratos/corte-identificacion.md` §5 ter.10): toda acción que cambia las
 * redes IPv4 o los prefijos IPv6 de un router lo emite en su transacción, una vez por router, para que el
 * `wireguard-agente` rehaga los AllowedIPs del corte por el túnel. Y `corte_por_tunel` en la vista del
 * router, con la misma regla que `corteTunelDeRouter`. Postgres real.
 */

const VARIABLES = ['ARGOSISP_WIREGUARD', 'ARGOSISP_WG_RED', 'PORTAL_CORTE_TUNEL', 'PORTAL_CORTE_PUERTO']

function guardarEntorno(group: { each: { setup: (fn: () => () => void) => void } }) {
    group.each.setup(() => {
        const antes = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.ARGOSISP_WIREGUARD = '1'
        process.env.ARGOSISP_WG_RED = '10.255.0.0/16'
        delete process.env.PORTAL_CORTE_TUNEL
        delete process.env.PORTAL_CORTE_PUERTO
        return () => {
            for (const [v, valor] of Object.entries(antes)) {
                if (valor === undefined) delete process.env[v]
                else process.env[v] = valor
            }
        }
    })
}

/** Routers de los `router.redes_cambiadas` de un request, en orden. */
async function eventos(requestId: string): Promise<number[]> {
    const filas = (await db
        .from('audit.outbox')
        .where({ evento: 'router.redes_cambiadas', request_id: requestId })
        .orderBy('id')
        .select('payload')) as Array<{ payload: { router_id: number; empresa_id: number | null } }>
    for (const f of filas) if (f.payload.empresa_id !== null) throw new Error('empresa_id debe ser null')
    return filas.map((f) => Number(f.payload.router_id))
}

async function conCtx<T>(fn: (ctx: ContextoAccion) => Promise<T>): Promise<{ salida: T; routers: number[] }> {
    const ctx = contextoPrueba()
    const salida = await fn(ctx)
    return { salida, routers: await eventos(ctx.requestId) }
}

async function versionDe(tabla: string, id: number): Promise<number> {
    const fila = (await db.from(tabla).where('id', id).select('version').firstOrFail()) as { version: number }
    return Number(fila.version)
}

test.group('router.redes_cambiadas · redes IPv4', (group) => {
    guardarEntorno(group)

    test('redes.crear lo emite para su router', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const { salida, routers } = await conCtx((ctx) =>
            new CrearRedIpv4().execute({ router_id: routerId, cidr: redUnica(), tipo: 'estatico' }, ctx),
        )
        assert.deepEqual(routers, [routerId])
        assert.equal(salida.router_id, routerId)
    })

    test('redes.editar lo emite solo si cambia el CIDR', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const red = await new CrearRedIpv4().execute(
            { router_id: routerId, cidr: redUnica(), tipo: 'estatico' },
            contextoPrueba(),
        )
        const soloNombre = await conCtx((ctx) =>
            new EditarRedIpv4().execute({ id: red.id, version: red.version, nombre: unico('Red') }, ctx),
        )
        assert.deepEqual(soloNombre.routers, [], 'cambiar el nombre no toca los AllowedIPs')
        const conCidr = await conCtx(async (ctx) =>
            new EditarRedIpv4().execute(
                { id: red.id, version: await versionDe('network.redes_ipv4', red.id), cidr: redUnica() },
                ctx,
            ),
        )
        assert.deepEqual(conCidr.routers, [routerId])
    })

    test('redes.migrar lo emite para el router de origen y el de destino', async ({ assert }) => {
        const origen = await crearRouterFila()
        const destino = await crearRouterFila()
        const red = await new CrearRedIpv4().execute(
            { router_id: origen, cidr: redUnica(), tipo: 'estatico' },
            contextoPrueba(),
        )
        const { routers } = await conCtx((ctx) =>
            new MigrarRedIpv4().execute({ id: red.id, version: red.version, router_id: destino }, ctx),
        )
        assert.deepEqual(
            routers,
            [origen, destino].sort((a, b) => a - b),
        )
    })

    test('simular redes.migrar no deja eventos', async ({ assert }) => {
        const origen = await crearRouterFila()
        const destino = await crearRouterFila()
        const red = await new CrearRedIpv4().execute(
            { router_id: origen, cidr: redUnica(), tipo: 'estatico' },
            contextoPrueba(),
        )
        const ctx = contextoPrueba()
        await MigrarRedIpv4.simular({ id: red.id, version: red.version, router_id: destino }, ctx)
        assert.deepEqual(await eventos(ctx.requestId), [])
    })
})

test.group('router.redes_cambiadas · IPv6', (group) => {
    guardarEntorno(group)

    test('ipv6.crear (bloque y pool) lo emite para su router', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const prefijo = bloqueV6Unico()
        const bloque = await conCtx((ctx) =>
            new CrearBloqueIpv6().execute({ router_id: routerId, prefijo }, ctx),
        )
        assert.deepEqual(bloque.routers, [routerId])
        const raiz = prefijo.replace('00::/40', '')
        const pool = await conCtx((ctx) =>
            new CrearPoolIpv6().execute(
                {
                    bloque_id: bloque.salida.id,
                    prefijo: `${raiz}00::/48`,
                    tipo: 'enlace',
                    tamano_entrega: 64,
                },
                ctx,
            ),
        )
        assert.deepEqual(pool.routers, [routerId])
    })

    test('ipv6.editar (bloque y pool) lo emite solo si cambia el prefijo', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const prefijo = bloqueV6Unico()
        const bloque = await new CrearBloqueIpv6().execute({ router_id: routerId, prefijo }, contextoPrueba())
        const raiz = prefijo.replace('00::/40', '')
        const pool = await new CrearPoolIpv6().execute(
            { bloque_id: bloque.id, prefijo: `${raiz}00::/48`, tipo: 'enlace', tamano_entrega: 64 },
            contextoPrueba(),
        )

        const soloNombre = await conCtx((ctx) =>
            new EditarBloqueIpv6().execute(
                { id: bloque.id, version: bloque.version, nombre: 'Proveedor A' },
                ctx,
            ),
        )
        assert.deepEqual(soloNombre.routers, [])
        const poolNombre = await conCtx((ctx) =>
            new EditarPoolIpv6().execute({ id: pool.id, version: pool.version, nombre: 'enlace' }, ctx),
        )
        assert.deepEqual(poolNombre.routers, [])

        const poolPrefijo = await conCtx(async (ctx) =>
            new EditarPoolIpv6().execute(
                {
                    id: pool.id,
                    version: await versionDe('network.ipv6_pools', pool.id),
                    prefijo: `${raiz}00::/47`,
                },
                ctx,
            ),
        )
        assert.deepEqual(poolPrefijo.routers, [routerId])

        // un bloque sin pools a otro prefijo
        const vacio = await new CrearBloqueIpv6().execute(
            { router_id: routerId, prefijo: bloqueV6Unico() },
            contextoPrueba(),
        )
        const bloquePrefijo = await conCtx((ctx) =>
            new EditarBloqueIpv6().execute(
                { id: vacio.id, version: vacio.version, prefijo: bloqueV6Unico() },
                ctx,
            ),
        )
        assert.deepEqual(bloquePrefijo.routers, [routerId])
    })

    test('ipv6.migrar lo emite para los dos routers, una vez cada uno aunque se muden también redes', async ({
        assert,
    }) => {
        const origen = await crearRouterFila()
        const destino = await crearRouterFila()
        const bloque = await new CrearBloqueIpv6().execute(
            { router_id: origen, prefijo: bloqueV6Unico() },
            contextoPrueba(),
        )
        const red = await new CrearRedIpv4().execute(
            { router_id: origen, cidr: redUnica(), tipo: 'estatico' },
            contextoPrueba(),
        )
        const { routers } = await conCtx((ctx) =>
            new MigrarBloqueIpv6().execute(
                { id: bloque.id, version: bloque.version, router_id: destino, redes_ipv4: [red.id] },
                ctx,
            ),
        )
        assert.deepEqual(
            routers,
            [origen, destino].sort((a, b) => a - b),
        )
        const movida = (await db.from('network.redes_ipv4').where('id', red.id).firstOrFail()) as {
            router_id: number
        }
        assert.equal(Number(movida.router_id), destino)
    })
})

test.group('router.redes_cambiadas · routers.unir', (group) => {
    guardarEntorno(group)

    test('routers.unir lo emite para el que queda y el absorbido', async ({ assert }) => {
        const { routerId: absorbido } = await crearEscenarioRouter()
        const queda = await crearRouterFila()
        const { routers } = await conCtx((ctx) =>
            new UnirRouters().execute({ id: queda, version: 1, absorber_id: absorbido }, ctx),
        )
        assert.deepEqual(
            routers,
            [queda, absorbido].sort((a, b) => a - b),
        )
    })

    test('routers.unir sin redes ni prefijos no lo emite', async ({ assert }) => {
        const absorbido = await crearRouterFila()
        const queda = await crearRouterFila()
        const { routers } = await conCtx((ctx) =>
            new UnirRouters().execute({ id: queda, version: 1, absorber_id: absorbido }, ctx),
        )
        assert.deepEqual(routers, [])
    })
})

/** Acción de prueba que crea dos redes del mismo router con acciones anidadas (como el importador). */
class CrearDosRedes extends DomainAction<{ router_id: number; fallaLaSegunda?: boolean }, void> {
    readonly nombre = 'redes.crear'
    protected async handle(input: { router_id: number; fallaLaSegunda?: boolean }, t: Transaccion) {
        await new CrearRedIpv4().execute(
            { router_id: input.router_id, cidr: redUnica(), tipo: 'estatico' },
            t.ctx,
            { trx: t.trx },
        )
        await new CrearRedIpv4().execute(
            { router_id: input.router_id, cidr: redUnica(), tipo: 'estatico' },
            t.ctx,
            { trx: t.trx },
        )
        // pedir otra vez el evento en la misma transacción no lo repite
        await emitirRedesCambiadas(t, [input.router_id, input.router_id])
    }
}

test.group('router.redes_cambiadas · idempotencia', (group) => {
    guardarEntorno(group)

    test('acciones anidadas en una transacción: un solo evento por router', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const { routers } = await conCtx((ctx) => new CrearDosRedes().execute({ router_id: routerId }, ctx))
        assert.deepEqual(routers, [routerId])
        const conteo = (await db
            .from('network.redes_ipv4')
            .where('router_id', routerId)
            .count('* as n')) as Array<{ n: string }>
        assert.equal(Number(conteo[0]!.n), 2)
    })

    test('transacciones distintas del mismo request: cada una emite el suyo', async ({ assert }) => {
        const routerId = await crearRouterFila()
        const ctx = contextoPrueba()
        await new CrearRedIpv4().execute({ router_id: routerId, cidr: redUnica(), tipo: 'estatico' }, ctx)
        await new CrearRedIpv4().execute({ router_id: routerId, cidr: redUnica(), tipo: 'estatico' }, ctx)
        assert.deepEqual(await eventos(ctx.requestId), [routerId, routerId])
    })
})

test.group('Router · corte_por_tunel', (group) => {
    guardarEntorno(group)

    let admin = ''
    group.setup(async () => {
        const usuario = await usuarioConRoles(['admin'])
        admin = usuario.token
    })

    async function registrarEnTunel(routerId: number) {
        await db.from('network.routers_conexion').where('router_id', routerId).delete()
        await db.table('network.routers_conexion').insert({
            router_id: routerId,
            ip_tunel: `10.255.${100 + (routerId % 100)}.${(routerId % 250) + 2}/32`,
            public_key: `${unico('k')
                .replace(/[^A-Za-z0-9]/g, '')
                .padEnd(42, 'A')
                .slice(0, 42)}A=`,
            estado: 'conectado',
            registrado_en: new Date().toISOString(),
        })
    }

    test('GET /routers/:id y GET /routers: corte_por_tunel y su motivo', async ({ client, assert }) => {
        const routerId = await crearRouterFila()
        const ver = async () => {
            const respuesta = await estado(client.get(`/api/v1/routers/${routerId}`).bearerToken(admin), 200)
            return respuesta.body()
        }
        const motivo = async () => {
            const vista = await ver()
            return vista.corte_por_tunel_motivo
        }

        let r = await ver()
        assert.isFalse(r.corte_por_tunel)
        assert.equal(r.corte_por_tunel_motivo, 'sin_tunel')
        assert.notProperty(r, 'tunel_registrado')

        await registrarEnTunel(routerId)
        r = await ver()
        assert.isTrue(r.corte_por_tunel)
        assert.isNull(r.corte_por_tunel_motivo)

        // la lista lleva lo mismo (se recorre por cursor hasta encontrarlo)
        let enLista: { corte_por_tunel: boolean; corte_por_tunel_motivo: string | null } | undefined
        let cursor: string | null = null
        do {
            const respuesta = await estado(
                client
                    .get('/api/v1/routers')
                    .qs(cursor ? { limit: 100, cursor } : { limit: 100 })
                    .bearerToken(admin),
                200,
            )
            const pagina = respuesta.body() as {
                data: Array<{ id: number; corte_por_tunel: boolean; corte_por_tunel_motivo: string | null }>
                nextCursor: string | null
            }
            enLista = pagina.data.find((x) => x.id === routerId)
            cursor = pagina.nextCursor
        } while (!enLista && cursor)
        assert.isDefined(enLista)
        assert.isTrue(enLista!.corte_por_tunel)
        assert.isNull(enLista!.corte_por_tunel_motivo)

        await db
            .from('network.routers')
            .where('id', routerId)
            .update({ corte_identificacion: 'codigo', api_usuario: 'argos', api_password: 'x' })
        assert.equal(await motivo(), 'modo_codigo')
        await db.from('network.routers').where('id', routerId).update({ corte_identificacion: 'ip' })

        process.env.PORTAL_CORTE_TUNEL = '0'
        assert.equal(await motivo(), 'tunel_corte_apagado')
        process.env.ARGOSISP_WIREGUARD = '0'
        assert.equal(await motivo(), 'wireguard_apagado')
    })

    test('POST, PUT y las acciones que responden con el router traen corte_por_tunel y su motivo', async ({
        client,
        assert,
    }) => {
        const respuestaAlta = await estado(
            client
                .post('/api/v1/routers')
                .bearerToken(admin)
                .json({ nombre: unico('MK'), host: `${unico('mk')}.lab`, nas_ip: ipUnica() }),
            201,
        )
        const creado = respuestaAlta.body() as {
            id: number
            version: number
            corte_por_tunel: boolean
            corte_por_tunel_motivo: string
        }
        assert.isFalse(creado.corte_por_tunel)
        assert.equal(creado.corte_por_tunel_motivo, 'sin_tunel')

        await registrarEnTunel(creado.id)
        const respuestaEdicion = await estado(
            client
                .put(`/api/v1/routers/${creado.id}`)
                .bearerToken(admin)
                .json({ version: creado.version, nombre: unico('MK') }),
            200,
        )
        const editado = respuestaEdicion.body() as {
            version: number
            corte_por_tunel: boolean
            corte_por_tunel_motivo: string | null
        }
        assert.isTrue(editado.corte_por_tunel)
        assert.isNull(editado.corte_por_tunel_motivo)

        const respuestaControl = await estado(
            client
                .post(`/api/v1/routers/${creado.id}/cambiar-control-velocidad`)
                .bearerToken(admin)
                .json({ version: editado.version, control_velocidad: 'arbol_pcq' }),
            200,
        )
        const control = respuestaControl.body() as {
            corte_por_tunel: boolean
            corte_por_tunel_motivo: string | null
        }
        assert.isTrue(control.corte_por_tunel)
        assert.isNull(control.corte_por_tunel_motivo)
    })

    test('motivoSinCorteTunel coincide con corteTunelDeRouter en todas las combinaciones', async ({
        assert,
    }) => {
        const routerId = await crearRouterFila()
        const entornos: Array<Record<string, string>> = [
            { ARGOSISP_WIREGUARD: '1', ARGOSISP_WG_RED: '10.255.0.0/16' },
            { ARGOSISP_WIREGUARD: '1', ARGOSISP_WG_RED: '10.255.0.0/16', PORTAL_CORTE_TUNEL: '0' },
            { ARGOSISP_WIREGUARD: '0', ARGOSISP_WG_RED: '10.255.0.0/16' },
        ]
        let casos = 0
        for (const registrado of [false, true]) {
            if (registrado) await registrarEnTunel(routerId)
            for (const activo of [true, false]) {
                for (const modo of ['ip', 'codigo'] as const) {
                    for (const conApi of [true, false]) {
                        await db
                            .from('network.routers')
                            .where('id', routerId)
                            .update({
                                activo,
                                corte_identificacion: modo,
                                api_usuario: conApi ? 'argos' : null,
                                api_password: conApi ? 'x' : null,
                            })
                        const vista = await verRouter(routerId)
                        for (const entorno of entornos) {
                            const motivo = motivoSinCorteTunel(
                                { ...vista, tunel_registrado: registrado },
                                entorno,
                            )
                            const destino = await corteTunelDeRouter(routerId, db.connection(), entorno)
                            assert.equal(
                                motivo === null,
                                destino !== null,
                                JSON.stringify({ registrado, activo, modo, conApi, entorno }),
                            )
                            casos++
                        }
                    }
                }
            }
        }
        assert.equal(casos, 48)
    })
})
