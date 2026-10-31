import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearRouterFila,
    crearZonaFila,
} from '#tests/core/fabricas'
import { limpiarClavesAaa } from '#tests/core/ayudas_aaa'
import type { ContextoAccion } from '#shared/contexto'
import { normalizarTelefono } from '#core/telefonos'
import { ConsumidorAaaCache } from '#core/consumidor_aaa'
import CrearCliente from '#core/actions/crear_cliente'
import EditarCliente from '#core/actions/editar_cliente'
import CrearServicio from '#core/actions/crear_servicio'
import EditarServicio from '#core/actions/editar_servicio'
import EditarZona from '#core/actions/editar_zona'
import EditarPlan from '#network/actions/editar_plan'
import EditarRouter from '#network/actions/editar_router'
import { verRouter } from '#network/consultas/routers'
import { verPlan } from '#network/consultas/planes'

/**
 * Pedidos de Iris A10–A15 (contrato Iris 0.5.0):
 * - A10: `servicio.datos_cambiados` al cambiar dirección o coordenadas del servicio (no
 *   `servicio.config_cambiada`).
 * - A11: `email` en `campos[]` de `cliente.actualizado`.
 * - A12/A13: `referencia` en cliente y servicio; contacto en sitio del servicio.
 * - A14: teléfonos validados y normalizados solo cuando cambian (también en el alta de clientes
 *   y servicios por la API).
 * - A15: `catalogo.cambiado` al renombrar, desactivar o reactivar zona, plan o router, y al cambiar
 *   las coordenadas de un router (ajustes 0.5.0).
 */

function contextoPanel(): ContextoAccion {
    return { ...contextoPrueba(), canal: 'panel' }
}

async function eventosDe(requestId: string) {
    const filas = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
    return filas.map((f) => ({ evento: f.evento as string, payload: f.payload as Record<string, unknown> }))
}

/** `campos` de cada `catalogo.cambiado` de la petición. */
async function camposCatalogo(requestId: string) {
    const eventos = await eventosDe(requestId)
    return eventos.filter((e) => e.evento === 'catalogo.cambiado').map((e) => e.payload.campos)
}

async function servicioDePrueba() {
    const { routerId } = await crearEscenarioRouter()
    const planId = await crearPlanFila()
    const clienteId = await crearClienteFila()
    return new CrearServicio().execute(
        {
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            direccion: '5a avenida 10-20',
            referencia: 'Casa verde frente a la iglesia',
            contacto_nombre: 'Doña Marta',
            contacto_telefono: '5512 3344',
        },
        contextoPanel(),
    )
}

test.group('A14 · normalizar teléfonos', () => {
    test('Guatemala con +502 opcional, internacional E.164; lo demás es inválido', ({ assert }) => {
        const casos: Array<[string, string | null]> = [
            ['55123344', '+502 5512-3344'],
            ['5512-3344', '+502 5512-3344'],
            ['5512 3344', '+502 5512-3344'],
            ['+502 5512-3344', '+502 5512-3344'],
            ['+50255123344', '+502 5512-3344'],
            ['502 5512 3344', '+502 5512-3344'],
            ['(502) 2233.4455', '+502 2233-4455'],
            ['00502 7777 6655', '+502 7777-6655'],
            ['+1 (555) 123-4567', '+15551234567'],
            ['0052 55 1234 5678', '+525512345678'],
            ['1234', null],
            ['1234-5678', null], // 8 dígitos que no empiezan con 2-7
            ['5512-334', null],
            ['+502 5512-334', null],
            ['5512-3344 ext 2', null],
            ['correo@x.gt', null],
            ['+12345', null],
            ['', null],
        ]
        for (const [entrada, esperado] of casos) {
            assert.equal(normalizarTelefono(entrada), esperado, entrada)
        }
    })
})

