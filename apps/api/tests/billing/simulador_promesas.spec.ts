import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { servicioCortado } from '#tests/billing/ayudas_billing'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import { limitesPromesa, simularPromesa } from '#billing/simulador_promesas'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * Simulador de promesas: todas las reglas con su explicación, sin crear nada, y el mismo
 * resultado que daría crear la promesa.
 */

const DIA = 86_400_000

async function cuentaPromesas(servicioId: number): Promise<number> {
    const fila = await db.from('billing.promesas').where('servicio_id', servicioId).count('* as n').first()
    return Number(fila!.n)
}

test.group('billing · simulador de promesas', () => {
    test('revisa todas las reglas, no crea nada y coincide con crear la promesa', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: JSON.stringify(normalizarReglasPromesa({ abono_inicial_pct: 50 })) },
        })
        const { token } = await usuarioConRoles(['cajero'])
        const venceEn = new Date(Date.now() + 10 * DIA).toISOString()
        const auditoriaAntes = await db
            .from('audit.acciones')
            .where('accion', 'promesas.crear')
            .count('* as n')

        const respuesta = await estado(
            client
                .post('/api/v1/promesas/simular')
                .bearerToken(token)
                .json({ servicio_id: datos.servicioId, vence_en: venceEn, monto: '150.00' }),
            200,
        )
        const simulacion = respuesta.body()
        assert.equal(simulacion.resultado, 'rechazada')
        assert.equal(simulacion.regla, 'plazo_max_dias')
        assert.equal(simulacion.canal, 'operador')
        assert.equal(simulacion.resultado_creacion, 'rechazada')
        const porRegla = new Map(simulacion.reglas.map((r: { regla: string }) => [r.regla, r]))
        // sigue después de la primera que falla: el abono también falla
        assert.include(porRegla.get('plazo_max_dias'), { ok: false, aplica: true, valor: 10, limite: 5 })
        assert.include(porRegla.get('abono_inicial_pct'), {
            ok: false,
            aplica: true,
            valor: '0.00',
            limite: '150.00',
        })
        assert.match((porRegla.get('abono_inicial_pct') as { detalle: string }).detalle, /Debe abonar el 50%/)
        assert.include(porRegla.get('deuda_maxima'), { ok: true, aplica: false })
        assert.include(porRegla.get('max_por_periodo'), { ok: true, aplica: true })
        assert.sameMembers(
            [...porRegla.keys()],
            [
                'habilitadas',
                'canal_permitido',
                'sin_deuda',
                'plazo_max_dias',
                'no_exceder_siguiente_facturacion',
                'deuda_maxima',
                'abono_inicial_pct',
                'antiguedad_minima_dias',
                'cumplimiento_minimo_pct',
                'bloqueo_tras_incumplida_dias',
                'max_por_periodo',
            ],
        )
        assert.isTrue(simulacion.validaciones.every((v: { ok: boolean }) => v.ok))
        assert.equal(simulacion.limites.plazo_max_dias, 5)
        assert.equal(simulacion.limites.abono_requerido, '150.00')
        assert.equal(simulacion.deuda.pendiente, '300.00')

        // no creó nada ni dejó auditoría de crear
        assert.equal(await cuentaPromesas(datos.servicioId), 0)
        const auditoriaDespues = await db
            .from('audit.acciones')
            .where('accion', 'promesas.crear')
            .count('* as n')
        assert.equal(Number(auditoriaDespues[0].n), Number(auditoriaAntes[0].n))

        // crear con los mismos datos da la misma regla
        const creada = await new CrearPromesaPago().execute(
            {
                servicio_id: datos.servicioId,
                vence_en: new Date(venceEn),
                monto: '150.00',
                canal: 'operador',
            },
            contextoPrueba(),
        )
        assert.equal(creada.estado, 'rechazada')
        assert.equal((creada.resultado_evaluacion as { regla: string }).regla, simulacion.regla)
    })

    test('valores por defecto, canal portal con aprobación, validaciones y límites para el portal', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado({
            plantilla: {
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({
                        canales: { portal: { requiere_aprobacion: true } },
                    } as Parameters<typeof normalizarReglasPromesa>[0]),
                ),
            },
        })
        const porDefecto = await simularPromesa({ servicio_id: datos.servicioId, canal: 'operador' })
        assert.equal(porDefecto.resultado, 'aprobada')
        assert.isNull(porDefecto.regla)
        assert.equal(porDefecto.monto, '300.00')
        assert.equal(porDefecto.resultado_creacion, 'aprobada')

        const portal = await simularPromesa({ servicio_id: datos.servicioId, canal: 'portal' })
        assert.equal(portal.resultado, 'pendiente_aprobacion')
        assert.equal(portal.regla, 'requiere_aprobacion')
        assert.equal(portal.limites.plazo_max_dias, 3)
        assert.isTrue(portal.limites.requiere_aprobacion)

        // `monto` se ignora (obsoleto); vencimiento pasado → crear respondería 422
        const invalida = await simularPromesa({
            servicio_id: datos.servicioId,
            canal: 'operador',
            monto: '999.00',
            vence_en: new Date(Date.now() - DIA),
        })
        assert.equal(invalida.resultado_creacion, 'error')
        assert.equal(invalida.monto, '300.00')
        assert.sameMembers(
            invalida.validaciones.filter((v) => !v.ok).map((v) => v.regla),
            ['futuro'],
        )

        // con una promesa activa: crear daría 409
        await new CrearPromesaPago().execute(
            {
                servicio_id: datos.servicioId,
                vence_en: new Date(Date.now() + 2 * DIA),
                monto: '100.00',
                canal: 'operador',
            },
            contextoPrueba(),
        )
        const conAbierta = await simularPromesa({ servicio_id: datos.servicioId, canal: 'operador' })
        assert.equal(conAbierta.resultado_creacion, 'error')
        assert.include(
            conAbierta.validaciones.find((v) => v.regla === 'promesa_abierta'),
            { ok: false },
        )

        // límites para el portal (A5)
        const limites = await limitesPromesa(datos.servicioId, 'portal')
        assert.equal(limites.plazo_max_dias, 3)
        assert.isTrue(limites.fecha_maxima < (limites.siguiente_facturacion ?? '9999-12-31'))
        assert.isTrue(limites.fecha_maxima > hoyGuatemala())

        // permiso promesas.ver; el técnico no lo tiene
        const { token } = await usuarioConRoles(['tecnico'])
        await estado(
            client
                .post('/api/v1/promesas/simular')
                .bearerToken(token)
                .json({ servicio_id: datos.servicioId }),
            403,
        )
    })

    test('reglas sin guardar (simulador de la plantilla): se aplican sobre las del servicio y no se guardan', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado({
            plantilla: { reglas_promesa: JSON.stringify(normalizarReglasPromesa({ abono_inicial_pct: 50 })) },
        })
        const { token } = await usuarioConRoles(['cajero'])
        const venceEn = new Date(Date.now() + 10 * DIA).toISOString()
        const simular = (reglas: Record<string, unknown>) =>
            estado(
                client.post('/api/v1/promesas/simular').bearerToken(token).json({
                    servicio_id: datos.servicioId,
                    vence_en: venceEn,
                    monto: '150.00',
                    reglas_promesa: reglas,
                }),
                200,
            )
        // plazo de 15 días, sin abono ni tope de la siguiente factura: la misma promesa se aprueba
        const aprobada = await simular({
            plazo_max_dias: 15,
            abono_inicial_pct: 0,
            no_exceder_siguiente_facturacion: false,
            canales: { operador: { plazo_max_dias: 15 } },
        })
        assert.equal(
            aprobada.body().resultado,
            'aprobada',
            JSON.stringify(aprobada.body().reglas.filter((r: { ok: boolean }) => !r.ok)),
        )
        const deshabilitada = await simular({ habilitadas: false })
        assert.deepInclude(deshabilitada.body(), { resultado: 'rechazada', regla: 'habilitadas' })
        // la plantilla no cambió y no se creó nada
        const plantilla = await db
            .from('billing.plantillas_facturacion as p')
            .join('core.servicios as s', 's.plantilla_facturacion_id', 'p.id')
            .where('s.id', datos.servicioId)
            .select('p.reglas_promesa')
            .firstOrFail()
        assert.include(plantilla.reglas_promesa, { abono_inicial_pct: 50, habilitadas: true })
        assert.equal(await cuentaPromesas(datos.servicioId), 0)
        await estado(
            client
                .post('/api/v1/promesas/simular')
                .bearerToken(token)
                .json({ servicio_id: datos.servicioId, reglas_promesa: { plazo_max_dias: 0 } }),
            422,
        )
    })
})
