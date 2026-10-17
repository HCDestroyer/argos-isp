import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEmpresaFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
    crearZonaFila,
} from '#tests/core/fabricas'
import CrearServicio from '#core/actions/crear_servicio'
import CambiarEmpresaServicio from '#core/actions/cambiar_empresa_servicio'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'
import type { ContextoAccion } from '#shared/contexto'
import { construirVariables } from '#notify/variables'
import { leerEmpresa } from '#portal/empresa'

/**
 * Multiempresa, paso 2: `empresa_id` del servicio (resolución servicio > zona > router > empresa
 * activa), `servicios.cambiar_empresa` sin saldo y `empresa_id` en los eventos de servicio.
 */

async function ultimoEvento(evento: string, servicioId: number) {
    return db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id', 'desc')
        .firstOrFail()
}

async function escenario(
    datosCliente: Record<string, unknown> = {},
    datosRouter: Record<string, unknown> = {},
) {
    const { routerId } = await crearEscenarioRouter()
    if (Object.keys(datosRouter).length > 0) {
        await db.from('network.routers').where('id', routerId).update(datosRouter)
    }
    const clienteId = await crearClienteFila(datosCliente)
    const planId = await crearPlanFila()
    return { routerId, clienteId, planId }
}

function conEmpresa(empresaId: number | null, permitidas: number[] | null = null): ContextoAccion {
    return { ...contextoPrueba(), empresaId, empresasPermitidas: permitidas }
}

