import { randomUUID } from 'node:crypto'
import { setTimeout as esperar } from 'node:timers/promises'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { Redis } from 'ioredis'
import type { ContextoAccion } from '#shared/contexto'
import { estado, unico } from '#tests/ayudas'
import { crearServicio, crearSesion } from '#tests/portal/ayudas_portal'
import IdentificarPorIp from '#portal/actions/identificar_por_ip'
import { VentanaAuditoriaRedis, ventanaAuditoriaS, type VentanaAuditoria } from '#portal/auditoria_unica'

/**
 * Bitácora del portal: `portal.quien_soy` y `portal.estado` se auditan una vez por IP, servicio y
 * acción cada `PORTAL_AUDITORIA_VENTANA_S` (10 min), sin dejar de responder. Redis y Postgres reales.
 */

const QUIEN_SOY = '/api/v1/portal/quien-soy'
const ESTADO = '/api/v1/portal/estado'
const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_AUDITORIA_VENTANA_S',
    'PORTAL_LIMITE_PETICIONES',
] as const

async function filasDelServicio(servicioId: number, accion: string): Promise<number> {
    const fila = (await db
        .from('audit.acciones')
        .where({ entidad_tipo: 'servicio', entidad_id: servicioId, accion })
        .count('* as total')
        .first()) as { total: string | number }
    return Number(fila.total)
}

async function filasDeLasPeticiones(requestIds: string[]): Promise<number> {
    const fila = (await db
        .from('audit.acciones')
        .whereIn('request_id', requestIds)
        .count('* as total')
        .first()) as {
        total: string | number
    }
    return Number(fila.total)
}

function contexto(): ContextoAccion {
    return { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: randomUUID() }
}

test.group('Portal: auditoría una vez por IP y servicio', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-auditoria')
        process.env.PORTAL_LIMITE_PETICIONES = '0'
        delete process.env.PORTAL_AUDITORIA_VENTANA_S
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('la misma IP y el mismo servicio: responde siempre, audita una vez', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.60' })

        for (let i = 0; i < 3; i += 1) {
            const respuesta = await estado(
                client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.60'),
                200,
            )
            assert.containsSubset(respuesta.body(), { identificado: true, estado: 'suspendido' })
        }
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 1)
    })

    test('el estado en vivo cada 5 s tampoco llena la bitácora; cada acción cuenta aparte', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.61' })

        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.61'), 200)
        for (let i = 0; i < 5; i += 1) {
            await estado(client.get(ESTADO).header('X-Forwarded-For', '198.51.100.61'), 200)
        }
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 1)
        assert.equal(await filasDelServicio(s.servicioId, 'portal.estado'), 1)
    })

    test('otra IP del mismo servicio se audita', async ({ client, assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.62', delegado: '2001:db8:600:100::/56' })

        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.62'), 200)
        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '2001:db8:600:100::1'), 200)
        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '2001:db8:600:100::1'), 200)
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 2)
    })

    test('la misma IP en otro servicio se audita en el acto', async ({ client, assert }) => {
        const viejo = await crearServicio()
        await crearSesion(viejo, { ipv4: '198.51.100.63' })
        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.63'), 200)

        await db.from('network.sesiones').where('servicio_id', viejo.servicioId).update({ fin: new Date() })
        const nuevo = await crearServicio({ nombre: 'Pedro' })
        await crearSesion(nuevo, { ipv4: '198.51.100.63' })
        const respuesta = await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.63'), 200)

        assert.equal(respuesta.body().nombre_parcial, 'Pedro')
        assert.equal(await filasDelServicio(viejo.servicioId, 'portal.quien_soy'), 1)
        assert.equal(await filasDelServicio(nuevo.servicioId, 'portal.quien_soy'), 1)
    })

    test('una IP sin servicio también se audita una vez', async ({ client, assert }) => {
        const ids = [unico('desconocida'), unico('desconocida'), unico('desconocida')]
        for (const id of ids) {
            const respuesta = await estado(
                client.get(QUIEN_SOY).header('X-Forwarded-For', '203.0.113.160').header('X-Request-Id', id),
                200,
            )
            assert.isFalse(respuesta.body().identificado)
        }
        assert.equal(await filasDeLasPeticiones(ids), 1)
    })

    test('al terminar la ventana se vuelve a auditar', async ({ client, assert }) => {
        process.env.PORTAL_AUDITORIA_VENTANA_S = '1'
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.64' })

        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.64'), 200)
        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.64'), 200)
        await esperar(1100)
        await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.64'), 200)
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 2)
    }).timeout(5000)

    test('PORTAL_AUDITORIA_VENTANA_S=0 audita todas las consultas', async ({ client, assert }) => {
        process.env.PORTAL_AUDITORIA_VENTANA_S = '0'
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.65' })

        for (let i = 0; i < 3; i += 1) {
            await estado(client.get(QUIEN_SOY).header('X-Forwarded-For', '198.51.100.65'), 200)
        }
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 3)
    })

    test('si Redis falla, se audita cada consulta', async ({ assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.66' })
        const rota = new VentanaAuditoriaRedis({
            set: async () => {
                throw new Error('ECONNREFUSED')
            },
            del: async () => 0,
        } as unknown as Redis)

        await new IdentificarPorIp().execute({ ip: '198.51.100.66' }, contexto(), { ventana: rota })
        const segunda = await new IdentificarPorIp().execute({ ip: '198.51.100.66' }, contexto(), {
            ventana: rota,
        })
        assert.isTrue(segunda.identificado)
        assert.equal(await filasDelServicio(s.servicioId, 'portal.quien_soy'), 2)
    })

    test('si la auditoría falla, libera la marca y la consulta falla', async ({ assert }) => {
        const s = await crearServicio()
        await crearSesion(s, { ipv4: '198.51.100.67' })
        const liberadas: Array<number | null> = []
        const ventana: VentanaAuditoria = {
            reclamar: async () => true,
            liberar: async (_accion, _ip, servicioId) => {
                liberadas.push(servicioId)
            },
        }
        // actor_tipo inválido: el CHECK de audit.acciones rechaza la fila.
        const roto = { ...contexto(), actor: { tipo: 'nadie', id: null } } as unknown as ContextoAccion

        await assert.rejects(() => new IdentificarPorIp().execute({ ip: '198.51.100.67' }, roto, { ventana }))
        assert.deepEqual(liberadas, [s.servicioId])
    })

    test('configuración de la ventana', ({ assert }) => {
        assert.equal(ventanaAuditoriaS({}), 600)
        assert.equal(ventanaAuditoriaS({ PORTAL_AUDITORIA_VENTANA_S: '0' }), 0)
        assert.throws(
            () => ventanaAuditoriaS({ PORTAL_AUDITORIA_VENTANA_S: '-1' }),
            /PORTAL_AUDITORIA_VENTANA_S/,
        )
    })
})
