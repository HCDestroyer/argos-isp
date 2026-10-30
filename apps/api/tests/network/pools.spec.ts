import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { estado, usuarioConRoles } from '#tests/ayudas'
import {
    bloqueV6Unico,
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    redUnica,
} from '#tests/core/fabricas'

/**
 * Pools editables y migrables, ocupación y vistas previas IPv6 (`contratos/pools.md`).
 */

type Cliente = any

async function crearRed(routerId: number, datos: Record<string, unknown>) {
    const [fila] = (await db
        .table('network.redes_ipv4')
        .insert({ router_id: routerId, tipo: 'estatico', ...datos })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function crearBloque(routerId: number, prefijo: string) {
    const [fila] = (await db
        .table('network.ipv6_bloques')
        .insert({ router_id: routerId, prefijo })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function crearPool(bloqueId: number, prefijo: string, tipo: 'enlace' | 'delegacion', tamano: number) {
    const [fila] = (await db
        .table('network.ipv6_pools')
        .insert({ bloque_id: bloqueId, prefijo, tipo, tamano_entrega: tamano })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

async function crearServicio(
    client: Cliente,
    token: string,
    routerId: number,
    planId: number,
    extra: Record<string, unknown> = {},
) {
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: await crearClienteFila(),
                router_id: routerId,
                plan_id: planId,
                ...extra,
            }),
        201,
    )
    return r.body() as Record<string, any>
}

async function eventosDe(servicioId: number, evento: string) {
    return (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .select('payload')) as Array<{ payload: Record<string, any> }>
}

async function leerRedis(userPpp: string): Promise<Record<string, any> | null> {
    const valor = await redis().get(claveAaa(userPpp))
    return valor === null ? null : (JSON.parse(valor) as Record<string, any>)
}

test.group('Pools · ocupación IPv4 y rango', () => {
    test('ocupación en lista y detalle; la asignación respeta el rango', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        const base = redUnica().replace('.0/24', '')
        const redId = await crearRed(routerId, {
            cidr: `${base}.0/29`,
            gateway: `${base}.1`,
            rango_inicio: `${base}.2`,
            rango_fin: `${base}.5`,
        })
        const planId = await crearPlanFila({ dual_stack: 'v4' })

        const primero = await crearServicio(client, token, routerId, planId)
        assert.equal(primero.ipv4, `${base}.2`)
        const segundo = await crearServicio(client, token, routerId, planId)
        assert.equal(segundo.ipv4, `${base}.3`)

        // fuera del rango: 422 en ipv4
        const fuera = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                    ipv4: `${base}.6`,
                }),
            422,
        )
        assert.equal(fuera.body().errors[0].field, 'ipv4')
        assert.include(fuera.body().errors[0].message, 'rango')

        const detalle = await estado(client.get(`/api/v1/redes-ipv4/${redId}`).bearerToken(token), 200)
        // /29: 6 hosts (.1–.6); rango .2–.5; gateway .1 y .6 reservadas
        assert.deepEqual(detalle.body().ocupacion, {
            total: 6,
            asignadas: 2,
            libres: 2,
            reservadas: 2,
            porcentaje: 50,
        })
        assert.equal(detalle.body().rango_inicio, `${base}.2`)
        const listaRedes = await estado(
            client.get(`/api/v1/routers/${routerId}/redes-ipv4`).bearerToken(token),
            200,
        )
        assert.deepEqual(listaRedes.body()[0].ocupacion, detalle.body().ocupacion)
    })

    test('crear red: mensajes que explican lo obligatorio y validación del rango', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila()
        const sinDatos = await estado(
            client.post(`/api/v1/routers/${routerId}/redes-ipv4`).bearerToken(token).json({}),
            422,
        )
        const cidr = sinDatos.body().errors.find((e: any) => e.field === 'cidr')
        assert.include(cidr.message, 'obligatoria')
        assert.include(cidr.message, 'IPs que reciben los clientes')
        const tipo = sinDatos.body().errors.find((e: any) => e.field === 'tipo')
        assert.include(tipo.message, 'estatico')

        const base = redUnica().replace('.0/24', '')
        const incompleto = await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({ cidr: `${base}.0/24`, tipo: 'estatico', rango_inicio: `${base}.10` }),
            422,
        )
        assert.equal(incompleto.body().errors[0].field, 'rango_fin')
        const invertido = await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({
                    cidr: `${base}.0/24`,
                    tipo: 'estatico',
                    rango_inicio: `${base}.50`,
                    rango_fin: `${base}.10`,
                }),
            422,
        )
        assert.equal(invertido.body().errors[0].field, 'rango_fin')
        const creada = await estado(
            client
                .post(`/api/v1/routers/${routerId}/redes-ipv4`)
                .bearerToken(token)
                .json({
                    cidr: `${base}.0/24`,
                    tipo: 'pool',
                    nombre: 'Clientes norte',
                    gateway: `${base}.1`,
                    rango_inicio: `${base}.10`,
                    rango_fin: `${base}.20`,
                    dns_primario: '8.8.8.8',
                }),
            201,
        )
        assert.containsSubset(creada.body(), {
            nombre: 'Clientes norte',
            dns_primario: '8.8.8.8',
            dns_secundario: null,
            ocupacion: { total: 254, asignadas: 0, libres: 11, reservadas: 243, porcentaje: 0 },
        })
    })
})

