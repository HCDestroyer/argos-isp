import { test } from '@japa/runner'
import type { ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import CrearPromesaPago, { type EntradaCrearPromesa } from '#billing/actions/crear_promesa_pago'
import { simularPromesa } from '#billing/simulador_promesas'
import type { ResultadoEvaluacion } from '#billing/promesas'
import {
    REGLAS_PROMESA_POR_DEFECTO,
    limitesDeCanal,
    normalizarReglasPromesa,
    type ReglasPromesaParciales,
} from '#billing/reglas_promesa'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'
import {
    estadoServicio,
    reglasPromesaSinTopeFacturacion,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * «Mismas reglas para IA y operador» (`reglas_promesa.mismas_reglas_ia_operador`, pedido A23 de
 * Iris, decisión del PM). Apagada (por defecto): `ia` tiene 3 días y `operador` el general de 5.
 * Encendida: `ia` usa exactamente los límites efectivos de `operador` (permitido,
 * requiere_aprobacion, plazo_max_dias, max_por_periodo, deuda_maxima) al crear la promesa, en el
 * simulador y desde Iris (`X-Iris-Actor: asistente_ia` → `ia`, `usuario:<id>` → `operador`).
 */

const RUTA_PLANTILLAS = '/api/v1/plantillas-facturacion'

/** Instante en hora de Guatemala (UTC−6). */
const gt = (fechaHora: string) => new Date(`${fechaHora}:00-06:00`)
const AHORA = gt('2026-10-08T10:00')
/** vence `dias` días después de AHORA (siguiente facturación: 2026-11-01) */
const enDias = (dias: number) => new Date(AHORA.getTime() + dias * 86_400_000)

async function prometer(servicioId: number, extra: Partial<EntradaCrearPromesa> = {}) {
    const r = await new CrearPromesaPago().execute(
        { servicio_id: servicioId, vence_en: enDias(5), canal: 'operador', ahora: AHORA, ...extra },
        contextoPrueba(),
    )
    return { ...r, resultado_evaluacion: r.resultado_evaluacion as ResultadoEvaluacion }
}

const cortado = (reglas: ReglasPromesaParciales = {}) =>
    servicioCortado({ plantilla: { reglas_promesa: reglasPromesaSinTopeFacturacion(reglas) } })

const encendida = (reglas: ReglasPromesaParciales = {}) =>
    cortado({ ...reglas, mismas_reglas_ia_operador: true })

test.group('Promesas · mismas reglas para IA y operador (reglas)', () => {
    test('por defecto apagada; limitesDeCanal devuelve los de operador solo con la opción encendida', ({
        assert,
    }) => {
        assert.isFalse(REGLAS_PROMESA_POR_DEFECTO.mismas_reglas_ia_operador)
        const apagada = normalizarReglasPromesa(null)
        assert.isFalse(apagada.mismas_reglas_ia_operador)
        assert.deepEqual(limitesDeCanal(apagada, 'ia'), { limites: apagada.canales.ia, origen: 'ia' })
        assert.equal(apagada.canales.ia.plazo_max_dias, 3)

        // reglas guardadas antes de la opción no traen la clave: quedan apagadas
        const vieja = normalizarReglasPromesa({ plazo_max_dias: 5 } as ReglasPromesaParciales)
        assert.isFalse(vieja.mismas_reglas_ia_operador)

        const on = normalizarReglasPromesa({
            mismas_reglas_ia_operador: true,
            canales: { operador: { requiere_aprobacion: true, max_por_periodo: 4 } },
        })
        const ia = limitesDeCanal(on, 'ia')
        assert.equal(ia.origen, 'operador')
        assert.deepEqual(ia.limites, on.canales.operador)
        // los demás canales no cambian
        assert.deepEqual(limitesDeCanal(on, 'portal'), { limites: on.canales.portal, origen: 'portal' })
        assert.deepEqual(limitesDeCanal(on, 'operador'), {
            limites: on.canales.operador,
            origen: 'operador',
        })
    })
})

test.group('Promesas · mismas reglas para IA y operador (plantilla)', () => {
    test('crear sin la opción → false; editar la enciende con diff en audit.cambios; no booleano → 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const creada = await estado(
            client
                .post(RUTA_PLANTILLAS)
                .bearerToken(token)
                .json({ nombre: await unicoBd('Mismas reglas'), ciclo: 'dia_fijo', dia: 1 }),
            201,
        )
        const original = creada.body()
        assert.isFalse(original.reglas_promesa.mismas_reglas_ia_operador)

        const editada = await estado(
            client
                .put(`${RUTA_PLANTILLAS}/${original.id}`)
                .bearerToken(token)
                .json({ version: 1, reglas_promesa: { mismas_reglas_ia_operador: true } }),
            200,
        )
        assert.isTrue(editada.body().reglas_promesa.mismas_reglas_ia_operador)
        // los límites por canal guardados no se tocan: la opción solo cambia cuál se aplica a ia
        assert.equal(editada.body().reglas_promesa.canales.ia.plazo_max_dias, 3)

        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_facturacion')
            .where('entidad_id', original.id)
            .where('campo', 'reglas_promesa')
            .orderBy('id', 'desc')
            .select('antes', 'despues')
            .firstOrFail()
        assert.isFalse(cambio.antes.mismas_reglas_ia_operador)
        assert.isTrue(cambio.despues.mismas_reglas_ia_operador)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'plantillas.editar')
            .where('entidad_id', original.id)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        const mala = await client
            .put(`${RUTA_PLANTILLAS}/${original.id}`)
            .bearerToken(token)
            .json({ version: 2, reglas_promesa: { mismas_reglas_ia_operador: 'tal vez' } })
        mala.assertStatus(422)
        assert.include(JSON.stringify(mala.body().errors), 'mismas_reglas_ia_operador')
    })
})

