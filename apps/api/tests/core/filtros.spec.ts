import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearPlantillaFila, generar } from '#tests/billing/ayudas_billing'
import VencerFacturas from '#billing/actions/vencer_facturas'
import {
    crearClienteFila,
    crearPlanFila,
    crearRouterFila,
    crearServicioFila,
    crearZonaFila,
} from '#tests/core/fabricas'

/**
 * Filtros avanzados (pedido del PM, día 3): `GET /clientes`, `GET /servicios`, nombres en la vista
 * `Servicio` y `GET /bitacora/acciones` por cliente, canal y con `actor_nombre`.
 */

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<number> {
    const [r] = (await db.table(tabla).insert(fila).returning('id')) as Array<{ id: number }>
    return r!.id
}

/**
 * Factura vencida del periodo 2026-09 emitida por billing (`GenerarFacturas` + `VencerFacturas`),
 * con su asiento de CxC: un INSERT directo dejaba cartera sin CxC en la empresa principal y hacía
 * fallar la conciliación «cartera vencida vs. CxC» de A3 según el orden de los archivos.
 * `VencerFacturas` no cambia el estado del servicio.
 */
async function facturaVencida(servicioId: number): Promise<number> {
    const plantillaId = await crearPlantillaFila({ mora_tipo: 'ninguna' })
    await db
        .from('core.servicios')
        .where('id', servicioId)
        .update({ plantilla_facturacion_id: plantillaId, fecha_instalacion: '2026-09-01' })
    await generar(servicioId, '2026-09-01')
    await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-10-01' }, contextoPrueba())
    const factura = await db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .where('estado', 'vencida')
        .orderBy('id', 'asc')
        .firstOrFail()
    return Number(factura.id)
}

async function promesa(clienteId: number, servicioId: number, estadoPromesa = 'activa') {
    return insertar('billing.promesas', {
        cliente_id: clienteId,
        servicio_id: servicioId,
        vence_en: new Date(Date.now() + 86_400_000),
        monto: '112.00',
        estado: estadoPromesa,
        canal: 'operador',
    })
}

/**
 * Z1: C1 (S1 R1 P1 activo, factura vencida), C2 (S2 R1 P2 suspendido, promesa activa)
 * Z2: C3 (S3 R2 P1 suspendido + S3b R1 P2 activo, factura pagada), C4 sin servicios
 */
async function escenario() {
    const z1 = await crearZonaFila()
    const z2 = await crearZonaFila()
    const r1 = await crearRouterFila()
    const r2 = await crearRouterFila()
    const p1 = await crearPlanFila()
    const p2 = await crearPlanFila()
    const c1 = await crearClienteFila({ zona_id: z1 })
    const c2 = await crearClienteFila({ zona_id: z1 })
    const c3 = await crearClienteFila({ zona_id: z2 })
    const c4 = await crearClienteFila({ zona_id: z2 })
    const s1 = await crearServicioFila({ cliente_id: c1, router_id: r1, plan_id: p1 })
    const s2 = await crearServicioFila({ cliente_id: c2, router_id: r1, plan_id: p2, estado: 'suspendido' })
    const s3 = await crearServicioFila({ cliente_id: c3, router_id: r2, plan_id: p1, estado: 'suspendido' })
    const s3b = await crearServicioFila({ cliente_id: c3, router_id: r1, plan_id: p2 })
    await facturaVencida(s1)
    await insertar('billing.facturas', {
        cliente_id: c3,
        servicio_id: s3,
        periodo: '2026-09-01',
        clave_unica: unico('fac'),
        vence_en: '2026-09-10',
        estado: 'pagada',
        subtotal: '100.00',
        iva: '12.00',
        total: '112.00',
        pagado: '112.00',
    })
    await promesa(c2, s2)
    await promesa(c3, s3, 'cumplida')
    return { z1, z2, r1, r2, p1, p2, c1, c2, c3, c4, s1, s2, s3, s3b }
}

type Escenario = Awaited<ReturnType<typeof escenario>>

async function idsClientes(client: any, token: string, qs: Record<string, unknown>, e: Escenario) {
    const r = await estado(
        client
            .get('/api/v1/clientes')
            .bearerToken(token)
            .qs({ limit: 200, ...qs }),
        200,
    )
    const mios = new Set([e.c1, e.c2, e.c3, e.c4])
    return (r.body().data as Array<{ id: number }>)
        .map((c) => c.id)
        .filter((id) => mios.has(id))
        .sort((a, b) => a - b)
}

async function idsServicios(client: any, token: string, qs: Record<string, unknown>, e: Escenario) {
    const r = await estado(
        client
            .get('/api/v1/servicios')
            .bearerToken(token)
            .qs({ limit: 200, ...qs }),
        200,
    )
    const mios = new Set([e.s1, e.s2, e.s3, e.s3b])
    return (r.body().data as Array<{ id: number }>)
        .map((s) => s.id)
        .filter((id) => mios.has(id))
        .sort((a, b) => a - b)
}

const orden = (...ids: number[]) => [...ids].sort((a, b) => a - b)