test.group('Pools · editar red IPv4', () => {
    test('edita con version; 409 con la versión vieja; 422 con la lista si deja IPs fuera', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        const base = redUnica().replace('.0/24', '')
        const redId = await crearRed(routerId, { cidr: `${base}.0/24`, gateway: `${base}.1` })
        const planId = await crearPlanFila({ dual_stack: 'v4' })
        const servicio = await crearServicio(client, admin, routerId, planId, { ipv4: `${base}.200` })

        const editada = await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Troncal', dns_primario: '1.1.1.1', tipo: 'pool' }),
            200,
        )
        assert.containsSubset(editada.body(), { version: 2, nombre: 'Troncal', tipo: 'pool' })
        const cambios = (await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'red_ipv4', entidad_id: redId })
            .select('campo')) as Array<{ campo: string }>
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'dns_primario', 'tipo'],
        )
        assert.notInclude(
            cambios.map((c) => c.campo),
            'ocupacion',
        )

        await estado(
            client.put(`/api/v1/redes-ipv4/${redId}`).bearerToken(token).json({ version: 1, nombre: 'Otra' }),
            409,
        )
        const sinVersion = await estado(
            client.put(`/api/v1/redes-ipv4/${redId}`).bearerToken(token).json({ nombre: 'Otra' }),
            422,
        )
        assert.include(sinVersion.body().errors[0].message, 'otra sesión')

        // achicar a /25 deja fuera .200
        const achicar = await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(token)
                .json({ version: 2, cidr: `${base}.0/25` }),
            422,
        )
        assert.equal(achicar.body().type, 'urn:argosisp:problema:ips_asignadas_fuera')
        assert.lengthOf(achicar.body().errors, 1)
        assert.equal(achicar.body().errors[0].field, 'cidr')
        assert.include(achicar.body().errors[0].message, `${base}.200`)
        assert.include(achicar.body().errors[0].message, String(servicio.id))

        // rango que deja fuera .200
        const rango = await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(token)
                .json({ version: 2, rango_inicio: `${base}.10`, rango_fin: `${base}.100` }),
            422,
        )
        assert.equal(rango.body().errors[0].field, 'rango_inicio')
        // gateway sobre una IP asignada
        const gateway = await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(token)
                .json({ version: 2, gateway: `${base}.200` }),
            422,
        )
        assert.equal(gateway.body().errors[0].field, 'gateway')

        // agrandar sí se puede (si no se traslapa)
        const rangoOk = await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(token)
                .json({ version: 2, rango_inicio: `${base}.10`, rango_fin: `${base}.250` }),
            200,
        )
        assert.equal(rangoOk.body().ocupacion.asignadas, 1)
        assert.equal(rangoOk.body().ocupacion.libres, 240)

        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .put(`/api/v1/redes-ipv4/${redId}`)
                .bearerToken(cajero.token)
                .json({ version: 3, nombre: 'x' }),
            403,
        )
    })

    test('409 si la red nueva se traslapa con otra', async ({ client }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const routerId = await crearRouterFila()
        const a = redUnica()
        const b = redUnica()
        const redId = await crearRed(routerId, { cidr: a })
        await crearRed(routerId, { cidr: b })
        // si los /24 son contiguos, el /23 que contiene a `a` puede tocar a `b`; usamos un /16
        const supernet = a.split('.').slice(0, 2).join('.') + '.0.0/16'
        await estado(
            client.put(`/api/v1/redes-ipv4/${redId}`).bearerToken(token).json({ version: 1, cidr: supernet }),
            409,
        )
    })
})

