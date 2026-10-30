import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearRouterFila, crearServicioFila } from '#tests/core/fabricas'
import { HorusSimulado } from '#tests/integraciones/horus_simulado'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import EliminarServicio from '#core/actions/eliminar_servicio'
import { usuarioIris } from '#core/integraciones_iris'
import EliminarRouter from '#network/actions/eliminar_router'
import { asignarIpTunel } from '#network/conexion/ipam_tunel'
import { leerRedTunel } from '#network/conexion/config'
import { listarPeers } from '#network/conexion/consultas'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { entregarPendientesIris, fijarFetchEnviosIris } from '#integraciones/iris/envios'
import { idWebhook } from '#integraciones/webhooks_salientes'
import { firmar } from '#integraciones/horus/firma'

/**
 * Eliminar sin historial (`contratos/eliminar.md`, A1) visto desde A6:
 * - `servicio.eliminado` y `router.eliminado` reales (acciones de A1) llegan a Iris firmados, con
 *   el payload del evento (la fila ya no existe), una sola vez aunque el bus repita.
 * - Alcance: router sin empresa (compartido) a cualquier conector; con empresa, solo en alcance.
 * - WireGuard: el router eliminado sale de `GET /internal/wireguard/peers` (lo que reconcilia el
 *   agente con `router.eliminado`), los demás peers siguen, y su /32 del túnel queda libre.
 */

const SECRETO = 'secreto-del-receptor-de-iris-eliminados-01'
const RECEPTOR = '/api/v1/integraciones/argosisp/webhook/c-elim'
const consumidor = new ConsumidorIris()

async function limpiarIris() {
    await db.from('integraciones.iris_envios').delete()
    await db.from('integraciones.iris_conector').delete()
    fijarFetchEnviosIris()
}

async function fijarConector(url: string) {
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: url,
        token_cifrado: cifrar(`iris_pat_${'Ab3Cd4Ef'.repeat(5)}`),
        webhook_salida_url: `${url}${RECEPTOR}`,
        webhook_salida_secreto_cifrado: cifrar(SECRETO),
    })
}

async function usuarioTecnico(empresas: number[] | null = null): Promise<number> {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return id
}

/** Lleva al consumidor de Iris los eventos del outbox de un request (como el bus, dos veces). */
async function consumirOutbox(requestId: string) {
    const eventos = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    for (const ev of eventos) {
        await consumidor.procesar({ id: ev.id, evento: ev.evento, payload: ev.payload })
        await consumidor.procesar({ id: ev.id, evento: ev.evento, payload: ev.payload })
    }
    return eventos as Array<{ id: number; evento: string; payload: Record<string, unknown> }>
}

async function eliminarServicio(servicioId: number) {
    const fila = await db.from('core.servicios').where('id', servicioId).firstOrFail()
    const ctx = contextoPrueba()
    await new EliminarServicio().execute({ id: servicioId, version: Number(fila.version) }, ctx)
    return ctx.requestId
}

async function eliminarRouter(routerId: number) {
    const fila = await db.from('network.routers').where('id', routerId).firstOrFail()
    const ctx = contextoPrueba()
    await new EliminarRouter().execute({ id: routerId, version: Number(fila.version) }, ctx)
    return ctx.requestId
}

/** Clave pública WireGuard de prueba (base64 de 32 bytes, distinta por número). */
function clave(n: number): string {
    const bytes = Buffer.alloc(32, 0)
    bytes.writeUInt32BE(n, 0)
    bytes.writeUInt32BE(0xa6e1, 4)
    return bytes.toString('base64')
}

