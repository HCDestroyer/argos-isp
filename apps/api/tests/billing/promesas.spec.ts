import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { dec } from '#ledger/dinero'
import type { ValidacionFallida } from '#shared/errores'
import CrearPromesaPago, { type EntradaCrearPromesa } from '#billing/actions/crear_promesa_pago'
import AprobarPromesa from '#billing/actions/aprobar_promesa'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import RegistrarPago from '#billing/actions/registrar_pago'
import { ConsumidorBilling } from '#billing/consumidor'
import { evaluarReglas, type DatosEvaluacion } from '#billing/promesas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { estadoServicio, eventosDe, servicioCortado } from '#tests/billing/ayudas_billing'

/**
 * Tarea 10: promesas de pago. El servicio de prueba tiene septiembre y octubre vencidas
 * (Q300.00) y está cortado; la siguiente facturación es el 2026-11-01.
 */

/** Instante en hora de Guatemala (UTC−6). */
const gt = (fechaHora: string) => new Date(`${fechaHora}:00-06:00`)

const prometer = (servicioId: number, extra: Partial<EntradaCrearPromesa> = {}) =>
    new CrearPromesaPago().execute(
        {
            servicio_id: servicioId,
            vence_en: gt('2026-10-12T18:00'),
            canal: 'operador',
            ahora: gt('2026-10-08T10:00'),
            ...extra,
        },
        contextoPrueba(),
    )

const pagoRegistrado = (clienteId: number) =>
    new ConsumidorBilling().procesar({
        id: unico('evt'),
        evento: 'pago.registrado',
        payload: { cliente_id: clienteId },
    })

const evaluacion = (promesa: { resultado_evaluacion: unknown }) =>
    promesa.resultado_evaluacion as {
        resultado: string
        regla: string | null
        motivo: string
        reglas: Array<{ regla: string; ok: boolean; valor: unknown; limite: unknown; origen: string }>
    }

test.group('billing · promesas: crear y evaluar', () => {
    test('aprobada: queda activa, emite promesa.creada y reactiva en la misma transacción', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado()
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        const promesa = await prometer(servicioId)
        assert.containSubset(promesa, {
            servicio_id: servicioId,
            cliente_id: clienteId,
            estado: 'activa',
            canal: 'operador',
            monto: '300.00',
            aprobada_por: null,
        })
        assert.containSubset(evaluacion(promesa), { resultado: 'aprobada', regla: null })
        assert.deepEqual(
            evaluacion(promesa).reglas.map((r) => [r.regla, r.ok]),
            [
                ['habilitadas', true],
                ['canal_permitido', true],
                ['sin_deuda', true],
                ['plazo_max_dias', true],
                ['no_exceder_siguiente_facturacion', true],
                ['max_por_periodo', true],
            ],
        )
        assert.containSubset(promesa.servicio, { de: 'suspendido', estado: 'activo', cambiado: true })
        assert.equal(await estadoServicio(servicioId), 'activo')

        const [creada] = await eventosDe('promesa.creada', 'promesa_id', promesa.id)
        assert.deepEqual(creada.payload, {
            empresa_id: 1,
            promesa_id: promesa.id,
            servicio_id: servicioId,
            vence: gt('2026-10-12T18:00').toISOString(),
            monto: '300.00',
        })
        const [cambio] = await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId).then((e) =>
            e.slice(-1),
        )
        assert.containSubset(cambio.payload, { de: 'suspendido', a: 'activo' })
        assert.match(cambio.payload.motivo, /promesa de pago \d+ activa/)

        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(fila.reglas_snapshot.plazo_max_dias, 5)
        await afirmarLibroCuadrado(assert)

        // una segunda promesa mientras hay una activa → 409
        await assert.rejects(() => prometer(servicioId), /ya tiene la promesa/)
    })

    test('rechazada: guarda la promesa y explica la regla exacta (plazo general y del canal portal)', async ({
        assert,
    }) => {
        const { servicioId } = await servicioCortado()

        const larga = await prometer(servicioId, { vence_en: gt('2026-10-15T12:00') })
        assert.equal(larga.estado, 'rechazada')
        assert.containSubset(evaluacion(larga), {
            resultado: 'rechazada',
            regla: 'plazo_max_dias',
            motivo: 'Vence en 7 días; el máximo es 5 días',
        })
        assert.containSubset(evaluacion(larga).reglas.at(-1), {
            regla: 'plazo_max_dias',
            ok: false,
            valor: 7,
            limite: 5,
            origen: 'general',
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.lengthOf(await eventosDe('promesa.creada', 'promesa_id', larga.id), 0)

        const portal = await prometer(servicioId, { canal: 'portal', vence_en: gt('2026-10-12T09:00') })
        assert.containSubset(evaluacion(portal), {
            regla: 'plazo_max_dias',
            motivo: 'Vence en 4 días; el máximo del canal portal es 3 días',
        })
        assert.containSubset(evaluacion(portal).reglas.at(-1), { origen: 'portal', limite: 3 })

        // una rechazada no bloquea: la siguiente dentro del plazo se aprueba
        const valida = await prometer(servicioId, { canal: 'portal', vence_en: gt('2026-10-10T09:00') })
        assert.equal(valida.estado, 'activa')
    })

    test('no exceder la siguiente facturación, deuda máxima del canal, canal no permitido y validaciones', async ({
        assert,
    }) => {
        const { servicioId } = await servicioCortado({
            plantilla: {
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({
                        plazo_max_dias: 60,
                        canales: {
                            ia: { permitido: false },
                            portal: { deuda_maxima: '200.00', plazo_max_dias: null },
                        },
                    }),
                ),
            },
        })
        const tarde = await prometer(servicioId, { vence_en: gt('2026-11-01T08:00') })
        assert.containSubset(evaluacion(tarde), {
            regla: 'no_exceder_siguiente_facturacion',
            motivo: 'Vence el 2026-11-01; debe vencer antes de la siguiente facturación (2026-11-01)',
        })
        const portal = await prometer(servicioId, { canal: 'portal' })
        assert.containSubset(evaluacion(portal), {
            regla: 'deuda_maxima',
            motivo: 'La deuda vencida es Q300.00; el máximo del canal portal para prometer es Q200.00',
        })
        const ia = await prometer(servicioId, { canal: 'ia' })
        assert.containSubset(evaluacion(ia), { regla: 'canal_permitido' })

        const errorDe = async (entrada: Partial<EntradaCrearPromesa>) => {
            try {
                await prometer(servicioId, entrada)
            } catch (error) {
                return (error as ValidacionFallida).errores
            }
            throw new Error('se esperaba un error de validación')
        }
        assert.containSubset(await errorDe({ vence_en: gt('2026-10-08T09:00') }), [
            { field: 'vence_en', rule: 'futuro' },
        ])
    })

    test('una promesa no quita la suspensión manual', async ({ assert }) => {
        const { servicioId } = await servicioCortado()
        await db.from('core.servicios').where('id', servicioId).update({
            suspension_manual: true,
            suspension_manual_motivo: 'fraude',
            suspension_manual_en: new Date(),
        })
        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'activa')
        assert.containSubset(promesa.servicio, {
            estado: 'suspendido',
            cambiado: false,
            motivo: 'suspensión manual',
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
    })
})

