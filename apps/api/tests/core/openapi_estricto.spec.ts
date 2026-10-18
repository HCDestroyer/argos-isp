import { test } from '@japa/runner'
import { construirOpenApi } from '#shared/openapi/documento'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Semana 3, tarea 4: los esquemas de respuesta del núcleo declaran como obligatorio todo lo que la
 * API siempre envía (los nulables siguen nulables). Esta prueba compara cada `required` del
 * esquema con las respuestas reales: si un campo obligatorio falta, el OpenAPI miente.
 */

type Esquema = { required?: string[]; properties?: Record<string, unknown> }

async function esquemas(): Promise<Record<string, Esquema>> {
    return JSON.parse(await construirOpenApi()).components.schemas
}

function exigirCampos(assert: any, esquema: Esquema, valor: Record<string, unknown>, nombre: string) {
    for (const campo of esquema.required ?? []) {
        assert.property(valor, campo, `${nombre}.${campo} es obligatorio en el OpenAPI y la API no lo envía`)
    }
    // y nada de lo que la API envía queda fuera del esquema
    for (const campo of Object.keys(valor)) {
        assert.property(esquema.properties ?? {}, campo, `${nombre}.${campo} no está en el esquema`)
    }
}

/**
 * Campos nuevos que la API ya envía siempre pero quedan opcionales en el esquema mientras los
 * fixtures tipados del panel (A4) no los tengan (`a1.md`). Se vuelven obligatorios después.
 */
const OPCIONALES_PENDIENTES: Record<string, string[]> = {
    Cliente: [
        'codigo',
        'codigo_externo',
        // localización fiscal, fase 1
        'tipo_documento_fiscal',
        'nit_cui_invalido',
        'pais_fiscal',
        'agente_retencion_iva',
        'sector_publico',
    ],
}

test.group('OpenAPI estricto · núcleo', () => {
    test('los esquemas del núcleo no tienen propiedades opcionales', async ({ assert }) => {
        const todos = await esquemas()
        for (const nombre of [
            'Router',
            'Servicio',
            'Plan',
            'PlanRouter',
            'PlanEfectivo',
            'Cliente',
            'AccionAuditoria',
            'CambioAuditoria',
        ]) {
            const e = todos[nombre]!
            const pendientes = OPCIONALES_PENDIENTES[nombre] ?? []
            assert.sameMembers(
                e.required!,
                Object.keys(e.properties!).filter((p) => !pendientes.includes(p)),
                `${nombre}: required = properties`,
            )
        }
        assert.include(todos.Servicio!.required, 'cliente_nombre')
        assert.include(todos.Servicio!.required, 'tipo_conexion')
        assert.include(todos.Servicio!.required, 'amarre_ip_mac')
        assert.include(todos.Router!.required, 'control_velocidad')
        assert.include(todos.Plan!.required, 'garantizado_pct')
        assert.include(todos.AccionAuditoria!.required, 'actor_nombre')
        assert.include(todos.CambioAuditoria!.required, 'actor_nombre')
    })

    test('las respuestas reales traen todos los campos obligatorios', async ({ client, assert }) => {
        const todos = await esquemas()
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()

        const router = await estado(client.get(`/api/v1/routers/${routerId}`).bearerToken(token), 200)
        exigirCampos(assert, todos.Router!, router.body(), 'Router')

        const plan = await estado(client.get(`/api/v1/planes/${planId}`).bearerToken(token), 200)
        exigirCampos(assert, todos.Plan!, plan.body(), 'Plan')

        const impl = await estado(
            client
                .put(`/api/v1/planes/${planId}/routers/${routerId}`)
                .bearerToken(token)
                .json({ profile_ppp: 'argos-prueba' }),
            200,
        )
        exigirCampos(assert, todos.PlanRouter!, impl.body(), 'PlanRouter')

        const disponibles = await estado(
            client.get(`/api/v1/routers/${routerId}/planes`).bearerToken(token),
            200,
        )
        const efectivo = disponibles.body().find((p: { id: number }) => p.id === planId)
        exigirCampos(assert, todos.PlanEfectivo!, efectivo, 'PlanEfectivo')

        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    plantilla_facturacion_id: null,
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: planId,
                }),
            201,
        )
        exigirCampos(assert, todos.Servicio!, creado.body(), 'Servicio (alta)')
        const servicioId = creado.body().id as number
        const visto = await estado(client.get(`/api/v1/servicios/${servicioId}`).bearerToken(token), 200)
        exigirCampos(assert, todos.Servicio!, visto.body(), 'Servicio')
        const lista = await estado(
            client.get('/api/v1/servicios').qs({ router_id: routerId }).bearerToken(token),
            200,
        )
        exigirCampos(assert, todos.Servicio!, lista.body().data[0], 'Servicio (lista)')
        const suspendido = await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .bearerToken(token)
                .json({ motivo: 'prueba' }),
            200,
        )
        exigirCampos(assert, todos.Servicio!, suspendido.body(), 'Servicio (acción)')

        const cliente = await estado(
            client.get(`/api/v1/clientes/${creado.body().cliente_id}`).bearerToken(token),
            200,
        )
        exigirCampos(assert, todos.Cliente!, cliente.body(), 'Cliente')

        const acciones = await estado(
            client.get('/api/v1/bitacora/acciones').qs({ limit: 5 }).bearerToken(token),
            200,
        )
        exigirCampos(assert, todos.AccionAuditoria!, acciones.body().data[0], 'AccionAuditoria')
        const cambios = await estado(
            client
                .get('/api/v1/bitacora/cambios')
                .qs({ entidad_tipo: 'servicio', entidad_id: servicioId })
                .bearerToken(token),
            200,
        )
        exigirCampos(assert, todos.CambioAuditoria!, cambios.body().data[0], 'CambioAuditoria')
    })
})
