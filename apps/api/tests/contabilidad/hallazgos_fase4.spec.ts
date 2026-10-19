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

    test('H13 · anular el pago deja viva la diferencia de cobro que ese pago cerró', async ({ assert }) => {
        // Producto: app/billing/actions/anular_pago.ts no toca billing.diferencias_cobro ni su nota. La diferencia se
        // justificó con un cobro que ya no existe: la factura queda con su saldo menos la nota (un descuento sin causa).
        // En Odoo el write-off es parte del asiento del pago y se revierte con él.
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
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
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

    test('H18 · con DTE de la factura, anular el pago devuelve la diferencia como cargo interno CxC / 5.3.05 que cuadra en el auxiliar', async ({
        assert,
    }) => {
        // Producto: app/billing/actions/anular_pago.ts no anula la nota de la diferencia si la factura ya tiene DTE (el DTE
        // se certificó por el neto). La decisión H13 dice que anular el pago revierte su diferencia; con documento
        // fiscal haría falta un cargo o una NDEB por la diferencia. Hoy el cliente queda con Q0.50 descontados sin causa.
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '149.50', empresa_id: e.B },
            e.ctx,
        )
        await new CerrarDiferenciaPago().execute({ pago_id: pago.id }, e.ctx)
        await cola(e)
        assert.equal(await dtesDe('factura', s.facturas[0]!.id).then((r) => r[0]?.estado), 'certificado')
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
        // decisión H18: el DTE no se toca; el cliente vuelve a deber los Q0.50 con un cargo interno (CxC / 5.3.05)
        assert.lengthOf(await dtesDe('factura', s.facturas[0]!.id), 1)
        const cargos = (await db
            .from('billing.facturas')
            .where({ factura_origen_id: s.facturas[0]!.id, tipo: 'cargo' })
            .select('id', 'total', 'iva', 'estado')) as Array<Record<string, string>>
        assert.lengthOf(cargos, 1)
        assert.include(cargos[0]!, { total: '0.50', iva: '0.00', estado: 'emitida' })
        assert.equal(
            await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId),
            '150.00',
            'auxiliar = 149.50 + cargo 0.50',
        )
        // la nota de la diferencia (decisión f, aviso) llevó la base 0.45 a 5.3.05 y el IVA 0.05 a 2.1.11, que el DTE
        // ya reclasificó por su neto; el cargo, por decisión, abona los 0.50 enteros a 5.3.05: queda acreedora en 0.05
        // (ingreso no fiscal). Opinión del auditor: aceptable por la decisión; confirmar con contador
        assert.equal(await saldoCuenta(e.B, '5.3.05'), '-0.05', 'base de la nota (0.45) − cargo (0.50)')
        // el cliente paga lo que debe: la factura y el cargo quedan pagados, el cargo nunca va a la cola FEL
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        assert.lengthOf(await dtesDe('factura', Number(cargos[0]!.id)), 0)
        assert.equal(Number(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId)), 0)
        assert.equal(Number(await saldoCuenta(e.B, CUENTAS.ANTICIPOS_CLIENTES, s.clienteId)), 0)
        assert.deepEqual(await verificarLibro(e.B, { incluirHallazgosAbiertos: true }), [])
    })
})