test.group('billing · promesas: cumplir e incumplir', () => {
    test('cumplida por pago.registrado (idempotente) solo cuando todas sus facturas quedan pagadas', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({
            plantilla: {
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({ max_por_periodo: 1, max_por_periodo_buen_historial: 1 }),
                ),
            },
        })
        const promesa = await prometer(servicioId)
        assert.equal(promesa.monto, '300.00')
        assert.equal(await estadoServicio(servicioId), 'activo')

        // abono menor que lo vencido: sigue activa
        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '150.00' },
            contextoPrueba(),
        )
        await pagoRegistrado(clienteId)
        const sigue = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(sigue.estado, 'activa')

        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '150.00' },
            contextoPrueba(),
        )
        await pagoRegistrado(clienteId)
        await pagoRegistrado(clienteId)
        const cumplida = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(cumplida.estado, 'cumplida')
        assert.containSubset(cumplida.resultado_evaluacion.cierre, {
            estado: 'cumplida',
            pagado: '300.00',
            saldo_cubierto: '0.00',
        })
        assert.lengthOf(await eventosDe('promesa.cumplida', 'promesa_id', promesa.id), 1)
        assert.equal(await estadoServicio(servicioId), 'activo')
        await afirmarLibroCuadrado(assert)

        // sin nada vencido no hay promesa que hacer
        const otra = await prometer(servicioId, {
            ahora: gt('2026-10-09T10:00'),
            vence_en: gt('2026-10-11T10:00'),
        })
        assert.containSubset(evaluacion(otra), { regla: 'sin_deuda' })
        assert.equal(otra.monto, '0.00')
    })

    test('incumplida por el cron: promesa.incumplida, vuelve a cortar y bloquea nuevas promesas', async ({
        assert,
    }) => {
        const { servicioId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        assert.equal(await estadoServicio(servicioId), 'activo')

        const antes = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-12T17:59') },
            contextoPrueba(),
        )
        assert.equal(antes.revisadas, 0)

        const cron = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-12T18:00') },
            contextoPrueba(),
        )
        assert.deepEqual(cron, { revisadas: 1, incumplidas: 1, cumplidas: 0, canceladas: 0, errores: 0 })
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(fila.estado, 'incumplida')
        assert.lengthOf(await eventosDe('promesa.incumplida', 'promesa_id', promesa.id), 1)
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        const repetido = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-13T08:00') },
            contextoPrueba(),
        )
        assert.equal(repetido.revisadas, 0)
        assert.lengthOf(await eventosDe('promesa.incumplida', 'promesa_id', promesa.id), 1)

        const bloqueada = await prometer(servicioId, {
            ahora: gt('2026-10-14T08:00'),
            vence_en: gt('2026-10-16T08:00'),
        })
        assert.containSubset(evaluacion(bloqueada), {
            regla: 'bloqueo_tras_incumplida_dias',
            motivo: 'Incumplió una promesa hace 2 días; puede volver a prometer desde el 2026-11-11',
        })
        await afirmarLibroCuadrado(assert)
    })

    test('vencida pero pagada (sin evento todavía): el cron la marca cumplida', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '300.00' },
            contextoPrueba(),
        )
        const cron = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-13T08:00') },
            contextoPrueba(),
        )
        assert.equal(cron.cumplidas, 1)
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.equal(fila.estado, 'cumplida')
        assert.equal(await estadoServicio(servicioId), 'activo')
    })
})

