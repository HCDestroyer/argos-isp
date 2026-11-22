import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { ejecutarCronCore } from '#core/jobs'
import { tramoEn, proximoTramo } from '#core/promociones_velocidad'
import { EXTRAS_TODOS, estrategiasDeControl } from '#network/estrategia_velocidad'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Promociones de velocidad (decisión del PM 18): multiplicador o plan destino, por días o franja horaria;
 * se aplican por CoA de velocidad sin cortar la sesión, con el cron que abre y cierra los tramos.
 */

const HORA = 3_600_000

async function leerAaa(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

async function eventos(nombre: string, servicioId: number) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`payload->>'servicio_id' = ?`, [String(servicioId)])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, any> }>
    return filas.map((f) => f.payload)
}

async function escenario(client: any, token: string, router: Record<string, unknown> = {}) {
    const red = await crearEscenarioRouter(router)
    const plan = await crearPlanFila({ bajada_kbps: 20000, subida_kbps: 5000 })
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: red.routerId,
                plan_id: plan,
            }),
        201,
    )
    return { ...red, plan, servicio: r.body() as Record<string, any> }
}

/** Sesión PPPoE abierta del servicio (para ver el CoA de velocidad). */
async function abrirSesion(servicio: Record<string, any>, routerId: number) {
    const nas = (await db.from('network.routers').where('id', routerId).select('nas_ip').first()) as {
        nas_ip: string
    }
    await db.table('network.sesiones').insert({
        servicio_id: servicio.id,
        router_id: routerId,
        nas_ip: nas.nas_ip,
        acct_session_id: unico('ses'),
        user_ppp: servicio.user_ppp,
        ipv4: servicio.ipv4,
        inicio: new Date(Date.now() - HORA),
    })
}

test.group('Promociones de velocidad · tramos', () => {
    test('días completos: el tramo es todo el periodo', ({ assert }) => {
        const inicio = new Date('2026-12-01T06:00:00Z')
        const fin = new Date('2026-12-08T06:00:00Z')
        const def = {
            modo: 'dias' as const,
            inicio,
            fin,
            franja_inicio: null,
            franja_fin: null,
            dias_semana: null,
        }
        assert.deepEqual(tramoEn(def, new Date('2026-12-03T00:00:00Z')), { inicio, fin })
        assert.isNull(tramoEn(def, new Date('2026-12-08T06:00:00Z')))
        assert.deepEqual(proximoTramo(def, new Date('2026-11-30T00:00:00Z')), { inicio, fin })
    })

    test('franja 18:00–23:00 de Guatemala (UTC−6), solo viernes y sábado', ({ assert }) => {
        const def = {
            modo: 'franja' as const,
            inicio: new Date('2026-12-01T00:00:00Z'),
            fin: new Date('2027-01-01T00:00:00Z'),
            franja_inicio: '18:00',
            franja_fin: '23:00',
            dias_semana: [5, 6],
        }
        // viernes 4 dic, 19:30 en Guatemala = sábado 5 dic 01:30 UTC
        const tramo = tramoEn(def, new Date('2026-12-05T01:30:00Z'))
        assert.deepEqual(tramo, {
            inicio: new Date('2026-12-05T00:00:00Z'),
            fin: new Date('2026-12-05T05:00:00Z'),
        })
        // jueves 3 dic 19:30 Guatemala: no es día de la promoción
        assert.isNull(tramoEn(def, new Date('2026-12-04T01:30:00Z')))
        // viernes 4 dic 17:59 Guatemala: aún no empieza
        assert.isNull(tramoEn(def, new Date('2026-12-04T23:59:00Z')))
        assert.deepEqual(
            proximoTramo(def, new Date('2026-12-02T00:00:00Z'))?.inicio,
            new Date('2026-12-05T00:00:00Z'),
        )
    })

    test('franja que cruza la medianoche: 22:00–02:00 termina el día siguiente', ({ assert }) => {
        const def = {
            modo: 'franja' as const,
            inicio: new Date('2026-12-01T00:00:00Z'),
            fin: new Date('2027-01-01T00:00:00Z'),
            franja_inicio: '22:00',
            franja_fin: '02:00',
            dias_semana: null,
        }
        // 01:00 del 10 dic en Guatemala = 07:00 UTC: es la franja que empezó el 9 a las 22:00
        assert.deepEqual(tramoEn(def, new Date('2026-12-10T07:00:00Z')), {
            inicio: new Date('2026-12-10T04:00:00Z'),
            fin: new Date('2026-12-10T08:00:00Z'),
        })
    })
})

