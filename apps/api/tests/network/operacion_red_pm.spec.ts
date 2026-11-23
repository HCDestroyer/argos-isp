import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ejecutarCronCore } from '#core/jobs'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila, redUnica } from '#tests/core/fabricas'

/**
 * Decisiones del PM 28 (quién tenía una IP en una fecha), 30 (IP pública) y 31 (falla general y
 * caídas repetidas; contrato Iris 0.13.0).
 */

const MINUTO = 60_000

async function crearServicio(client: any, token: string, routerId: number, plan?: number) {
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: routerId,
                plan_id: plan ?? (await crearPlanFila()),
            }),
        201,
    )
    return r.body() as Record<string, any>
}

async function eventos(nombre: string, filtro: (p: Record<string, any>) => boolean) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .orderBy('id')
        .select('payload')) as Array<{
        payload: Record<string, any>
    }>
    return filas.map((f) => f.payload).filter(filtro)
}

async function sesion(servicio: Record<string, any>, routerId: number, datos: Record<string, unknown>) {
    const nas = (await db.from('network.routers').where('id', routerId).select('nas_ip').first()) as {
        nas_ip: string
    }
    const [fila] = (await db
        .table('network.sesiones')
        .insert({
            servicio_id: servicio.id,
            router_id: routerId,
            nas_ip: nas.nas_ip,
            acct_session_id: unico('ses'),
            user_ppp: servicio.user_ppp,
            ipv4: servicio.ipv4,
            ...datos,
        })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}

test.group('Quién tenía una IP (decisión 28)', () => {
    test('por IPv4 y fecha: servicio, cliente y sesión; auditado; permiso propio; retención', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const red = await crearEscenarioRouter()
        const servicio = await crearServicio(client, admin.token, red.routerId)
        const inicio = new Date(Date.now() - 3 * 3_600_000)
        const sesionId = await sesion(servicio, red.routerId, {
            inicio,
            fin: new Date(Date.now() - 3_600_000),
            causa_fin: 'User-Request',
        })
        // la asignación del servicio empezó hace un momento: con una fecha de hace 2 h sale solo la sesión
        const en = new Date(Date.now() - 2 * 3_600_000).toISOString()
        const r = await estado(
            client.get('/api/v1/ip-historial').qs({ ip: servicio.ipv4, en }).bearerToken(admin.token),
            200,
        )
        assert.lengthOf(r.body().resultados, 1)
        const [resultado] = r.body().resultados
        assert.equal(resultado.fuente, 'sesion')
        assert.equal(resultado.servicio_id, servicio.id)
        assert.equal(resultado.cliente_id, servicio.cliente_id)
        assert.equal(resultado.sesion.id, sesionId)
        assert.equal(resultado.sesion.causa_fin, 'User-Request')

        // ahora: la asignación vigente
        const ahora = await estado(
            client
                .get('/api/v1/ip-historial')
                .qs({ ip: servicio.ipv4, en: new Date().toISOString() })
                .bearerToken(admin.token),
            200,
        )
        assert.equal(ahora.body().resultados[0].fuente, 'asignacion')

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'ip.buscar_historial', actor_id: admin.usuario.id })
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion.entrada.ip, servicio.ipv4)
        assert.deepEqual(accion.entrada.auditoria.servicios, [servicio.id])

        const viejo = await estado(
            client
                .get('/api/v1/ip-historial')
                .qs({ ip: servicio.ipv4, en: '2020-01-01T00:00:00Z' })
                .bearerToken(admin.token),
            422,
        )
        assert.equal(viejo.body().type, 'urn:argosisp:problema:fuera_de_retencion')
        const soporte = await usuarioConRoles(['soporte'])
        await estado(
            client.get('/api/v1/ip-historial').qs({ ip: servicio.ipv4, en }).bearerToken(soporte.token),
            403,
        )
    })
})

