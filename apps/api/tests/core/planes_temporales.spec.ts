import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { ejecutarCronCore } from '#core/jobs'
import ProgramarPlanTemporal from '#core/actions/programar_plan_temporal'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Lealtad, parte de A1 (`contratos/lealtad.md` §3, §5 y §16): planes temporales de un servicio.
 * Inicio y fin cambian `core.servicios.plan_id`, emiten `servicio.config_cambiada` (`motivo:
 * plan_temporal`) y reescriben `aaa:user:*`; el cron procesa todo lo pendiente hasta ahora sin
 * duplicar.
 */

const HORA = 60 * 60 * 1000

async function leerAaa(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

async function eventosPlan(servicioId: number) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', 'servicio.config_cambiada')
        .whereRaw(`payload->>'servicio_id' = ?`, [String(servicioId)])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, any> }>
    return filas.map((f) => f.payload)
}

async function escenario(client: any, token: string, extra: Record<string, unknown> = {}) {
    const red = await crearEscenarioRouter()
    const planBase = await crearPlanFila({ bajada_kbps: 20000, subida_kbps: 5000 })
    const planMejor = await crearPlanFila({ bajada_kbps: 50000, subida_kbps: 10000, precio: '250.00' })
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: red.routerId,
                plan_id: planBase,
                ...extra,
            }),
        201,
    )
    return { ...red, planBase, planMejor, servicio: r.body() as Record<string, any> }
}

async function cuerpoDe(peticion: PromiseLike<any>, status: number): Promise<Record<string, any>> {
    const r = await estado(peticion, status)
    return r.body() as Record<string, any>
}

const programar = (client: any, token: string, servicioId: number, cuerpo: Record<string, unknown>) =>
    client.post(`/api/v1/servicios/${servicioId}/planes-temporales`).bearerToken(token).json(cuerpo)