test.group('Promociones de velocidad · API', (group) => {
    group.setup(limpiarClavesAaa)

    test('x2 por días: sube la velocidad ya (aaa, CoA sin cortar, evento, auditoría) y el cron la baja al fin', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const { servicio, routerId } = await escenario(client, token)
        await abrirSesion(servicio, routerId)
        const antes = await leerAaa(servicio.user_ppp)
        assert.match(antes!.plan.rate_limit, /^5M\/20M/)

        const inicio = new Date(Date.now() - HORA)
        const fin = new Date(Date.now() + 2 * HORA)
        const r = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({
                    nombre: unico('Gamers'),
                    tipo_velocidad: 'multiplicador',
                    multiplicador: 2,
                    modo: 'dias',
                    inicio: inicio.toISOString(),
                    fin: fin.toISOString(),
                    servicio_ids: [servicio.id],
                }),
            201,
        )
        const promo = r.body()
        assert.equal(promo.servicios, 1)
        assert.equal(promo.multiplicador, '2.00')
        assert.isNull(promo.precio)
        assert.equal(promo.creado_por, usuario.id)

        const durante = await leerAaa(servicio.user_ppp)
        assert.match(durante!.plan.rate_limit, /^10M\/40M/)
        assert.equal(durante!.plan.bajada_kbps, 40000)
        // la limitada no cambia
        assert.equal(durante!.plan.rate_limit_limitado, antes!.plan.rate_limit_limitado)

        const coa = await eventos('sesion.velocidad_solicitada', servicio.id)
        assert.lengthOf(coa, 1)
        assert.match(coa[0]!.rate_limit, /^10M\/40M/)
        assert.equal(coa[0]!.motivo, 'promocion_velocidad')
        const iniciadas = await eventos('servicio.promocion_velocidad_iniciada', servicio.id)
        assert.lengthOf(iniciadas, 1)
        assert.equal(iniciadas[0]!.promocion_id, promo.id)
        assert.isFalse(iniciadas[0]!.cambia_precio)
        // nunca Disconnect: no hay servicio.config_cambiada por la promoción
        const configs = await eventos('servicio.config_cambiada', servicio.id)
        assert.lengthOf(
            configs.filter((e) => e.motivo),
            0,
        )

        const servicios = await estado(
            client.get(`/api/v1/servicios/${servicio.id}/promociones-velocidad`).bearerToken(token),
            200,
        )
        assert.equal(servicios.body().data[0].promocion_id, promo.id)
        assert.isNotNull(servicios.body().data[0].tramo_abierto)

        const acciones = (
            (await db.from('audit.acciones').where('actor_id', usuario.id).select('accion')) as Array<{
                accion: string
            }>
        ).map((a) => a.accion)
        assert.includeMembers(acciones, [
            'promociones_velocidad.crear',
            'promociones_velocidad.asignar',
            'promociones_velocidad.abrir_tramo',
        ])

        // el cron con el reloj pasado el fin cierra el tramo y vuelve la velocidad del plan
        const corrida = await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 60_000))
        assert.isFalse(corrida.omitido)
        const despues = await leerAaa(servicio.user_ppp)
        assert.match(despues!.plan.rate_limit, /^5M\/20M/)
        const terminadas = await eventos('servicio.promocion_velocidad_terminada', servicio.id)
        assert.equal(terminadas[0]!.motivo, 'fin')
        assert.lengthOf(await eventos('sesion.velocidad_solicitada', servicio.id), 2)
        // repetir la corrida no duplica
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 120_000))
        assert.lengthOf(await eventos('servicio.promocion_velocidad_terminada', servicio.id), 1)
    })

    test('plan destino por franja: el cron abre el tramo una sola vez y lo cierra', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio } = await escenario(client, token)
        const destino = await crearPlanFila({ bajada_kbps: 50000, subida_kbps: 10000 })
        const r = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({
                    nombre: unico('Noches'),
                    tipo_velocidad: 'plan_destino',
                    plan_destino_id: destino,
                    modo: 'franja',
                    inicio: '2030-01-01T00:00:00Z',
                    fin: '2030-02-01T00:00:00Z',
                    franja_inicio: '18:00',
                    franja_fin: '23:00',
                    precio: '199.00',
                    servicio_ids: [servicio.id],
                }),
            201,
        )
        assert.equal(r.body().precio, '199.00')
        // todavía no empieza: no hay tramo
        assert.lengthOf(await eventos('servicio.promocion_velocidad_iniciada', servicio.id), 0)

        // 2 ene 2030 19:00 Guatemala = 3 ene 01:00 UTC
        const dentro = new Date('2030-01-03T01:00:00Z')
        await ejecutarCronCore('promociones_velocidad', dentro)
        await ejecutarCronCore('promociones_velocidad', new Date(dentro.getTime() + 60_000))
        const iniciadas = await eventos('servicio.promocion_velocidad_iniciada', servicio.id)
        assert.lengthOf(iniciadas, 1)
        assert.equal(iniciadas[0]!.inicio, '2030-01-03T00:00:00.000Z')
        assert.equal(iniciadas[0]!.fin, '2030-01-03T05:00:00.000Z')
        assert.isTrue(iniciadas[0]!.cambia_precio)
        const aaa = await leerAaa(servicio.user_ppp)
        assert.equal(aaa!.plan.bajada_kbps, 50000)

        await ejecutarCronCore('promociones_velocidad', new Date('2030-01-03T05:00:00Z'))
        assert.lengthOf(await eventos('servicio.promocion_velocidad_terminada', servicio.id), 1)
        assert.equal((await leerAaa(servicio.user_ppp))!.plan.bajada_kbps, 20000)
    })

    test('422 si supera la capacidad del router, si el router controla por plan o si se solapa', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const cuerpo = (servicioId: number, extra: Record<string, unknown> = {}) => ({
            nombre: unico('Promo'),
            tipo_velocidad: 'multiplicador',
            multiplicador: 3,
            modo: 'dias',
            inicio: '2031-01-01T00:00:00Z',
            fin: '2031-01-10T00:00:00Z',
            servicio_ids: [servicioId],
            ...extra,
        })
        const chico = await escenario(client, token, {
            capacidad_bajada_kbps: 50000,
            capacidad_subida_kbps: 50000,
        })
        const r1 = await estado(
            client.post('/api/v1/promociones-velocidad').bearerToken(token).json(cuerpo(chico.servicio.id)),
            422,
        )
        assert.equal(r1.body().type, 'urn:argosisp:problema:promocion_supera_capacidad')

        const local = await escenario(client, token)
        await db.from('network.routers').where('id', local.routerId).update({ modo_seguridad: 'api' })
        const r2 = await estado(
            client.post('/api/v1/promociones-velocidad').bearerToken(token).json(cuerpo(local.servicio.id)),
            422,
        )
        assert.equal(r2.body().type, 'urn:argosisp:problema:promocion_estrategia_incompatible')

        const normal = await escenario(client, token)
        await estado(
            client.post('/api/v1/promociones-velocidad').bearerToken(token).json(cuerpo(normal.servicio.id)),
            201,
        )
        const r3 = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json(
                    cuerpo(normal.servicio.id, {
                        inicio: '2031-01-05T00:00:00Z',
                        fin: '2031-01-20T00:00:00Z',
                    }),
                ),
            422,
        )
        assert.equal(r3.body().type, 'urn:argosisp:problema:promocion_solapada')
    })

    test('quitar y cancelar vuelven la velocidad; cajero recibe 403; retiro cierra el tramo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const cajero = await usuarioConRoles(['cajero'])
        const a = await escenario(client, token)
        const b = await escenario(client, token)
        const ahora = Date.now()
        const cuerpo = {
            nombre: unico('Promo'),
            tipo_velocidad: 'multiplicador',
            multiplicador: 2,
            modo: 'dias',
            inicio: new Date(ahora - HORA).toISOString(),
            fin: new Date(ahora + 5 * HORA).toISOString(),
        }
        await estado(client.post('/api/v1/promociones-velocidad').bearerToken(cajero.token).json(cuerpo), 403)
        const creada = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({ ...cuerpo, servicio_ids: [a.servicio.id, b.servicio.id] }),
            201,
        )
        const promo = creada.body()
        assert.equal(promo.servicios, 2)

        await estado(
            client
                .post(`/api/v1/promociones-velocidad/${promo.id}/servicios/${a.servicio.id}/quitar`)
                .bearerToken(token)
                .json({ motivo: 'lo pidió el cliente' }),
            200,
        )
        assert.equal((await leerAaa(a.servicio.user_ppp))!.plan.bajada_kbps, 20000)
        const terminadasA = await eventos('servicio.promocion_velocidad_terminada', a.servicio.id)
        assert.equal(terminadasA[0]!.motivo, 'quitada')

        // retirar b cierra su tramo (sin CoA: el retiro desconecta)
        await estado(
            client
                .post(`/api/v1/servicios/${b.servicio.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'baja' }),
            200,
        )
        const terminadasB = await eventos('servicio.promocion_velocidad_terminada', b.servicio.id)
        assert.equal(terminadasB[0]!.motivo, 'retiro')
        const leida = await estado(
            client.get(`/api/v1/promociones-velocidad/${promo.id}`).bearerToken(token),
            200,
        )
        const vigente = leida.body()
        assert.equal(vigente.servicios, 0)

        const cancelada = await estado(
            client
                .post(`/api/v1/promociones-velocidad/${promo.id}/cancelar`)
                .bearerToken(token)
                .json({ version: vigente.version, motivo: 'fin de la campaña' }),
            200,
        )
        assert.equal(cancelada.body().estado, 'cancelada')
        await estado(
            client
                .post(`/api/v1/promociones-velocidad/${promo.id}/cancelar`)
                .bearerToken(token)
                .json({ version: vigente.version, motivo: 'otra vez' }),
            409,
        )
    })
})

/** Router con velocidad por plan: `pcq_plan` (cola PCQ del plan) o `arbol_pcq` (árbol). */
function estrategiaPorPlan(aplicacion: 'pcq_plan' | 'arbol_pcq') {
    if (aplicacion === 'arbol_pcq') {
        return {
            control_velocidad: 'arbol_pcq',
            estrategia_velocidad: JSON.stringify(estrategiasDeControl('arbol_pcq')),
        }
    }
    const pcq = { aplicacion: 'pcq_plan', padre: 'ninguno', tipo_cola: 'pcq', extras: { ...EXTRAS_TODOS } }
    return { estrategia_velocidad: JSON.stringify({ pppoe: pcq, ip_estatica: pcq, dhcp_fija: pcq }) }
}

async function planDelServicio(servicioId: number): Promise<number> {
    const fila = (await db.from('core.servicios').where('id', servicioId).select('plan_id').first()) as {
        plan_id: number
    }
    return Number(fila.plan_id)
}

test.group('Promociones de velocidad · routers con velocidad por plan (decisión del PM 34)', (group) => {
    group.each.setup(() => limpiarClavesAaa())

    test('PCQ, días completos: multiplicador 422; plan destino cambia el plan y lo devuelve al terminar', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, plan, routerId } = await escenario(client, token, estrategiaPorPlan('pcq_plan'))
        await abrirSesion(servicio, routerId)
        const ahora = Date.now()
        const inicio = new Date(ahora - HORA)
        const fin = new Date(ahora + 24 * HORA)
        const base = {
            nombre: unico('Gamer PCQ'),
            modo: 'dias',
            inicio: inicio.toISOString(),
            fin: fin.toISOString(),
            servicio_ids: [servicio.id],
        }

        const multiplicador = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({ ...base, tipo_velocidad: 'multiplicador', multiplicador: 2 }),
            422,
        )
        assert.equal(multiplicador.body().type, 'urn:argosisp:problema:promocion_requiere_plan_destino')
        assert.match(multiplicador.body().detail, /plan destino/)
        assert.equal(multiplicador.body().errors[0].field, 'plan_destino_id')

        const destino = await crearPlanFila({ bajada_kbps: 60000, subida_kbps: 15000, precio: '400.00' })
        const r = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({ ...base, tipo_velocidad: 'plan_destino', plan_destino_id: destino }),
            201,
        )
        const promo = r.body()

        // el servicio pasa al plan destino (mecánica del plan temporal), sin CoA de velocidad propio
        assert.equal(await planDelServicio(servicio.id), destino)
        const configs = await eventos('servicio.config_cambiada', servicio.id)
        const dePromo = configs.filter((e) => e.motivo === 'promocion_velocidad')
        assert.lengthOf(dePromo, 1)
        assert.deepEqual(dePromo[0]!.campos, ['plan'])
        assert.equal(dePromo[0]!.promocion_id, promo.id)
        assert.lengthOf(await eventos('sesion.velocidad_solicitada', servicio.id), 0)
        const iniciadas = await eventos('servicio.promocion_velocidad_iniciada', servicio.id)
        assert.lengthOf(iniciadas, 1)
        assert.isTrue(iniciadas[0]!.cambia_plan)
        assert.isFalse(iniciadas[0]!.cambia_precio)
        const tramo = (await db
            .from('core.promociones_velocidad_tramos')
            .where({ promocion_id: promo.id, servicio_id: servicio.id })
            .firstOrFail()) as Record<string, any>
        assert.isTrue(tramo.cambia_plan)
        assert.equal(Number(tramo.plan_original_id), plan)
        assert.equal(Number(tramo.plan_destino_id), destino)
        assert.equal(dePromo[0]!.tramo_id, Number(tramo.id))

        // RADIUS ve el plan destino; facturación sigue en el plan original
        const durante = await leerAaa(servicio.user_ppp)
        assert.equal(durante!.plan.bajada_kbps, 60000)
        const { sqlPlanFacturablePromocion } = await import('#core/promociones_velocidad')
        const facturable = (await db
            .from('core.servicios as s')
            .where('s.id', servicio.id)
            .select(db.raw(`${sqlPlanFacturablePromocion('s')} AS plan`))
            .first()) as { plan: number }
        assert.equal(Number(facturable.plan), plan)

        // el cron pasado el fin lo devuelve a su plan; repetir la corrida no duplica
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 60_000))
        await ejecutarCronCore('promociones_velocidad', new Date(fin.getTime() + 120_000))
        assert.equal(await planDelServicio(servicio.id), plan)
        const configsFin = await eventos('servicio.config_cambiada', servicio.id)
        const todas = configsFin.filter((e) => e.motivo === 'promocion_velocidad')
        assert.lengthOf(todas, 2)
        assert.isUndefined(todas.find((e) => (e.campos as string[]).includes('precio')))
        const terminadas = await eventos('servicio.promocion_velocidad_terminada', servicio.id)
        assert.lengthOf(terminadas, 1)
        assert.isTrue(terminadas[0]!.cambia_plan)
        assert.equal((await leerAaa(servicio.user_ppp))!.plan.bajada_kbps, 20000)
        const cambios = (await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: servicio.id, campo: 'plan_id' })
            .count('* as n')
            .first()) as { n: string }
        assert.isAtLeast(Number(cambios.n), 2)
    })

    test('árbol, franja horaria: cada franja cambia de plan al empezar y lo devuelve al terminar, sin duplicar', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio, plan } = await escenario(client, token, estrategiaPorPlan('arbol_pcq'))
        const destino = await crearPlanFila({ bajada_kbps: 50000, subida_kbps: 10000 })
        await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json({
                    nombre: unico('Noches árbol'),
                    tipo_velocidad: 'plan_destino',
                    plan_destino_id: destino,
                    modo: 'franja',
                    inicio: '2032-01-01T00:00:00Z',
                    fin: '2032-02-01T00:00:00Z',
                    franja_inicio: '18:00',
                    franja_fin: '23:00',
                    servicio_ids: [servicio.id],
                }),
            201,
        )
        assert.equal(await planDelServicio(servicio.id), plan)
        const dePromo = async () => {
            const todas = await eventos('servicio.config_cambiada', servicio.id)
            return todas.filter((e) => e.motivo === 'promocion_velocidad')
        }

        // 2 ene 2032 19:00 Guatemala = 3 ene 01:00 UTC; dos corridas abren un solo tramo
        const dentro = new Date('2032-01-03T01:00:00Z')
        await ejecutarCronCore('promociones_velocidad', dentro)
        await ejecutarCronCore('promociones_velocidad', new Date(dentro.getTime() + 60_000))
        assert.equal(await planDelServicio(servicio.id), destino)
        assert.lengthOf(await dePromo(), 1)
        assert.equal((await leerAaa(servicio.user_ppp))!.plan.bajada_kbps, 50000)

        // 23:00 Guatemala: vuelve a su plan
        await ejecutarCronCore('promociones_velocidad', new Date('2032-01-03T05:00:00Z'))
        await ejecutarCronCore('promociones_velocidad', new Date('2032-01-03T05:01:00Z'))
        assert.equal(await planDelServicio(servicio.id), plan)
        assert.lengthOf(await dePromo(), 2)

        // la franja del día siguiente abre otro tramo y lo cierra igual
        await ejecutarCronCore('promociones_velocidad', new Date('2032-01-04T01:00:00Z'))
        assert.equal(await planDelServicio(servicio.id), destino)
        await ejecutarCronCore('promociones_velocidad', new Date('2032-01-04T05:00:00Z'))
        assert.equal(await planDelServicio(servicio.id), plan)
        assert.lengthOf(await dePromo(), 4)
        const tramos = await db
            .from('core.promociones_velocidad_tramos')
            .where('servicio_id', servicio.id)
            .where('cambia_plan', true)
        assert.lengthOf(tramos, 2)
        assert.isTrue(tramos.every((t) => t.estado === 'cerrado'))
    })

    test('plan destino con plan temporal o incompatible: 422', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { servicio } = await escenario(client, token, estrategiaPorPlan('pcq_plan'))
        const solo4 = await crearPlanFila({ dual_stack: 'v4' })
        const cuerpo = (planDestino: number) => ({
            nombre: unico('Promo'),
            tipo_velocidad: 'plan_destino',
            plan_destino_id: planDestino,
            modo: 'dias',
            inicio: '2033-01-01T00:00:00Z',
            fin: '2033-01-10T00:00:00Z',
            servicio_ids: [servicio.id],
        })
        const incompatible = await estado(
            client.post('/api/v1/promociones-velocidad').bearerToken(token).json(cuerpo(solo4)),
            422,
        )
        assert.equal(incompatible.body().type, 'urn:argosisp:problema:promocion_plan_incompatible')

        const temporal = await crearPlanFila({ bajada_kbps: 30000 })
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/planes-temporales`)
                .bearerToken(token)
                .json({ plan_id: temporal, inicio: '2033-01-01T00:00:00Z', fin: '2033-02-01T00:00:00Z' }),
            201,
        )
        const conTemporal = await estado(
            client
                .post('/api/v1/promociones-velocidad')
                .bearerToken(token)
                .json(cuerpo(await crearPlanFila({ bajada_kbps: 40000 }))),
            422,
        )
        assert.equal(conTemporal.body().type, 'urn:argosisp:problema:promocion_con_plan_temporal')
    })
})