test.group('Multiempresa: empresa del servicio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('con una sola empresa, todo queda en la 1 (también las filas sin empresa_id)', async ({
        assert,
    }) => {
        const e = await escenario()
        const servicio = await new CrearServicio().execute(
            { cliente_id: e.clienteId, router_id: e.routerId, plan_id: e.planId },
            contextoPrueba(),
        )
        assert.equal(servicio.empresa_id, 1)
        const creado = await ultimoEvento('servicio.creado', servicio.id)
        assert.equal(creado.payload.empresa_id, 1)
        const asignacion = await ultimoEvento('asignacion.cambiada', servicio.id)
        assert.equal(asignacion.payload.empresa_id, 1)

        const fila = await crearServicioFila({ cliente_id: e.clienteId })
        const { empresa_id: empresaFila } = await db.from('core.servicios').where('id', fila).firstOrFail()
        assert.equal(empresaFila, 1)
    })

    test('resolución: explícita > zona > router > empresa activa; sin ninguna 422', async ({ assert }) => {
        const [norte, sur, oriente] = [
            await crearEmpresaFila(),
            await crearEmpresaFila(),
            await crearEmpresaFila(),
        ]
        const zona = await crearZonaFila()
        await db.from('core.zonas').where('id', zona).update({ empresa_sugerida_id: norte })

        // zona y router sugieren; la explícita gana
        const e1 = await escenario({ zona_id: zona }, { empresa_sugerida_id: sur })
        const explicita = await new CrearServicio().execute(
            { cliente_id: e1.clienteId, router_id: e1.routerId, plan_id: e1.planId, empresa_id: oriente },
            conEmpresa(null),
        )
        assert.equal(explicita.empresa_id, oriente)

        // sin explícita: la de la zona del cliente
        const porZona = await new CrearServicio().execute(
            { cliente_id: e1.clienteId, router_id: e1.routerId, plan_id: e1.planId },
            conEmpresa(oriente),
        )
        assert.equal(porZona.empresa_id, norte)

        // cliente sin zona: la del router
        const e2 = await escenario({}, { empresa_sugerida_id: sur })
        const porRouter = await new CrearServicio().execute(
            { cliente_id: e2.clienteId, router_id: e2.routerId, plan_id: e2.planId },
            conEmpresa(oriente),
        )
        assert.equal(porRouter.empresa_id, sur)

        // sin sugeridas: la empresa activa del contexto
        const e3 = await escenario()
        const porActiva = await new CrearServicio().execute(
            { cliente_id: e3.clienteId, router_id: e3.routerId, plan_id: e3.planId },
            conEmpresa(oriente),
        )
        assert.equal(porActiva.empresa_id, oriente)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.crear')
            .where('entidad_id', porActiva.id)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        // nada que deducir y varias empresas activas: 422 empresa_requerida
        const error = await new CrearServicio()
            .execute(
                { cliente_id: e3.clienteId, router_id: e3.routerId, plan_id: e3.planId },
                conEmpresa(null),
            )
            .catch((e: unknown) => e)
        assert.include(error, { status: 422 })
        assert.match((error as { tipo: string }).tipo, /empresa_requerida/)

        // una fila sin empresa_id con varias activas también falla
        await assert.rejects(() => crearServicioFila({ cliente_id: e3.clienteId }))

        // empresa desactivada o sin acceso
        await db.from('core.empresas').where('id', sur).update({ activa: false })
        const inactiva = await new CrearServicio()
            .execute(
                { cliente_id: e3.clienteId, router_id: e3.routerId, plan_id: e3.planId, empresa_id: sur },
                conEmpresa(null),
            )
            .catch((e: unknown) => e)
        assert.include(inactiva, { status: 422 })
        const prohibida = await new CrearServicio()
            .execute(
                { cliente_id: e3.clienteId, router_id: e3.routerId, plan_id: e3.planId, empresa_id: norte },
                conEmpresa(oriente, [oriente]),
            )
            .catch((e: unknown) => e)
        assert.include(prohibida, { status: 403 })
        assert.match((prohibida as { tipo: string }).tipo, /empresa_no_permitida/)
    })

    test('POST /servicios acepta empresa_id; zonas y routers guardan su empresa sugerida', async ({
        client,
        assert,
    }) => {
        const otra = await crearEmpresaFila()
        const { token } = await usuarioConRoles(['admin'])
        const zona = await estado(
            client
                .post('/api/v1/zonas')
                .bearerToken(token)
                .json({ nombre: `Zona ${otra}`, empresa_sugerida_id: otra }),
            201,
        )
        assert.equal(zona.body().empresa_sugerida_id, otra)
        const editada = await estado(
            client
                .put(`/api/v1/zonas/${zona.body().id}`)
                .bearerToken(token)
                .json({ nombre: `Zona ${otra}`, empresa_sugerida_id: null, version: 1 }),
            200,
        )
        assert.isNull(editada.body().empresa_sugerida_id)
        await estado(
            client
                .post('/api/v1/zonas')
                .bearerToken(token)
                .json({ nombre: `Zona X ${otra}`, empresa_sugerida_id: 999999 }),
            422,
        )

        const e = await escenario()
        const router = await estado(client.get(`/api/v1/routers/${e.routerId}`).bearerToken(token), 200)
        assert.isNull(router.body().empresa_sugerida_id)
        const conEmpresaSugerida = await estado(
            client
                .put(`/api/v1/routers/${e.routerId}`)
                .bearerToken(token)
                .json({ version: router.body().version, empresa_sugerida_id: otra }),
            200,
        )
        assert.equal(conEmpresaSugerida.body().empresa_sugerida_id, otra)

        const servicio = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                cliente_id: e.clienteId,
                router_id: e.routerId,
                plan_id: e.planId,
                empresa_id: 1,
                plantilla_facturacion_id: null,
            }),
            201,
        )
        assert.equal(servicio.body().empresa_id, 1)
        const porRouter = await estado(
            client.post('/api/v1/servicios').bearerToken(token).json({
                cliente_id: e.clienteId,
                router_id: e.routerId,
                plan_id: e.planId,
                plantilla_facturacion_id: null,
            }),
            201,
        )
        assert.equal(porRouter.body().empresa_id, otra)
    })
})

