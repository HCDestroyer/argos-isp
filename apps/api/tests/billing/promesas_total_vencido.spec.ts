import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import CrearPromesaPago, { type EntradaCrearPromesa } from '#billing/actions/crear_promesa_pago'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import RegistrarPago from '#billing/actions/registrar_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import SustituirFactura from '#billing/actions/sustituir_factura'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import { ConsumidorBilling } from '#billing/consumidor'
import { verPromesa } from '#billing/promesas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { limitesPromesa, simularPromesa } from '#billing/simulador_promesas'
import {
    escenario,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Decisión del PM (29 oct): **una promesa cubre todo lo vencido**. El monto lo calcula Argos (las
 * facturas vencidas con saldo, mora incluida), la promesa guarda esas facturas y se cumple solo
 * cuando todas quedan pagadas. Las promesas abiertas antes del cambio siguen su regla de monto.
 *
 * Escenario: septiembre y octubre vencidas (Q150.00 cada una), servicio cortado.
 */

const gt = (fechaHora: string) => new Date(`${fechaHora}:00-06:00`)

/** Plazo amplio y sin tope de la siguiente facturación: la promesa sigue activa al vencer noviembre. */
const REGLAS_AMPLIAS = JSON.stringify(
    normalizarReglasPromesa({ plazo_max_dias: 60, no_exceder_siguiente_facturacion: false }),
)

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

const abono = (pct: number) => JSON.stringify(normalizarReglasPromesa({ abono_inicial_pct: pct }))

const reglaAbono = (promesa: { resultado_evaluacion: unknown }) =>
    (promesa.resultado_evaluacion as { reglas: Array<{ regla: string }> }).reglas.find(
        (r) => r.regla === 'abono_inicial_pct',
    )

const pagar = (clienteId: number, monto: string) =>
    new RegistrarPago().execute({ cliente_id: clienteId, metodo: 'caja', monto }, contextoPrueba())

const pagoRegistrado = (clienteId: number) =>
    new ConsumidorBilling().procesar({
        id: unico('evt'),
        evento: 'pago.registrado',
        payload: { cliente_id: clienteId },
    })

async function estadoPromesa(id: number): Promise<string> {
    const fila = await db.from('billing.promesas').where('id', id).select('estado').firstOrFail()
    return fila.estado
}

test.group('billing · promesas: cubren todo lo vencido', () => {
    test('crear calcula el total vencido (mora incluida) y guarda las facturas que cubre', async ({
        assert,
    }) => {
        const { servicioId } = await servicioCortado({
            plantilla: { mora_tipo: 'fija', mora_valor: '25.00' },
        })
        const facturas = await facturasDe(servicioId)
        const vencidas = facturas.filter((f) => f.estado === 'vencida')
        assert.sameMembers(
            vencidas.map((f) => f.tipo),
            ['servicio', 'servicio', 'mora', 'mora'],
        )

        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'activa')
        assert.equal(promesa.regla_cumplimiento, 'facturas')
        assert.equal(promesa.monto, '350.00')
        assert.sameMembers(
            promesa.facturas.map((f) => f.factura_id),
            vencidas.map((f) => Number(f.id)),
        )
        for (const f of promesa.facturas) {
            assert.equal(f.saldo, f.monto)
            assert.equal(f.estado, 'vencida')
        }
        assert.sameMembers(
            promesa.facturas.map((f) => `${f.tipo}:${f.monto}`),
            ['servicio:150.00', 'servicio:150.00', 'mora:25.00', 'mora:25.00'],
        )
        const filas = await db.from('billing.promesas_facturas').where('promesa_id', promesa.id)
        assert.lengthOf(filas, 4)
        assert.isTrue(filas.every((f) => Number(f.empresa_id) === 1))

        const [creada] = await eventosDe('promesa.creada', 'promesa_id', promesa.id)
        assert.equal(creada.payload.monto, '350.00')
        assert.equal(await estadoServicio(servicioId), 'activo')

        // la promesa no genera asientos
        const asientos = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'promesa')
            .where('origen_id', promesa.id)
        assert.lengthOf(asientos, 0)
        await afirmarLibroCuadrado(assert)
    })

    test('un pago parcial no la cumple; pagar todas sus facturas la cumple por pago.registrado', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        assert.equal(promesa.monto, '300.00')

        // paga septiembre completa y parte de octubre: sigue activa
        await pagar(clienteId, '200.00')
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'activa')
        const vista = await verPromesa(promesa.id)
        assert.sameMembers(
            vista.facturas.map((f) => `${f.estado}:${f.saldo}`),
            ['pagada:0.00', 'vencida:100.00'],
        )
        assert.lengthOf(await eventosDe('promesa.cumplida', 'promesa_id', promesa.id), 0)

        await pagar(clienteId, '100.00')
        await pagoRegistrado(clienteId)
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'cumplida')
        assert.lengthOf(await eventosDe('promesa.cumplida', 'promesa_id', promesa.id), 1)
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.containSubset(fila.resultado_evaluacion.cierre, {
            estado: 'cumplida',
            pagado: '300.00',
            saldo_cubierto: '0.00',
        })
        assert.equal(await estadoServicio(servicioId), 'activo')
        await afirmarLibroCuadrado(assert)
    })

    test('incumplida al vencer si le queda saldo a una de sus facturas', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        await pagar(clienteId, '299.99')
        const cron = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-12T18:00') },
            contextoPrueba(),
        )
        assert.containSubset(cron, { revisadas: 1, incumplidas: 1, cumplidas: 0 })
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.containSubset(fila.resultado_evaluacion.cierre, {
            estado: 'incumplida',
            pagado: '299.99',
            saldo_cubierto: '0.01',
        })
        assert.lengthOf(await eventosDe('promesa.incumplida', 'promesa_id', promesa.id), 1)
        // queda octubre vencida con Q0.01: se limita (facturas_para_limitar = 1)
        assert.equal(await estadoServicio(servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })

    test('una factura que vence después no entra en la promesa ni impide cumplirla', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado({
            plantilla: { reglas_promesa: REGLAS_AMPLIAS },
        })
        const promesa = await prometer(servicioId, { vence_en: gt('2026-11-20T18:00') })
        assert.equal(promesa.estado, 'activa')
        assert.lengthOf(promesa.facturas, 2)

        // noviembre se emite y vence con la promesa activa
        await generar(servicioId, '2026-11-01')
        await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-11-07' }, contextoPrueba())
        const facturas = await facturasDe(servicioId)
        const noviembre = facturas.find((f) => f.periodo === '2026-11-01')!
        assert.equal(noviembre.estado, 'vencida')
        const vista = await verPromesa(promesa.id)
        assert.lengthOf(vista.facturas, 2)
        assert.equal(vista.monto, '300.00')

        // pagar septiembre y octubre la cumple aunque noviembre siga vencida
        await pagar(clienteId, '300.00')
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'cumplida')
        // noviembre la evalúa el corte normal: 1 vencida → limitado
        assert.equal(await estadoServicio(servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })

    test('las promesas abiertas antes del cambio siguen su regla de monto', async ({ assert }) => {
        // la migración deja `monto` como valor por defecto: las filas que existían quedan legadas
        const columna = await db
            .from('information_schema.columns')
            .where({ table_schema: 'billing', table_name: 'promesas', column_name: 'regla_cumplimiento' })
            .select('column_default')
            .firstOrFail()
        assert.match(columna.column_default, /'monto'/)

        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        // una promesa de antes del cambio: monto escrito por el operador y sin facturas cubiertas
        await db.from('billing.promesas_facturas').where('promesa_id', promesa.id).delete()
        await db
            .from('billing.promesas')
            .where('id', promesa.id)
            .update({ regla_cumplimiento: 'monto', monto: '150.00' })
        const legada = await verPromesa(promesa.id)
        assert.containSubset(legada, { regla_cumplimiento: 'monto', monto: '150.00', facturas: [] })

        // con la regla vieja, Q150.00 la cumplen aunque octubre siga vencida
        await pagar(clienteId, '150.00')
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'cumplida')
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.containSubset(fila.resultado_evaluacion.cierre, { estado: 'cumplida', pagado: '150.00' })
        assert.notProperty(fila.resultado_evaluacion.cierre, 'saldo_cubierto')
        assert.equal(await estadoServicio(servicioId), 'limitado')
    })

    test('abono que salda una factura completa: cuenta como abono y la promesa cubre lo que falta', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({ plantilla: { reglas_promesa: abono(50) } })
        const sinAbono = await prometer(servicioId)
        assert.equal(sinAbono.estado, 'rechazada')
        assert.containSubset(sinAbono.resultado_evaluacion, { regla: 'abono_inicial_pct' })
        assert.containSubset(reglaAbono(sinAbono), { ok: false, valor: '0.00', limite: '150.00' })
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        // Q300 vencidos al 50 % → Q150; el pago salda septiembre completa
        await pagar(clienteId, '150.00')
        const conAbono = await prometer(servicioId)
        assert.equal(conAbono.estado, 'activa')
        assert.containSubset(reglaAbono(conAbono), { ok: true, valor: '150.00', limite: '150.00' })
        assert.equal(conAbono.monto, '150.00')
        assert.lengthOf(conAbono.facturas, 1)
        assert.containSubset(conAbono.facturas[0], {
            periodo: '2026-10-01',
            monto: '150.00',
            saldo: '150.00',
        })
        assert.equal(await estadoServicio(servicioId), 'activo')
    })

    test('abono parcial a una factura: la base sigue siendo lo vencido antes del abono', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({ plantilla: { reglas_promesa: abono(25) } })
        await pagar(clienteId, '74.99')
        const corta = await prometer(servicioId)
        assert.containSubset(reglaAbono(corta), { ok: false, valor: '74.99', limite: '75.00' })

        await pagar(clienteId, '0.01')
        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'activa')
        assert.containSubset(reglaAbono(promesa), { ok: true, valor: '75.00', limite: '75.00' })
        assert.equal(promesa.monto, '225.00')
        assert.sameMembers(
            promesa.facturas.map((f) => `${f.periodo}:${f.monto}`),
            ['2026-09-01:75.00', '2026-10-01:150.00'],
        )
        const limites = await limitesPromesa(servicioId, 'portal')
        assert.include(limites, { abono_requerido: '75.00', abono_pagado: '75.00' })
    })

    test('abono repartido entre dos facturas', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado({ plantilla: { reglas_promesa: abono(50) } })
        await pagar(clienteId, '100.00')
        const corta = await prometer(servicioId)
        assert.containSubset(reglaAbono(corta), { ok: false, valor: '100.00', limite: '150.00' })

        // septiembre se salda y Q10.00 van a octubre: Q160 abonados de Q300
        await pagar(clienteId, '60.00')
        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'activa')
        assert.containSubset(reglaAbono(promesa), { ok: true, valor: '160.00', limite: '150.00' })
        assert.equal(promesa.monto, '140.00')
        assert.lengthOf(promesa.facturas, 1)
        assert.containSubset(promesa.facturas[0], { periodo: '2026-10-01', monto: '140.00' })
    })

    test('no cuentan como abono los pagos de una mora anterior ya saldada ni los adelantos', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({
            fecha_instalacion: '2026-09-01',
            plantilla: { hora_corte: '00:00', reglas_promesa: abono(50) },
        })
        // septiembre vence y se paga completa: esa mora terminó
        await generar(servicioId, '2026-09-01')
        await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-09-07' }, contextoPrueba())
        await pagar(clienteId, '150.00')
        // octubre vence; noviembre se emite y se paga por adelantado (aún no vence)
        await generar(servicioId, '2026-10-01')
        await new VencerFacturas().execute({ servicio_id: servicioId, hasta: '2026-10-07' }, contextoPrueba())
        await generar(servicioId, '2026-11-01')
        const facturas = await facturasDe(servicioId)
        const noviembre = facturas.find((f) => f.periodo === '2026-11-01')!
        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '150.00', facturas: [Number(noviembre.id)] },
            contextoPrueba(),
        )

        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'rechazada')
        // base: solo octubre (Q150) → Q75; nada abonado
        assert.containSubset(reglaAbono(promesa), { ok: false, valor: '0.00', limite: '75.00' })
    })

    test('sin facturas vencidas se rechaza por sin_deuda con monto 0', async ({ assert }) => {
        const { servicioId, clienteId } = await servicioCortado()
        await pagar(clienteId, '300.00')
        const promesa = await prometer(servicioId)
        assert.containSubset(promesa, { estado: 'rechazada', monto: '0.00', facturas: [] })
        assert.containSubset(promesa.resultado_evaluacion, {
            regla: 'sin_deuda',
            motivo: 'El servicio no tiene facturas vencidas: no hace falta promesa',
        })
    })

    test('POST /promesas ignora monto y responde el total calculado', async ({ client, assert }) => {
        // por HTTP el reloj es el real: sin el tope de la siguiente facturación, que el 30 y 31 del
        // mes rechaza la promesa a dos días
        const { servicioId } = await servicioCortado({ plantilla: { reglas_promesa: REGLAS_AMPLIAS } })
        const { token } = await usuarioConRoles(['cajero'])
        const respuesta = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .header('Idempotency-Key', unico('promesa'))
                .json({
                    servicio_id: servicioId,
                    vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                    monto: '1.00',
                }),
            201,
        )
        assert.containSubset(respuesta.body(), {
            estado: 'activa',
            monto: '300.00',
            regla_cumplimiento: 'facturas',
        })
        assert.lengthOf(respuesta.body().facturas, 2)

        // sin monto también
        const { servicioId: otro } = await servicioCortado({ plantilla: { reglas_promesa: REGLAS_AMPLIAS } })
        const sinMonto = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .header('Idempotency-Key', unico('promesa'))
                .json({ servicio_id: otro, vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
            201,
        )
        assert.equal(sinMonto.body().monto, '300.00')
        assert.equal(sinMonto.body().estado, 'activa')
    })

    test('el simulador y los límites del portal devuelven el total y las facturas que cubriría', async ({
        client,
        assert,
    }) => {
        const { servicioId } = await servicioCortado({
            plantilla: { mora_tipo: 'fija', mora_valor: '25.00' },
        })
        const simulacion = await simularPromesa({ servicio_id: servicioId, canal: 'operador', monto: '5.00' })
        assert.equal(simulacion.monto, '350.00')
        assert.lengthOf(simulacion.facturas, 4)
        assert.equal(simulacion.limites.monto_promesa, '350.00')
        // la más antigua primero
        assert.equal(simulacion.facturas[0]!.periodo, '2026-09-01')

        const limites = await limitesPromesa(servicioId, 'portal')
        assert.equal(limites.monto_promesa, '350.00')
        assert.deepEqual(limites.facturas, simulacion.facturas)

        const { token } = await usuarioConRoles(['cajero'])
        const http = await estado(
            client.post('/api/v1/promesas/simular').bearerToken(token).json({ servicio_id: servicioId }),
            200,
        )
        assert.equal(http.body().monto, '350.00')
        assert.lengthOf(http.body().facturas, 4)
        // no creó nada
        const n = await db.from('billing.promesas').where('servicio_id', servicioId).count('* as n')
        assert.equal(Number(n[0].n), 0)
    })
})

