import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { cuadreCompras, libroCompras } from '#fiscal/libros'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularCompra from '#ledger/actions/anular_compra'
import { saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { hacerAgenteRetencion, haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import AmortizarDiferidos from '#ledger/actions/amortizar_diferidos'
import { verActivo } from '#ledger/activos'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · fase 5 (compras y retenciones; contrato §3.4, §3.5 y §19). Activa los dos
 * pendientes de `pendientes_fases.spec.ts` («libro de compras = 1.1.04» y «retención recibida»)
 * con el auditor completo (`afirmarLibro`) después de cada paso.
 */

/** Movimiento de 1.1.04 del mes `YYYY-MM` en la empresa (todos los orígenes). */
async function ivaCreditoDelMes(empresaId: number, mes: string): Promise<string> {
    const fila = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.codigo', CUENTAS_GT.IVA_CREDITO)
        .whereRaw(`to_char(a.fecha, 'YYYY-MM') = ?`, [mes])
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text as monto'))
        .firstOrFail()
    return fila.monto as string
}

test.group('Auditor contable · fase 5 (compras y retenciones)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('libro de compras = cuenta 1.1.04 IVA crédito fiscal, por empresa y mes: FACT, NCRE, FPEQ, desde egreso y anulación en el mes de su reverso', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx, { dias_credito: 30 })
        const pequeno = await proveedorEn(e.B, e.ctx, { tipo: 'pequeno_contribuyente' })
        const otraEmpresa = await proveedorEn(e.C, e.ctx)
        const mes2 = haceMeses(2).slice(0, 7)
        const mes1 = haceMeses(1).slice(0, 7)
        const mes0 = haceMeses(0).slice(0, 7)
        // mes −2: FACT al crédito 1120 (IVA 120) y su NCRE 112 (IVA 12)
        const fact = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(2, 10),
                condicion: 'credito',
                lineas: [
                    { descripcion: 'Tránsito IP', tipo: 'servicio', categoria: 'transito', total: '1120.00' },
                ],
            },
            e.ctx,
        )
        await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'NCRE',
                numero: unico('NC'),
                fecha_documento: haceMeses(2, 20),
                condicion: 'credito',
                compra_referencia_id: fact.id,
                lineas: [{ descripcion: 'Descuento', categoria: 'transito', total: '112.00' }],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // mes −1: FACT de bienes 2240 (IVA 240) que se anula hoy, y FPEQ sin IVA ni crédito
        const anulable = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(1, 3),
                condicion: 'credito',
                lineas: [{ descripcion: 'Cable', tipo: 'bien', total: '2240.00' }],
            },
            e.ctx,
        )
        await new RegistrarCompra().execute(
            {
                proveedor_id: pequeno.id,
                tipo_documento: 'FPEQ',
                numero: unico('P'),
                fecha_documento: haceMeses(1, 4),
                condicion: 'credito',
                lineas: [{ descripcion: 'Conectores', tipo: 'bien', total: '95.00' }],
            },
            e.ctx,
        )
        // otra empresa: no se mezcla
        await new RegistrarCompra().execute(
            {
                proveedor_id: otraEmpresa.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(1, 5),
                condicion: 'credito',
                lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '336.00' }],
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
        // mes en curso: compra desde un egreso (reclasificación 1.1.04 / gasto por 60) y la anulación de la de −1
        const egreso = await new RegistrarEgreso().execute(
            {
                categoria: 'energia',
                monto: '560.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                proveedor: 'EEGSA',
                fecha: haceMeses(0),
            },
            e.ctx,
        )
        const antes = await partidas('egreso', egreso.id)
        await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: egreso.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('E'),
                fecha_documento: haceMeses(0),
                lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '560.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(await partidas('egreso', egreso.id), antes, 'el asiento del egreso no se toca')
        await new AnularCompra().execute({ compra_id: anulable.id, motivo: 'documento equivocado' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])

        const esperado: Record<string, string> = { [mes2]: '108.00', [mes1]: '240.00', [mes0]: '-180.00' }
        for (const [mes, monto] of Object.entries(esperado)) {
            const libro = await libroCompras(e.B, { desde: `${mes}-01` })
            assert.equal(libro.totales.iva_credito, monto, `libro de compras ${mes}`)
            assert.equal(await ivaCreditoDelMes(e.B, mes), monto, `1.1.04 de ${mes}`)
        }
        const cuadre = await cuadreCompras(e.B, { desde: `${mes2}-01`, hasta: `${mes0}-01` })
        assert.deepEqual(
            cuadre.map((c) => [c.periodo, c.libro, c.cuenta, c.cuadra]),
            [
                [mes2, '108.00', '108.00', true],
                [mes1, '240.00', '240.00', true],
                [mes0, '-180.00', '-180.00', true],
            ],
        )
        // la otra empresa lleva su propio libro (IVA 36 en el mes −1)
        const libroC = await libroCompras(e.C, { desde: `${mes1}-01` })
        assert.equal(libroC.totales.iva_credito, '36.00')
        assert.equal(await ivaCreditoDelMes(e.C, mes1), '36.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.IVA_CREDITO), '168.00')
    })

    test('retención recibida: CxC baja por el total, 1.1.05 / 1.1.06 por las constancias; Σ constancias vigentes = 1.1.05 + 1.1.06 en cada paso', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-10-01' })
        const factura = s.facturas[0]!
        const cajaId = e.cajas.get(e.B)!
        const constanciasVigentes = async () => {
            const fila = await db
                .from('ledger.constancias_retencion as k')
                .join('billing.pagos as p', 'p.id', 'k.pago_id')
                .where('k.empresa_id', e.B)
                .where('k.direccion', 'recibida')
                .where('p.estado', 'registrado')
                .select(db.raw('coalesce(sum(k.monto), 0)::numeric(14,2)::text as monto'))
                .firstOrFail()
            return fila.monto as string
        }
        const retenido = async () => {
            const iva = Number(await saldoCuenta(e.B, CUENTAS_GT.IVA_RETENIDO_CLIENTES))
            const isr = Number(await saldoCuenta(e.B, CUENTAS_GT.ISR_RETENIDO_CLIENTES))
            return (iva + isr).toFixed(2)
        }
        // pago parcial: 100 en efectivo + constancias IVA 2.41 e ISR 8.09 → aplica 110.50
        const parcial = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '100.00',
                caja_id: cajaId,
                empresa_id: e.B,
                retenciones: [
                    { codigo: 'RET_IVA_ESP', numero: unico('CT'), monto: '2.41' },
                    { codigo: 'RET_ISR_OPC', numero: unico('ISR'), monto: '8.09' },
                ],
            },
            e.ctx,
        )
        assert.equal(parcial.monto, '110.50')
        const asiento = await partidas('pago', parcial.id)
        const lineas = asiento.map(([c, d, h]) => `${c} ${d}/${h}`)
        assert.includeMembers(lineas, [
            `${CUENTAS_GT.IVA_RETENIDO_CLIENTES} 2.41/0.00`,
            `${CUENTAS_GT.ISR_RETENIDO_CLIENTES} 8.09/0.00`,
            `${CUENTAS.CXC_CLIENTES} 0.00/110.50`,
        ])
        assert.equal(await retenido(), await constanciasVigentes())
        assert.equal(await retenido(), '10.50')
        let f = await db.from('billing.facturas').where('id', factura.id).firstOrFail()
        assert.equal(f.pagado, '110.50')
        assert.equal(f.estado, 'parcial')
        await afirmarLibro(assert, [e.B, e.C])
        // el resto por banco, sin constancias
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'deposito',
                monto: '39.50',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                referencia: unico('T'),
                empresa_id: e.B,
            },
            e.ctx,
        )
        f = await db.from('billing.facturas').where('id', factura.id).firstOrFail()
        assert.equal(f.estado, 'pagada')
        await afirmarLibro(assert, [e.B, e.C])
        // anular el pago con constancias: 1.1.05 y 1.1.06 vuelven a cero y la factura queda debiendo 110.50
        await new AnularPago().execute({ pago_id: parcial.id, motivo: 'constancias rechazadas' }, e.ctx)
        assert.equal(await retenido(), '0.00')
        assert.equal(await constanciasVigentes(), '0.00')
        f = await db.from('billing.facturas').where('id', factura.id).firstOrFail()
        assert.equal(f.pagado, '39.50')
        assert.equal(await saldoCuenta(e.B, CUENTAS.CXC_CLIENTES, s.clienteId), '110.50')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('fin de la vida útil al centavo: la última cuota completa lo depreciable, repetir no duplica y el retiro deja solo el residual', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        // costo 1000.00, residual 0.01, ya depreciado 940.00, 20 % anual: cuota 16.67, quedan 59.99 → 16.67 × 3 + 9.98
        const a = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor viejo',
                fecha_alta: '2026-01-15',
                costo: '1000.00',
                valor_residual: '0.01',
                depreciacion_inicial: '940.00',
                tasa_anual: '20',
            },
            e.ctx,
        )
        assert.equal(a.cuota_mensual, '16.67')
        await afirmarLibro(assert, [e.B, e.C])
        const r = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(r.cuotas, 4)
        assert.equal(r.monto, '59.99')
        const cuotas = (await db
            .from('ledger.activos_cuotas')
            .where('activo_id', a.id)
            .orderBy('mes')
            .select('monto')) as Array<{ monto: string }>
        assert.deepEqual(
            cuotas.map((c) => c.monto),
            ['16.67', '16.67', '16.67', '9.98'],
        )
        const otra = await new DepreciarActivos().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(otra.cuotas, 0)
        const vista = await verActivo(a.id)
        assert.equal(vista.depreciacion_acumulada, '999.99')
        assert.equal(vista.valor_libros, '0.01')
        await afirmarLibro(assert, [e.B, e.C])
        const baja = await new DarDeBajaActivo().execute(
            { activo_id: a.id, tipo: 'retiro', motivo: 'fin de vida útil' },
            e.ctx,
        )
        assert.equal(baja.baja!.valor_libros, '0.01')
        const asientoBaja = await partidas('baja_activo', a.id)
        const lineas = asientoBaja.map(([c, d, h]) => `${c} ${d}/${h}`)
        assert.includeMembers(lineas, [`${CUENTAS_GT.PERDIDA_BAJA_ACTIVOS} 0.01/0.00`])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('fin de un diferimiento al centavo: 100.00 en 3 meses = 33.33 + 33.33 + 33.34 y 1.1.13 queda en cero', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('S'),
                fecha_documento: haceMeses(4, 2),
                condicion: 'credito',
                retenciones: [],
                lineas: [{ descripcion: 'Licencia', total: '112.00', diferir_meses: 3 }],
            },
            e.ctx,
        )
        const d = await db.from('ledger.diferimientos').where('compra_id', compra.id).firstOrFail()
        assert.equal(d.total, '100.00')
        await new AmortizarDiferidos().execute({ empresa_id: e.B }, e.ctx)
        await new AmortizarDiferidos().execute({ empresa_id: e.B }, e.ctx)
        const cuotas = (await db
            .from('ledger.diferimientos_cuotas')
            .where('diferimiento_id', d.id)
            .orderBy('mes')
            .select('monto')) as Array<{ monto: string }>
        assert.deepEqual(
            cuotas.map((c) => c.monto),
            ['33.33', '33.33', '33.34'],
        )
        assert.equal(Number(await saldoCuenta(e.B, CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO)), 0)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('compra al contado con retenciones (agente): el egreso y la caja salen por el neto, 2.1.04 y 2.1.05 por lo retenido', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await hacerAgenteRetencion(e.B, e.ctx)
        const opcional = await proveedorEn(e.B, e.ctx, { regimen_isr: 'opcional_simplificado' })
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: unico('R'),
                fecha_documento: haceMeses(0),
                condicion: 'contado',
                metodo: 'caja',
                caja_id: e.cajas.get(e.B)!,
                lineas: [{ descripcion: 'Mantenimiento de red', total: '3360.00' }],
            },
            e.ctx,
        )
        assert.equal(compra.neto, '3096.00')
        const egreso = await db.from('ledger.egresos').where('compra_id', compra.id).firstOrFail()
        assert.equal(egreso.monto, '3096.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR), '-54.00')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR), '-210.00')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