test.group('Pools · migrar red IPv4', () => {
    test('sin mover_servicios: 422 con la lista; simular no guarda; con mover_servicios pasan los servicios', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const origen = await crearEscenarioRouter()
        const destino = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const servicio = await crearServicio(client, token, origen.routerId, planId)
        const red = (await db
            .from('network.redes_ipv4')
            .where('router_id', origen.routerId)
            .select('id', 'version')
            .firstOrFail()) as { id: number; version: number }

        const rechazo = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version, router_id: destino.routerId }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:pool_con_servicios')
        assert.lengthOf(rechazo.body().errors, 1)
        assert.include(rechazo.body().errors[0].message, servicio.ipv4)

        const simulada = await estado(
            client.post(`/api/v1/redes-ipv4/${red.id}/migrar`).bearerToken(token).json({
                version: red.version,
                router_id: destino.routerId,
                mover_servicios: true,
                simular: true,
            }),
            200,
        )
        assert.isTrue(simulada.body().simulado)
        assert.lengthOf(simulada.body().servicios, 1)
        assert.equal(simulada.body().servicios[0].despues.ipv4, servicio.ipv4)
        assert.equal(simulada.body().servicios[0].despues.router_id, destino.routerId)
        // nada cambió
        const tras = (await db.from('core.servicios').where('id', servicio.id).firstOrFail()) as {
            router_id: number
            version: number
        }
        assert.equal(tras.router_id, origen.routerId)
        const redTras = (await db.from('network.redes_ipv4').where('id', red.id).firstOrFail()) as {
            router_id: number
            version: number
        }
        assert.equal(redTras.router_id, origen.routerId)
        assert.lengthOf(await eventosDe(servicio.id, 'servicio.config_cambiada'), 0)
        // el rechazo queda auditado como error; la simulación no deja nada
        const auditoriaPrevia = (await db
            .from('audit.acciones')
            .where('accion', 'redes.migrar')
            .where('entidad_id', red.id)
            .select('resultado')) as Array<{ resultado: string }>
        assert.deepEqual(
            auditoriaPrevia.map((a) => a.resultado),
            ['error'],
        )

        const migrada = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version, router_id: destino.routerId, mover_servicios: true }),
            200,
        )
        assert.isFalse(migrada.body().simulado)
        assert.equal(migrada.body().redes_ipv4[0].router_id, destino.routerId)
        const despues = migrada.body().servicios[0]
        assert.equal(despues.antes.router_id, origen.routerId)
        assert.equal(despues.despues.ipv4, servicio.ipv4)
        // la IPv6 se reservó en el destino (sus bloques no se mudaron)
        assert.notEqual(despues.despues.prefijo_delegado_v6, servicio.prefijo_delegado_v6)
        const poolDestino = await db
            .from('network.ipv6_pools as p')
            .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
            .where('b.router_id', destino.routerId)
            .whereRaw('p.prefijo >>= ?::cidr', [despues.despues.prefijo_delegado_v6])
            .first()
        assert.exists(poolDestino)

        const ver = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.equal(ver.body().router_id, destino.routerId)
        assert.equal(ver.body().ipv4, servicio.ipv4)
        const config = await eventosDe(servicio.id, 'servicio.config_cambiada')
        assert.isTrue(config.some((e) => e.payload.campos.includes('router')))
        const asignacion = await eventosDe(servicio.id, 'asignacion.cambiada')
        assert.isAtLeast(asignacion.length, 2) // alta + migración
        const registro = await leerRedis(servicio.user_ppp)
        assert.equal(registro?.router_id, destino.routerId)
        assert.equal(registro?.ipv4?.ip, servicio.ipv4)

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'redes.migrar')
            .where('entidad_id', red.id)
            .where('resultado', 'ok')
        assert.lengthOf(auditoria, 1)
        const diff = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'red_ipv4', entidad_id: red.id, campo: 'router_id' })
        assert.lengthOf(diff, 1)
    })

    test('mudando también el bloque IPv6 los servicios conservan IPv4 y prefijos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const origen = await crearEscenarioRouter()
        const destino = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const servicio = await crearServicio(client, token, origen.routerId, planId)
        const red = (await db
            .from('network.redes_ipv4')
            .where('router_id', origen.routerId)
            .firstOrFail()) as { id: number; version: number }
        const bloque = (await db
            .from('network.ipv6_bloques')
            .where('router_id', origen.routerId)
            .firstOrFail()) as { id: number }

        const migrada = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({
                    version: red.version,
                    router_id: destino.routerId,
                    mover_servicios: true,
                    bloques_ipv6: [bloque.id],
                }),
            200,
        )
        assert.equal(migrada.body().bloques_ipv6[0].router_id, destino.routerId)
        assert.deepEqual(migrada.body().servicios[0].despues, {
            router_id: destino.routerId,
            ipv4: servicio.ipv4,
            prefijo_enlace_v6: servicio.prefijo_enlace_v6,
            prefijo_delegado_v6: servicio.prefijo_delegado_v6,
        })
        const pools = await estado(
            client.get(`/api/v1/ipv6-bloques/${bloque.id}/pools`).bearerToken(token),
            200,
        )
        assert.isTrue(pools.body().every((p: any) => p.router_id === destino.routerId))
    })

    test('un servicio que no puede pasar: 422 servicio_no_migrable y nada cambia', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const origen = await crearEscenarioRouter()
        // destino sin bloques IPv6: el servicio dual stack no tendría prefijos
        const destino = await crearRouterFila()
        const planId = await crearPlanFila()
        const servicio = await crearServicio(client, token, origen.routerId, planId)
        const red = (await db
            .from('network.redes_ipv4')
            .where('router_id', origen.routerId)
            .firstOrFail()) as { id: number; version: number }

        const r = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version, router_id: destino, mover_servicios: true }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:servicio_no_migrable')
        assert.include(r.body().detail, String(servicio.id))
        const tras = (await db.from('network.redes_ipv4').where('id', red.id).firstOrFail()) as {
            router_id: number
        }
        assert.equal(tras.router_id, origen.routerId)
    })

    test('permisos: cajero 403; mudar bloques pide ipv6.migrar; mismo router 422', async ({
        client,
        assert,
    }) => {
        const origen = await crearEscenarioRouter()
        const destino = await crearRouterFila()
        const red = (await db
            .from('network.redes_ipv4')
            .where('router_id', origen.routerId)
            .firstOrFail()) as { id: number; version: number }
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(cajero.token)
                .json({ version: red.version, router_id: destino }),
            403,
        )
        const { token } = await usuarioConRoles(['tecnico'])
        const mismo = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version, router_id: origen.routerId }),
            422,
        )
        assert.equal(mismo.body().errors[0].field, 'router_id')
        await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version + 5, router_id: destino }),
            409,
        )
        // sin servicios se muda sin mover_servicios
        const ok = await estado(
            client
                .post(`/api/v1/redes-ipv4/${red.id}/migrar`)
                .bearerToken(token)
                .json({ version: red.version, router_id: destino }),
            200,
        )
        assert.lengthOf(ok.body().servicios, 0)
        assert.equal(ok.body().redes_ipv4[0].version, red.version + 1)
    })
})