test.group('Filtros · GET /clientes', () => {
    test('estado_servicio, router_id y plan_id se cumplen en el mismo servicio', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()

        assert.deepEqual(
            await idsClientes(client, token, { estado_servicio: 'suspendido' }, e),
            orden(e.c2, e.c3),
        )
        assert.deepEqual(await idsClientes(client, token, { router_id: e.r1 }, e), orden(e.c1, e.c2, e.c3))
        assert.deepEqual(await idsClientes(client, token, { plan_id: e.p1 }, e), orden(e.c1, e.c3))
        // C3 tiene un suspendido (R2) y un servicio en R1 (activo): no cumple ambos en el mismo
        assert.deepEqual(
            await idsClientes(client, token, { estado_servicio: 'suspendido', router_id: e.r1 }, e),
            [e.c2],
        )
        assert.deepEqual(
            await idsClientes(client, token, { estado_servicio: 'suspendido', plan_id: e.p1 }, e),
            [e.c3],
        )
        assert.deepEqual(await idsClientes(client, token, { estado_servicio: 'retirado' }, e), [])
    })

    test('con_deuda_vencida y con_promesa_activa (true y false), cruzados con zona y q', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()

        assert.deepEqual(await idsClientes(client, token, { con_deuda_vencida: true }, e), [e.c1])
        assert.deepEqual(
            await idsClientes(client, token, { con_deuda_vencida: false }, e),
            orden(e.c2, e.c3, e.c4),
        )
        assert.deepEqual(await idsClientes(client, token, { con_promesa_activa: 'true' }, e), [e.c2])
        assert.deepEqual(
            await idsClientes(client, token, { con_promesa_activa: false, zona_id: e.z2 }, e),
            orden(e.c3, e.c4),
        )
        assert.deepEqual(
            await idsClientes(client, token, { con_deuda_vencida: false, router_id: e.r1, zona_id: e.z1 }, e),
            [e.c2],
        )
        const { user_ppp: userPpp } = await db.from('core.servicios').where('id', e.s3b).firstOrFail()
        assert.deepEqual(await idsClientes(client, token, { q: userPpp, estado_servicio: 'activo' }, e), [
            e.c3,
        ])
        assert.deepEqual(await idsClientes(client, token, { q: userPpp, con_deuda_vencida: true }, e), [])
    })

    test('valores inválidos: 422', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client.get('/api/v1/clientes').bearerToken(token).qs({ estado_servicio: 'cortado' }),
            422,
        )
        await estado(
            client.get('/api/v1/clientes').bearerToken(token).qs({ con_deuda_vencida: 'quizas' }),
            422,
        )
    })
})

test.group('Filtros · GET /servicios', () => {
    test('zona_id y con_deuda_vencida cruzados con estado y router', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()

        assert.deepEqual(await idsServicios(client, token, { zona_id: e.z2 }, e), orden(e.s3, e.s3b))
        assert.deepEqual(await idsServicios(client, token, { con_deuda_vencida: true }, e), [e.s1])
        assert.deepEqual(await idsServicios(client, token, { con_deuda_vencida: false, zona_id: e.z1 }, e), [
            e.s2,
        ])
        assert.deepEqual(await idsServicios(client, token, { zona_id: e.z2, estado: 'suspendido' }, e), [
            e.s3,
        ])
        assert.deepEqual(await idsServicios(client, token, { zona_id: e.z2, router_id: e.r1 }, e), [e.s3b])
    })

    test('la vista Servicio trae cliente_nombre, plan_nombre, router_nombre y zona_nombre', async ({
        client,
        assert,
    }) => {
        // cajero no tiene routers.ver ni zonas.ver: igual ve los nombres
        const { token } = await usuarioConRoles(['cajero'])
        const e = await escenario()
        const r = await estado(client.get(`/api/v1/servicios/${e.s1}`).bearerToken(token), 200)
        const cliente = await db.from('core.clientes').where('id', e.c1).firstOrFail()
        const plan = await db.from('network.planes').where('id', e.p1).firstOrFail()
        const router = await db.from('network.routers').where('id', e.r1).firstOrFail()
        const zona = await db.from('core.zonas').where('id', e.z1).firstOrFail()
        assert.containsSubset(r.body(), {
            cliente_nombre: cliente.nombre,
            plan_nombre: plan.nombre,
            router_nombre: router.nombre,
            zona_nombre: zona.nombre,
        })
        const sinZona = await crearServicioFila({ cliente_id: await crearClienteFila() })
        const r2 = await estado(client.get(`/api/v1/servicios/${sinZona}`).bearerToken(token), 200)
        assert.isNull(r2.body().zona_nombre)
    })
})