test.group('billing · promesas: aprobación y endpoints', () => {
    test('canal que requiere aprobación: pendiente → aprobar (supervisor) reactiva; vencida sin aprobar se cancela', async ({
        client,
        assert,
    }) => {
        const reglas = JSON.stringify(
            normalizarReglasPromesa({ canales: { operador: { requiere_aprobacion: true } } }),
        )
        const { servicioId } = await servicioCortado({ plantilla: { reglas_promesa: reglas } })
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: contador, usuario } = await usuarioConRoles(['contabilidad'])

        const vence = new Date(Date.now() + 2 * 86_400_000).toISOString()
        const creada = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(cajero)
                .header('Idempotency-Key', unico('promesa'))
                .json({ servicio_id: servicioId, vence_en: vence, monto: '300.00' }),
            201,
        )
        assert.containSubset(creada.body(), { estado: 'pendiente_aprobacion', canal: 'operador' })
        assert.containSubset(creada.body().resultado_evaluacion, {
            resultado: 'pendiente_aprobacion',
            regla: 'requiere_aprobacion',
        })
        assert.notProperty(creada.body(), 'servicio')
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        // el cajero no aprueba ni puede usar el canal supervisor
        await estado(
            client.post(`/api/v1/promesas/${creada.body().id}/aprobar`).bearerToken(cajero).json({}),
            403,
        )
        await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(cajero)
                .json({ servicio_id: servicioId, vence_en: vence, monto: '300.00', canal: 'supervisor' }),
            403,
        )
        // ya hay una pendiente → 409
        await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(cajero)
                .json({ servicio_id: servicioId, vence_en: vence, monto: '300.00' }),
            409,
        )

        const aprobada = await estado(
            client
                .post(`/api/v1/promesas/${creada.body().id}/aprobar`)
                .bearerToken(contador)
                .json({ nota: 'cliente frecuente' }),
            200,
        )
        assert.containSubset(aprobada.body(), {
            estado: 'activa',
            aprobada_por: usuario.id,
            servicio: { servicio_id: servicioId, de: 'suspendido', estado: 'activo', cambiado: true },
        })
        assert.containSubset(aprobada.body().resultado_evaluacion.aprobacion, {
            por: usuario.id,
            nota: 'cliente frecuente',
        })
        assert.lengthOf(await eventosDe('promesa.creada', 'promesa_id', creada.body().id), 1)
        await estado(
            client.post(`/api/v1/promesas/${creada.body().id}/aprobar`).bearerToken(contador).json({}),
            409,
        )

        // otra pendiente que vence sin aprobar → cancelada por el cron
        const otro = await servicioCortado({ plantilla: { reglas_promesa: reglas } })
        const pendiente = await prometer(otro.servicioId)
        assert.equal(pendiente.estado, 'pendiente_aprobacion')
        const cron = await new IncumplirPromesas().execute(
            { servicio_id: otro.servicioId, ahora: gt('2026-10-13T00:00') },
            contextoPrueba(),
        )
        assert.equal(cron.canceladas, 1)
        await assert.rejects(
            () => new AprobarPromesa().execute({ promesa_id: pendiente.id }, contextoPrueba()),
            /solo se aprueban las pendientes/,
        )
    })

    test('GET /promesas filtra por servicio y estado; supervisor con su plazo ampliado', async ({
        client,
        assert,
    }) => {
        // Solo se prueba el plazo por canal: sin la regla de la siguiente facturación, que
        // rechazaría la promesa los días en que hoy + 10 cae en o después del 1 del mes.
        const { servicioId } = await servicioCortado({
            plantilla: {
                reglas_promesa: JSON.stringify(
                    normalizarReglasPromesa({ no_exceder_siguiente_facturacion: false }),
                ),
            },
        })
        const { token } = await usuarioConRoles(['admin'])
        const vence = new Date(Date.now() + 10 * 86_400_000).toISOString()

        const operador = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .json({ servicio_id: servicioId, vence_en: vence, monto: '300.00' }),
            201,
        )
        assert.equal(operador.body().estado, 'rechazada')
        assert.equal(operador.body().resultado_evaluacion.regla, 'plazo_max_dias')

        const supervisor = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .json({ servicio_id: servicioId, vence_en: vence, monto: '300.00', canal: 'supervisor' }),
            201,
        )
        assert.containSubset(supervisor.body(), { estado: 'activa', canal: 'supervisor' })

        const lista = await estado(
            client.get('/api/v1/promesas').qs({ servicio_id: servicioId }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((p: { id: number; estado: string }) => [p.id, p.estado]),
            [
                [supervisor.body().id, 'activa'],
                [operador.body().id, 'rechazada'],
            ],
        )
        const rechazadas = await estado(
            client
                .get('/api/v1/promesas')
                .qs({ servicio_id: servicioId, estado: 'rechazada' })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(rechazadas.body().data, 1)
    })
})

