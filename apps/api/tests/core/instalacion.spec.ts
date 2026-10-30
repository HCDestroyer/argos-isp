import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'

/**
 * Servicio `pendiente_instalacion` y `servicios.activar_instalacion` (pedido A1 de Iris,
 * `.claude/integration/contratos/instalacion.md` §1, §2 y §4).
 */

async function leerRedis(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

/** Alta por la API con `estado_inicial: pendiente_instalacion` (como Iris al ganar un prospecto). */
async function crearPendiente(client: any, token: string, extra: Record<string, unknown> = {}) {
    const escenario = await crearEscenarioRouter()
    const planId = await crearPlanFila({ bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024 })
    const clienteId = await crearClienteFila()
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: escenario.routerId,
                plan_id: planId,
                estado_inicial: 'pendiente_instalacion',
                ...extra,
            }),
        201,
    )
    return r.body() as Record<string, any>
}

const activar = (client: any, token: string, id: number, cuerpo: Record<string, unknown>, clave?: string) => {
    const peticion = client.post(`/api/v1/servicios/${id}/activar-instalacion`).bearerToken(token)
    return (clave === undefined ? peticion : peticion.header('Idempotency-Key', clave)).json(cuerpo)
}

const eventosEstado = (servicioId: number) =>
    db
        .from('audit.outbox')
        .where('evento', 'servicio.estado_cambiado')
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')