test.group('Filtros · GET /bitacora/acciones', () => {
    test('cliente_id trae acciones del cliente, sus servicios, facturas, pagos y promesas; canal y excluir_canal', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const e = await escenario()
        // la factura vencida de S1 que dejó el escenario
        const factura = await db
            .from('billing.facturas')
            .where('servicio_id', e.s1)
            .orderBy('id')
            .firstOrFail()
        const facturaId = Number(factura.id)
        // acciones reales que dejó el escenario al emitir y vencer la factura de S1 (canal consola)
        const previas = await estado(
            client.get('/api/v1/bitacora/acciones').bearerToken(token).qs({ cliente_id: e.c1, limit: 200 }),
            200,
        )
        const accionesPrevias = (previas.body().data as Array<{ accion: string; canal: string }>).map(
            (a) => a.accion,
        )
        assert.isTrue(
            (previas.body().data as Array<{ canal: string }>).every((a) => a.canal === 'consola'),
            'el escenario solo deja acciones de consola',
        )
        const pagoId = await insertar('billing.pagos', {
            cliente_id: e.c1,
            metodo: 'deposito',
            monto: '50.00',
            referencia: unico('boleta'),
        })
        const promesaId = await promesa(e.c1, e.s1, 'cumplida')

        // acción real: editar el cliente por la API (canal panel, actor con nombre)
        const cliente = await db.from('core.clientes').where('id', e.c1).firstOrFail()
        await estado(
            client
                .put(`/api/v1/clientes/${e.c1}`)
                .bearerToken(token)
                .header('X-Canal', 'panel')
                .json({ version: cliente.version, telefono: '5555-1234' }),
            200,
        )
        const base = { actor_tipo: 'sistema', resultado: 'ok', request_id: unico('req') }
        await db.table('audit.acciones').multiInsert([
            {
                ...base,
                canal: 'cron',
                accion: 'servicios.cambiar_estado',
                entidad_tipo: 'servicio',
                entidad_id: e.s1,
            },
            {
                ...base,
                canal: 'cron',
                accion: 'facturas.generar',
                entidad_tipo: 'factura',
                entidad_id: facturaId,
            },
            {
                ...base,
                canal: 'webhook',
                accion: 'pagos.registrar',
                entidad_tipo: 'pago',
                entidad_id: pagoId,
            },
            {
                ...base,
                canal: 'ia',
                accion: 'promesas.crear',
                entidad_tipo: 'promesa',
                entidad_id: promesaId,
            },
            {
                ...base,
                canal: 'portal',
                accion: 'portal.quien_soy',
                entidad_tipo: 'servicio',
                entidad_id: e.s1,
            },
            // de otro cliente: no debe salir
            {
                ...base,
                canal: 'cron',
                accion: 'servicios.cambiar_estado',
                entidad_tipo: 'servicio',
                entidad_id: e.s2,
            },
        ])

        const listar = async (qs: Record<string, unknown>) => {
            const r = await estado(
                client
                    .get('/api/v1/bitacora/acciones')
                    .bearerToken(token)
                    .qs({ limit: 200, ...qs }),
                200,
            )
            return r.body().data as Array<Record<string, any>>
        }

        const todas = await listar({ cliente_id: e.c1 })
        assert.sameMembers(
            todas.map((a) => a.accion),
            [
                ...accionesPrevias,
                'clientes.editar',
                'servicios.cambiar_estado',
                'facturas.generar',
                'pagos.registrar',
                'promesas.crear',
                'portal.quien_soy',
            ],
        )
        assert.isTrue(todas.every((a) => !(a.entidad_tipo === 'servicio' && a.entidad_id === e.s2)))
        const editar = todas.find((a) => a.accion === 'clientes.editar')!
        assert.equal(editar.actor_id, usuario.id)
        assert.equal(editar.actor_nombre, usuario.nombre)
        assert.equal(editar.canal, 'panel')
        assert.isNull(todas.find((a) => a.accion === 'facturas.generar')!.actor_nombre)
        // orden descendente por id
        const ids = todas.map((a) => a.id)
        assert.deepEqual(
            ids,
            [...ids].sort((a, b) => b - a),
        )

        const sinPortal = await listar({ cliente_id: e.c1, excluir_canal: 'portal' })
        assert.notInclude(
            sinPortal.map((a) => a.accion),
            'portal.quien_soy',
        )
        assert.lengthOf(sinPortal, todas.length - 1)

        const soloCron = await listar({ cliente_id: e.c1, canal: 'cron' })
        assert.sameMembers(
            soloCron.map((a) => a.accion),
            ['servicios.cambiar_estado', 'facturas.generar'],
        )
        const servicioCron = await listar({ cliente_id: e.c1, canal: 'cron', entidad_tipo: 'servicio' })
        assert.deepEqual(
            servicioCron.map((a) => a.accion),
            ['servicios.cambiar_estado'],
        )

        // paginación con el filtro
        const pagina1 = await estado(
            client.get('/api/v1/bitacora/acciones').bearerToken(token).qs({ cliente_id: e.c1, limit: 2 }),
            200,
        )
        assert.lengthOf(pagina1.body().data, 2)
        const pagina2 = await estado(
            client
                .get('/api/v1/bitacora/acciones')
                .bearerToken(token)
                .qs({ cliente_id: e.c1, limit: 200, cursor: pagina1.body().nextCursor }),
            200,
        )
        assert.lengthOf(pagina2.body().data, todas.length - 2)

        await estado(client.get('/api/v1/bitacora/acciones').bearerToken(token).qs({ canal: 'x' }), 422)
    })
})
