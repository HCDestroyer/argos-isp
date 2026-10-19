import { test } from '@japa/runner'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import {
    facturasDelServicio,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
} from '#tests/contabilidad/ayudas_contabilidad'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import DesactivarPrograma from '#lealtad/actions/desactivar_programa'
import { saldoPuntos } from '#lealtad/puntos'
import {
    afirmarPasivoLealtad,
    asientoLealtad,
    asientosLealtad,
    entregarEvento,
    movimientosDe,
    programaConReglas,
} from '#tests/lealtad/ayudas_lealtad'

/**
 * Lealtad · pago a tiempo (contrato §4, §6, §9 y §10): un evento repetido no da puntos dos veces y,
 * con diferimiento, `2.1.10` = valor de los lotes vivos en cada paso.
 */

/** Servicio con la factura de noviembre (vence en el futuro) y la de octubre (ya vencida). */
async function servicioConFacturas(empresaId: number) {
    const s = await servicioEn(empresaId, { precio: '200.00', instalacion: '2026-10-01' })
    await generar(s.servicioId, '2026-11-01')
    const facturas = await facturasDelServicio(s.servicioId)
    const vencimientos = await db
        .from('billing.facturas')
        .where('servicio_id', s.servicioId)
        .orderBy('id', 'asc')
        .select('id', db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`))
    return { ...s, facturas, vencimientos }
}

test.group('Lealtad · pago a tiempo', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('evento repetido: un solo movimiento y un solo asiento; 2.1.10 = lotes vivos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true, canje_esperado_pct: '80' }, [
            { tipo: 'pago_a_tiempo', puntos: 10 },
        ])
        const s = await servicioConFacturas(e.B)
        const noviembre = s.facturas.at(-1)!
        assert.isAbove(
            String(s.vencimientos.at(-1)!.vence_en).localeCompare('2026-10-18'),
            0,
            'la factura de noviembre vence después de hoy',
        )
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        // el bus entrega al menos una vez: tres entregas del mismo evento
        await entregarEvento('pago.registrado', 'pago_id', pago.id, 3)

        const movimientos = await movimientosDe(e.B, s.clienteId)
        assert.lengthOf(movimientos, 1)
        assert.equal(movimientos[0]!.clave_unica, `pago_a_tiempo:factura:${noviembre.id}`)
        assert.equal(movimientos[0]!.puntos, 10)
        // 10 puntos × Q0.10 × 80 % = Q0.80 diferidos
        assert.equal(movimientos[0]!.valor, '0.80')
        assert.isNotNull(movimientos[0]!.vence_en)
        assert.deepEqual(await asientoLealtad(movimientos[0]!.id), [
            ['4.1.05', '0.80', '0.00'],
            ['2.1.10', '0.00', '0.80'],
        ])
        assert.equal(await asientosLealtad(e.B), 1)
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 10)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '-0.80')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pago después del vencimiento: sin puntos', async ({ assert }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true }, [{ tipo: 'pago_a_tiempo', puntos: 10 }])
        const s = await servicioConFacturas(e.B)
        const octubre = s.facturas[0]!
        assert.isBelow(String(s.vencimientos[0]!.vence_en).localeCompare('2026-10-18'), 0)
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: octubre.total,
                facturas: [octubre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id)
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 0)
        assert.equal(await asientosLealtad(e.B), 0)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pago anulado: reverso espejo con su asiento; repetir la anulación no duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true }, [{ tipo: 'pago_a_tiempo', puntos: 25 }])
        const s = await servicioConFacturas(e.B)
        const noviembre = s.facturas.at(-1)!
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '-2.50')

        await new AnularPago().execute({ pago_id: pago.id, motivo: 'boleta rechazada' }, e.ctx)
        await entregarEvento('pago.anulado', 'pago_id', pago.id, 2)
        // un pago.registrado repetido después de anular tampoco devuelve los puntos
        await entregarEvento('pago.registrado', 'pago_id', pago.id)

        const movimientos = await movimientosDe(e.B, s.clienteId)
        assert.deepEqual(
            movimientos.map((m) => [m.tipo, m.puntos, m.valor]),
            [
                ['acumulacion', 25, '2.50'],
                ['reverso', -25, '2.50'],
            ],
        )
        assert.equal(movimientos[1]!.reversa_de, movimientos[0]!.id)
        assert.equal(movimientos[1]!.origen_tipo, 'pago')
        assert.deepEqual(await asientoLealtad(movimientos[1]!.id), [
            ['2.1.10', '2.50', '0.00'],
            ['4.1.05', '0.00', '2.50'],
        ])
        assert.equal(await saldoPuntos(db.connection(), e.B, s.clienteId), 0)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '0.00')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('programa desactivado: no otorga, pero el reverso por un pago anulado se aplica igual', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx, { diferimiento: true }, [
            { tipo: 'pago_a_tiempo', puntos: 10 },
        ])
        const s = await servicioConFacturas(e.B)
        const noviembre = s.facturas.at(-1)!
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id)
        await new DesactivarPrograma().execute({ id: programa.id, motivo: 'pausa' }, e.ctx)
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'error de digitación' }, e.ctx)
        await entregarEvento('pago.anulado', 'pago_id', pago.id)
        assert.deepEqual(
            await movimientosDe(e.B, s.clienteId).then((lista) => lista.map((m) => [m.tipo, m.puntos])),
            [
                ['acumulacion', 10],
                ['reverso', -10],
            ],
        )
        // otro pago a tiempo con el programa apagado no otorga
        const pago2 = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago2.id)
        assert.lengthOf(await movimientosDe(e.B, s.clienteId), 2)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('sin diferimiento (por defecto): puntos como indicador, sin asientos', async ({ assert }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, {}, [{ tipo: 'pago_a_tiempo', puntos: 10 }])
        const s = await servicioConFacturas(e.B)
        const noviembre = s.facturas.at(-1)!
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id, 2)
        const [movimiento] = await movimientosDe(e.B, s.clienteId)
        assert.equal(movimiento!.puntos, 10)
        assert.equal(movimiento!.valor, '0.00')
        assert.isNull(movimiento!.asiento_id)
        assert.equal(await asientosLealtad(e.B), 0)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '0')
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('empresa sin programa: el consumidor no evalúa nada', async ({ assert }) => {
        const e = await prepararEmpresas()
        const s = await servicioConFacturas(e.B)
        const noviembre = s.facturas.at(-1)!
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: noviembre.total,
                facturas: [noviembre.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id)
        const auditadas = await db
            .from('audit.acciones')
            .where('accion', 'lealtad.evaluar_evento')
            .where('empresa_id', e.B)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(auditadas.n), 0)
        assert.lengthOf(await movimientosDe(e.B), 0)
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        await afirmarLibro(assert, [e.B, e.C])
    })
})
