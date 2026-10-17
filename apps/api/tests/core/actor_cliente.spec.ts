import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import EditarCliente from '#core/actions/editar_cliente'
import SuspenderServicio from '#core/actions/suspender_servicio'
import { contextoCliente, usuarioDelActor } from '#shared/contexto'
import { construirOpenApi } from '#shared/openapi/documento'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearServicioFila } from '#tests/core/fabricas'

/**
 * Columnas que apuntan a `core.usuarios` (`*_por`, `created_by`, `{ por }`) o búsquedas por usuario
 * (`cajaDelCajero`) escritas con `ctx.actor.id` crudo: con actor `cliente` guardarían un id de
 * cliente. Deben usar `usuarioDelActor(t.ctx.actor)`.
 */
const USO_CRUDO = /(\w+_por|created_by|\bpor)\s*:[^\n]*ctx\.actor\.id\b|cajaDelCajero\(\s*t\.ctx\.actor\.id/

/**
 * Archivos de otros módulos que todavía lo hacen (avisado a A3 en `.claude/integration/a1.md`,
 * 2026-10-17). Ninguno recibe hoy el actor `cliente`; cuando los corrijan, se quitan de aquí.
 * Un archivo nuevo con el uso crudo hace fallar la prueba.
 */
const PENDIENTES_OTROS_MODULOS = new Set([
    'app/billing/actions/anular_factura.ts',
    'app/billing/actions/anular_pago.ts',
    'app/billing/actions/anular_saldo_inicial.ts',
    'app/billing/actions/aprobar_comprobante.ts',
    'app/billing/actions/aprobar_promesa.ts',
    'app/billing/actions/conciliar_pasarela.ts',
    'app/billing/actions/crear_cobro_pasarela.ts',
    'app/billing/actions/crear_promesa_pago.ts',
    'app/billing/actions/rechazar_comprobante.ts',
    'app/billing/actions/registrar_comprobante.ts',
    'app/billing/actions/registrar_pago.ts',
    'app/billing/actions/registrar_pago_historico.ts',
    'app/billing/actions/registrar_saldo_inicial.ts',
    'app/billing/cierre_promesa_operador.ts',
    'app/ledger/actions/abrir_caja.ts',
    'app/ledger/actions/anular_egreso.ts',
    'app/ledger/actions/cerrar_caja.ts',
    'app/ledger/actions/cerrar_periodo.ts',
    'app/ledger/actions/reabrir_periodo.ts',
    'app/ledger/actions/registrar_asiento.ts',
    'app/ledger/actions/registrar_egreso.ts',
])

async function archivosTs(directorio: string): Promise<string[]> {
    const entradas = await readdir(directorio, { withFileTypes: true })
    const anidados = await Promise.all(
        entradas.map((e) => {
            const ruta = join(directorio, e.name)
            if (e.isDirectory()) return archivosTs(ruta)
            return Promise.resolve(e.name.endsWith('.ts') ? [ruta] : [])
        }),
    )
    return anidados.flat()
}

/**
 * Semana 3, tarea 6: tipo de actor `cliente` (acciones del portal autenticado, `a5.md:21`).
 */

test.group('Auditoría · actor cliente', () => {
    test('una acción con contextoCliente queda en audit.acciones y audit.cambios con el cliente', async ({
        client,
        assert,
    }) => {
        const clienteId = await crearClienteFila({ telefono: '22223333' })
        const cliente = await db.from('core.clientes').where('id', clienteId).firstOrFail()
        const ctx = contextoCliente(clienteId, `prueba-actor-cliente-${clienteId}`)
        assert.deepEqual(ctx.actor, { tipo: 'cliente', id: clienteId })
        assert.equal(ctx.canal, 'portal')

        await new EditarCliente().execute(
            { id: clienteId, version: cliente.version, telefono: '55556666' },
            ctx,
        )

        const accion = await db.from('audit.acciones').where('request_id', ctx.requestId).firstOrFail()
        assert.containsSubset(accion, { actor_tipo: 'cliente', canal: 'portal', accion: 'clientes.editar' })
        assert.equal(Number(accion.actor_id), clienteId)
        const cambio = await db.from('audit.cambios').where('request_id', ctx.requestId).firstOrFail()
        assert.equal(cambio.actor_tipo, 'cliente')
        assert.equal(Number(cambio.actor_id), clienteId)

        // la bitácora nombra al cliente (y no al usuario que tenga el mismo id)
        const { token } = await usuarioConRoles(['admin'])
        const acciones = await estado(
            client.get('/api/v1/bitacora/acciones').qs({ request_id: ctx.requestId }).bearerToken(token),
            200,
        )
        assert.containsSubset(acciones.body().data[0], {
            actor_tipo: 'cliente',
            actor_id: clienteId,
            actor_nombre: cliente.nombre,
        })
        const cambios = await estado(
            client.get('/api/v1/bitacora/cambios').qs({ request_id: ctx.requestId }).bearerToken(token),
            200,
        )
        assert.equal(cambios.body().data[0].actor_nombre, cliente.nombre)
    })

    test('usuarioDelActor: solo usuarios, tokens y agentes tienen id de usuario', ({ assert }) => {
        assert.equal(usuarioDelActor({ tipo: 'usuario', id: 3 }), 3)
        assert.equal(usuarioDelActor({ tipo: 'token', id: 4 }), 4)
        assert.equal(usuarioDelActor({ tipo: 'agente', id: 5 }), 5)
        assert.isNull(usuarioDelActor({ tipo: 'cliente', id: 6 }))
        assert.isNull(usuarioDelActor({ tipo: 'sistema', id: null }))
    })

    test('el OpenAPI declara cliente en actor_tipo', async ({ assert }) => {
        const esquemas = JSON.parse(await construirOpenApi()).components.schemas
        assert.include(esquemas.AccionAuditoria.properties.actor_tipo.enum, 'cliente')
        assert.include(esquemas.CambioAuditoria.properties.actor_tipo.enum, 'cliente')
    })

    test('suspender con actor cliente no guarda el id del cliente en suspension_manual_por', async ({
        assert,
    }) => {
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({ cliente_id: clienteId })
        await new SuspenderServicio().execute(
            { id: servicioId, motivo: 'prueba actor cliente' },
            contextoCliente(clienteId),
        )
        const fila = await db.from('core.servicios').where('id', servicioId).firstOrFail()
        assert.isTrue(fila.suspension_manual)
        assert.isNull(fila.suspension_manual_por)

        // con un usuario sí queda su id
        const { usuario } = await usuarioConRoles(['admin'])
        const otro = await crearServicioFila({ cliente_id: clienteId })
        await new SuspenderServicio().execute(
            { id: otro, motivo: 'prueba usuario' },
            { actor: { tipo: 'usuario', id: usuario.id }, canal: 'panel', requestId: `p-${otro}` },
        )
        const conUsuario = await db.from('core.servicios').where('id', otro).firstOrFail()
        assert.equal(Number(conUsuario.suspension_manual_por), usuario.id)
    })

    test('ninguna columna de usuario se escribe con ctx.actor.id crudo (salvo pendientes avisados)', async ({
        assert,
    }) => {
        const raiz = app.makePath()
        const crudos: string[] = []
        for (const archivo of await archivosTs(app.makePath('app'))) {
            const texto = await readFile(archivo, 'utf8')
            if (texto.split('\n').some((linea) => USO_CRUDO.test(linea))) {
                crudos.push(relative(raiz, archivo).split('\\').join('/'))
            }
        }
        const nuevos = crudos.filter((archivo) => !PENDIENTES_OTROS_MODULOS.has(archivo))
        assert.deepEqual(nuevos, [], 'Usa usuarioDelActor(t.ctx.actor) de #shared/contexto')
        // core, network y shared (A1) ya no tienen ninguno
        assert.isFalse(crudos.some((a) => /^app\/(core|network|shared)\//.test(a)))
    })
})