test.group('A11, A12, A14 · cliente', () => {
    test('alta por la API: referencia y teléfonos normalizados; 422 con un teléfono inválido', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creado = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({
                    nombre: unico('Cliente'),
                    telefono: '2233 4455',
                    movil: '+502 5512-3344',
                    referencia: 'Casa verde frente a la iglesia',
                }),
            201,
        )
        assert.include(creado.body(), {
            telefono: '+502 2233-4455',
            movil: '+502 5512-3344',
            referencia: 'Casa verde frente a la iglesia',
        })
        const visto = await estado(client.get(`/api/v1/clientes/${creado.body().id}`).bearerToken(token), 200)
        assert.equal(visto.body().referencia, 'Casa verde frente a la iglesia')

        const invalido = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: unico('C'), movil: '123' }),
            422,
        )
        assert.deepEqual(
            invalido.body().errors.map((e: { field: string; rule: string }) => [e.field, e.rule]),
            [['movil', 'telefono']],
        )

        const larga = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: unico('C'), referencia: 'x'.repeat(301) }),
            422,
        )
        assert.equal(larga.body().errors[0].field, 'referencia')
    })

    test('un teléfono viejo inválido no impide editar: solo se valida si cambia', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearClienteFila({ telefono: '123-viejo', movil: '4444' })
        // el panel reenvía el formulario completo con los teléfonos guardados
        const editado = await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Nuevo nombre', telefono: '123-viejo', movil: '4444' }),
            200,
        )
        assert.include(editado.body(), { nombre: 'Nuevo nombre', telefono: '123-viejo', movil: '4444' })

        const malo = await estado(
            client.put(`/api/v1/clientes/${id}`).bearerToken(token).json({ version: 2, telefono: '999' }),
            422,
        )
        assert.equal(malo.body().errors[0].field, 'telefono')

        const corregido = await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 2, telefono: '7777-6655', movil: null }),
            200,
        )
        assert.include(corregido.body(), { telefono: '+502 7777-6655', movil: null })
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: id, campo: 'telefono' })
            .orderBy('id')
        assert.deepEqual(
            cambios.map((c) => [c.antes, c.despues]),
            [['123-viejo', '+502 7777-6655']],
        )
    })

    test('canal consola (importador): un teléfono inválido se guarda tal cual en vez de rechazar', async ({
        assert,
    }) => {
        const ctx = contextoPrueba()
        assert.equal(ctx.canal, 'consola')
        const cliente = await new CrearCliente().execute(
            { nombre: unico('Importado'), telefono: ' 1234 ', movil: '5512-3344' },
            ctx,
        )
        assert.include(cliente, { telefono: '1234', movil: '+502 5512-3344' })
    })

    test('cliente.actualizado lleva email y referencia (solo nombres); referencia en audit.cambios', async ({
        assert,
    }) => {
        const ctx = contextoPanel()
        const cliente = await new CrearCliente().execute({ nombre: unico('Cliente') }, ctx)
        const ctxEdicion = contextoPanel()
        const correo = `${unico('c')}@ejemplo.gt`
        await new EditarCliente().execute(
            {
                id: cliente.id,
                version: cliente.version,
                email: correo,
                referencia: 'Portón negro, segunda casa',
            },
            ctxEdicion,
        )
        const eventos = await eventosDe(ctxEdicion.requestId)
        assert.deepEqual(eventos, [
            {
                evento: 'cliente.actualizado',
                payload: { cliente_id: cliente.id, campos: ['email', 'referencia'] },
            },
        ])
        const texto = JSON.stringify(eventos)
        assert.notInclude(texto, correo)
        assert.notInclude(texto, 'Portón')

        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: cliente.id, campo: 'referencia' })
            .first()
        assert.include(cambio, { antes: null, despues: 'Portón negro, segunda casa' })
    })
})

