import { test } from '@japa/runner'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { servicioCortado } from '#tests/billing/ayudas_billing'
import { construirOpenApi } from '#shared/openapi/documento'
import RegistrarPago from '#billing/actions/registrar_pago'
import CumplirPromesa from '#billing/actions/cumplir_promesa'
import { NOMBRES_REGLA } from '#billing/promesas'

/**
 * Semana 3 · tarea 6: `Promesa.resultado_evaluacion` tiene un tipo estable en el OpenAPI
 * (`EvaluacionPromesa`). Cada respuesta real (aprobada, rechazada, pendiente, aprobada por el
 * supervisor, rechazada por el supervisor, cancelada, cumplida) cumple el esquema exacto: ni
 * campos sin declarar ni obligatorios ausentes.
 */

type Esquema = Record<string, any>

/** Validador mínimo de JSON Schema (lo que usa el generador): $ref, anyOf, type, enum, objetos cerrados. */
function validar(valor: unknown, esquema: Esquema, esquemas: Record<string, any>, ruta = '$'): string[] {
    if (esquema.$ref) return validar(valor, esquemas[esquema.$ref.split('/').pop()], esquemas, ruta)
    if (esquema.anyOf) {
        const intentos = esquema.anyOf.map((e: Esquema) => validar(valor, e, esquemas, ruta))
        return intentos.some((e: string[]) => e.length === 0) ? [] : intentos.flat()
    }
    const tipos: string[] = esquema.type === undefined ? [] : [esquema.type].flat()
    const tipo =
        valor === null
            ? 'null'
            : Array.isArray(valor)
              ? 'array'
              : Number.isInteger(valor)
                ? 'integer'
                : typeof valor
    if (tipos.length > 0 && !tipos.includes(tipo) && !(tipo === 'integer' && tipos.includes('number'))) {
        return [`${ruta}: ${tipo} no es ${tipos.join('|')}`]
    }
    if (esquema.enum && !esquema.enum.includes(valor)) return [`${ruta}: ${String(valor)} fuera del enum`]
    if (esquema.pattern && typeof valor === 'string' && !new RegExp(esquema.pattern).test(valor)) {
        return [`${ruta}: ${valor} no cumple ${esquema.pattern}`]
    }
    if (tipo === 'array' && esquema.items) {
        return (valor as unknown[]).flatMap((v, i) => validar(v, esquema.items, esquemas, `${ruta}[${i}]`))
    }
    if (tipo === 'object' && esquema.properties) {
        const objeto = valor as Record<string, unknown>
        const errores: string[] = []
        for (const clave of esquema.required ?? []) {
            if (!(clave in objeto)) errores.push(`${ruta}.${clave}: falta`)
        }
        for (const [clave, v] of Object.entries(objeto)) {
            const propiedad = esquema.properties[clave]
            if (!propiedad) errores.push(`${ruta}.${clave}: no está en el esquema`)
            else errores.push(...validar(v, propiedad, esquemas, `${ruta}.${clave}`))
        }
        return errores
    }
    return []
}

const crear = (client: any, token: string, servicioId: number, dias = 2, canal?: string) =>
    estado(
        client
            .post('/api/v1/promesas')
            .bearerToken(token)
            .header('Idempotency-Key', unico('promesa'))
            .json({
                servicio_id: servicioId,
                vence_en: new Date(Date.now() + dias * 86_400_000).toISOString(),
                monto: '300.00',
                ...(canal ? { canal } : {}),
            }),
        201,
    )

