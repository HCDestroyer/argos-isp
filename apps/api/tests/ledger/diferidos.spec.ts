import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verDiferimiento } from '#ledger/diferidos'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import AmortizarDiferidos from '#ledger/actions/amortizar_diferidos'
import RegistrarDiferimiento from '#ledger/actions/registrar_diferimiento'
import AnularFactura from '#billing/actions/anular_factura'
import { ejecutarCron } from '#billing/jobs'
import { errorDe, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Fase 5 (§10.10): gastos pagados por anticipado (1.1.13) e ingresos cobrados por anticipado
 * (2.1.12) con amortización mensual por cron idempotente.
 */

const ANTICIPADO = CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO
const COBRADO_ANTICIPADO = CUENTAS_GT.INGRESOS_COBRADOS_ANTICIPADO

test.group('Fase 5 · diferidos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('seguro anual de una compra: va a 1.1.13 y vuelve al gasto mes a mes; repetir no duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('S'),
                fecha_documento: haceMeses(2, 3),
                condicion: 'credito',
                retenciones: [],
                lineas: [{ descripcion: 'Seguro de equipo anual', total: '1344.00', diferir_meses: 12 }],
            },
            e.ctx,
        )
        assert.deepEqual(await partidas('compra', compra.id), [
            [ANTICIPADO, '1200.00', '0.00', '+C_BASE_SERV'],
            [CUENTAS_GT.IVA_CREDITO, '144.00', '0.00', '+C_IVA'],
            [CUENTAS_GT.PROVEEDORES, '0.00', '1344.00', null],
        ])
        const fila = await db.from('ledger.diferimientos').where('compra_id', compra.id).firstOrFail()
        const corrida = await new AmortizarDiferidos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(corrida.cuotas, 2)
        await ejecutarCron('diferir')
        const otra = await new AmortizarDiferidos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(otra.cuotas, 0)
        const diferido = await verDiferimiento(Number(fila.id))
        assert.equal(diferido.amortizado, '200.00')
        assert.equal(diferido.pendiente, '1000.00')
        assert.equal(diferido.inicio, haceMeses(2))
        const cuotasDiferidas = await partidas('diferido', diferido.id)
        assert.deepEqual(cuotasDiferidas.slice(0, 2), [
            [CUENTAS.GASTO_OTROS, '100.00', '0.00', null],
            [ANTICIPADO, '0.00', '100.00', null],
        ])
        assert.equal(await saldoCuenta(e.B, ANTICIPADO), '1000.00')
        const anular = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'no' }, e.ctx),
        )
        assert.equal(anular.codigo, 'diferido_con_cuotas')
        const activo = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: await unicoBd('S'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [
                        {
                            descripcion: 'x',
                            tipo: 'activo_fijo',
                            clase_activo: 'otros',
                            total: '112.00',
                            diferir_meses: 3,
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(activo.reglas, 'no_aplica')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('factura de varios meses: la base pasa a 2.1.12 y vuelve al ingreso; la factura diferida no se anula', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const [factura] = s.facturas
        const linea = await db.from('billing.facturas_lineas').where('factura_id', factura!.id).firstOrFail()
        const diferido = await new RegistrarDiferimiento().execute(
            { origen: 'factura', factura_linea_id: Number(linea.id), meses: 3, inicio: haceMeses(2) },
            e.ctx,
        )
        assert.equal(diferido.total, '133.93')
        assert.deepEqual(await partidas('diferido', diferido.id), [
            [CUENTAS.INGRESOS_INTERNET, '133.93', '0.00', null],
            [COBRADO_ANTICIPADO, '0.00', '133.93', null],
        ])
        const repetido = await errorDe(
            new RegistrarDiferimiento().execute(
                { origen: 'factura', factura_linea_id: Number(linea.id), meses: 2 },
                e.ctx,
            ),
        )
        assert.equal(repetido.codigo, 'linea_diferida')
        await new AmortizarDiferidos().execute({ diferimiento_id: diferido.id }, e.ctx)
        const despues = await verDiferimiento(diferido.id)
        assert.deepEqual(
            despues.cuotas.map((c) => c.monto),
            ['44.64', '44.64'],
        )
        assert.equal(despues.pendiente, '44.65')
        assert.equal(await saldoCuenta(e.B, COBRADO_ANTICIPADO), '-44.65')
        const anular = await errorDe(
            new AnularFactura().execute({ factura_id: factura!.id, motivo: 'no corresponde' }, e.ctx),
        )
        assert.equal(anular.codigo, 'factura_diferida')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('diferir una línea de compra ya registrada; anular la compra sin cuotas cancela el diferimiento con su reverso', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('L'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                retenciones: [],
                lineas: [{ descripcion: 'Licencia anual del NMS', categoria: 'otros', total: '672.00' }],
            },
            e.ctx,
        )
        const respuesta = await estado(
            client
                .post('/api/v1/diferimientos')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .header('Idempotency-Key', unico('d'))
                .json({ origen: 'compra', compra_linea_id: compra.lineas[0]!.id, meses: 12 }),
            201,
        )
        const diferido = respuesta.body()
        assert.equal(diferido.total, '600.00')
        assert.deepEqual(await partidas('diferido', diferido.id), [
            [ANTICIPADO, '600.00', '0.00', null],
            [CUENTAS.GASTO_OTROS, '0.00', '600.00', null],
        ])
        await new AnularCompra().execute({ compra_id: compra.id, motivo: 'licencia devuelta' }, e.ctx)
        const cancelado = await verDiferimiento(diferido.id)
        assert.equal(cancelado.estado, 'cancelado')
        assert.equal(await saldoCuenta(e.B, ANTICIPADO), '0.00')
        const lista = await estado(
            client
                .get('/api/v1/diferimientos')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.B) }),
            200,
        )
        assert.isTrue(lista.body().data.some((d: { id: number }) => d.id === diferido.id))
        await afirmarLibro(assert, [e.B, e.C])
    })
})
