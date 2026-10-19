import { createHash } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import EditarProveedorCobro from '#ledger/actions/editar_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import { resumenCobrosPorLiquidar } from '#ledger/cobros_liquidar'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import { errorDe, lineas, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Fase 4 (§10.3): cobros por liquidar. Un pago por pasarela de un proveedor configurado va a su
 * 1.1.10.NN por el bruto; la liquidación lo limpia con Banco (neto) + Comisión. El libro se
 * verifica con el auditor completo y los reemplazos de la fase 4 después de cada paso.
 */

async function cuentaBancaria(e: EmpresasGt, empresaId: number) {
    return e.banco.get(empresaId)!
}

async function pagarPasarela(
    e: EmpresasGt,
    empresaId: number,
    clienteId: number,
    monto: string,
    comision = '0.00',
) {
    return new RegistrarPago().execute(
        {
            cliente_id: clienteId,
            metodo: 'pasarela',
            pasarela: 'falsa',
            monto,
            comision,
            referencia: unico('PAS'),
            empresa_id: empresaId,
        },
        e.ctx,
    )
}

test.group('Fase 4 · cobros por liquidar (1.1.10)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('pasarela con proveedor: 1.1.10.NN por el bruto; liquidación Banco neto + comisión; el puente cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancaria(e, e.B)
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })

        // sin proveedor: como antes (al banco principal, por el neto)
        const antes = await pagarPasarela(e, e.B, s.clienteId, '10.00', '0.35')
        assert.isNull(antes.proveedor_cobro_id)
        const lineasAntes = await lineas('pago', antes.id)
        assert.deepEqual(
            lineasAntes.find(([c]) => c === CUENTAS.BANCO_PRINCIPAL),
            [CUENTAS.BANCO_PRINCIPAL, '9.65', '0.00'],
        )

        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'Falsa',
                nombre: 'Pasarela de pruebas',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        assert.equal(proveedor.codigo, 'falsa')
        assert.match(proveedor.cuenta_codigo, /^1\.1\.10\.\d{2}$/)
        assert.equal(proveedor.desde, hoyGuatemala())
        // fecha de corte en el pasado: no se reescribe lo registrado
        const pasado = await errorDe(
            new CrearProveedorCobro().execute(
                {
                    empresa_id: e.B,
                    metodo: 'agente',
                    nombre: 'Agente',
                    desde: '2026-01-01',
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            ),
        )
        assert.equal(pasado.status, 422)
        assert.include(pasado.reglas, 'pasado')
        const repetido = await errorDe(
            new CrearProveedorCobro().execute(
                {
                    empresa_id: e.B,
                    metodo: 'pasarela',
                    pasarela: 'falsa',
                    nombre: 'Otra',
                    cuenta_bancaria_id: banco.id,
                },
                e.ctx,
            ),
        )
        assert.equal(repetido.codigo, 'proveedor_cobro_duplicado')

        const p1 = await pagarPasarela(e, e.B, s.clienteId, '100.00', '3.50')
        const p2 = await pagarPasarela(e, e.B, s.clienteId, '50.00')
        assert.equal(p1.proveedor_cobro_id, proveedor.id)
        assert.equal(p1.comision, '0.00', 'la comisión ya no se estima en el webhook')
        assert.deepEqual(await lineas('pago', p1.id), [
            [proveedor.cuenta_codigo, '100.00', '0.00'],
            [CUENTAS.CXC_CLIENTES, '0.00', '100.00'],
        ])
        assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '150.00')
        let [resumen] = await resumenCobrosPorLiquidar([e.B])
        assert.equal(resumen!.pendiente, '150.00')
        assert.isTrue(resumen!.cuadra)
        assert.lengthOf(resumen!.anomalias, 0)
        // antigüedad: vistos 10 días después, los dos pagos son anomalía (cobros_liquidar_dias = 7)
        const despues = new Date(Date.now() + 10 * 86_400_000)
        ;[resumen] = await resumenCobrosPorLiquidar([e.B], undefined, hoyGuatemala(despues))
        assert.equal(resumen!.dias_limite, 7)
        assert.deepEqual(
            resumen!.anomalias.map((a) => a.pago_id),
            [p1.id, p2.id],
        )
        await afirmarLibro(assert, [e.B, e.C])

        // descuadrada y con un pago ajeno
        const descuadre = await errorDe(
            new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: 'LIQ-1',
                    bruto: '140.00',
                    comision: '5.25',
                    pagos: [p1.id, p2.id],
                },
                e.ctx,
            ),
        )
        assert.equal(descuadre.codigo, 'liquidacion_descuadrada')
        const ajeno = await errorDe(
            new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: 'LIQ-1',
                    bruto: '10.00',
                    comision: '0',
                    pagos: [antes.id],
                },
                e.ctx,
            ),
        )
        assert.equal(ajeno.status, 422)
        assert.include(ajeno.reglas, 'proveedor')

        const liq = await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'LIQ-1',
                bruto: '150.00',
                comision: '5.25',
                neto: '144.75',
                pagos: [p1.id, p2.id],
                archivo: 'liq-1.csv',
                sha256: createHash('sha256').update('pago,monto\n1,100\n2,50\n').digest('hex'),
            },
            e.ctx,
        )
        assert.equal(liq.neto, '144.75')
        assert.equal(liq.cuenta_codigo, banco.codigo)
        assert.match(liq.sha256 ?? '', /^[0-9a-f]{64}$/)
        assert.deepEqual(await lineas('liquidacion_cobro', liq.id), [
            [banco.codigo, '144.75', '0.00'],
            [CUENTAS.COMISIONES_PASARELAS, '5.25', '0.00'],
            [proveedor.cuenta_codigo, '0.00', '150.00'],
        ])
        assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
        assert.equal(await saldoCuenta(e.B, banco.codigo), '144.75')
        ;[resumen] = await resumenCobrosPorLiquidar([e.B])
        assert.equal(resumen!.pendiente, '0.00')
        assert.isTrue(resumen!.cuadra)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'cobros.liquidados')
            .whereRaw(`(payload->>'liquidacion_id')::bigint = ?`, [liq.id])
            .select('payload')
            .firstOrFail()
        assert.deepEqual(evento.payload.pagos, [p1.id, p2.id])
        assert.equal(evento.payload.proveedor, 'falsa')

        // un pago se liquida una sola vez; la referencia es única por proveedor
        const otraVez = await errorDe(
            new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: 'LIQ-2',
                    bruto: '100.00',
                    comision: '0',
                    pagos: [p1.id],
                },
                e.ctx,
            ),
        )
        assert.equal(otraVez.status, 409)
        assert.equal(otraVez.codigo, 'pago_ya_liquidado')
        const p3 = await pagarPasarela(e, e.B, s.clienteId, '20.00')
        const dup = await errorDe(
            new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: 'LIQ-1',
                    bruto: '20.00',
                    comision: '0',
                    pagos: [p3.id],
                },
                e.ctx,
            ),
        )
        assert.equal(dup.codigo, 'liquidacion_duplicada')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('contracargo: un pago liquidado y anulado deja 1.1.10 en negativo y la siguiente liquidación lo descuenta', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancaria(e, e.B)
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01' })
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'falsa',
                nombre: 'Falsa',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const p1 = await pagarPasarela(e, e.B, s.clienteId, '80.00')
        await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'A',
                bruto: '80.00',
                comision: '2.00',
                pagos: [p1.id],
            },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: p1.id, motivo: 'contracargo del tarjetahabiente' }, e.ctx)
        assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '-80.00')
        let [resumen] = await resumenCobrosPorLiquidar([e.B])
        assert.equal(resumen!.pendiente, '-80.00')
        assert.isTrue(resumen!.cuadra)
        assert.deepEqual(
            resumen!.pagos.map((p) => [p.pago_id, p.tipo]),
            [[p1.id, 'contracargo']],
        )
        await afirmarLibro(assert, [e.B])

        const p2 = await pagarPasarela(e, e.B, s.clienteId, '120.00')
        // el contracargo de un pago no liquidado no existe
        const noEs = await errorDe(
            new LiquidarCobros().execute(
                {
                    proveedor_cobro_id: proveedor.id,
                    referencia: 'B',
                    bruto: '0.01',
                    comision: '0',
                    pagos: [p2.id],
                    contracargos: [p2.id],
                },
                e.ctx,
            ),
        )
        assert.include(noEs.reglas, 'no_es_contracargo')
        const liq = await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'B',
                bruto: '40.00',
                comision: '1.00',
                pagos: [p2.id],
                contracargos: [p1.id],
            },
            e.ctx,
        )
        assert.deepEqual(
            liq.pagos.map((p) => [p.pago_id, p.tipo, p.monto]),
            [
                [p2.id, 'cobro', '120.00'],
                [p1.id, 'contracargo', '80.00'],
            ],
        )
        assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
        ;[resumen] = await resumenCobrosPorLiquidar([e.B])
        assert.equal(resumen!.pendiente, '0.00')
        assert.isTrue(resumen!.cuadra)
        await afirmarLibro(assert, [e.B])
    })

    test('agente y débito: un proveedor por método; sin pagos se mueve el corte y se desactiva; con pagos, 409', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const banco = await cuentaBancaria(e, e.C)
        const s = await servicioFacturado(e.C, '2026-10-01', { instalacion: '2026-08-01' })
        const agente = await new CrearProveedorCobro().execute(
            { empresa_id: e.C, metodo: 'agente', nombre: 'Agentes bancarios', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        assert.equal(agente.codigo, 'agente')
        // sin pagos: el corte se mueve (hoy o futuro) y se puede desactivar y volver a activar
        const movido = await new EditarProveedorCobro().execute(
            { id: agente.id, version: agente.version, desde: '2099-01-01' },
            e.ctx,
        )
        assert.equal(movido.desde, '2099-01-01')
        const pasado = await errorDe(
            new EditarProveedorCobro().execute(
                { id: agente.id, version: movido.version, desde: '2020-01-01' },
                e.ctx,
            ),
        )
        assert.include(pasado.reglas, 'pasado')
        const apagado = await new EditarProveedorCobro().execute(
            { id: agente.id, version: movido.version, activo: false },
            e.ctx,
        )
        assert.isFalse(apagado.activo)
        assert.exists(
            await db
                .from('audit.cambios')
                .where({ entidad_tipo: 'proveedor_cobro', entidad_id: agente.id, campo: 'activo' })
                .first(),
        )
        // apagado o con el corte en el futuro, el pago va al banco como antes
        const alBanco = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'agente',
                monto: '7.00',
                referencia: unico('AG'),
                empresa_id: e.C,
            },
            e.ctx,
        )
        assert.isNull(alBanco.proveedor_cobro_id)
        const listo = await new EditarProveedorCobro().execute(
            { id: agente.id, version: apagado.version, activo: true, desde: hoyGuatemala() },
            e.ctx,
        )
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'agente',
                monto: '25.00',
                referencia: unico('AG'),
                empresa_id: e.C,
            },
            e.ctx,
        )
        assert.equal(pago.proveedor_cobro_id, agente.id)
        const debito = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'debito',
                monto: '5.00',
                referencia: unico('DB'),
                empresa_id: e.C,
            },
            e.ctx,
        )
        assert.isNull(debito.proveedor_cobro_id, 'débito sin proveedor configurado: al banco como antes')

        const conflicto = await errorDe(
            new EditarProveedorCobro().execute(
                { id: agente.id, version: agente.version, nombre: 'X' },
                e.ctx,
            ),
        )
        assert.equal(conflicto.status, 409)
        for (const cambio of [{ activo: false }, { desde: '2099-01-01' }]) {
            const conPagos = await errorDe(
                new EditarProveedorCobro().execute(
                    { id: agente.id, version: listo.version, ...cambio },
                    e.ctx,
                ),
            )
            assert.equal(conPagos.codigo, 'proveedor_con_pagos')
        }
        const renombrado = await new EditarProveedorCobro().execute(
            { id: agente.id, version: listo.version, nombre: 'Agentes' },
            e.ctx,
        )
        assert.equal(renombrado.nombre, 'Agentes')
        assert.equal(await saldoCuenta(e.C, agente.cuenta_codigo), '25.00')
        await afirmarLibro(assert, [e.C])
        await afirmarLibro(assert, e.B)
    })
})