test.group('Pools · IPv6', () => {
    test('varios bloques por router; ocupación y entrega de cada pool', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId, raiz } = await crearEscenarioRouter()
        // segundo bloque de otro proveedor en el mismo router
        const otro = bloqueV6Unico()
        const b2 = await estado(
            client
                .post(`/api/v1/routers/${routerId}/ipv6-bloques`)
                .bearerToken(token)
                .json({ prefijo: otro, nombre: 'Proveedor B', proveedor: 'Tigo' }),
            201,
        )
        assert.containsSubset(b2.body(), {
            proveedor: 'Tigo',
            espacio: { pools: 0, porcentaje_en_pools: 0 },
        })
        const bloques = await estado(
            client.get(`/api/v1/routers/${routerId}/ipv6-bloques`).bearerToken(token),
            200,
        )
        assert.lengthOf(bloques.body(), 2)

        const planId = await crearPlanFila()
        await crearServicio(client, token, routerId, planId)
        const primerBloque = bloques.body().find((b: any) => b.proveedor === null)
        // /48 + /44 + /44 dentro de un /40: 1/256 + 1/16 + 1/16
        assert.equal(primerBloque.espacio.pools, 3)
        assert.equal(primerBloque.espacio.porcentaje_en_pools, 12.9)
        const pools = await estado(
            client.get(`/api/v1/ipv6-bloques/${primerBloque.id}/pools`).bearerToken(token),
            200,
        )
        const delegacion = pools.body().find((p: any) => p.tipo === 'delegacion' && p.tamano_entrega === 56)
        // /44 → /56: 4096 prefijos
        assert.deepEqual(delegacion.ocupacion, {
            total: 4096,
            asignadas: 1,
            libres: 4095,
            reservadas: 0,
            porcentaje: 0,
        })
        assert.deepEqual(delegacion.entrega, {
            atributo_radius: 'Delegated-IPv6-Prefix',
            redes_lan_por_cliente: 256,
            clientes_maximos: 4096,
            primer_prefijo: `${raiz}10::/56`,
            segundo_prefijo: `${raiz}10:100::/56`,
            ultimo_prefijo: `${raiz}1f:ff00::/56`,
        })
        const enlace = pools.body().find((p: any) => p.tipo === 'enlace')
        assert.equal(enlace.entrega.atributo_radius, 'Framed-IPv6-Prefix')
        assert.equal(enlace.entrega.redes_lan_por_cliente, 1)
        assert.equal(enlace.ocupacion.total, 65536)

        const detalle = await estado(
            client.get(`/api/v1/ipv6-pools/${delegacion.id}`).bearerToken(token),
            200,
        )
        assert.deepEqual(detalle.body().ocupacion, delegacion.ocupacion)
    })

    test('un estático de otro tamaño cuenta como reservado', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const routerId = await crearRouterFila()
        const bloque = bloqueV6Unico()
        const raiz = bloque.replace('00::/40', '')
        const bloqueId = await crearBloque(routerId, bloque)
        const poolId = await crearPool(bloqueId, `${raiz}00::/52`, 'delegacion', 56)
        const planId = await crearPlanFila({ dual_stack: 'v4' })
        const base = redUnica().replace('.0/24', '')
        await crearRed(routerId, { cidr: `${base}.0/24` })
        const servicio = await crearServicio(client, token, routerId, planId)
        // un /60 manual dentro del pool ocupa un /56 completo
        await db.table('network.ipv6_asignaciones').insert({
            servicio_id: servicio.id,
            prefijo: `${raiz}00:500::/60`,
            tipo: 'delegacion',
        })
        const pool = await estado(client.get(`/api/v1/ipv6-pools/${poolId}`).bearerToken(token), 200)
        assert.deepEqual(pool.body().ocupacion, {
            total: 16,
            asignadas: 0,
            libres: 15,
            reservadas: 1,
            porcentaje: 0,
        })
    })

    test('editar pool: 422 si deja prefijos fuera o cambia el tipo con asignaciones; 409 por versión', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId, raiz } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const servicio = await crearServicio(client, token, routerId, planId)
        const pool = (await db
            .from('network.ipv6_pools as p')
            .join('network.ipv6_bloques as b', 'b.id', 'p.bloque_id')
            .where('b.router_id', routerId)
            .where('p.tipo', 'delegacion')
            .where('p.tamano_entrega', 56)
            .select('p.id', 'p.version')
            .firstOrFail()) as { id: number; version: number }

        const renombrado = await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: pool.version, nombre: 'PD clientes', nombre_en_router: 'pd-56' }),
            200,
        )
        assert.containsSubset(renombrado.body(), { nombre: 'PD clientes', nombre_en_router: 'pd-56' })
        await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: pool.version, nombre: 'x' }),
            409,
        )
        const v = pool.version + 1
        // el servicio tiene el primer /56 del /44 (raiz10::/56); mover el pool a la mitad alta lo deja fuera
        const fuera = await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: v, prefijo: `${raiz}18::/45` }),
            422,
        )
        assert.equal(fuera.body().type, 'urn:argosisp:problema:prefijos_asignados_fuera')
        assert.include(fuera.body().errors[0].message, servicio.prefijo_delegado_v6)
        const tipo = await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: v, tamano_entrega: 48 }),
            422,
        )
        assert.equal(tipo.body().type, 'urn:argosisp:problema:pool_con_asignaciones')
        assert.equal(tipo.body().errors[0].field, 'tamano_entrega')
        // achicar sin dejar fuera sí: /45 baja
        const achicado = await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: v, prefijo: `${raiz}10::/45` }),
            200,
        )
        assert.equal(achicado.body().ocupacion.total, 2048)
        // fuera del bloque
        await estado(
            client
                .put(`/api/v1/ipv6-pools/${pool.id}`)
                .bearerToken(token)
                .json({ version: v + 1, prefijo: '2001:db8:ff00::/44' }),
            422,
        )
    })

    test('editar bloque: 422 si deja pools fuera; nombre y proveedor', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId, raiz } = await crearEscenarioRouter()
        const bloque = (await db.from('network.ipv6_bloques').where('router_id', routerId).firstOrFail()) as {
            id: number
            version: number
        }
        const fuera = await estado(
            client
                .put(`/api/v1/ipv6-bloques/${bloque.id}`)
                .bearerToken(token)
                .json({ version: bloque.version, prefijo: `${raiz}00::/44` }),
            422,
        )
        assert.equal(fuera.body().type, 'urn:argosisp:problema:pools_fuera_del_bloque')
        assert.lengthOf(fuera.body().errors, 2)
        const ok = await estado(
            client
                .put(`/api/v1/ipv6-bloques/${bloque.id}`)
                .bearerToken(token)
                .json({ version: bloque.version, nombre: 'Principal', proveedor: 'Claro' }),
            200,
        )
        assert.containsSubset(ok.body(), {
            nombre: 'Principal',
            proveedor: 'Claro',
            version: bloque.version + 1,
        })
    })

    test('migrar bloque con sus pools: servicios conservan prefijos y reciben IPv4 del destino', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const origen = await crearEscenarioRouter()
        const destino = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const servicio = await crearServicio(client, token, origen.routerId, planId)
        const bloque = (await db
            .from('network.ipv6_bloques')
            .where('router_id', origen.routerId)
            .firstOrFail()) as { id: number; version: number }

        const rechazo = await estado(
            client
                .post(`/api/v1/ipv6-bloques/${bloque.id}/migrar`)
                .bearerToken(token)
                .json({ version: bloque.version, router_id: destino.routerId }),
            422,
        )
        assert.equal(rechazo.body().type, 'urn:argosisp:problema:pool_con_servicios')
        assert.include(rechazo.body().errors[0].message, servicio.prefijo_delegado_v6)

        const migrada = await estado(
            client
                .post(`/api/v1/ipv6-bloques/${bloque.id}/migrar`)
                .bearerToken(token)
                .json({ version: bloque.version, router_id: destino.routerId, mover_servicios: true }),
            200,
        )
        const s = migrada.body().servicios[0]
        assert.equal(s.despues.prefijo_delegado_v6, servicio.prefijo_delegado_v6)
        assert.equal(s.despues.prefijo_enlace_v6, servicio.prefijo_enlace_v6)
        assert.isTrue(s.despues.ipv4.startsWith(`${destino.base}.`))
        assert.notEqual(s.despues.ipv4, servicio.ipv4)
    })

    test('vistas previas de bloque y pool', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const bloque = await estado(
            client
                .post('/api/v1/ipv6-bloques/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::/40', tamano_delegado: 56 }),
            200,
        )
        assert.deepEqual(bloque.body(), {
            prefijo: '2001:db8:4000::/40',
            tamano_delegado: 56,
            clientes: 32768,
            redes_lan_por_cliente: 256,
            pools_sugeridos: [
                { tipo: 'enlace', prefijo: '2001:db8:4000::/49', tamano_entrega: 64, clientes: 32768 },
                { tipo: 'delegacion', prefijo: '2001:db8:4080::/41', tamano_entrega: 56, clientes: 32768 },
            ],
            ejemplos: [
                { servicio: 1, prefijo_enlace: '2001:db8:4000::/64', prefijo_delegado: '2001:db8:4080::/56' },
                {
                    servicio: 2,
                    prefijo_enlace: '2001:db8:4000:1::/64',
                    prefijo_delegado: '2001:db8:4080:100::/56',
                },
            ],
            traslapa_con: bloque.body().traslapa_con,
        })
        const chico = await estado(
            client
                .post('/api/v1/ipv6-bloques/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::/56', tamano_delegado: 56 }),
            422,
        )
        assert.include(chico.body().errors[0].message, '/55')
        await estado(
            client
                .post('/api/v1/ipv6-bloques/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::1/40', tamano_delegado: 56 }),
            422,
        )
        const sinTamano = await estado(
            client
                .post('/api/v1/ipv6-bloques/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::/40' }),
            422,
        )
        assert.include(sinTamano.body().errors[0].message, 'prefijo que recibe cada cliente')

        const pool = await estado(
            client
                .post('/api/v1/ipv6-pools/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::/48', tipo: 'delegacion', tamano_entrega: 56 }),
            200,
        )
        assert.containsSubset(pool.body(), {
            clientes_maximos: 256,
            redes_lan_por_cliente: 256,
            atributo_radius: 'Delegated-IPv6-Prefix',
            primer_prefijo: '2001:db8:4000::/56',
            ultimo_prefijo: '2001:db8:4000:ff00::/56',
        })
        const enlaceMal = await estado(
            client
                .post('/api/v1/ipv6-pools/vista-previa')
                .bearerToken(token)
                .json({ prefijo: '2001:db8:4000::/48', tipo: 'enlace', tamano_entrega: 56 }),
            422,
        )
        assert.equal(enlaceMal.body().errors[0].field, 'tamano_entrega')
    })
})

