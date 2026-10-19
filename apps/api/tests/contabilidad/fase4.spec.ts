import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import DepositarCaja from '#ledger/actions/depositar_caja'
import TrasladarFondos from '#ledger/actions/trasladar_fondos'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import ReatribuirLlegada from '#ledger/actions/reatribuir_llegada'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import { crearClienteFila } from '#tests/core/fabricas'
import { cola, datosNit, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { hoyGuatemala } from '#ledger/fechas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import {
    afirmarLibro,
    compararFotoLibro,
    fotoLibro,
    marcasAuditoria,
} from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariantes de la fase 4 (cobros, bancos y cartera; contrato §10.3 y §10.9),
 * con el auditor completo (`afirmarLibro`, sin los reemplazos de `tests/ledger/verificar_bancos.ts`)
 * después de cada paso. Activa «conciliación bancaria solo por inserción» de `pendientes_fases`.
 */

test.group('Auditor contable · fase 4 (cobros y bancos)', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('pasarela con proveedor, liquidación y contracargo: 1.1.10.NN = pagos sin liquidar − contracargos', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01' })
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'falsa',
                nombre: 'Pasarela',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
            },
            e.ctx,
        )
        const pagar = (monto: string) =>
            new RegistrarPago().execute(
                {
                    cliente_id: s.clienteId,
                    metodo: 'pasarela',
                    pasarela: 'falsa',
                    monto,
                    comision: '1.00',
                    referencia: unico('PAS'),
                    empresa_id: e.B,
                },
                e.ctx,
            )
        const p1 = await pagar('100.00')
        const p2 = await pagar('50.00')
        assert.equal(p1.proveedor_cobro_id, proveedor.id)
        await afirmarLibro(assert, [e.B, e.C])
        await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'L-1',
                bruto: '150.00',
                comision: '4.50',
                pagos: [p1.id, p2.id],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // contracargo: el pago liquidado se anula; el puente queda negativo hasta la próxima liquidación
        await new AnularPago().execute({ pago_id: p2.id, motivo: 'contracargo' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        const p3 = await pagar('80.00')
        await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'L-2',
                bruto: '30.00',
                comision: '0.90',
                pagos: [p3.id],
                contracargos: [p2.id],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cartera: estimación hasta el tope y castigo de un aviso pagado en parte (IVA proporcional de 2.1.11)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const t = await servicioFel(e, 'emitir', '224.00', await crearClienteFila(datosNit()))
        await cola(e)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '50.00', empresa_id: e.B },
            e.ctx,
        )
        const p1 = await new ProvisionarCartera().execute({ empresa_id: e.B, anio: 2026 }, e.ctx)
        assert.isAbove(Number(p1.monto), 0)
        const p2 = await new ProvisionarCartera().execute({ empresa_id: e.B, anio: 2026 }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        assert.equal(p2.monto, '0.00')
        // aviso sin DTE pagado en parte: sale de 2.1.11 solo el IVA del saldo
        const k1 = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'tres llamadas y una carta' },
            e.ctx,
        )
        assert.isAbove(Number(k1.iva), 0)
        // factura certificada: el IVA ya es débito y no se toca
        const k2 = await new CastigarCartera().execute(
            { facturas: [t.facturas[0]!.id], motivo: 'incobrable', evidencia: 'tres llamadas y una carta' },
            e.ctx,
        )
        assert.equal(k2.iva, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('conciliación bancaria solo por inserción: depósito, traslado, extracto, conciliar y deshacer nunca cambian el libro existente', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        const cajaId = e.cajas.get(e.B)!
        const banco = e.cuentas.get(e.B)!
        const otra = await cuentaBancariaPrueba('Banrural', e.B)
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '300.00', caja_id: cajaId, empresa_id: e.B },
            e.ctx,
        )
        const deposito = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '250.00', boleta: 'B-1', cuenta_bancaria_id: banco },
            e.ctx,
        )
        const traslado = await new TrasladarFondos().execute(
            {
                monto: '40.00',
                referencia: 'T-1',
                origen: { cuenta_bancaria_id: banco },
                destino: { cuenta_bancaria_id: otra.id },
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        const marcas = await marcasAuditoria()
        const antes = await fotoLibro([e.B], marcas.acciones, marcas.outbox)

        const hoy = hoyGuatemala()
        const ext = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: banco,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: '0.00',
                saldo_final: '237.50',
                lineas: [
                    { fecha: hoy, descripcion: 'DEPOSITO', referencia: 'B-1', monto: '250.00' },
                    { fecha: hoy, descripcion: 'COMISION', referencia: 'C-1', monto: '-12.50' },
                ],
            },
            e.ctx,
        )
        const [lDep, lCom] = (await db
            .from('ledger.extractos_lineas')
            .where('extracto_id', ext.id)
            .orderBy('orden')
            .select('id')) as Array<{ id: number }>
        const llegada = await new ConciliarLinea().execute(
            { linea_id: lDep!.id, depositos: [deposito.id] },
            e.ctx,
        )
        await new RegistrarDesdeExtracto().execute({ linea_id: lCom!.id }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        await new AnularConciliacion().execute(
            { conciliacion_id: llegada.id, motivo: 'línea equivocada' },
            e.ctx,
        )
        await new ConciliarLinea().execute(
            { linea_id: lDep!.id, movimientos: [llegada.movimientos[0]!.movimiento_id] },
            e.ctx,
        )
        const extOtra = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: otra.id,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: '0.00',
                saldo_final: '40.00',
                lineas: [{ fecha: hoy, descripcion: 'TRASLADO', referencia: 'T-1', monto: '40.00' }],
            },
            e.ctx,
        )
        const lTr = (await db
            .from('ledger.extractos_lineas')
            .where('extracto_id', extOtra.id)
            .firstOrFail()) as {
            id: number
        }
        await new ConciliarLinea().execute({ linea_id: lTr.id, traslados: [traslado.id] }, e.ctx)
        await new CerrarCaja().execute({ caja_id: cajaId, contado: '150.00' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        // nada de lo que ya estaba cambió: solo hay filas nuevas
        const despues = await fotoLibro([e.B], marcas.acciones, marcas.outbox)
        assert.deepEqual(compararFotoLibro(antes, despues), [])

        // las tablas de la conciliación rechazan UPDATE y DELETE (solo inserción)
        for (const tabla of [
            'ledger.extractos',
            'ledger.extractos_lineas',
            'ledger.conciliaciones',
            'ledger.conciliaciones_anulaciones',
            'ledger.transitos_acreditados',
            'ledger.depositos',
            'ledger.traslados',
        ]) {
            for (const sql of [
                `UPDATE ${tabla} SET created_at = created_at WHERE empresa_id = ${e.B} OR true`,
                `DELETE FROM ${tabla} WHERE true`,
            ]) {
                const trx = await db.transaction()
                const aceptado = await trx
                    .rawQuery(sql)
                    .then(() => true)
                    .catch(() => false)
                await trx.rollback()
                assert.isFalse(aceptado, `${tabla} aceptó: ${sql}`)
            }
        }
    })
    test('reatribuir una llegada y recuperar lo castigado: el libro cuadra en cada paso (decisiones c y g)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const cajaId = e.cajas.get(e.B)!
        const banco = e.cuentas.get(e.B)!
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '20.00', caja_id: cajaId, empresa_id: e.B },
            e.ctx,
        )
        const d1 = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '40.00', boleta: 'R-1', cuenta_bancaria_id: banco },
            e.ctx,
        )
        const d2 = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '40.00', boleta: 'R-2', cuenta_bancaria_id: banco },
            e.ctx,
        )
        const hoy = hoyGuatemala()
        const ext = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: banco,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: '0.00',
                saldo_final: '40.00',
                lineas: [{ fecha: hoy, descripcion: 'DEPOSITO', referencia: 'R-2', monto: '40.00' }],
            },
            e.ctx,
        )
        const linea = (await db
            .from('ledger.extractos_lineas')
            .where('extracto_id', ext.id)
            .firstOrFail()) as {
            id: number
        }
        await new ConciliarLinea().execute({ linea_id: linea.id, depositos: [d1.id] }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
        await new ReatribuirLlegada().execute(
            {
                tipo: 'deposito',
                documento_id: d1.id,
                nuevo_tipo: 'deposito',
                nuevo_documento_id: d2.id,
                motivo: 'boleta R-2',
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])

        // castigo de lo que falta y recuperación posterior
        await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '200.00', caja_id: cajaId, empresa_id: e.B },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