test.group('Servicios · pendiente de instalación', (group) => {
    group.setup(limpiarClavesAaa)

    test('alta pendiente: credenciales, IPs y prefijos, sin instalado_en; Redis con estado pendiente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        assert.equal(s.estado, 'pendiente_instalacion')
        assert.isNull(s.instalado_en)
        assert.isString(s.user_ppp)
        assert.isString(s.ipv4)
        assert.isString(s.prefijo_enlace_v6)
        assert.isString(s.prefijo_delegado_v6)

        const cacheado = await leerRedis(s.user_ppp)
        assert.equal(cacheado?.estado, 'pendiente_instalacion')
        assert.notProperty(cacheado ?? {}, 'eliminado')

        const creados = await db
            .from('audit.outbox')
            .where('evento', 'servicio.creado')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [s.id])
        assert.lengthOf(creados, 1)
    })

    test('sin estado_inicial el servicio nace activo con instalado_en (como siempre)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const escenario = await crearEscenarioRouter()
        const r = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: escenario.routerId,
                    plan_id: await crearPlanFila(),
                }),
            201,
        )
        assert.equal(r.body().estado, 'activo')
        assert.isString(r.body().instalado_en)
    })

    test('activar: queda activo con instalado_en, evento motivo instalacion con origen, auditoría y Redis', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['tecnico'])
        const s = await crearPendiente(client, token)
        const instaladoEn = new Date(new Date(s.created_at).getTime() + 1).toISOString()
        const r = await estado(
            activar(
                client,
                token,
                s.id,
                {
                    version: s.version,
                    instalado_en: instaladoEn,
                    origen_tipo: 'iris_orden',
                    origen_id: 'ord-77',
                },
                `iris:instalacion:${unico('ord')}`,
            ),
            200,
        )
        const activo = r.body()
        assert.equal(activo.estado, 'activo')
        assert.equal(new Date(activo.instalado_en).toISOString(), instaladoEn)
        assert.equal(activo.version, s.version + 1)
        assert.isString(activo.fecha_instalacion)
        // sin planta: la columna queda en null y no hay diff de planta
        assert.isNull(activo.planta)

        const evs = await eventosEstado(s.id)
        assert.lengthOf(evs, 1)
        assert.deepEqual(evs[0].payload, {
            servicio_id: s.id,
            empresa_id: s.empresa_id,
            de: 'pendiente_instalacion',
            a: 'activo',
            motivo: 'instalacion',
            origen_tipo: 'iris_orden',
            origen_id: 'ord-77',
        })

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.activar_instalacion', entidad_tipo: 'servicio', entidad_id: s.id })
            .firstOrFail()
        assert.equal(accion.actor_id, usuario.id)
        assert.equal(accion.entrada.origen_tipo, 'iris_orden')
        assert.equal(accion.entrada.origen_id, 'ord-77')
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'estado' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(cambio.despues, 'activo')

        const cacheado = await leerRedis(s.user_ppp)
        assert.equal(cacheado?.estado, 'activo')
    })

    test('activar con planta: se guarda normalizada, sale en la vista y queda en audit.cambios', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const s = await crearPendiente(client, token)
        const r = await estado(
            activar(
                client,
                token,
                s.id,
                {
                    version: s.version,
                    planta: {
                        caja: 'NAP-12',
                        puerto: '7',
                        olt: 'OLT-Centro',
                        pon: '0/3/5',
                        potencia_dbm: '-19.4',
                    },
                },
                unico('k'),
            ),
            200,
        )
        const planta = {
            caja: 'NAP-12',
            puerto: '7',
            olt: 'OLT-Centro',
            pon: '0/3/5',
            potencia_dbm: '-19.40',
        }
        assert.deepEqual(r.body().planta, planta)

        const leido = await estado(client.get(`/api/v1/servicios/${s.id}`).bearerToken(token), 200)
        assert.deepEqual(leido.body().planta, planta)

        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'planta' })
            .firstOrFail()
        assert.isNull(cambio.antes)
        assert.deepEqual(cambio.despues, planta)
    })

    test('planta inválida: potencia fuera de rango o con 3 decimales y textos largos dan 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        const casos: Array<[Record<string, unknown>, string]> = [
            [{ potencia_dbm: '-60.01' }, 'planta.potencia_dbm'],
            [{ potencia_dbm: '10.5' }, 'planta.potencia_dbm'],
            [{ potencia_dbm: '-19.123' }, 'planta.potencia_dbm'],
            [{ potencia_dbm: -19.4 }, 'planta.potencia_dbm'],
            [{ caja: 'x'.repeat(101) }, 'planta.caja'],
        ]
        for (const [planta, campo] of casos) {
            const r = await estado(
                activar(client, token, s.id, { version: s.version, planta }, unico('k')),
                422,
            )
            assert.equal(r.body().errors[0].field, campo, JSON.stringify(planta))
        }
        const ok = await estado(
            activar(
                client,
                token,
                s.id,
                { version: s.version, planta: { potencia_dbm: '-60', slot: '1' } },
                unico('k'),
            ),
            200,
        )
        assert.deepEqual(ok.body().planta, { slot: '1', potencia_dbm: '-60.00' })
    })

    test('Idempotency-Key: el reintento devuelve lo mismo; una clave nueva da 409 servicio_no_pendiente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        const clave = `iris:instalacion:${unico('ord')}`
        const a = await estado(activar(client, token, s.id, { version: s.version }, clave), 200)
        const b = await estado(activar(client, token, s.id, { version: s.version }, clave), 200)
        assert.deepEqual(b.body(), a.body())
        assert.equal(b.header('idempotent-replayed'), 'true')
        assert.lengthOf(await eventosEstado(s.id), 1)

        const c = await estado(activar(client, token, s.id, { version: s.version }, unico('otra')), 409)
        assert.equal(c.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
        assert.equal(c.body().status, 409)
        // aun con la versión actual: el servicio ya no está pendiente
        const d = await estado(
            activar(client, token, s.id, { version: a.body().version }, unico('otra')),
            409,
        )
        assert.equal(d.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
        // y sin versión (cola de Iris con otra clave): el mismo 409, nada se repite
        const e = await estado(activar(client, token, s.id, {}, unico('otra')), 409)
        assert.equal(e.body().type, 'urn:argosisp:problema:servicio_no_pendiente')
        assert.lengthOf(await eventosEstado(s.id), 1)
    })

    test('sin version (Iris 0.3.1): activa aunque el servicio cambió; el reintento con la misma clave repite la respuesta', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        // Iris encola con la version leída; mientras tanto alguien edita el servicio (version + 1)
        await db
            .from('core.servicios')
            .where('id', s.id)
            .update({ version: db.knexRawQuery('version + 1') })
        const clave = `iris:instalacion:${unico('ord')}`
        const cuerpo = { origen_tipo: 'iris_orden', origen_id: unico('orden') }
        const a = await estado(activar(client, token, s.id, cuerpo, clave), 200)
        assert.equal(a.body().estado, 'activo')
        assert.equal(a.body().version, s.version + 2)
        assert.isNotNull(a.body().instalado_en)

        // los mismos bytes con la misma clave: la respuesta guardada, sin otro evento
        const b = await estado(activar(client, token, s.id, cuerpo, clave), 200)
        assert.deepEqual(b.body(), a.body())
        assert.equal(b.header('idempotent-replayed'), 'true')
        assert.lengthOf(await eventosEstado(s.id), 1)

        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.activar_instalacion', entidad_tipo: 'servicio', entidad_id: s.id })
            .where('resultado', 'ok')
        assert.lengthOf(auditoria, 1)
    })

    test('con version vieja sigue respondiendo 409 conflicto_version (no se activa)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        await db
            .from('core.servicios')
            .where('id', s.id)
            .update({ version: db.knexRawQuery('version + 1') })
        const r = await estado(activar(client, token, s.id, { version: s.version }, unico('k')), 409)
        assert.equal(r.body().type, 'urn:argosisp:problema:conflicto_version')
        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.equal(fila.estado, 'pendiente_instalacion')
        assert.lengthOf(await eventosEstado(s.id), 0)
    })

    test('sin Idempotency-Key: 400; versión vieja: 409; fechas futura o anterior al alta: 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)

        const sinClave = await estado(activar(client, token, s.id, { version: s.version }), 400)
        assert.equal(sinClave.body().type, 'urn:argosisp:problema:idempotency_key_requerida')

        const vieja = await estado(activar(client, token, s.id, { version: s.version + 5 }, unico('k')), 409)
        assert.equal(vieja.body().type, 'urn:argosisp:problema:conflicto_version')

        const futura = new Date(Date.now() + 24 * 3600_000).toISOString()
        const f = await estado(
            activar(client, token, s.id, { version: s.version, instalado_en: futura }, unico('k')),
            422,
        )
        assert.equal(f.body().errors[0].field, 'instalado_en')

        const antes = new Date(new Date(s.created_at).getTime() - 3600_000).toISOString()
        const p = await estado(
            activar(client, token, s.id, { version: s.version, instalado_en: antes }, unico('k')),
            422,
        )
        assert.equal(p.body().errors[0].field, 'instalado_en')

        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.equal(fila.estado, 'pendiente_instalacion')
        assert.isNull(fila.instalado_en)
        assert.lengthOf(await eventosEstado(s.id), 0)
    })

    test('cajero y lectura reciben 403 en servicios.activar_instalacion', async ({ client }) => {
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, soporte)
        for (const rol of ['cajero', 'lectura']) {
            const { token } = await usuarioConRoles([rol])
            await estado(activar(client, token, s.id, { version: s.version }, unico('k')), 403)
        }
    })

    test('transiciones prohibidas desde pendiente: 422 servicio_pendiente_instalacion', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await crearPendiente(client, token)
        for (const accion of ['suspender', 'reactivar', 'limitar', 'quitar-limite', 'desconectar']) {
            const r = await estado(
                client
                    .post(`/api/v1/servicios/${s.id}/${accion}`)
                    .bearerToken(token)
                    .json({ motivo: 'prueba de pendiente' }),
                422,
            )
            assert.equal(r.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion', accion)
        }
        const plan = await estado(
            client
                .post(`/api/v1/servicios/${s.id}/planes-temporales`)
                .bearerToken(token)
                .json({
                    plan_id: await crearPlanFila(),
                    fin: new Date(Date.now() + 86_400_000).toISOString(),
                }),
            422,
        )
        assert.equal(plan.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion')

        // la transición que usa evaluarEstadoServicio (billing) tampoco lo mueve
        await assert.rejects(
            () =>
                new CambiarEstadoServicio().execute(
                    { servicioId: s.id, nuevo: 'suspendido', motivo: 'corte' },
                    contextoPrueba(),
                ),
            /pendiente de instalación/,
        )

        const fila = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.equal(fila.estado, 'pendiente_instalacion')
        assert.lengthOf(await eventosEstado(s.id), 0)
    })

    test('retirar un pendiente (la venta se cae): retirado, libera IPs y lápida en Redis', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearPendiente(client, token)
        const r = await estado(
            client
                .post(`/api/v1/servicios/${s.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'venta caída' }),
            200,
        )
        assert.equal(r.body().estado, 'retirado')
        assert.isNull(r.body().ipv4)
        assert.isNull(r.body().instalado_en)
        const evs = await eventosEstado(s.id)
        assert.deepEqual(
            evs.map((e) => [e.payload.de, e.payload.a]),
            [['pendiente_instalacion', 'retirado']],
        )
        const lapida = await leerRedis(s.user_ppp)
        assert.isTrue(lapida?.eliminado)
    })

    test('la base rechaza un pendiente con instalado_en y los existentes conservan su created_at', async ({
        assert,
    }) => {
        const id = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const fila = await db.from('core.servicios').where('id', id).firstOrFail()
        assert.isNotNull(fila.instalado_en)
        await assert.rejects(() =>
            db.from('core.servicios').where('id', id).update({ estado: 'pendiente_instalacion' }),
        )
    })
})
