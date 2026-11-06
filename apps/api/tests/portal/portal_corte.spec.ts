import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar, claveDesdeTexto } from '#shared/cifrado'
import env from '#start/env'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearEscenarioRouter } from '#tests/core/fabricas'
import { RouterOSFalso } from '#network/routeros/falso'
import { clienteDeRouter } from '#network/routeros/router'
import ReconciliarRouterOS from '#network/routeros/actions/reconciliar_router'
import { ConsumidorRouterOS } from '#network/routeros/consumidor'
import { bitacoraRed, type OpcionesDispatcher } from '#network/routeros/dispatcher'
import { REGLA_NAT_HTTP } from '#network/routeros/corte_router'
import { configCorteVigente } from '#network/routeros/corte_vigente'
import ConfigurarPortalCorte from '#portal/actions/configurar_portal_corte'
import { semillaPortalCorte } from '#portal/corte'

/**
 * Portal de corte configurable (pedido del PM, 6 nov): destino del dst-nat de los routers y modo de
 * suspensión en `core.portal_corte` (global), editables con `portal_corte.configurar`. El entorno solo
 * siembra mientras nadie guardó; al cambiar se emite `portal.config_cambiada` (`empresa_id: null`) y
 * el reconciliador escribe el NAT nuevo en los routers.
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

const VARIABLES = [
    'ROUTERS_SERVICIO_PORTAL_V4',
    'ROUTERS_SERVICIO_PORTAL_V6',
    'ROUTERS_SERVICIO_PORTAL_PUERTO',
    'COA_SUSPENDER',
] as const

async function reiniciarFila() {
    await db.from('core.portal_corte').where('id', 1).update({
        portal_v4: null,
        portal_v6: null,
        portal_puerto: 80,
        modo_suspension: 'desconectar',
        version: 0,
        updated_by: null,
    })
}

async function eventos(desde: number) {
    return (await db
        .from('audit.outbox')
        .where('evento', 'portal.config_cambiada')
        .where('id', '>', desde)
        .orderBy('id')
        .select('payload')) as Array<{ payload: { empresa_id: number | null; campos: string[] } }>
}

async function ultimoOutbox(): Promise<number> {
    const fila = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
    return Number(fila?.id ?? 0)
}

test.group('Portal de corte configurable', (group) => {
    group.each.setup(async () => {
        const previas = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.ROUTERS_SERVICIO_PORTAL_V4 = '192.0.2.20'
        process.env.ROUTERS_SERVICIO_PORTAL_V6 = '2001:db8:ffff::20'
        process.env.ROUTERS_SERVICIO_PORTAL_PUERTO = '8088'
        process.env.COA_SUSPENDER = 'coa'
        await reiniciarFila()
        return async () => {
            for (const v of VARIABLES) {
                if (previas[v] === undefined) delete process.env[v]
                else process.env[v] = previas[v]
            }
            await reiniciarFila()
        }
    })

    test('semilla: COA_SUSPENDER=disconnect y valores inválidos', ({ assert }) => {
        assert.deepEqual(semillaPortalCorte({}), {
            portal_v4: null,
            portal_v6: null,
            portal_puerto: 80,
            modo_suspension: 'desconectar',
        })
        assert.deepEqual(
            semillaPortalCorte({
                ROUTERS_SERVICIO_PORTAL_V4: 'portal.example',
                ROUTERS_SERVICIO_PORTAL_PUERTO: '70000',
                COA_SUSPENDER: 'disconnect',
            }),
            { portal_v4: null, portal_v6: null, portal_puerto: 80, modo_suspension: 'desconectar' },
        )
    })

    test('GET con version 0 = las variables de antes; PUT guarda, 409 con versión vieja', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(client.get('/api/v1/corte/configuracion').bearerToken(token), 200)
        assert.containsSubset(r.body(), {
            portal_v4: '192.0.2.20',
            portal_v6: '2001:db8:ffff::20',
            portal_puerto: 8088,
            modo_suspension: 'coa',
            origen: 'entorno',
            version: 0,
            updated_at: null,
        })

        const desde = await ultimoOutbox()
        const g = await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 0, portal_v4: '198.51.100.10', modo_suspension: 'desconectar' }),
            200,
        )
        assert.containsSubset(g.body(), {
            portal_v4: '198.51.100.10',
            portal_v6: '2001:db8:ffff::20',
            portal_puerto: 8088,
            modo_suspension: 'desconectar',
            origen: 'configuracion',
            version: 1,
        })
        const emitidos = await eventos(desde)
        assert.lengthOf(emitidos, 1)
        assert.deepEqual(emitidos[0]!.payload.empresa_id, null)
        assert.sameMembers(emitidos[0]!.payload.campos, ['portal_v4', 'modo_suspension'])

        // Desde que se guardó, el entorno ya no manda
        process.env.ROUTERS_SERVICIO_PORTAL_V4 = '203.0.113.99'
        process.env.COA_SUSPENDER = 'coa'
        const leido = await estado(client.get('/api/v1/corte/configuracion').bearerToken(token), 200)
        assert.equal(leido.body().portal_v4, '198.51.100.10')
        assert.equal(leido.body().modo_suspension, 'desconectar')

        // Versión vieja: 409
        await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 0, portal_puerto: 80 }),
            409,
        )
        // Sin cambios: guarda (versión 2) sin evento
        const antes = await ultimoOutbox()
        await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 1, portal_puerto: 8088 }),
            200,
        )
        assert.lengthOf(await eventos(antes), 0)

        // Quitar la IPv6 y validar
        const q = await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 2, portal_v6: null }),
            200,
        )
        assert.isNull(q.body().portal_v6)
        await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 3, portal_v4: '2001:db8::1' }),
            422,
        )
        await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 3, portal_puerto: 0 }),
            422,
        )
        await estado(
            client
                .put('/api/v1/corte/configuracion')
                .bearerToken(token)
                .json({ version: 3, modo_suspension: 'x' }),
            422,
        )

        // Auditoría con diff por campo
        const cambios = (await db
            .from('audit.cambios')
            .where('entidad_tipo', 'portal_corte')
            .where('entidad_id', 1)
            .select('campo')) as Array<{ campo: string }>
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['portal_v4', 'modo_suspension', 'portal_v6'],
        )
    })

    test('permisos: lectura ve, no configura; endpoint interno con INTERNAL_TOKEN', async ({ client }) => {
        const { token } = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/corte/configuracion').bearerToken(token), 200)
        await estado(client.put('/api/v1/corte/configuracion').bearerToken(token).json({ version: 0 }), 403)
        await estado(client.get('/api/v1/internal/corte/configuracion').bearerToken(token), 401)
        const r = await estado(
            client.get('/api/v1/internal/corte/configuracion').bearerToken(env.get('INTERNAL_TOKEN')),
            200,
        )
        r.assertBodyContains({ modo_suspension: 'coa', origen: 'entorno' })
    })

    test('el NAT del router usa la configuración; portal.config_cambiada solo reconcilia por red', async ({
        assert,
    }) => {
        const falso = new RouterOSFalso()
        await falso.levantar()
        try {
            const { routerId } = await crearEscenarioRouter()
            await db
                .from('network.routers')
                .where('id', routerId)
                .update({ host: falso.url, api_usuario: falso.usuario, api_password: cifrar(falso.password) })
            const nat = () =>
                falso.tabla('/ip/firewall/nat').find((o) => o.comment === REGLA_NAT_HTTP) ?? null
            const reconciliar = () =>
                new ReconciliarRouterOS(OPCIONES).execute(
                    { router_id: routerId, motivo: 'portal' },
                    contextoPrueba(),
                )

            // Siembra del entorno (nunca se guardó)
            await reconciliar()
            assert.equal(nat()?.['to-addresses'], '192.0.2.20')
            assert.equal(nat()?.['to-ports'], '8088')

            await new ConfigurarPortalCorte().execute(
                { version: 0, portal_v4: '198.51.100.10', portal_puerto: 80 },
                contextoPrueba(),
            )
            const config = await configCorteVigente()
            assert.equal(config.portal_v4, '198.51.100.10')
            assert.equal(config.portal_v4_origen, 'configuracion')
            assert.equal(config.nat_url, 'http://198.51.100.10:80/corte')

            await reconciliar()
            assert.equal(nat()?.['to-addresses'], '198.51.100.10')
            assert.equal(nat()?.['to-ports'], '80')

            const consumidor = new ConsumidorRouterOS(OPCIONES)
            assert.isTrue(consumidor.acepta('portal.config_cambiada'))
            // Por evento: cambia el router sin llamar al reconciliador a mano
            await new ConfigurarPortalCorte().execute(
                { version: 1, portal_v4: '198.51.100.11' },
                contextoPrueba(),
            )
            await consumidor.procesar({
                id: '1',
                evento: 'portal.config_cambiada',
                payload: { empresa_id: null, campos: ['portal_v4'] },
                requestId: 'prueba',
            })
            assert.equal(nat()?.['to-addresses'], '198.51.100.11')

            // Solo el modo de suspensión: los routers no se tocan
            await db.from('core.portal_corte').where('id', 1).update({ portal_v4: '198.51.100.12' })
            await consumidor.procesar({
                id: '2',
                evento: 'portal.config_cambiada',
                payload: { empresa_id: null, campos: ['modo_suspension'] },
                requestId: 'prueba',
            })
            assert.equal(nat()?.['to-addresses'], '198.51.100.11')
        } finally {
            await falso.cerrar()
        }
    })
})