test.group('IP pública (decisión 30)', () => {
    test('adicional cobrado: asigna una IP de la red pública y la devuelve al quitarlo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const red = await crearEscenarioRouter()
        const publica = redUnica()
        const creada = await estado(
            client
                .post(`/api/v1/routers/${red.routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr: publica, tipo: 'estatico', publica: true }),
            201,
        )
        assert.isTrue(creada.body().publica)
        const servicio = await crearServicio(client, token, red.routerId)
        assert.isTrue(
            servicio.ipv4.startsWith(red.base),
            'la asignación automática no toma de la red pública',
        )

        const adicional = await estado(
            client
                .post('/api/v1/adicionales')
                .bearerToken(token)
                .json({
                    codigo: unico('IPPUB')
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, ''),
                    nombre: 'IP pública',
                    precio_sugerido: '75.00',
                    tipo: 'ip_publica',
                }),
            201,
        )
        assert.equal(adicional.body().tipo, 'ip_publica')
        const asignada = await estado(
            client.post(`/api/v1/servicios/${servicio.id}/adicionales`).bearerToken(token).json({
                adicional_id: adicional.body().id,
                modalidad: 'cobrado',
                precio: '75.00',
            }),
            201,
        )
        const ip = asignada.body().ip_publica as string
        assert.isTrue(ip.startsWith(publica.replace('.0/24', '')))
        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.body().ipv4, ip)
        const config = await eventos('servicio.config_cambiada', (p) => p.servicio_id === servicio.id)
        assert.deepInclude(config, {
            servicio_id: servicio.id,
            empresa_id: servicio.empresa_id,
            campos: ['ips'],
        })

        // un segundo adicional de IP pública: 422
        await estado(
            client.post(`/api/v1/servicios/${servicio.id}/adicionales`).bearerToken(token).json({
                adicional_id: adicional.body().id,
                modalidad: 'cobrado',
                precio: '75.00',
            }),
            422,
        )

        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/adicionales/${asignada.body().id}/quitar`)
                .bearerToken(token)
                .json({ version: asignada.body().version }),
            200,
        )
        const despues = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.isTrue(despues.body().ipv4.startsWith(red.base))
        const libre = await db
            .from('network.ipv4_asignaciones')
            .whereRaw('ip = ?::inet', [ip])
            .whereNull('fin')
            .first()
        assert.isNull(libre)
    })

    test('plan que incluye IP pública: el alta toma una pública', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const red = await crearEscenarioRouter()
        const publica = redUnica()
        await db
            .table('network.redes_ipv4')
            .insert({ router_id: red.routerId, cidr: publica, tipo: 'estatico', publica: true })
        const plan = await crearPlanFila({ tipo: 'empresarial', incluye_ip_publica: true })
        const servicio = await crearServicio(client, token, red.routerId, plan)
        assert.isTrue(servicio.ipv4.startsWith(publica.replace('.0/24', '')))
        const vista = await estado(client.get(`/api/v1/planes/${plan}`).bearerToken(token), 200)
        assert.isTrue(vista.body().incluye_ip_publica)
    })
})