test.group('Pools · direccionamiento del router', () => {
    test('resumen con ocupación por familia y lo que recibe cada plan', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const { routerId } = await crearEscenarioRouter()
        const plan56 = await crearPlanFila()
        const plan64 = await crearPlanFila({ tamano_prefijo_delegado: 64 })
        await crearServicio(client, token, routerId, plan56)

        const r = await estado(
            client.get(`/api/v1/routers/${routerId}/direccionamiento`).bearerToken(token),
            200,
        )
        assert.equal(r.body().router_id, routerId)
        assert.lengthOf(r.body().redes_ipv4, 1)
        assert.lengthOf(r.body().bloques_ipv6[0].pools, 3)
        assert.containsSubset(r.body().ocupacion.ipv4, {
            total: 254,
            asignadas: 1,
            reservadas: 1,
            libres: 252,
        })
        assert.deepEqual(
            r.body().ocupacion.ipv6.map((g: any) => `${g.tipo}/${g.tamano_entrega}`),
            ['delegacion/56', 'delegacion/48', 'enlace/64'],
        )
        const de56 = r.body().planes.find((p: any) => p.plan_id === plan56)
        assert.containsSubset(de56, {
            ipv4: { origen: 'redes', pool: null, libres: 252 },
            ipv6: {
                prefijo_enlace: 64,
                prefijo_delegado: 56,
                redes_lan_por_cliente: 256,
                delegados_libres: 4095,
            },
            avisos: [],
        })
        const de64 = r.body().planes.find((p: any) => p.plan_id === plan64)
        assert.deepEqual(
            de64.avisos.map((a: any) => a.codigo),
            ['sin_pool_delegacion'],
        )
    })
})