test.group('billing · contrato de resultado_evaluacion', (group) => {
    let esquemas: Record<string, any> = {}
    group.setup(async () => {
        esquemas = JSON.parse(await construirOpenApi()).components.schemas
    })

    test('el OpenAPI declara EvaluacionPromesa con los nombres de regla', ({ assert }) => {
        const evaluacion = esquemas.EvaluacionPromesa
        assert.includeMembers(evaluacion.required, [
            'resultado',
            'regla',
            'motivo',
            'canal',
            'evaluada_en',
            'reglas',
            'deuda',
            'historial',
            'siguiente_facturacion',
        ])
        assert.deepEqual(esquemas.ReglaEvaluada.properties.regla.enum, [...NOMBRES_REGLA])
        const resultado = esquemas.Promesa.properties.resultado_evaluacion
        assert.include(resultado.description, 'EvaluacionPromesa')
    })

    test('cada respuesta real cumple el esquema exacto', async ({ client, assert }) => {
        const revisar = (promesa: { resultado_evaluacion: unknown }, caso: string) => {
            assert.deepEqual(
                validar(promesa.resultado_evaluacion, { $ref: '#/EvaluacionPromesa' }, esquemas),
                [],
                caso,
            )
        }
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: admin } = await usuarioConRoles(['admin'])

        // aprobada → cancelada
        const a = await servicioCortado()
        const aprobada = await crear(client, cajero, a.servicioId)
        assert.equal(aprobada.body().estado, 'activa')
        assert.isNull(aprobada.body().resultado_evaluacion.regla)
        revisar(aprobada.body(), 'aprobada')
        const cancelada = await estado(
            client
                .post(`/api/v1/promesas/${aprobada.body().id}/cancelar`)
                .bearerToken(admin)
                .json({ motivo: 'el cliente desistió' }),
            200,
        )
        revisar(cancelada.body(), 'cancelada')

        // rechazada: la regla exacta que falló
        const b = await servicioCortado()
        const rechazada = await crear(client, cajero, b.servicioId, 60)
        assert.equal(rechazada.body().estado, 'rechazada')
        assert.equal(rechazada.body().resultado_evaluacion.regla, 'plazo_max_dias')
        revisar(rechazada.body(), 'rechazada')

        // pendiente → aprobada por el supervisor; otra pendiente → rechazada por el supervisor
        const reglas = JSON.stringify(
            normalizarReglasPromesa({ canales: { operador: { requiere_aprobacion: true } } }),
        )
        const c = await servicioCortado({ plantilla: { reglas_promesa: reglas } })
        const pendiente = await crear(client, cajero, c.servicioId)
        assert.equal(pendiente.body().resultado_evaluacion.regla, 'requiere_aprobacion')
        revisar(pendiente.body(), 'pendiente')
        const aprobadaSup = await estado(
            client
                .post(`/api/v1/promesas/${pendiente.body().id}/aprobar`)
                .bearerToken(admin)
                .json({ nota: 'cliente de años' }),
            200,
        )
        assert.exists(aprobadaSup.body().resultado_evaluacion.aprobacion)
        revisar(aprobadaSup.body(), 'aprobada por el supervisor')

        const d = await servicioCortado({ plantilla: { reglas_promesa: reglas } })
        const otraPendiente = await crear(client, cajero, d.servicioId)
        const rechazadaSup = await estado(
            client
                .post(`/api/v1/promesas/${otraPendiente.body().id}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'ya incumplió antes' }),
            200,
        )
        revisar(rechazadaSup.body(), 'rechazada por el supervisor')

        // cumplida (cierre con pagado y deuda_vencida)
        const e = await servicioCortado()
        const activa = await crear(client, cajero, e.servicioId)
        await new RegistrarPago().execute(
            { cliente_id: e.clienteId, metodo: 'agente', monto: '300.00' },
            contextoPrueba(),
        )
        await new CumplirPromesa().execute({ promesa_id: activa.body().id }, contextoPrueba())
        const lista = await estado(
            client.get('/api/v1/promesas').qs({ servicio_id: e.servicioId }).bearerToken(admin),
            200,
        )
        const cumplida = lista.body().data.find((p: { id: number }) => p.id === activa.body().id)
        assert.equal(cumplida.estado, 'cumplida')
        assert.exists(cumplida.resultado_evaluacion.cierre.pagado)
        revisar(cumplida, 'cumplida')
    })
})