test.group('Planes temporales · programar, iniciar y terminar', (group) => {
    group.setup(limpiarClavesAaa)

    test('inicio inmediato: plan efectivo en el servicio y en aaa:user:*, evento y auditoría', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const antesAaa = await leerAaa(servicio.user_ppp)
        assert.equal(antesAaa!.plan.id, planBase)

        const r = await estado(programar(client, token, servicio.id, { plan_id: planMejor, dias: 30 }), 201)
        const temporal = r.body()
        assert.equal(temporal.estado, 'activo')
        assert.equal(temporal.plan_id, planMejor)
        assert.equal(temporal.plan_original_id, planBase)
        assert.equal(temporal.origen, 'manual')
        assert.equal(temporal.creado_por, usuario.id)
        assert.equal(new Date(temporal.fin).getTime() - new Date(temporal.inicio).getTime(), 30 * 24 * HORA)

        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.body().plan_id, planMejor)
        assert.equal(ver.body().plan_temporal.id, temporal.id)
        assert.equal(ver.body().plan_temporal.estado, 'activo')
        assert.equal(ver.body().plan_temporal.plan_original_id, planBase)

        // RADIUS ve la velocidad del temporal sin TTL (write-through al confirmar)
        const aaa = await leerAaa(servicio.user_ppp)
        assert.equal(aaa!.plan.id, planMejor)
        assert.equal(aaa!.plan.bajada_kbps, 50000)
        assert.match(aaa!.plan.rate_limit, /^10M\/50M /)
        assert.isAbove(aaa!.version, antesAaa!.version)
        assert.equal(await redis().ttl(claveAaa(servicio.user_ppp)), -1)

        // IPs y prefijos no se mueven (no corta la sesión)
        assert.equal(ver.body().ipv4, servicio.ipv4)
        assert.equal(ver.body().prefijo_delegado_v6, servicio.prefijo_delegado_v6)

        const eventos = await eventosPlan(servicio.id)
        assert.deepInclude(eventos, {
            servicio_id: servicio.id,
            empresa_id: servicio.empresa_id,
            campos: ['plan'],
            motivo: 'plan_temporal',
            plan_temporal_id: temporal.id,
        })

        const acciones = (await db
            .from('audit.acciones')
            .whereIn('accion', ['servicios.programar_plan_temporal', 'servicios.iniciar_plan_temporal'])
            .where('entidad_tipo', 'plan_temporal')
            .where('entidad_id', temporal.id)
            .orderBy('id')
            .select('accion', 'actor_tipo', 'actor_id', 'resultado', 'empresa_id')) as Array<
            Record<string, any>
        >
        assert.deepEqual(
            acciones.map((a) => [a.accion, a.actor_tipo, Number(a.actor_id), a.resultado]),
            [
                ['servicios.iniciar_plan_temporal', 'usuario', usuario.id, 'ok'],
                ['servicios.programar_plan_temporal', 'usuario', usuario.id, 'ok'],
            ],
        )
        assert.equal(Number(acciones[0]!.empresa_id), servicio.empresa_id)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: servicio.id, campo: 'plan_id' })
            .orderBy('id', 'desc')
            .first()
        assert.equal(JSON.parse(JSON.stringify(cambio.antes)), planBase)
        assert.equal(JSON.parse(JSON.stringify(cambio.despues)), planMejor)
        const historial = await db
            .from('network.asignaciones_historial')
            .where('servicio_id', servicio.id)
            .whereNull('fin')
            .firstOrFail()
        assert.equal(Number(historial.plan_id), planMejor)
    })

    test('el cron termina lo vencido hasta ahora, vuelve solo al plan base y repetirlo no duplica', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const fin = new Date(Date.now() + HORA)
        const temporal = await cuerpoDe(
            programar(client, token, servicio.id, { plan_id: planMejor, fin: fin.toISOString() }),
            201,
        )
        assert.equal(temporal.estado, 'activo')

        // antes del fin no hace nada
        const antes = await ejecutarCronCore('planes_temporales', new Date(fin.getTime() - 60_000))
        assert.notInclude(antes.resultado!.terminados, temporal.id)

        const despues = new Date(fin.getTime() + 60_000)
        const corrida = await ejecutarCronCore('planes_temporales', despues)
        assert.isFalse(corrida.omitido)
        assert.include(corrida.resultado!.terminados, temporal.id)

        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.body().plan_id, planBase)
        assert.isNull(ver.body().plan_temporal)
        assert.equal(ver.body().ipv4, servicio.ipv4)
        const aaa = await leerAaa(servicio.user_ppp)
        assert.equal(aaa!.plan.id, planBase)
        assert.match(aaa!.plan.rate_limit, /^5M\/20M /)

        const fila = await db.from('core.servicios_planes_temporales').where('id', temporal.id).firstOrFail()
        assert.equal(fila.estado, 'terminado')
        assert.isNotNull(fila.terminado_en)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.terminar_plan_temporal', entidad_id: temporal.id })
            .firstOrFail()
        assert.equal(accion.actor_tipo, 'sistema')
        assert.equal(accion.canal, 'cron')

        // dos corridas más (una en paralelo): ningún evento nuevo
        const eventos = await eventosPlan(servicio.id)
        assert.lengthOf(eventos, 2)
        await Promise.all([
            ejecutarCronCore('planes_temporales', despues),
            ejecutarCronCore('planes_temporales', despues),
        ])
        assert.lengthOf(await eventosPlan(servicio.id), 2)
        assert.deepEqual(
            eventos.map((e) => e.plan_temporal_id),
            [temporal.id, temporal.id],
        )
    })

    test('programado a futuro: el cron lo inicia cuando llega, una sola vez aunque corra en paralelo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const inicio = new Date(Date.now() + 2 * HORA)
        const temporal = await cuerpoDe(
            programar(client, token, servicio.id, {
                plan_id: planMejor,
                inicio: inicio.toISOString(),
                dias: 7,
            }),
            201,
        )
        assert.equal(temporal.estado, 'programado')
        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.body().plan_id, planBase)
        assert.equal(ver.body().plan_temporal.estado, 'programado')
        assert.lengthOf(await eventosPlan(servicio.id), 0)

        await ejecutarCronCore('planes_temporales', new Date())
        assert.lengthOf(await eventosPlan(servicio.id), 0)

        const llegada = new Date(inicio.getTime() + 60_000)
        const corridas = await Promise.all([
            ejecutarCronCore('planes_temporales', llegada),
            ejecutarCronCore('planes_temporales', llegada),
        ])
        const iniciados = corridas.flatMap((c) => c.resultado?.iniciados ?? [])
        assert.deepEqual(iniciados, [temporal.id])
        await ejecutarCronCore('planes_temporales', llegada)

        const eventos = await eventosPlan(servicio.id)
        assert.lengthOf(eventos, 1)
        assert.equal(eventos[0]!.motivo, 'plan_temporal')
        const fila = await db.from('core.servicios_planes_temporales').where('id', temporal.id).firstOrFail()
        assert.equal(fila.estado, 'activo')
        assert.equal((await leerAaa(servicio.user_ppp))!.plan.id, planMejor)
    })

    test('programado cuyo fin pasó con el cron detenido: queda terminado sin tocar el servicio', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const inicio = new Date(Date.now() + HORA)
        const temporal = await cuerpoDe(
            programar(client, token, servicio.id, {
                plan_id: planMejor,
                inicio: inicio.toISOString(),
                dias: 1,
            }),
            201,
        )
        await ejecutarCronCore('planes_temporales', new Date(inicio.getTime() + 2 * 24 * HORA))
        const fila = await db.from('core.servicios_planes_temporales').where('id', temporal.id).firstOrFail()
        assert.equal(fila.estado, 'terminado')
        assert.equal(fila.motivo, 'vencido_sin_iniciar')
        const s = await db.from('core.servicios').where('id', servicio.id).firstOrFail()
        assert.equal(Number(s.plan_id), planBase)
        assert.lengthOf(await eventosPlan(servicio.id), 0)
    })
})

