import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { huellaTablas } from '#tests/contabilidad/verificar_libro'
import { estadoServicio, eventosDe, facturasDe, servicioCortado } from '#tests/billing/ayudas_billing'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import RegistrarPago from '#billing/actions/registrar_pago'
import SustituirFactura from '#billing/actions/sustituir_factura'
import VencerFacturas from '#billing/actions/vencer_facturas'
import { ConsumidorBilling } from '#billing/consumidor'
import { verPromesa } from '#billing/promesas'
import { CERO, dec } from '#ledger/dinero'

/**
 * Auditor contable · revisión de «la promesa cubre todo lo vencido» (rama `a4/promesa-total-vencido`,
 * contrato `promesas.md`). La promesa no mueve el libro: cada paso de la promesa (crear, cumplir,
 * incumplir) deja `ledger` idéntico; solo los pagos lo mueven. Sus cifras cuadran con el auxiliar
 * 1.1.03 del cliente: el monto = saldo del auxiliar al crearla, `pagado` = lo que bajó el auxiliar y
 * `saldo_cubierto` = lo que le queda. Y el incumplimiento sigue cortando.
 *
 * Escenario (`servicioCortado`): septiembre y octubre vencidas, Q150.00 cada una, servicio cortado;
 * se limita con 1 vencida y se corta con 2.
 */

const gt = (fechaHora: string) => new Date(`${fechaHora}:00-06:00`)
const AHORA = gt('2026-10-08T10:00')
const VENCE = gt('2026-10-12T18:00')
const TRAS_VENCER = gt('2026-10-12T19:00')