test.group('Multiempresa: servicios.cambiar_empresa', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('sin saldo cambia, emite config_cambiada y audita; con saldo 422', async ({ client, assert }) => {
        const otra = await crearEmpresaFila()
        const { token } = await usuarioConRoles(['admin'])
        const e = await escenario()
        const servicio = await new CrearServicio().execute(
            { cliente_id: e.clienteId, router_id: e.routerId, plan_id: e.planId, empresa_id: 1 },
            contextoPrueba(),
        )

        const cambiado = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/cambiar-empresa`)
                .bearerToken(token)
                .json({ empresa_id: otra, version: servicio.version, motivo: 'Pasa a la sucursal norte' }),
            200,
        )
        assert.include(cambiado.body(), { empresa_id: otra, version: servicio.version + 1 })
        const evento = await ultimoEvento('servicio.config_cambiada', servicio.id)
        assert.deepInclude(evento.payload, { empresa_id: otra, empresa_anterior_id: 1, campos: ['empresa'] })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: servicio.id, campo: 'empresa_id' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(JSON.parse(JSON.stringify(cambio.despues)), otra)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'servicios.cambiar_empresa')
            .where('entidad_id', servicio.id)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        // los eventos posteriores llevan la empresa nueva
        await new CambiarEstadoServicio().execute(
            { servicioId: servicio.id, nuevo: 'suspendido', motivo: 'prueba' },
            contextoPrueba(),
        )
        const estadoCambiado = await ultimoEvento('servicio.estado_cambiado', servicio.id)
        assert.equal(estadoCambiado.payload.empresa_id, otra)

        // versión vieja: 409
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/cambiar-empresa`)
                .bearerToken(token)
                .json({ empresa_id: 1, version: servicio.version, motivo: 'Tarde' }),
            409,
        )

        // con una factura pendiente: 422 servicio_con_saldo
        const actual = await db.from('core.servicios').where('id', servicio.id).firstOrFail()
        await db.table('billing.facturas').insert({
            cliente_id: e.clienteId,
            servicio_id: servicio.id,
            periodo: '2026-09-01',
            clave_unica: `${servicio.id}-2026-09-01-prueba`,
            vence_en: '2026-09-15',
            estado: 'emitida',
            subtotal: '100.00',
            iva: '12.00',
            total: '112.00',
        })
        const conSaldo = await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/cambiar-empresa`)
                .bearerToken(token)
                .json({ empresa_id: 1, version: actual.version, motivo: 'Con deuda' }),
            422,
        )
        assert.include(conSaldo.body().type, 'servicio_con_saldo')

        // sin permiso: 403
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post(`/api/v1/servicios/${servicio.id}/cambiar-empresa`)
                .bearerToken(cajero.token)
                .json({ empresa_id: 1, version: actual.version, motivo: 'Sin permiso' }),
            403,
        )
    })

    test('misma empresa no cambia nada; sin acceso a la nueva 403', async ({ assert }) => {
        const otra = await crearEmpresaFila()
        const e = await escenario()
        const servicio = await new CrearServicio().execute(
            { cliente_id: e.clienteId, router_id: e.routerId, plan_id: e.planId, empresa_id: 1 },
            contextoPrueba(),
        )
        const igual = await new CambiarEmpresaServicio().execute(
            { id: servicio.id, empresa_id: 1, version: servicio.version, motivo: 'Igual' },
            contextoPrueba(),
        )
        assert.equal(igual.version, servicio.version)
        const error = await new CambiarEmpresaServicio()
            .execute(
                { id: servicio.id, empresa_id: otra, version: servicio.version, motivo: 'Sin acceso' },
                conEmpresa(1, [1]),
            )
            .catch((err: unknown) => err)
        assert.include(error, { status: 403 })
    })

    test('una empresa con servicios vivos no se desactiva', async ({ client, assert }) => {
        const otra = await crearEmpresaFila()
        const e = await escenario()
        await new CrearServicio().execute(
            { cliente_id: e.clienteId, router_id: e.routerId, plan_id: e.planId, empresa_id: otra },
            contextoPrueba(),
        )
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post(`/api/v1/empresas/${otra}/desactivar`)
                .bearerToken(token)
                .json({ version: 1, motivo: 'Cierre de la sucursal' }),
            422,
        )
        assert.include(r.body().type, 'empresa_con_servicios')
    })
})

test.group('Multiempresa: marca de la empresa del servicio', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('notificaciones y documentos toman los datos de la empresa del servicio', async ({ assert }) => {
        const norte = await crearEmpresaFila({ nombre_comercial: 'Cable Norte', telefono: '7764-0000' })
        const e = await escenario()
        const servicio = await new CrearServicio().execute(
            { cliente_id: e.clienteId, router_id: e.routerId, plan_id: e.planId, empresa_id: norte },
            contextoPrueba(),
        )
        const destinatario = {
            clienteId: e.clienteId,
            nombre: 'Ana',
            email: null,
            canalPreferido: 'correo' as const,
            telegramChatId: null,
        }
        const porServicio = await construirVariables(
            db.connection(),
            'servicio.estado_cambiado',
            { servicio_id: servicio.id },
            destinatario,
        )
        assert.include(porServicio.empresa as Record<string, unknown>, {
            nombre: 'Cable Norte',
            telefono: '7764-0000',
        })
        const porPayload = await construirVariables(
            db.connection(),
            'servicio.creado',
            { servicio_id: servicio.id, empresa_id: 1 },
            destinatario,
        )
        assert.notEqual((porPayload.empresa as Record<string, unknown>).nombre, 'Cable Norte')
        const datos = await leerEmpresa(undefined, norte)
        assert.equal(datos.nombre, 'Cable Norte')
    })
})