test.group('Planes temporales · cancelar, validar y ACL', (group) => {
    group.setup(limpiarClavesAaa)

    test('cancelar uno activo devuelve el plan base; cerrado o versión vieja → 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const temporal = await cuerpoDe(
            programar(client, token, servicio.id, { plan_id: planMejor, dias: 5 }),
            201,
        )
        const url = `/api/v1/servicios/${servicio.id}/planes-temporales/${temporal.id}/cancelar`

        const vieja = await estado(
            client
                .post(url)
                .bearerToken(token)
                .json({ version: temporal.version + 5, motivo: 'prueba' }),
            409,
        )
        assert.equal(vieja.body().status, 409)

        const r = await estado(
            client
                .post(url)
                .bearerToken(token)
                .json({ version: temporal.version, motivo: 'Canje revertido' }),
            200,
        )
        assert.equal(r.body().estado, 'cancelado')
        assert.equal(r.body().motivo, 'Canje revertido')
        const s = await db.from('core.servicios').where('id', servicio.id).firstOrFail()
        assert.equal(Number(s.plan_id), planBase)
        assert.equal((await leerAaa(servicio.user_ppp))!.plan.id, planBase)
        assert.lengthOf(await eventosPlan(servicio.id), 2)

        const otra = await estado(
            client.post(url).bearerToken(token).json({ version: r.body().version, motivo: 'otra vez' }),
            409,
        )
        assert.match(otra.body().type, /plan_temporal_cerrado$/)

        const lista = await estado(
            client.get(`/api/v1/servicios/${servicio.id}/planes-temporales`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((p: any) => [p.id, p.estado]),
            [[temporal.id, 'cancelado']],
        )
        assert.isNull(lista.body().nextCursor)
    })

    test('validaciones: existente 409, incompatible, igual, sin vigencia 422; editar el plan 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planBase, planMejor } = await escenario(client, token)

        const igual = await estado(programar(client, token, servicio.id, { plan_id: planBase, dias: 3 }), 422)
        assert.match(igual.body().type, /plan_temporal_igual$/)
        const soloV4 = await crearPlanFila({ dual_stack: 'v4' })
        const incompatible = await estado(
            programar(client, token, servicio.id, { plan_id: soloV4, dias: 3 }),
            422,
        )
        assert.match(incompatible.body().type, /plan_temporal_incompatible$/)
        const otroPrefijo = await crearPlanFila({ tamano_prefijo_delegado: 48 })
        await estado(programar(client, token, servicio.id, { plan_id: otroPrefijo, dias: 3 }), 422)
        const sinVigencia = await estado(programar(client, token, servicio.id, { plan_id: planMejor }), 422)
        assert.equal(sinVigencia.body().errors[0].field, 'fin')
        const pasado = await estado(
            programar(client, token, servicio.id, {
                plan_id: planMejor,
                inicio: new Date(Date.now() - 3 * HORA).toISOString(),
                fin: new Date(Date.now() - HORA).toISOString(),
            }),
            422,
        )
        assert.equal(pasado.body().errors[0].field, 'fin')

        await estado(programar(client, token, servicio.id, { plan_id: planMejor, dias: 3 }), 201)
        const otro = await crearPlanFila({ bajada_kbps: 80000 })
        const existente = await estado(programar(client, token, servicio.id, { plan_id: otro, dias: 3 }), 409)
        assert.match(existente.body().type, /plan_temporal_existente$/)

        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        const editar = await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: ver.body().version, plan_id: otro }),
            409,
        )
        assert.match(editar.body().type, /plan_temporal_activo$/)
        // editar otros datos sí se puede
        await estado(
            client
                .put(`/api/v1/servicios/${servicio.id}`)
                .bearerToken(token)
                .json({ version: ver.body().version, direccion: 'Zona 1' }),
            200,
        )
    })

    test('cajero y tecnico no programan (403); el canje de lealtad es idempotente por origen_id', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const { servicio, planMejor } = await escenario(client, admin)
        for (const rol of ['cajero', 'tecnico']) {
            const { token } = await usuarioConRoles([rol])
            await estado(programar(client, token, servicio.id, { plan_id: planMejor, dias: 3 }), 403)
        }

        const ctx = contextoPrueba()
        const entrada = {
            servicio_id: servicio.id,
            plan_id: planMejor,
            dias: 30,
            origen: 'lealtad' as const,
            origen_id: 987654,
        }
        const primero = await new ProgramarPlanTemporal().execute(entrada, ctx)
        const segundo = await new ProgramarPlanTemporal().execute(entrada, contextoPrueba())
        assert.equal(segundo.id, primero.id)
        assert.equal(primero.origen, 'lealtad')
        assert.equal(primero.origen_id, 987654)
        const filas = await db.from('core.servicios_planes_temporales').where('servicio_id', servicio.id)
        assert.lengthOf(filas, 1)
        assert.lengthOf(await eventosPlan(servicio.id), 1)
    })

    test('retirar el servicio cancela su plan temporal y lo deja en el plan base', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, planBase, planMejor } = await escenario(client, token)
        const temporal = await cuerpoDe(
            programar(client, token, servicio.id, { plan_id: planMejor, dias: 3 }),
            201,
        )
        const r = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'Baja' }),
            200,
        )
        assert.equal(r.body().plan_id, planBase)
        assert.isNull(r.body().plan_temporal)
        const fila = await db.from('core.servicios_planes_temporales').where('id', temporal.id).firstOrFail()
        assert.equal(fila.estado, 'cancelado')
        assert.equal(fila.motivo, 'retiro')
        await estado(programar(client, token, servicio.id, { plan_id: planMejor, dias: 3 }), 422)
    })
})