test.group('Falla general y caídas repetidas (decisión 31)', (group) => {
    group.each.setup(async () => {
        await db.from('core.ajustes_operacion').delete()
    })

    test('muchos servicios del router caen: un incidente, un evento por empresa, ids por API; luego se cierra', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const servicios = []
        for (let i = 0; i < 6; i++) servicios.push(await crearServicio(client, token, routerId))
        const ahora = new Date()
        // 5 de 6 cayeron hace 2 minutos (sin sesión abierta); el sexto sigue conectado
        for (const s of servicios.slice(0, 5)) {
            await sesion(s, routerId, {
                inicio: new Date(ahora.getTime() - 60 * MINUTO),
                fin: new Date(ahora.getTime() - 2 * MINUTO),
                causa_fin: 'NAS-Reboot',
            })
        }
        await sesion(servicios[5]!, routerId, { inicio: new Date(ahora.getTime() - 60 * MINUTO) })

        const corrida = (await ejecutarCronCore('fallas_generales', ahora)) as any
        assert.lengthOf(corrida.resultado.abiertos, 1)
        const incidenteId = corrida.resultado.abiertos[0]
        const abiertos = await eventos('red.falla_general_abierta', (p) => p.incidente_id === incidenteId)
        assert.lengthOf(abiertos, 1)
        assert.equal(abiertos[0]!.alcance, 'router')
        assert.equal(abiertos[0]!.alcance_id, routerId)
        assert.equal(abiertos[0]!.servicios_afectados.cantidad, 5)
        assert.sameMembers(
            abiertos[0]!.servicios_afectados.ids,
            servicios.slice(0, 5).map((s) => s.id),
        )
        assert.notProperty(abiertos[0]!, 'nombre')

        const pagina1 = await estado(
            client.get(`/api/v1/incidentes-red/${incidenteId}/servicios`).qs({ limit: 2 }).bearerToken(token),
            200,
        )
        assert.lengthOf(pagina1.body().data, 2)
        assert.isString(pagina1.body().nextCursor)
        await estado(
            client
                .get(`/api/v1/incidentes-red/${incidenteId}/servicios`)
                .qs({ limit: 1001 })
                .bearerToken(token),
            422,
        )
        await estado(
            client
                .get(`/api/v1/incidentes-red/${incidenteId}/servicios`)
                .qs({ empresa_id: 999999 })
                .bearerToken(token),
            404,
        )
        const deLaEmpresa = await estado(
            client
                .get(`/api/v1/incidentes-red/${incidenteId}/servicios`)
                .qs({ empresa_id: servicios[0]!.empresa_id })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(deLaEmpresa.body().data, 5)

        // mientras está abierto, otra corrida no abre otro
        const otra = (await ejecutarCronCore('fallas_generales', new Date(ahora.getTime() + MINUTO))) as any
        assert.lengthOf(otra.resultado.abiertos, 0)

        // vuelven 4 de 5: se cierra
        for (const s of servicios.slice(0, 4)) {
            await sesion(s, routerId, { inicio: new Date(ahora.getTime() + 2 * MINUTO) })
        }
        const cierre = (await ejecutarCronCore(
            'fallas_generales',
            new Date(ahora.getTime() + 3 * MINUTO),
        )) as any
        assert.deepEqual(cierre.resultado.cerrados, [incidenteId])
        const cerrados = await eventos('red.falla_general_cerrada', (p) => p.incidente_id === incidenteId)
        assert.lengthOf(cerrados, 1)
        assert.isString(cerrados[0]!.hasta)
        const ver = await estado(client.get(`/api/v1/incidentes-red/${incidenteId}`).bearerToken(token), 200)
        assert.equal(ver.body().estado, 'cerrado')
        assert.equal(ver.body().motivo_cierre, 'recuperado')
    })

    test('abierto a mano: motivo y actor; cajero 403; Iris tiene incidentes_red.leer', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['tecnico'])
        const admin = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const s = await crearServicio(client, admin.token, routerId)
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(cajero.token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'corte de fibra' }),
            403,
        )
        const r = await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'corte de fibra' }),
            201,
        )
        assert.equal(r.body().origen, 'manual')
        assert.equal(r.body().abierto_por, usuario.id)
        assert.equal(r.body().motivo, 'corte de fibra')
        assert.equal(r.body().servicios_afectados, 1)
        await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'otra vez' }),
            409,
        )
        const evento = await eventos('red.falla_general_abierta', (p) => p.incidente_id === r.body().id)
        assert.equal(evento[0]!.origen, 'manual')
        assert.deepEqual(evento[0]!.servicios_afectados.ids, [s.id])

        const rolIris = await db.from('core.roles').where('nombre', 'integracion_iris').first()
        if (rolIris) {
            const tiene = await db
                .from('core.roles_permisos as rp')
                .join('core.permisos as p', 'p.id', 'rp.permiso_id')
                .where('rp.role_id', rolIris.id)
                .where('p.nombre', 'incidentes_red.leer')
                .first()
            assert.exists(tiene)
        }
        const { PERMISOS_IRIS_CONTRATO } = await import('#core/integraciones_iris')
        assert.include([...PERMISOS_IRIS_CONTRATO], 'incidentes_red.leer')

        await estado(
            client
                .post(`/api/v1/incidentes-red/${r.body().id}/cerrar`)
                .bearerToken(token)
                .json({ motivo: 'reparado' }),
            200,
        )
    })

    test('afectados con datos para el tablero: código, cliente, plan, conexión; cursor y alcance del usuario', async ({
        client,
        assert,
    }) => {
        const admin = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const otro = await crearEscenarioRouter()
        const plan = await crearPlanFila()
        const servicios = []
        for (let i = 0; i < 3; i++) servicios.push(await crearServicio(client, admin.token, routerId, plan))
        const ahora = Date.now()
        // el primero volvió, el segundo sigue caído y el tercero nunca tuvo sesión
        await sesion(servicios[0]!, routerId, {
            inicio: new Date(ahora - 90 * MINUTO),
            fin: new Date(ahora - 30 * MINUTO),
            causa_fin: 'NAS-Reboot',
        })
        const volvio = new Date(ahora - 5 * MINUTO)
        await sesion(servicios[0]!, routerId, { inicio: volvio })
        const cayo = new Date(ahora - 20 * MINUTO)
        await sesion(servicios[1]!, routerId, {
            inicio: new Date(ahora - 90 * MINUTO),
            fin: cayo,
            causa_fin: 'Lost-Carrier',
        })
        const abierto = await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(admin.token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'corte de fibra' }),
            201,
        )
        const id = abierto.body().id
        const url = `/api/v1/incidentes-red/${id}/afectados`

        const p1 = await estado(client.get(url).qs({ limit: 2 }).bearerToken(admin.token), 200)
        assert.lengthOf(p1.body().data, 2)
        assert.isString(p1.body().nextCursor)
        assert.equal(p1.body().total, 3)
        const p2 = await estado(
            client.get(url).qs({ limit: 2, cursor: p1.body().nextCursor }).bearerToken(admin.token),
            200,
        )
        assert.isNull(p2.body().nextCursor)
        assert.equal(p2.body().total, 3)
        const filas = [...p1.body().data, ...p2.body().data]
        assert.deepEqual(
            filas.map((f: any) => f.servicio_id),
            servicios.map((s) => s.id),
        )
        const cliente = (await db
            .from('core.clientes')
            .where('id', servicios[0]!.cliente_id)
            .select('nombre')
            .first()) as { nombre: string }
        const nombrePlan = (await db.from('network.planes').where('id', plan).select('nombre').first()) as {
            nombre: string
        }
        const [a, b, c] = filas
        assert.match(a.codigo, /^S-\d+$/)
        assert.equal(a.codigo, servicios[0]!.codigo)
        assert.equal(a.cliente_id, servicios[0]!.cliente_id)
        assert.equal(a.cliente_nombre, cliente.nombre)
        assert.equal(a.plan_id, plan)
        assert.equal(a.plan_nombre, nombrePlan.nombre)
        assert.equal(a.router_id, routerId)
        assert.equal(a.empresa_id, servicios[0]!.empresa_id)
        assert.isString(a.empresa_nombre)
        assert.equal(a.estado, 'activo')
        assert.isTrue(a.conectado)
        assert.equal(a.conectado_desde, volvio.toISOString())
        assert.isNull(a.desconectado_desde)
        assert.isFalse(b.conectado)
        assert.isNull(b.conectado_desde)
        assert.equal(b.desconectado_desde, cayo.toISOString())
        assert.isFalse(c.conectado)
        assert.isNull(c.desconectado_desde)

        // alcance por router: el técnico de otro router ve el incidente pero ningún afectado
        const rol = (await db.from('core.roles').where('nombre', 'tecnico').select('id').first()) as {
            id: number
        }
        const ajeno = await usuarioConRoles([])
        await db.table('core.usuarios_roles').insert({
            usuario_id: ajeno.usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: otro.routerId,
        })
        const vacio = await estado(client.get(url).bearerToken(ajeno.token), 200)
        assert.deepEqual(vacio.body(), { data: [], nextCursor: null, total: 0 })
        const propio = await usuarioConRoles([])
        await db.table('core.usuarios_roles').insert({
            usuario_id: propio.usuario.id,
            role_id: rol.id,
            alcance_tipo: 'router',
            alcance_id: routerId,
        })
        const delPropio = await estado(client.get(url).bearerToken(propio.token), 200)
        assert.lengthOf(delPropio.body().data, 3)
        assert.equal(delPropio.body().total, 3)

        const sinPermiso = await usuarioConRoles(['contabilidad'])
        await estado(client.get(url).bearerToken(sinPermiso.token), 403)
        await estado(client.get('/api/v1/incidentes-red/99999999/afectados').bearerToken(admin.token), 404)
        await estado(client.get(url).qs({ limit: 201 }).bearerToken(admin.token), 422)
        await estado(
            client
                .post(`/api/v1/incidentes-red/${id}/cerrar`)
                .bearerToken(admin.token)
                .json({ motivo: 'listo' }),
            200,
        )
    })

    test('caídas repetidas: 3 en 60 min de fábrica, alerta visible; sin aviso dentro de un incidente', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const s = await crearServicio(client, token, routerId)
        const { procesarAccounting } = await import('#network/sesiones/cola')
        const nas = (await db.from('network.routers').where('id', routerId).select('nas_ip').first()) as {
            nas_ip: string
        }
        const base = new Date(Date.now() - 5 * 3_600_000)
        const stop = (minuto: number) =>
            procesarAccounting(
                {
                    tipo: 'Stop',
                    nas_ip: nas.nas_ip,
                    acct_session_id: unico('ses'),
                    user_ppp: s.user_ppp,
                    ipv4: s.ipv4,
                    prefijo_enlace_v6: null,
                    prefijo_delegado_v6: null,
                    bytes_in: '1',
                    bytes_out: '1',
                    duracion_s: 30,
                    causa_fin: 'Lost-Carrier',
                    evento_en: new Date(base.getTime() + minuto * MINUTO).toISOString(),
                } as never,
                unico('req'),
            )
        await stop(0)
        await stop(10)
        await stop(20)
        const avisos = await eventos('servicio.caidas_repetidas', (p) => p.servicio_id === s.id)
        assert.lengthOf(avisos, 1)
        assert.equal(avisos[0]!.umbral, 3)
        assert.equal(avisos[0]!.ventana_minutos, 60)
        const alerta = await estado(
            client.get(`/api/v1/servicios/${s.id}/caidas-repetidas`).bearerToken(token),
            200,
        )
        assert.lengthOf(alerta.body().data, 1)

        // con un incidente abierto en su router, no hay aviso por servicio
        await estado(
            client
                .post('/api/v1/incidentes-red')
                .bearerToken(token)
                .json({ alcance: 'router', alcance_id: routerId, motivo: 'falla general' }),
            201,
        )
        await stop(200)
        await stop(210)
        await stop(220)
        assert.lengthOf(await eventos('servicio.caidas_repetidas', (p) => p.servicio_id === s.id), 1)
    })
})