const prometer = (servicioId: number) =>
    new CrearPromesaPago().execute(
        { servicio_id: servicioId, vence_en: VENCE, canal: 'operador', ahora: AHORA },
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

const incumplir = (servicioId: number) =>
    new IncumplirPromesas().execute({ servicio_id: servicioId, ahora: TRAS_VENCER }, contextoPrueba())

/** Solo las tablas de `ledger`: crear o cerrar una promesa sí escribe en `audit` (su auditoría). */
async function huellaLibro() {
    const todas = await huellaTablas()
    return Object.fromEntries(Object.entries(todas).filter(([t]) => t.startsWith('ledger.')))
}

/** Saldo del auxiliar 1.1.03 (CxC) del cliente, leído del mayor. */
async function auxiliar(clienteId: number): Promise<string> {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS saldo
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE c.codigo = '1.1.03' AND m.cliente_id = ?`,
        [clienteId],
    )) as { rows: Array<{ saldo: string }> }
    return rows[0]!.saldo
}

async function promesa(id: number) {
    return (await db.from('billing.promesas').where('id', id).firstOrFail()) as {
        estado: string
        monto: string
        resultado_evaluacion: { cierre?: Record<string, string> }
    }
}

async function estadoPromesa(id: number): Promise<string> {
    const fila = await promesa(id)
    return fila.estado
}

async function cierreDe(id: number) {
    const fila = await promesa(id)
    return fila.resultado_evaluacion.cierre
}

test.group('Auditor contable · promesas que cubren todo lo vencido', () => {
    test('ciclo completo: la promesa no mueve el libro y sus cifras = auxiliar 1.1.03 (cumplida, incumplida con saldo e incumplida sin pago corta)', async ({
        assert,
    }) => {
        // 1) cumplida: crear, pago parcial, pago del resto
        const a = await servicioCortado()
        const inicial = await auxiliar(a.clienteId)
        assert.equal(inicial, '300.00')
        let libro = await huellaLibro()
        const p = await prometer(a.servicioId)
        assert.deepEqual(await huellaLibro(), libro, 'crear la promesa no escribe en ledger')
        assert.equal(p.estado, 'activa')
        assert.equal(p.monto, inicial, 'monto = saldo del auxiliar (todo lo pendiente está vencido)')
        const cubiertas = await db.from('billing.promesas_facturas').where('promesa_id', p.id)
        assert.equal(
            cubiertas.reduce((s, f) => s.plus(f.monto), CERO).toFixed(2),
            p.monto,
            'Σ promesas_facturas = monto',
        )
        assert.equal(await estadoServicio(a.servicioId), 'activo')

        await pagar(a.clienteId, '200.00')
        libro = await huellaLibro()
        await pagoRegistrado(a.clienteId)
        assert.deepEqual(await huellaLibro(), libro, 'revisar la promesa no escribe en ledger')
        assert.equal(await estadoPromesa(p.id), 'activa', 'un pago parcial no la cumple')
        const vista = await verPromesa(p.id)
        assert.equal(
            vista.facturas.reduce((s, f) => s.plus(f.saldo), CERO).toFixed(2),
            await auxiliar(a.clienteId),
            'Σ saldo de las cubiertas = auxiliar',
        )

        await pagar(a.clienteId, '100.00')
        libro = await huellaLibro()
        await pagoRegistrado(a.clienteId)
        assert.deepEqual(await huellaLibro(), libro, 'cumplir la promesa no escribe en ledger')
        const cumplida = await promesa(p.id)
        assert.equal(cumplida.estado, 'cumplida')
        assert.equal(await auxiliar(a.clienteId), '0.00')
        assert.containSubset(cumplida.resultado_evaluacion.cierre, {
            estado: 'cumplida',
            pagado: dec(inicial)
                .minus(await auxiliar(a.clienteId))
                .toFixed(2),
            saldo_cubierto: await auxiliar(a.clienteId),
        })
        assert.equal(await estadoServicio(a.servicioId), 'activo')

        // 2) incumplida con saldo: le queda Q0.01 a octubre → 1 vencida, se limita
        const b = await servicioCortado()
        const pb = await prometer(b.servicioId)
        await pagar(b.clienteId, '299.99')
        libro = await huellaLibro()
        await incumplir(b.servicioId)
        assert.deepEqual(await huellaLibro(), libro, 'incumplir no escribe en ledger')
        const incumplidaB = await promesa(pb.id)
        assert.equal(incumplidaB.estado, 'incumplida')
        assert.containSubset(incumplidaB.resultado_evaluacion.cierre, {
            estado: 'incumplida',
            pagado: dec(pb.monto)
                .minus(await auxiliar(b.clienteId))
                .toFixed(2),
            saldo_cubierto: await auxiliar(b.clienteId),
        })
        assert.equal(await auxiliar(b.clienteId), '0.01')
        assert.equal(await estadoServicio(b.servicioId), 'limitado')

        // 3) incumplida sin ningún pago: las dos vencidas vuelven a cortar
        const c = await servicioCortado()
        const pc = await prometer(c.servicioId)
        assert.equal(await estadoServicio(c.servicioId), 'activo')
        libro = await huellaLibro()
        await incumplir(c.servicioId)
        assert.deepEqual(await huellaLibro(), libro, 'incumplir (y cortar) no escribe en ledger')
        assert.equal(await estadoPromesa(pc.id), 'incumplida')
        assert.containSubset(await cierreDe(pc.id), {
            pagado: '0.00',
            saldo_cubierto: await auxiliar(c.clienteId),
        })
        assert.equal(await estadoServicio(c.servicioId), 'suspendido', 'el incumplimiento sigue cortando')
        await afirmarLibroCuadrado(assert)
    })

    test('hallazgo de la revisión: sustituir una factura cubierta no cumple la promesa (la deuda sigue en la sustituta)', async ({
        assert,
    }) => {
        const s = await servicioCortado()
        const p = await prometer(s.servicioId)
        assert.equal(p.estado, 'activa')
        // paga septiembre (la más antigua) y corrige octubre (sin pagos) con una sustitución
        await pagar(s.clienteId, '150.00')
        const antes = await facturasDe(s.servicioId)
        const octubre = antes.find((f) => f.periodo === '2026-10-01' && f.tipo === 'servicio')!
        const sustitucion = await new SustituirFactura().execute(
            { factura_id: Number(octubre.id), motivo: 'auditoría: NIT corregido' },
            contextoPrueba(),
        )
        await new VencerFacturas().execute(
            { servicio_id: s.servicioId, hasta: '2026-10-12' },
            contextoPrueba(),
        )
        const despues = await facturasDe(s.servicioId)
        const nueva = despues.find((f) => Number(f.id) === sustitucion.nueva.id)!
        assert.equal(nueva.estado, 'vencida', 'la sustituta vence el mismo día que la original')
        assert.equal(await auxiliar(s.clienteId), '150.00', 'la deuda sigue: Q150 en la sustituta')

        // un pago.registrado (de otro servicio, o repetido) revisa la promesa: no se cumplió
        await pagoRegistrado(s.clienteId)
        assert.equal(await estadoPromesa(p.id), 'activa', 'sigue activa: la sustituta no se ha pagado')
        assert.lengthOf(await eventosDe('promesa.cumplida', 'promesa_id', p.id), 0)

        // al vencer queda incumplida con el saldo de la sustituta, y el servicio vuelve a limitarse
        await incumplir(s.servicioId)
        const fila = await promesa(p.id)
        assert.equal(fila.estado, 'incumplida')
        assert.containSubset(fila.resultado_evaluacion.cierre, {
            saldo_cubierto: await auxiliar(s.clienteId),
        })
        assert.equal(await estadoServicio(s.servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })
})