test.group('Promesas · mismas reglas para IA y operador (crear promesa)', () => {
    test('apagada: ia rechaza a 5 días con límite 3 del canal ia; operador aprueba a 5', async ({
        assert,
    }) => {
        const ia = await cortado()
        const r = await prometer(ia.servicioId, { canal: 'ia' })
        assert.equal(r.estado, 'rechazada')
        assert.equal(r.resultado_evaluacion.regla, 'plazo_max_dias')
        const regla = r.resultado_evaluacion.reglas.find((x) => x.regla === 'plazo_max_dias')!
        assert.include(regla, { limite: 3, origen: 'ia' })
        assert.equal(await estadoServicio(ia.servicioId), 'suspendido')

        const op = await cortado()
        const a = await prometer(op.servicioId, { canal: 'operador' })
        assert.equal(a.estado, 'activa')
        assert.equal(await estadoServicio(op.servicioId), 'activo')
        await afirmarLibroCuadrado(assert)
    })

    test('encendida: ia aprueba a 5 días y rechaza a 6 con el límite general de 5, igual que operador', async ({
        assert,
    }) => {
        const ia = await encendida()
        const r = await prometer(ia.servicioId, { canal: 'ia' })
        assert.equal(r.estado, 'activa')
        assert.equal(r.canal, 'ia')
        assert.equal(await estadoServicio(ia.servicioId), 'activo')

        const lejosIa = await encendida()
        const op = await encendida()
        const rIa = await prometer(lejosIa.servicioId, { canal: 'ia', vence_en: enDias(6) })
        const rOp = await prometer(op.servicioId, { canal: 'operador', vence_en: enDias(6) })
        for (const x of [rIa, rOp]) {
            assert.equal(x.estado, 'rechazada')
            assert.equal(x.resultado_evaluacion.regla, 'plazo_max_dias')
            const regla = x.resultado_evaluacion.reglas.find((y) => y.regla === 'plazo_max_dias')!
            assert.include(regla, { limite: 5, origen: 'general' })
        }
        assert.equal(rIa.resultado_evaluacion.motivo, rOp.resultado_evaluacion.motivo)
        await afirmarLibroCuadrado(assert)
    })

    test('encendida: ia toma permitido, requiere_aprobacion, plazo, cupo y deuda de operador (se ignora canales.ia)', async ({
        assert,
    }) => {
        const reglas: ReglasPromesaParciales = {
            canales: {
                ia: { permitido: false },
                operador: {
                    requiere_aprobacion: true,
                    plazo_max_dias: 8,
                    max_por_periodo: 2,
                    deuda_maxima: '500.00',
                },
            },
        }
        // apagada: ia no puede prometer
        const apagada = await cortado(reglas)
        const no = await prometer(apagada.servicioId, { canal: 'ia', vence_en: enDias(8) })
        assert.equal(no.estado, 'rechazada')
        assert.equal(no.resultado_evaluacion.regla, 'canal_permitido')

        // encendida: los mismos límites efectivos que operador
        const resultados: Awaited<ReturnType<typeof prometer>>[] = []
        for (const canal of ['ia', 'operador'] as const) {
            const datos = await encendida(reglas)
            resultados.push(await prometer(datos.servicioId, { canal, vence_en: enDias(8) }))
        }
        const [ia, op] = resultados as [(typeof resultados)[0], (typeof resultados)[0]]
        for (const x of resultados) {
            assert.equal(x.estado, 'pendiente_aprobacion')
            assert.equal(x.resultado_evaluacion.regla, 'requiere_aprobacion')
        }
        const limites = (x: typeof ia) =>
            x.resultado_evaluacion.reglas.map((r) => ({ regla: r.regla, limite: r.limite, origen: r.origen }))
        assert.deepEqual(limites(ia), limites(op))
        assert.containSubset(limites(ia), [
            { regla: 'canal_permitido', limite: true, origen: 'operador' },
            { regla: 'plazo_max_dias', limite: 8, origen: 'operador' },
            { regla: 'deuda_maxima', limite: '500.00', origen: 'operador' },
            { regla: 'max_por_periodo', limite: 2, origen: 'operador' },
        ])
        assert.match(ia.resultado_evaluacion.motivo, /canal ia \(mismas reglas que operador\)/)

        // deuda: Q300 vencidos contra un máximo de operador de Q200 → los dos rechazan igual
        const deuda: ReglasPromesaParciales = { canales: { operador: { deuda_maxima: '200.00' } } }
        for (const canal of ['ia', 'operador'] as const) {
            const datos = await encendida(deuda)
            const r = await prometer(datos.servicioId, { canal })
            assert.equal(r.resultado_evaluacion.regla, 'deuda_maxima', canal)
        }
        await afirmarLibroCuadrado(assert)
    })
})