test.group('billing · promesas: sustituciones y pagos históricos (revisión de la PR #190)', () => {
    test('sustituir una factura cubierta (corrección de NIT) no cumple la promesa; pagar la sustituta, sí', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        assert.equal(promesa.monto, '300.00')
        // septiembre se paga; octubre (vencida, sin pagos) se sustituye
        await pagar(clienteId, '150.00')
        const facturas = await facturasDe(servicioId)
        const octubre = facturas.find((f) => f.periodo === '2026-10-01')!
        const primera = await new SustituirFactura().execute(
            { factura_id: Number(octubre.id), motivo: 'NIT equivocado' },
            contextoPrueba(),
        )
        assert.equal(primera.original.estado, 'anulada')

        // la cubierta ya no está pendiente, pero su deuda sigue en la sustituta: no se cumple
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'activa')
        assert.lengthOf(await eventosDe('promesa.cumplida', 'promesa_id', promesa.id), 0)

        // y tampoco al sustituir la sustituta (otra corrección): se sigue la cadena
        const segunda = await new SustituirFactura().execute(
            { factura_id: primera.nueva.id, motivo: 'Faltaba la dirección fiscal' },
            contextoPrueba(),
        )
        const cron = await new IncumplirPromesas().execute(
            { servicio_id: servicioId, ahora: gt('2026-10-12T18:00') },
            contextoPrueba(),
        )
        assert.containSubset(cron, { revisadas: 1, cumplidas: 0, incumplidas: 1 })
        const incumplida = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.containSubset(incumplida.resultado_evaluacion.cierre, {
            estado: 'incumplida',
            pagado: '150.00',
            saldo_cubierto: '150.00',
        })

        // la deuda está en la última sustituta, pendiente
        const ultima = await db.from('billing.facturas').where('id', segunda.nueva.id).firstOrFail()
        assert.include(['emitida', 'vencida'], ultima.estado)
        assert.equal(ultima.total, '150.00')
        await afirmarLibroCuadrado(assert)
    })

    test('una promesa cuya cubierta se sustituye y la sustituta se paga queda cumplida con lo pagado', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado()
        const promesa = await prometer(servicioId)
        const [septiembre] = await facturasDe(servicioId)
        const s = await new SustituirFactura().execute(
            { factura_id: Number(septiembre!.id), motivo: 'NIT equivocado' },
            contextoPrueba(),
        )
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'activa')

        // el pago va a lo más antiguo: la sustituta de septiembre y octubre
        await pagar(clienteId, '300.00')
        await pagoRegistrado(clienteId)
        assert.equal(await estadoPromesa(promesa.id), 'cumplida')
        const fila = await db.from('billing.promesas').where('id', promesa.id).firstOrFail()
        assert.containSubset(fila.resultado_evaluacion.cierre, {
            estado: 'cumplida',
            pagado: '300.00',
            saldo_cubierto: '0.00',
        })
        const aplicada = await db
            .from('billing.pagos_aplicaciones')
            .where('factura_id', s.nueva.id)
            .sum('monto as monto')
            .firstOrFail()
        assert.equal(aplicada.monto, '150.00')
        await afirmarLibroCuadrado(assert)
    })

    test('un pago histórico anterior al vencimiento (en el sistema de origen) no cuenta como abono', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({ plantilla: { reglas_promesa: abono(50) } })
        const [septiembre] = await facturasDe(servicioId)
        // pagado el 3 de septiembre en el sistema anterior; importado hoy (aplicación de hoy)
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                id_externo: await unicoBd('mw-pago'),
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '150.00',
                fecha: '2026-09-03',
                facturas: [Number(septiembre!.id)],
            },
            contextoPrueba(),
        )
        const promesa = await prometer(servicioId)
        assert.equal(promesa.estado, 'rechazada')
        assert.containSubset(reglaAbono(promesa), { ok: false, valor: '0.00' })

        // un pago de hoy (después del vencimiento) sí cuenta
        await pagar(clienteId, '75.00')
        const conAbono = await prometer(servicioId)
        assert.containSubset(reglaAbono(conAbono), { valor: '75.00' })
    })
})