test.group('A10, A12, A13 · servicio', (group) => {
    group.setup(limpiarClavesAaa)

    test('alta con referencia y contacto en sitio (teléfono normalizado) y vista por la API', async ({
        client,
        assert,
    }) => {
        const servicio = await servicioDePrueba()
        assert.include(servicio, {
            referencia: 'Casa verde frente a la iglesia',
            contacto_nombre: 'Doña Marta',
            contacto_telefono: '+502 5512-3344',
        })
        const { token } = await usuarioConRoles(['admin'])
        const visto = await estado(client.get(`/api/v1/servicios/${servicio.id}`).bearerToken(token), 200)
        assert.include(visto.body(), {
            referencia: 'Casa verde frente a la iglesia',
            contacto_nombre: 'Doña Marta',
            contacto_telefono: '+502 5512-3344',
        })
    })

    test('alta por la API (POST /servicios): teléfono de contacto normalizado; 422 si es inválido', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const cuerpo = {
            plantilla_facturacion_id: null,
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            contacto_nombre: 'Doña Marta',
        }
        const malo = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...cuerpo, contacto_telefono: '12-34' }),
            422,
        )
        assert.deepEqual(
            malo.body().errors.map((e: { field: string; rule: string }) => [e.field, e.rule]),
            [['contacto_telefono', 'telefono']],
        )
        assert.lengthOf(await db.from('core.servicios').where('cliente_id', clienteId), 0)

        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...cuerpo, contacto_telefono: '(502) 4123 9087' }),
            201,
        )
        assert.equal(creado.body().contacto_telefono, '+502 4123-9087')
        const internacional = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({ ...cuerpo, contacto_telefono: '+1 555 123 4567' }),
            201,
        )
        assert.equal(internacional.body().contacto_telefono, '+15551234567')
    })

    test('dirección y coordenadas emiten servicio.datos_cambiados, nunca servicio.config_cambiada', async ({
        assert,
    }) => {
        const servicio = await servicioDePrueba()
        const ctx = contextoPanel()
        const editado = await new EditarServicio().execute(
            {
                id: servicio.id,
                version: servicio.version,
                direccion: 'Km 17.5 carretera a El Salvador',
                coordenadas: '14.5300,-90.4800',
            },
            ctx,
        )
        const eventos = await eventosDe(ctx.requestId)
        assert.deepEqual(eventos, [
            {
                evento: 'servicio.datos_cambiados',
                payload: {
                    servicio_id: servicio.id,
                    empresa_id: servicio.empresa_id,
                    // contrato 0.5.0: igual que `cliente.actualizado`
                    empresas: [servicio.empresa_id],
                    cliente_id: servicio.cliente_id,
                    campos: ['direccion', 'coordenadas'],
                },
            },
        ])
        assert.notInclude(JSON.stringify(eventos), 'Km 17.5')

        // referencia y contacto (A12, A13), con diff en audit.cambios
        const ctx2 = contextoPanel()
        await new EditarServicio().execute(
            {
                id: servicio.id,
                version: editado.version,
                referencia: 'Portón azul',
                contacto_nombre: 'Don Luis',
                contacto_telefono: '+502 4123-9087',
            },
            ctx2,
        )
        const [evento, ...otros] = await eventosDe(ctx2.requestId)
        assert.lengthOf(otros, 0)
        assert.deepEqual(evento!.payload.campos, ['referencia', 'contacto_nombre', 'contacto_telefono'])
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: servicio.id })
            .whereIn('campo', [
                'direccion',
                'coordenadas',
                'referencia',
                'contacto_nombre',
                'contacto_telefono',
            ])
            .select('campo', 'despues')
        // (las filas del alta también están: se buscan las de las dos ediciones)
        assert.includeDeepMembers(
            cambios.map((c) => [c.campo, c.despues]),
            [
                ['direccion', 'Km 17.5 carretera a El Salvador'],
                ['coordenadas', '14.5300,-90.4800'],
                ['referencia', 'Portón azul'],
                ['contacto_nombre', 'Don Luis'],
                ['contacto_telefono', '+502 4123-9087'],
            ],
        )
    })

    test('cambiar el plan y la dirección a la vez: cada evento con sus campos', async ({ assert }) => {
        const servicio = await servicioDePrueba()
        const otroPlan = await crearPlanFila()
        const ctx = contextoPanel()
        await new EditarServicio().execute(
            { id: servicio.id, version: servicio.version, plan_id: otroPlan, direccion: 'Otra dirección' },
            ctx,
        )
        const eventos = await eventosDe(ctx.requestId)
        const config = eventos.find((e) => e.evento === 'servicio.config_cambiada')
        const datos = eventos.find((e) => e.evento === 'servicio.datos_cambiados')
        assert.deepEqual(config!.payload.campos, ['plan'])
        assert.deepEqual(datos!.payload.campos, ['direccion'])
    })

    test('sin cambios de datos no hay evento; un teléfono de contacto inválido solo falla si cambia', async ({
        assert,
    }) => {
        const servicio = await servicioDePrueba()
        await db.from('core.servicios').where('id', servicio.id).update({ contacto_telefono: 'viejo' })
        const ctx = contextoPanel()
        const editado = await new EditarServicio().execute(
            {
                id: servicio.id,
                version: servicio.version,
                direccion: servicio.direccion,
                contacto_telefono: 'viejo',
            },
            ctx,
        )
        assert.equal(editado.contacto_telefono, 'viejo')
        assert.lengthOf(await eventosDe(ctx.requestId), 0)

        await assert.rejects(
            () =>
                new EditarServicio().execute(
                    { id: servicio.id, version: editado.version, contacto_telefono: '12' },
                    contextoPanel(),
                ),
            /no son válidos/,
        )
    })

    test('aaa-cache ignora servicio.datos_cambiados (no toca RADIUS)', ({ assert }) => {
        const aaa = new ConsumidorAaaCache()
        assert.isFalse(aaa.acepta('servicio.datos_cambiados'))
        assert.isTrue(aaa.acepta('servicio.config_cambiada'))
    })
})

