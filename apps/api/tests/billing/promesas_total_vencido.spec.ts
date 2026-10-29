import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import CrearPromesaPago, { type EntradaCrearPromesa } from '#billing/actions/crear_promesa_pago'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import RegistrarPago from '#billing/actions/registrar_pago'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { ConsumidorBilling } from '#billing/consumidor'
import { verPromesa } from '#billing/promesas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { limitesPromesa, simularPromesa } from '#billing/simulador_promesas'
import {
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    servicioCortado,
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

    test('el abono inicial se sigue exigiendo antes de prometer; la promesa cubre lo que queda', async ({
        assert,
    }) => {
        const { servicioId, clienteId } = await servicioCortado({
            plantilla: { reglas_promesa: JSON.stringify(normalizarReglasPromesa({ abono_inicial_pct: 50 })) },
        })
        const sinAbono = await prometer(servicioId)
        assert.equal(sinAbono.estado, 'rechazada')
        assert.containSubset(sinAbono.resultado_evaluacion, { regla: 'abono_inicial_pct' })
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        // septiembre completa y la mitad de octubre: el abono alcanza
        await pagar(clienteId, '225.00')
        const conAbono = await prometer(servicioId)
        assert.equal(conAbono.estado, 'activa')
        assert.equal(conAbono.monto, '75.00')
        assert.lengthOf(conAbono.facturas, 1)
        assert.containSubset(conAbono.facturas[0], { periodo: '2026-10-01', monto: '75.00', saldo: '75.00' })
        assert.equal(await estadoServicio(servicioId), 'activo')
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
        const { servicioId } = await servicioCortado()
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
        const { servicioId: otro } = await servicioCortado()
        const sinMonto = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .header('Idempotency-Key', unico('promesa'))
                .json({ servicio_id: otro, vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
            201,
        )
        assert.equal(sinMonto.body().monto, '300.00')
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