test.group('integraciones · eliminados · webhooks a Iris', (group) => {
    group.each.setup(async () => {
        await limpiarIris()
        await usuarioTecnico()
        return async () => {
            await limpiarIris()
            await usuarioTecnico()
            await soloEmpresaPrincipal()
        }
    })

    test('servicio.eliminado real: webhook firmado con el payload del evento, una sola vez', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 202 }))
            await fijarConector(iris.url)
            const clienteId = await crearClienteFila()
            const routerId = await crearRouterFila()
            const servicioId = await crearServicioFila({ cliente_id: clienteId, router_id: routerId })
            await db.from('core.servicios').where('id', servicioId).update({ pass_ppp: 'secreto-ppp-elim' })
            const servicio = await db.from('core.servicios').where('id', servicioId).firstOrFail()
            const userPpp = servicio.user_ppp as string

            const eventos = await consumirOutbox(await eliminarServicio(servicioId))
            const eliminado = eventos.find((e) => e.evento === 'servicio.eliminado')!
            assert.exists(eliminado)

            // servicio.eliminado y el asignacion.cambiada que lo acompaña; el bus repitió: uno por evento
            const filas = await db.from('integraciones.iris_envios').orderBy('id')
            assert.sameMembers(
                filas.map((f) => f.evento),
                ['servicio.eliminado', 'asignacion.cambiada'],
            )
            const r = await entregarPendientesIris()
            assert.equal(r.enviados, 2)
            const recibido = iris.de(RECEPTOR).find((p) => p.json.evento === 'servicio.eliminado')!
            assert.equal(recibido.json.id, idWebhook(eliminado.id))
            assert.deepEqual(recibido.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                router_id: routerId,
            })
            const ts = String(recibido.cabeceras['x-webhook-timestamp'])
            assert.equal(recibido.cabeceras['x-webhook-signature'], firmar(SECRETO, ts, recibido.cuerpo))
            for (const p of iris.de(RECEPTOR)) {
                assert.notInclude(p.cuerpo, userPpp)
                assert.notInclude(p.cuerpo, 'secreto-ppp-elim')
            }
            // el asignacion.cambiada de ips vacías también lleva la empresa (la fila ya no está)
            const asignacion = iris.de(RECEPTOR).find((p) => p.json.evento === 'asignacion.cambiada')!
            assert.containsSubset(asignacion.json.payload, {
                servicio_id: servicioId,
                empresa_id: 1,
                ipv4: [],
            })
        } finally {
            await iris.detener()
        }
    })

    test('router.eliminado real: sin empresa a cualquier alcance; con empresa, solo en el suyo', async ({
        assert,
    }) => {
        const iris = await new HorusSimulado().iniciar()
        try {
            iris.responder(RECEPTOR, () => ({ status: 200 }))
            await fijarConector(iris.url)
            const empresa2 = await crearEmpresaFila()
            const empresa3 = await crearEmpresaFila()
            await usuarioTecnico([empresa2])

            const compartido = await crearRouterFila()
            const deLa2 = await crearRouterFila({ empresa_sugerida_id: empresa2 })
            const deLa3 = await crearRouterFila({ empresa_sugerida_id: empresa3 })
            const ids: Record<number, number> = {}
            for (const routerId of [compartido, deLa2, deLa3]) {
                const eventos = await consumirOutbox(await eliminarRouter(routerId))
                ids[routerId] = eventos.find((e) => e.evento === 'router.eliminado')!.id
            }
            // servicio.eliminado de la empresa 3: fuera del alcance
            const servicio3 = await crearServicioFila({
                cliente_id: await crearClienteFila(),
                router_id: await crearRouterFila(),
                empresa_id: empresa3,
            })
            await consumirOutbox(await eliminarServicio(servicio3))

            const filas = await db.from('integraciones.iris_envios').orderBy('id')
            assert.deepEqual(
                filas.map((f) => f.evento_id),
                [idWebhook(ids[compartido]!), idWebhook(ids[deLa2]!)],
            )
            await entregarPendientesIris()
            const recibidos = iris.de(RECEPTOR).map((p) => p.json.payload)
            assert.deepEqual(recibidos, [
                { router_id: compartido, empresa_id: null },
                { router_id: deLa2, empresa_id: empresa2 },
            ])
        } finally {
            await iris.detener()
        }
    })
})

test.group('integraciones · eliminados · peer WireGuard', () => {
    test('router.eliminado: su peer sale de la lista, los demás siguen y su /32 queda libre', async ({
        client,
        assert,
    }) => {
        // red propia de la prueba (/29: .2 a .6), sin filas de otras pruebas
        const red = leerRedTunel('10.252.6.0/29')
        await db.from('network.routers_conexion').whereRaw("ip_tunel <<= '10.252.6.0/29'::inet").delete()
        const conectar = async (routerId: number, n: number) => {
            const ip = await db.transaction((trx) => asignarIpTunel(trx, red))
            await db.table('network.routers_conexion').insert({
                router_id: routerId,
                ip_tunel: ip,
                public_key: clave(n),
                estado: 'conectado',
                registrado_en: new Date(),
                ultimo_handshake: new Date(),
            })
            // al registrarse, la IP del túnel pasa a ser host y nas_ip del router
            await db.from('network.routers').where('id', routerId).update({ host: ip, nas_ip: ip })
            return ip
        }
        const queda = await crearRouterFila()
        const seVa = await crearRouterFila()
        const n = Date.now() % 1_000_000_000
        const ipQueda = await conectar(queda, n)
        const ipSeVa = await conectar(seVa, n + 1)
        assert.deepEqual([ipQueda, ipSeVa], ['10.252.6.2', '10.252.6.3'])

        const peers = async () => {
            const respuesta = await estado(
                client.get('/api/v1/internal/wireguard/peers').bearerToken(env.get('INTERNAL_TOKEN')),
                200,
            )
            return respuesta.body().data as Array<{ router_id: number; public_key: string; ip_tunel: string }>
        }
        assert.deepInclude(await peers(), { router_id: seVa, public_key: clave(n + 1), ip_tunel: ipSeVa })

        const requestId = await eliminarRouter(seVa)
        const evento = await db
            .from('audit.outbox')
            .where({ request_id: requestId, evento: 'router.eliminado' })
            .firstOrFail()
        assert.deepEqual(evento.payload, { router_id: seVa, empresa_id: null })

        // lo que relee el agente: sin el eliminado, con el otro intacto (wg syncconf no lo toca)
        const despues = await peers()
        assert.isFalse(despues.some((p) => p.router_id === seVa))
        assert.deepInclude(despues, { router_id: queda, public_key: clave(n), ip_tunel: ipQueda })
        const lista = await listarPeers()
        assert.deepEqual(
            lista.filter((p) => p.router_id === seVa),
            [],
        )
        // idempotente: releer otra vez da lo mismo
        assert.deepEqual(await peers(), despues)

        // la /32 y la clave quedaron libres: el siguiente router recibe la misma IP
        const nuevo = await crearRouterFila()
        assert.equal(await conectar(nuevo, n + 1), ipSeVa)
        assert.deepInclude(await peers(), { router_id: nuevo, public_key: clave(n + 1), ip_tunel: ipSeVa })
        await db.from('network.routers_conexion').whereIn('router_id', [queda, nuevo]).delete()
    })
})