test.group('billing · promesas: evaluarReglas', () => {
    const base = (cambios: Partial<DatosEvaluacion> = {}): DatosEvaluacion => ({
        canal: 'operador',
        ahora: gt('2026-10-08T10:00'),
        vence_en: gt('2026-10-10T10:00'),
        reglas: normalizarReglasPromesa({}),
        cobertura: { monto: dec('300'), facturas: [] },
        deuda: {
            pendiente: dec('300'),
            vencida: dec('300'),
            total_pendientes: dec('300'),
            pagado_pendientes: dec('0'),
            vencidas: 2,
        },
        inicio: '2026-09-01',
        periodo_actual: '2026-10-01',
        siguiente_facturacion: '2026-11-01',
        en_periodo: 0,
        resueltas: [],
        ultima_incumplida: null,
        ...cambios,
    })

    test('buen historial amplía el máximo; abono, antigüedad y cumplimiento mínimo', ({ assert }) => {
        const reglas = normalizarReglasPromesa({
            abono_inicial_pct: 20,
            antiguedad_minima_dias: 60,
            cumplimiento_minimo_pct: 50,
        })
        assert.containSubset(evaluarReglas(base({ reglas })), {
            regla: 'abono_inicial_pct',
            motivo: 'Debe abonar el 20% de la deuda (Q60.00) antes de prometer; lleva Q0.00',
        })
        const conAbono = base({
            reglas,
            deuda: { ...base().deuda, pendiente: dec('240'), pagado_pendientes: dec('60') },
        })
        assert.containSubset(evaluarReglas(conAbono), {
            regla: 'antiguedad_minima_dias',
            motivo: 'El servicio tiene 37 días; se exigen 60 para prometer',
        })
        const antiguo = { ...conAbono, inicio: '2026-01-01' }
        assert.containSubset(
            evaluarReglas({ ...antiguo, resueltas: ['incumplida', 'incumplida', 'cumplida'] }),
            {
                regla: 'cumplimiento_minimo_pct',
                motivo: 'Cumplió 1 de sus últimas 3 promesas (33%); se exige 50%',
            },
        )
        assert.equal(evaluarReglas({ ...antiguo, resueltas: ['cumplida'] }).resultado, 'aprobada')

        // máximo 1 por periodo; con 100 % de cumplimiento, 2
        assert.containSubset(evaluarReglas(base({ en_periodo: 1, resueltas: ['incumplida'] })), {
            regla: 'max_por_periodo',
        })
        const bueno = evaluarReglas(base({ en_periodo: 1, resueltas: ['cumplida'] }))
        assert.equal(bueno.resultado, 'aprobada')
        assert.match(bueno.reglas.at(-1)!.detalle, /por buen historial/)
        // el canal supervisor reemplaza el máximo (3)
        assert.equal(evaluarReglas(base({ canal: 'supervisor', en_periodo: 2 })).resultado, 'aprobada')
        assert.equal(evaluarReglas(base({ reglas: { ...reglas, habilitadas: false } })).regla, 'habilitadas')
        assert.equal(
            evaluarReglas(
                base({
                    deuda: { ...base().deuda, pendiente: dec('0'), vencida: dec('0') },
                    cobertura: { monto: dec('0'), facturas: [] },
                }),
            ).regla,
            'sin_deuda',
        )
    })
})
