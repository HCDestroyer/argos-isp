import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { CUENTAS } from '#ledger/plan_cuentas'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import CerrarDiferenciaPago from '#billing/actions/cerrar_diferencia_pago'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import { saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { errorDe, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'

/**
 * Auditor contable · HALLAZGOS de la fase 4 (cobros, bancos y cartera; `a3/fase4-bancos`). Como en
 * las fases anteriores: `.fails(motivo)` mientras el hallazgo exista; su invariante está en
 * `HALLAZGOS_ABIERTOS` y la prueba lo enciende.
 */

test.group('Auditor contable · hallazgos de la fase 4', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('H12 · una provisión con corte pasado toma el saldo de 1.1.12 de hoy: la reserva al corte supera el tope', async ({
        assert,
    }) => {
        // Producto: app/ledger/actions/provisionar_cartera.ts calcula la base al corte (`a.fecha <= fecha`) pero el
        // saldo anterior de 1.1.12 sin fecha (hoy). Si después del corte un castigo usó la estimación, la segunda
        // provisión con el mismo corte vuelve a llenar el tope y la reserva AL CORTE queda en el doble del 3 % que
        // permite el art. 21.20 de la LAT.
        const e = await prepararEmpresasGt()
        const clienteId = await crearClienteFila()
        const importada = await new ImportarFacturaPendiente().execute(
            {
                origen: 'auditoria',
                id_externo: unico('h12'),
                cliente_id: clienteId,
                empresa_id: e.B,
                cargo_unico: true,
                emitida_en: '2026-09-15',
                total: '1000.00',
                concepto: 'Cargo histórico',
            },
            e.ctx,
        )
        const corte = '2026-09-30'
        const p1 = await new ProvisionarCartera().execute(
            { empresa_id: e.B, anio: 2026, fecha: corte },
            e.ctx,
        )
        assert.equal(p1.tope, '30.00')
        assert.equal(p1.monto, '30.00')
        // hoy (después del corte) se castiga la factura y se usa la estimación
        await new CastigarCartera().execute(
            {
                facturas: [importada.factura_id!],
                motivo: 'incobrable',
                evidencia: 'gestiones de cobro documentadas',
            },
            e.ctx,
        )
        const p2 = await new ProvisionarCartera().execute(
            { empresa_id: e.B, anio: 2026, fecha: corte },
            e.ctx,
        )
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
        assert.equal(p2.monto, '0.00', 'al 30-sep la reserva ya estaba en el tope')
    })

    test('decisión B (antes H13) · cerrar una diferencia es gasto 5.3.05 / CxC; anular el pago la revierte en espejo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '149.50',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
            },
            e.ctx,
        )
        await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        let factura = await db.from('billing.facturas').where('id', s.facturas[0]!.id).firstOrFail()
        assert.include(factura, { estado: 'pagada', pagado: '149.50' })
        assert.equal(await saldoCuenta(e.B, '5.3.05'), '0.50')
        assert.equal(Number(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId)), 0)
        assert.deepEqual(await verificarLibro(e.B), [])
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        factura = await db.from('billing.facturas').where('id', s.facturas[0]!.id).firstOrFail()
        assert.include(factura, { pagado: '0.00' })
        assert.equal(Number(await saldoCuenta(e.B, '5.3.05')), 0)
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), factura.total)
        assert.deepEqual(await verificarLibro(e.B), [])
    })

    test('H14 · una liquidación con solo contracargos (el proveedor debita el banco) no se puede registrar', async ({
        assert,
    }) => {
        // Producto: app/ledger/actions/liquidar_cobros.ts (bruto > 0) y ledger.liquidaciones_cobro (CHECK bruto > 0,
        // neto >= 0). Si en un periodo el proveedor solo devuelve contracargos, debita el banco y no hay forma de
        // registrarlo: 1.1.10.NN queda negativo y el banco no cuadra con el extracto hasta que haya cobros nuevos
        // (y si el proveedor se da de baja, nunca). §18 promete que «la siguiente liquidación lo descuenta».
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
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
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'pasarela',
                pasarela: 'falsa',
                monto: '100.00',
                referencia: unico('PAS'),
                empresa_id: e.B,
            },
            e.ctx,
        )
        await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'L-1',
                bruto: '100.00',
                comision: '3.00',
                pagos: [pago.id],
            },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'contracargo' }, e.ctx)
        await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'L-2',
                bruto: '-100.00',
                comision: '0.00',
                pagos: [],
                contracargos: [pago.id],
            },
            e.ctx,
        )
        assert.deepEqual(await verificarLibro(e.B), [])
        assert.equal(await saldoCuenta(e.B, proveedor.cuenta_codigo), '0.00')
    })
    test('H16 · un aviso acreditado por completo con notas internas queda acreditada y no se certifica (nunca un DTE de Q0.00)', async ({
        assert,
    }) => {
        // Producto: app/fiscal/fel/cola.ts (avisosPorCertificar: estado pagada) y app/fiscal/actions/solicitar_certificacion.ts
        // (netoParaDte): «pagada» incluye lo acreditado por notas. Un aviso que nadie pagó y se acreditó entero no es una
        // venta: no debe generar DTE (la SAT no certifica una FACT de Q0.00).
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new EmitirNotaCredito().execute({ factura_id: f.id, monto: '150.00', motivo: 'baja' }, e.ctx)
        await cola(e)
        const dtes = await dtesDe('factura', f.id)
        assert.lengthOf(dtes, 0, `DTE ${dtes[0]?.id} por Q${dtes[0]?.total} (${dtes[0]?.estado})`)
        // decisión H16: acreditada (no es venta), sin cobro ni DTE; el IVA del aviso salió de 2.1.11 con la nota
        const fila = await db.from('billing.facturas').where('id', f.id).firstOrFail()
        assert.equal(fila.estado, 'acreditada')
        const manual = await errorDe(new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx))
        assert.equal(manual.codigo, 'factura_acreditada')
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        assert.equal(await saldoCuenta(e.B, '2.1.11'), '0.00')
        // con algo cobrado sí es venta: pagada (y la cola la certifica por su neto)
        const otro = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const g = otro.facturas[0]!
        await new RegistrarPago().execute(
            { cliente_id: otro.clienteId, metodo: 'caja', monto: '50.00', empresa_id: e.B },
            e.ctx,
        )
        await new EmitirNotaCredito().execute(
            { factura_id: g.id, monto: '100.00', motivo: 'descuento' },
            e.ctx,
        )
        const pagada = await db.from('billing.facturas').where('id', g.id).firstOrFail()
        assert.equal(pagada.estado, 'pagada')
        await cola(e)
        assert.equal(await dtesDe('factura', g.id).then((r) => r[0]?.total), '50.00')
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    })

    test('H17 · recuperar un aviso castigado: la base a 4.2.03 y el IVA que salió de 2.1.11 vuelve a 2.1.11', async ({
        assert,
    }) => {
        // Producto: app/billing/actions/registrar_pago.ts (y registrar_pago_historico.ts) abona todo lo recuperado a 4.2.03.
        // El castigo de un aviso sin DTE sacó su IVA de 2.1.11 porque «nunca se causó»; al cobrarlo sí se percibe
        // (LIVA art. 4.1): la parte de IVA de lo recuperado es IVA por certificar (o débito), no ingreso. Propuesta:
        // recuperación proporcional al castigo (cf.iva / cf.monto) a 2.1.11 y el resto a 4.2.03.
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const k = await new CastigarCartera().execute(
            { facturas: [s.facturas[0]!.id], motivo: 'incobrable', evidencia: 'gestión documentada' },
            e.ctx,
        )
        assert.equal(k.iva, '16.07')
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        assert.equal(await saldoCuenta(e.B, '4.2.03'), '-133.93', 'solo la base es recuperación')
        assert.equal(await saldoCuenta(e.B, '2.1.11'), '-16.07', 'decisión H17: el IVA vuelve a 2.1.11')
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    })

    test('decisión B (antes H18) · con DTE la diferencia no toca el documento; anular otro pago aplicado a la factura también la revierte (desvío b)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        const primero = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', empresa_id: e.B, facturas: [f.id] },
            e.ctx,
        )
        const segundo = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '49.50', empresa_id: e.B, facturas: [f.id] },
            e.ctx,
        )
        await new CerrarDiferenciaPago().execute({ pago_id: segundo.id }, e.ctx)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.include(dte!, { estado: 'certificado', total: '150.00' })
        assert.deepEqual(await verificarLibro(e.B), [])
        // se anula el otro pago (no el que cerró la diferencia): la diferencia se revierte y la factura debe 100.50
        await new AnularPago().execute({ pago_id: primero.id, motivo: 'cheque rechazado' }, e.ctx)
        const factura = await db.from('billing.facturas').where('id', f.id).firstOrFail()
        assert.include(factura, { pagado: '49.50', estado: 'parcial' })
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '100.50')
        assert.lengthOf(await dtesDe('factura', f.id), 1, 'el DTE no se toca')
        assert.equal(Number(await saldoCuenta(e.B, '5.3.05')), 0)
        // la diferencia no se puede volver a cerrar con el pago que queda: ahora faltan 100.50
        assert.deepEqual(await verificarLibro(e.B), [])
    })
})