test.group('Promesas · mismas reglas para IA y operador (simulador)', () => {
    const campos = [
        'permitido',
        'requiere_aprobacion',
        'plazo_max_dias',
        'fecha_maxima',
        'max_por_periodo',
        'deuda_maxima',
    ] as const
    const elegir = (limites: Record<string, unknown>) =>
        Object.fromEntries(campos.map((c) => [c, limites[c]]))

    test('apagada: ia 3 días y operador 5; encendida: límites idénticos', async ({ assert }) => {
        const datos = await cortado()
        const simular = (canal: 'ia' | 'operador', reglas?: ReglasPromesaParciales) =>
            simularPromesa({
                servicio_id: datos.servicioId,
                canal,
                vence_en: enDias(5),
                ahora: AHORA,
                reglas_promesa: reglas,
            })
        const ia = await simular('ia')
        const op = await simular('operador')
        assert.equal(ia.limites.plazo_max_dias, 3)
        assert.equal(op.limites.plazo_max_dias, 5)
        assert.equal(ia.resultado, 'rechazada')
        assert.equal(op.resultado, 'aprobada')

        // reglas probadas sin guardar (simulador dentro de la plantilla)
        const on = { mismas_reglas_ia_operador: true }
        const iaOn = await simular('ia', on)
        const opOn = await simular('operador', on)
        assert.deepEqual(elegir(iaOn.limites as any), elegir(opOn.limites as any))
        assert.equal(iaOn.limites.plazo_max_dias, 5)
        assert.equal(iaOn.resultado, 'aprobada')
        assert.equal(iaOn.resultado_creacion, opOn.resultado_creacion)
        // el simulador no crea promesas
        assert.lengthOf(await db.from('billing.promesas').where('servicio_id', datos.servicioId), 0)
    })

    test('POST /promesas/simular desde el panel respeta la opción guardada en la plantilla', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const datos = await encendida({ canales: { operador: { plazo_max_dias: 7 } } })
        const respuesta = async (canal: string) => {
            const r = await estado(
                client
                    .post('/api/v1/promesas/simular')
                    .bearerToken(token)
                    .json({ servicio_id: datos.servicioId, canal }),
                200,
            )
            return r.body()
        }
        const ia = await respuesta('ia')
        const op = await respuesta('operador')
        assert.equal(ia.limites.plazo_max_dias, 7)
        assert.deepEqual(elegir(ia.limites), elegir(op.limites))
    })
})

