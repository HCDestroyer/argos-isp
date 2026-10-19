import { test } from '@japa/runner'
import vine from '@vinejs/vine'
import { metaConservaRequerido } from '#shared/vine_meta'
import { registroRutas } from '#start/routes/index'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * Bug de VineJS 4.4.0 (`app/shared/vine_meta.ts`): `.meta()` sobre un campo obligatorio lo volvía
 * nullable; con el bodyparser (`""` → `null`) un campo obligatorio vacío llegaba como `null` a la
 * acción y respondía 500 en vez de 422.
 */

type Esquema = { required?: string[]; properties?: Record<string, unknown> }

test.group('VineJS · .meta() conserva el required', () => {
    test('un campo obligatorio con .meta() rechaza null; uno .nullable() con .meta() lo acepta', async ({
        assert,
    }) => {
        assert.isTrue(await metaConservaRequerido())
        const validador = vine.compile(
            vine.object({
                obligatorio: vine.number().min(1).meta({ description: 'x' }),
                nulable: vine.string().nullable().meta({ description: 'y' }),
                opcional: vine.string().optional().meta({ description: 'z' }),
            }),
        )
        const [error] = await validador.tryValidate({ obligatorio: null, nulable: null, opcional: null })
        assert.deepEqual(
            (error as any).messages.map((m: any) => [m.field, m.rule]),
            [['obligatorio', 'required']],
        )
        const ok = await validador.validate({ obligatorio: 3, nulable: null })
        assert.deepEqual(ok, { obligatorio: 3, nulable: null })
    })

    test('ningún validador de la API acepta null en un campo obligatorio del OpenAPI', async ({ assert }) => {
        const aceptados: string[] = []
        for (const ruta of registroRutas) {
            for (const [donde, validador] of [
                ['cuerpo', ruta.cuerpo],
                ['query', ruta.query],
            ] as const) {
                if (!validador) continue
                const esquema = validador.toJSONSchema() as Esquema
                const requeridos = esquema.required ?? []
                if (requeridos.length === 0) continue
                const entrada = Object.fromEntries(requeridos.map((campo) => [campo, null]))
                const [error] = await validador.tryValidate(entrada)
                const conError = new Set(
                    ((error as any)?.messages ?? []).map((m: any) => String(m.field).split('.')[0]),
                )
                for (const campo of requeridos) {
                    if (!conError.has(campo)) {
                        aceptados.push(`${ruta.metodo} ${ruta.ruta} (${donde}).${campo}`)
                    }
                }
            }
        }
        assert.deepEqual(aceptados, [], 'campos obligatorios que aceptan null')
    })

    test('HTTP: un campo obligatorio vacío ("") responde 422 con su errors[], no 500', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { routerId } = await crearEscenarioRouter()
        const creado = await estado(
            client
                .post('/api/v1/servicios')
                .bearerToken(token)
                .json({
                    cliente_id: await crearClienteFila(),
                    router_id: routerId,
                    plan_id: await crearPlanFila(),
                    plantilla_facturacion_id: null,
                }),
            201,
        )
        const r = await estado(
            client
                .post(`/api/v1/servicios/${creado.body().id}/cambiar-empresa`)
                .bearerToken(token)
                .json({ empresa_id: '', version: creado.body().version, motivo: 'Prueba vacía' }),
            422,
        )
        assert.include(r.header('content-type'), 'application/problem+json')
        assert.deepInclude(
            r.body().errors.map((e: any) => ({ field: e.field, rule: e.rule })),
            { field: 'empresa_id', rule: 'required' },
        )
        const vacio = await estado(client.post('/api/v1/zonas').bearerToken(token).json({ nombre: '' }), 422)
        assert.equal(vacio.body().errors[0].field, 'nombre')
    })
})