test.group('A15 · catalogo.cambiado', () => {
    test('renombrar zona, plan o router emite catalogo.cambiado; otros cambios no', async ({ assert }) => {
        const zonaId = await crearZonaFila()
        const ctxZona = contextoPanel()
        const zona = await new EditarZona().execute(
            { id: zonaId, version: 1, nombre: unico('Zona renombrada') },
            ctxZona,
        )
        assert.deepEqual(await eventosDe(ctxZona.requestId), [
            {
                evento: 'catalogo.cambiado',
                payload: { catalogo: 'zona', id: zonaId, empresa_id: null, campos: ['nombre'] },
            },
        ])
        const ctxMismo = contextoPanel()
        await new EditarZona().execute({ id: zonaId, version: zona.version, nombre: zona.nombre }, ctxMismo)
        assert.lengthOf(await eventosDe(ctxMismo.requestId), 0)

        const planId = await crearPlanFila()
        const plan = await verPlan(planId)
        const ctxPlan = contextoPanel()
        await new EditarPlan().execute(
            { id: planId, version: plan.version, nombre: unico('Plan nuevo') },
            ctxPlan,
        )
        assert.deepEqual(await eventosDe(ctxPlan.requestId), [
            {
                evento: 'catalogo.cambiado',
                payload: { catalogo: 'plan', id: planId, empresa_id: null, campos: ['nombre'] },
            },
        ])
        const ctxPrecio = contextoPanel()
        await new EditarPlan().execute({ id: planId, version: plan.version + 1, precio: '199.00' }, ctxPrecio)
        const eventosPrecio = await eventosDe(ctxPrecio.requestId)
        assert.notInclude(
            eventosPrecio.map((e) => e.evento),
            'catalogo.cambiado',
        )

        const routerId = await crearRouterFila({ empresa_sugerida_id: 1 })
        const router = await verRouter(routerId)
        const ctxRouter = contextoPanel()
        await new EditarRouter().execute(
            { id: routerId, version: router.version, nombre: unico('Router nuevo') },
            ctxRouter,
        )
        assert.deepEqual(await eventosDe(ctxRouter.requestId), [
            {
                evento: 'catalogo.cambiado',
                payload: { catalogo: 'router', id: routerId, empresa_id: 1, campos: ['nombre'] },
            },
        ])
    })

    test('desactivar o reactivar zona, plan o router y mover un router emiten catalogo.cambiado', async ({
        client,
        assert,
    }) => {
        // zona: desactivar y reactivar (`campos: ['activo']`); a la vez que el nombre, los dos
        const zonaId = await crearZonaFila()
        const fila = await db.from('core.zonas').where('id', zonaId).firstOrFail()
        const ctxZona = contextoPanel()
        const zona = await new EditarZona().execute(
            { id: zonaId, version: 1, nombre: fila.nombre, activo: false },
            ctxZona,
        )
        assert.isFalse(zona.activo)
        assert.deepEqual(await eventosDe(ctxZona.requestId), [
            {
                evento: 'catalogo.cambiado',
                payload: { catalogo: 'zona', id: zonaId, empresa_id: null, campos: ['activo'] },
            },
        ])
        const ctxZona2 = contextoPanel()
        await new EditarZona().execute(
            { id: zonaId, version: zona.version, nombre: unico('Zona otra'), activo: true },
            ctxZona2,
        )
        assert.deepEqual(await camposCatalogo(ctxZona2.requestId), [['nombre', 'activo']])

        // la API: `activo` en la zona y filtro `?activo=`
        const { token } = await usuarioConRoles(['admin'])
        const zonaApi = await crearZonaFila()
        const desactivada = await estado(
            client
                .put(`/api/v1/zonas/${zonaApi}`)
                .bearerToken(token)
                .json({ version: 1, nombre: unico('Zona API'), activo: false }),
            200,
        )
        assert.isFalse(desactivada.body().activo)
        const activas = await estado(client.get('/api/v1/zonas?activo=true').bearerToken(token), 200)
        const ids = (activas.body() as Array<{ id: number; activo: boolean }>).map((z) => Number(z.id))
        assert.notInclude(ids, zonaApi)
        assert.include(ids, zonaId)
        const todas = await estado(client.get('/api/v1/zonas').bearerToken(token), 200)
        assert.include(
            (todas.body() as Array<{ id: number }>).map((z) => Number(z.id)),
            zonaApi,
        )

        // plan: `empresa_id` siempre null
        const planId = await crearPlanFila()
        const plan = await verPlan(planId)
        const ctxPlan = contextoPanel()
        await new EditarPlan().execute({ id: planId, version: plan.version, activo: false }, ctxPlan)
        const eventosPlan = await eventosDe(ctxPlan.requestId)
        assert.deepEqual(
            eventosPlan.filter((e) => e.evento === 'catalogo.cambiado'),
            [
                {
                    evento: 'catalogo.cambiado',
                    payload: { catalogo: 'plan', id: planId, empresa_id: null, campos: ['activo'] },
                },
            ],
        )
        const ctxPlan2 = contextoPanel()
        await new EditarPlan().execute({ id: planId, version: plan.version + 1, activo: true }, ctxPlan2)
        assert.deepEqual(await camposCatalogo(ctxPlan2.requestId), [['activo']])

        // router: coordenadas y activo
        const routerId = await crearRouterFila({ empresa_sugerida_id: 1 })
        const router = await verRouter(routerId)
        const ctxCoord = contextoPanel()
        const movido = await new EditarRouter().execute(
            { id: routerId, version: router.version, coordenadas: '14.6349,-90.5069' },
            ctxCoord,
        )
        const eventosCoord = await eventosDe(ctxCoord.requestId)
        assert.deepEqual(
            eventosCoord.filter((e) => e.evento === 'catalogo.cambiado'),
            [
                {
                    evento: 'catalogo.cambiado',
                    payload: { catalogo: 'router', id: routerId, empresa_id: 1, campos: ['coordenadas'] },
                },
            ],
        )
        assert.notInclude(JSON.stringify(eventosCoord), '14.6349')
        const ctxApagar = contextoPanel()
        await new EditarRouter().execute(
            { id: routerId, version: movido.version, activo: false, coordenadas: null },
            ctxApagar,
        )
        assert.deepEqual(await camposCatalogo(ctxApagar.requestId), [['activo', 'coordenadas']])
        // sin cambios en catálogo: nada
        const ctxNada = contextoPanel()
        await new EditarRouter().execute({ id: routerId, version: movido.version + 1 }, ctxNada)
        assert.deepEqual(await camposCatalogo(ctxNada.requestId), [])
    })
})