/** Token `atk_` del usuario técnico Iris (alcance global), como en `iris_cobros.spec.ts`. */
async function tokenIris(): Promise<string> {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db.from('core.usuarios').where('id', id).update({ activo: true, alcance_global: true })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    return token
}

function iris(peticion: ApiRequest, actor: string, clave: string | null = unico('iris:a23')) {
    let p = peticion.header('X-Iris-Actor', actor).header('X-Iris-Conversacion', 'wa:5025512-3344:a23')
    if (clave !== null) p = p.header('Idempotency-Key', clave)
    return p
}

test.group('Promesas · mismas reglas para IA y operador (Iris)', () => {
    // reloj real: 4 días adelante, sin tope de la siguiente facturación (reglasPromesaSinTopeFacturacion)
    const en4Dias = () => new Date(Date.now() + 4 * 86_400_000).toISOString()

    test('apagada: asistente_ia rechaza a 4 días (ia = 3) y usuario:<id> aprueba (operador = 5)', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const ia = await cortado()
        const r = await estado(
            iris(
                client
                    .post('/api/v1/promesas')
                    .bearerToken(token)
                    .json({ servicio_id: ia.servicioId, vence_en: en4Dias() }),
                'asistente_ia',
            ),
            201,
        )
        assert.equal(r.body().canal, 'ia')
        assert.equal(r.body().estado, 'rechazada')
        assert.equal(r.body().resultado_evaluacion.regla, 'plazo_max_dias')

        const op = await cortado()
        const o = await estado(
            iris(
                client
                    .post('/api/v1/promesas')
                    .bearerToken(token)
                    .json({ servicio_id: op.servicioId, vence_en: en4Dias() }),
                'usuario:ana_01',
            ),
            201,
        )
        assert.equal(o.body().canal, 'operador')
        assert.equal(o.body().estado, 'activa')

        const sim = await estado(
            iris(
                client
                    .post('/api/v1/promesas/simular')
                    .bearerToken(token)
                    .json({ servicio_id: ia.servicioId }),
                'asistente_ia',
                null,
            ),
            200,
        )
        assert.equal(sim.body().canal, 'ia')
        assert.equal(sim.body().limites.plazo_max_dias, 3)
    })

    test('encendida: asistente_ia y usuario:<id> aprueban igual a 4 días y el simulador da los mismos límites', async ({
        client,
        assert,
    }) => {
        const token = await tokenIris()
        const resultados: Record<string, any> = {}
        for (const actor of ['asistente_ia', 'usuario:ana_01']) {
            const datos = await encendida()
            const sim = await estado(
                iris(
                    client
                        .post('/api/v1/promesas/simular')
                        .bearerToken(token)
                        .json({ servicio_id: datos.servicioId }),
                    actor,
                    null,
                ),
                200,
            )
            const r = await estado(
                iris(
                    client
                        .post('/api/v1/promesas')
                        .bearerToken(token)
                        .json({ servicio_id: datos.servicioId, vence_en: en4Dias() }),
                    actor,
                ),
                201,
            )
            resultados[actor] = { sim: sim.body(), promesa: r.body(), servicioId: datos.servicioId }
        }
        const ia = resultados['asistente_ia']
        const op = resultados['usuario:ana_01']
        assert.equal(ia.promesa.canal, 'ia')
        assert.equal(op.promesa.canal, 'operador')
        assert.equal(ia.promesa.estado, 'activa')
        assert.equal(op.promesa.estado, 'activa')
        assert.equal(await estadoServicio(ia.servicioId), 'activo')
        assert.equal(ia.sim.limites.plazo_max_dias, 5)
        for (const campo of [
            'permitido',
            'requiere_aprobacion',
            'plazo_max_dias',
            'max_por_periodo',
            'deuda_maxima',
        ]) {
            assert.deepEqual(ia.sim.limites[campo], op.sim.limites[campo], campo)
        }
        await afirmarLibroCuadrado(assert)
    })
})
