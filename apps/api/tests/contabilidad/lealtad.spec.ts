import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import { reporteLealtad } from '#lealtad/reporte'
import { hoyGuatemala } from '#ledger/fechas'
import {
    facturasDelServicio,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import {
    contextoPrueba,
    entregarEvento,
    movimientosDe,
    programaConReglas,
} from '#tests/lealtad/ayudas_lealtad'

/**
 * Auditor contable · programa de lealtad, fase 1 (`contratos/lealtad.md` §3, §4, §6 y §9),
 * activados desde `pendientes_fases.spec.ts`. Cada paso termina en `afirmarLibro` (el auditor
 * completo, que ya conoce el origen `lealtad`) y en el `cuadra` del reporte.
 */

/** Servicio con su factura de noviembre (vence en el futuro: el pago es a tiempo). */
async function servicioConNoviembre(empresaId: number, clienteId?: number) {
    const s = await servicioEn(empresaId, { precio: '200.00', instalacion: '2026-10-01', clienteId })
    await generar(s.servicioId, '2026-11-01')
    const facturas = await facturasDelServicio(s.servicioId)
    return { ...s, noviembre: facturas.at(-1)! }
}

async function pagarATiempo(
    e: Empresas,
    empresaId: number,
    s: Awaited<ReturnType<typeof servicioConNoviembre>>,
) {
    const pago = await new RegistrarPago().execute(
        {
            cliente_id: s.clienteId,
            metodo: 'caja',
            monto: s.noviembre.total,
            facturas: [s.noviembre.id],
            empresa_id: empresaId,
        },
        e.ctx,
    )
    await entregarEvento('pago.registrado', 'pago_id', pago.id)
    return pago
}

async function afirmarLealtad(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    e: Empresas,
) {
    await afirmarLibro(assert, [e.B, e.C])
    const reporte = await reporteLealtad([e.B, e.C], null, null)
    for (const fila of reporte.empresas) {
        assert.deepEqual(
            [fila.cuadra, fila.saldo_puntos],
            [true, fila.puntos_vivos],
            `reporte de lealtad de la empresa ${fila.empresa_id}: 2.1.10 ${fila.pasivo_libro} / lotes ${fila.pasivo_lotes}`,
        )
    }
}

test.group('Auditor contable · lealtad, fase 1', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('lealtad: 2.1.10 = valor de los lotes vivos cuando diferimiento = true · lealtad, fase 1', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(
            e.B,
            e.ctx,
            { diferimiento: true, canje_esperado_pct: '70', vencimiento_meses: 12 },
            [{ tipo: 'pago_a_tiempo', puntos: 33 }],
        )
        // sin diferimiento (C): puntos sin asientos
        await programaConReglas(e.C, e.ctx, {}, [{ tipo: 'pago_a_tiempo', puntos: 10 }])
        const s = await servicioConNoviembre(e.B)
        const pago = await pagarATiempo(e, e.B, s)
        await afirmarLealtad(assert, e)

        // otro lote (ajuste+) que vence antes de que se anule el pago
        const ajuste = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 17, motivo: 'bienvenida' },
            e.ctx,
        )
        // ajuste− que consume una parte del lote del pago (el que vence antes sale primero: los dos vencen igual)
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: -11, motivo: 'corrección' },
            e.ctx,
        )
        await afirmarLealtad(assert, e)
        // vencimiento de todo lo que vence hasta dentro de 13 meses (los dos lotes)
        const vence = String(ajuste.movimiento.vence_en)
        await new VencerPuntos().execute({ hoy: vence }, contextoPrueba())
        await afirmarLealtad(assert, e)
        // pago anulado tras el vencimiento: nada que revertir (lo vencido ya salió) y el libro cuadra
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'boleta rechazada' }, e.ctx)
        await entregarEvento('pago.anulado', 'pago_id', pago.id, 2)
        await afirmarLealtad(assert, e)
        assert.equal(await saldoCuenta(e.B, '2.1.10'), '0.00')

        // sin diferimiento: puntos sin ningún asiento de lealtad
        const t = await servicioConNoviembre(e.C)
        await pagarATiempo(e, e.C, t)
        assert.lengthOf(await movimientosDe(e.C, t.clienteId), 1)
        const asientos = await db.from('ledger.asientos').where({ empresa_id: e.C, origen_tipo: 'lealtad' })
        assert.lengthOf(asientos, 0)
        await afirmarLealtad(assert, e)
    })

    test('lealtad: un evento repetido no da puntos (ni asientos) dos veces · lealtad, fase 1', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: true, vencimiento_meses: 12 }, [
            { tipo: 'pago_a_tiempo', puntos: 25 },
        ])
        // un cliente con servicio en las dos empresas: cada empresa con su programa y su libro
        const clienteId = await crearClienteFila()
        await programaConReglas(e.C, e.ctx, { diferimiento: true, vencimiento_meses: 12 }, [
            { tipo: 'pago_a_tiempo', puntos: 40 },
        ])
        const sb = await servicioConNoviembre(e.B, clienteId)
        const sc = await servicioConNoviembre(e.C, clienteId)
        const pb = await pagarATiempo(e, e.B, sb)
        await pagarATiempo(e, e.C, sc)
        await entregarEvento('pago.registrado', 'pago_id', pb.id, 3)
        assert.lengthOf(await movimientosDe(e.B, clienteId), 1)
        assert.lengthOf(await movimientosDe(e.C, clienteId), 1)
        const asientos = (await db
            .from('ledger.asientos')
            .whereIn('empresa_id', [e.B, e.C])
            .where('origen_tipo', 'lealtad')
            .select('empresa_id')) as Array<{ empresa_id: number }>
        assert.sameMembers(
            asientos.map((a) => Number(a.empresa_id)),
            [e.B, e.C],
        )
        // el cron repetido no duplica el vencimiento
        const [lote] = await movimientosDe(e.B, clienteId)
        await new VencerPuntos().execute({ hoy: String(lote!.vence_en) }, contextoPrueba())
        await new VencerPuntos().execute({ hoy: String(lote!.vence_en) }, contextoPrueba())
        assert.lengthOf(await movimientosDe(e.B, clienteId), 2)
        await afirmarLealtad(assert, e)
    })

    test('lealtad: movimientos, consumos y avisos son de solo inserción y un lote no se consume de más', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: false })
        const { clienteId } = await servicioEn(e.B)
        const lote = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: clienteId, puntos: 50, motivo: 'bienvenida' },
            e.ctx,
        )
        for (const sql of [
            `UPDATE lealtad.movimientos SET puntos = 999 WHERE id = ${lote.movimiento.id}`,
            `DELETE FROM lealtad.movimientos WHERE id = ${lote.movimiento.id}`,
            `UPDATE lealtad.consumos SET puntos = puntos WHERE true`,
            `DELETE FROM lealtad.consumos WHERE true`,
            `UPDATE lealtad.avisos_vencimiento SET puntos = puntos WHERE true`,
            `DELETE FROM lealtad.avisos_vencimiento WHERE true`,
        ]) {
            const trx = await db.transaction()
            const aceptado = await trx
                .rawQuery(sql)
                .then((r: { rowCount?: number }) => (r.rowCount ?? 0) > 0)
                .catch(() => false)
            await trx.rollback()
            assert.isFalse(aceptado, sql)
        }
        // una salida que pide más de lo que el lote tiene: el trigger la rechaza
        const trx = await db.transaction()
        const sobre = await trx
            .rawQuery(
                `WITH salida AS (
                     INSERT INTO lealtad.movimientos (empresa_id, programa_id, cliente_id, tipo, puntos, origen_tipo, clave_unica, motivo)
                     SELECT empresa_id, programa_id, cliente_id, 'ajuste', -51, 'ajuste', ?, 'prueba' FROM lealtad.movimientos WHERE id = ?
                     RETURNING id)
                 INSERT INTO lealtad.consumos (movimiento_id, lote_id, puntos) SELECT id, ?, 51 FROM salida`,
                [unico('sobre'), lote.movimiento.id, lote.movimiento.id],
            )
            .then(() => true)
            .catch(() => false)
        await trx.rollback()
        assert.isFalse(sobre, 'el lote entregó más puntos de los que tenía')
        assert.equal(hoyGuatemala().length, 10)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H15 · dos salidas concurrentes del mismo lote fuera de la acción pasan el trigger de sobreconsumo', async ({
        assert,
    }) => {
        // Producto: database/migrations/1792363934648_create_lealtad_programas_table.ts, `lealtad.validar_consumo()` suma
        // los consumos confirmados sin bloquear el lote: dos transacciones concurrentes ven lo mismo y las dos pasan.
        // Las acciones se salvan con el advisory lock por cliente (5101), pero el trigger que se presenta como la
        // defensa de la base no lo es. Arreglo: `SELECT ... FROM lealtad.movimientos WHERE id = NEW.lote_id FOR UPDATE`
        // dentro del trigger.
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, { diferimiento: false })
        const { clienteId } = await servicioEn(e.B)
        const lote = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: clienteId, puntos: 50, motivo: 'bienvenida' },
            e.ctx,
        )
        const salida = (trx: Awaited<ReturnType<typeof db.transaction>>) =>
            trx.rawQuery(
                `WITH salida AS (
                     INSERT INTO lealtad.movimientos (empresa_id, programa_id, cliente_id, tipo, puntos, origen_tipo, clave_unica, motivo)
                     SELECT empresa_id, programa_id, cliente_id, 'ajuste', -30, 'ajuste', ?, 'carrera' FROM lealtad.movimientos WHERE id = ?
                     RETURNING id)
                 INSERT INTO lealtad.consumos (movimiento_id, lote_id, puntos) SELECT id, ?, 30 FROM salida`,
                [unico('carrera'), lote.movimiento.id, lote.movimiento.id],
            )
        const a = await db.transaction()
        const b = await db.transaction()
        const ra = await salida(a)
            .then(() => true)
            .catch(() => false)
        // la segunda no espera a la primera (no hay bloqueo): si el trigger bloqueara, esta llamada esperaría
        const rb = await Promise.race([
            salida(b)
                .then(() => true)
                .catch(() => false),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
        ])
        await a.rollback()
        await b.rollback()
        assert.isFalse(ra && rb, 'las dos salidas de 30 puntos de un lote de 50 pasaron el trigger')
        const v = await verificarLibro(e.B)
        assert.deepEqual(v, [])
    }).fails('H15: el trigger de consumos no bloquea el lote')
})
