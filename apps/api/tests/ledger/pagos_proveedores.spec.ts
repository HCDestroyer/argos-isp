import { test } from '@japa/runner'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { saldoProveedor } from '#ledger/proveedores'
import { cuentasPorPagar, estadoCuentaProveedor } from '#ledger/pagos_proveedores'
import { verCompra } from '#ledger/compras'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarPagoProveedor from '#ledger/actions/registrar_pago_proveedor'
import AnularPagoProveedor from '#ledger/actions/anular_pago_proveedor'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import { codigoCaja, errorDe, saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { haceMeses, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { afirmarLibroFase5 } from '#tests/ledger/verificar_compras'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 5 (§3.4, §10.8): pagos a proveedores, auxiliar (estado de cuenta) y antigüedad de
 * proveedores que cuadra con 2.1.03.
 */

const PROVEEDORES = CUENTAS_GT.PROVEEDORES

async function compraCredito(
    ctx: ContextoAccion,
    proveedorId: number,
    total: string,
    fecha: string,
    vence?: string,
) {
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedorId,
            tipo_documento: 'FACT',
            numero: unico('F'),
            fecha_documento: fecha,
            condicion: 'credito',
            vence_en: vence ?? null,
            retenciones: [],
            lineas: [{ descripcion: 'Servicio', categoria: 'transito', total }],
        },
        ctx,
    )
}

/** Saldo de 2.1.03 en la empresa como lo que se debe (haber − debe). */
async function cxp(empresaId: number) {
    const saldo = await saldoCuenta(empresaId, PROVEEDORES)
    return saldo.startsWith('-') ? saldo.slice(1) : saldo === '0.00' ? '0.00' : `-${saldo}`
}

test.group('Fase 5 · pagos a proveedores', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('pago por banco: la compra más antigua primero, Proveedores / Banco; no se paga de más; anular devuelve el saldo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const vieja = await compraCredito(e.ctx, proveedor.id, '1120.00', haceMeses(1), haceMeses(1, 15))
        const nueva = await compraCredito(e.ctx, proveedor.id, '560.00', haceMeses(0))
        const excede = await errorDe(
            new RegistrarPagoProveedor().execute(
                {
                    proveedor_id: proveedor.id,
                    monto: '2000.00',
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                },
                e.ctx,
            ),
        )
        assert.equal(excede.codigo, 'pago_excede_saldo')
        const pago = await new RegistrarPagoProveedor().execute(
            {
                proveedor_id: proveedor.id,
                monto: '1400.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                referencia: 'CHQ-881',
            },
            e.ctx,
        )
        assert.deepEqual(
            pago.aplicaciones.map((a) => [a.compra_id, a.monto]),
            [
                [vieja.id, '1120.00'],
                [nueva.id, '280.00'],
            ],
        )
        assert.deepEqual(await partidas('pago_proveedor', pago.id), [
            [PROVEEDORES, '1400.00', '0.00', null],
            [e.banco.get(e.B)!.codigo, '0.00', '1400.00', null],
        ])
        const saldo = await saldoProveedor(proveedor.id)
        assert.equal(saldo.toFixed(2), '280.00')
        const viejaDespues = await verCompra(vieja.id)
        assert.equal(viejaDespues.saldo, '0.00')
        const nuevaDespues = await verCompra(nueva.id)
        assert.equal(nuevaDespues.saldo, '280.00')

        const conPago = await errorDe(
            new AnularCompra().execute({ compra_id: vieja.id, motivo: 'no' }, e.ctx),
        )
        assert.equal(conPago.codigo, 'compra_con_pagos')
        const anulado = await new AnularPagoProveedor().execute(
            { pago_id: pago.id, motivo: 'cheque rechazado' },
            e.ctx,
        )
        assert.equal(anulado.estado, 'anulado')
        const saldoAnulado = await saldoProveedor(proveedor.id)
        assert.equal(saldoAnulado.toFixed(2), '1680.00')
        const otraVez = await errorDe(
            new AnularPagoProveedor().execute({ pago_id: pago.id, motivo: 'otra' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'pago_anulado')

        // la compra pedida primero, aunque sea la más nueva
        const dirigido = await new RegistrarPagoProveedor().execute(
            {
                proveedor_id: proveedor.id,
                monto: '600.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                compras: [nueva.id],
            },
            e.ctx,
        )
        assert.deepEqual(
            dirigido.aplicaciones.map((a) => [a.compra_id, a.monto]),
            [
                [nueva.id, '560.00'],
                [vieja.id, '40.00'],
            ],
        )
        const nuevaConPago = await errorDe(
            new AnularCompra().execute({ compra_id: nueva.id, motivo: 'x' }, e.ctx),
        )
        assert.equal(nuevaConPago.codigo, 'compra_con_pagos')
        const ajena = await errorDe(
            new RegistrarPagoProveedor().execute(
                {
                    proveedor_id: proveedor.id,
                    monto: '10.00',
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.C)!,
                },
                e.ctx,
            ),
        )
        assert.include(ajena.reglas, 'cuenta_de_otra_empresa')
        await afirmarLibroFase5(assert, [e.B, e.C])
    })

    test('pago en efectivo baja el esperado del turno; estado de cuenta y antigüedad cuadran con 2.1.03', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const otro = await proveedorEn(e.B, e.ctx)
        await compraCredito(e.ctx, proveedor.id, '336.00', haceMeses(2), haceMeses(2))
        await compraCredito(e.ctx, proveedor.id, '224.00', haceMeses(0), haceMeses(-1))
        await compraCredito(e.ctx, otro.id, '112.00', haceMeses(0), haceMeses(-1))
        const cajaId = e.cajas.get(e.B)!
        const pago = await new RegistrarPagoProveedor().execute(
            { proveedor_id: proveedor.id, monto: '80.00', metodo: 'caja', caja_id: cajaId },
            e.ctx,
        )
        assert.isNotNull(pago.turno_id)
        assert.deepEqual(await partidas('pago_proveedor', pago.id), [
            [PROVEEDORES, '80.00', '0.00', null],
            [await codigoCaja(cajaId), '0.00', '80.00', null],
        ])
        const turno = await new CerrarCaja().execute({ caja_id: cajaId, contado: '20.00' }, e.ctx)
        assert.equal(turno.esperado, '20.00')
        assert.equal(turno.diferencia, '0.00')

        const estadoCuenta = await estadoCuentaProveedor(proveedor.id, {})
        assert.deepEqual(
            estadoCuenta.movimientos.map((m) => [m.tipo, m.debe, m.haber, m.saldo]),
            [
                ['compra', '0.00', '336.00', '336.00'],
                ['compra', '0.00', '224.00', '560.00'],
                ['pago', '80.00', '0.00', '480.00'],
            ],
        )
        assert.equal(estadoCuenta.saldo_final, '480.00')
        assert.deepEqual(
            estadoCuenta.pendientes.map((p) => p.saldo),
            ['256.00', '224.00'],
        )
        assert.isAbove(estadoCuenta.pendientes[0]!.dias_vencida, 30)

        const reporte = await cuentasPorPagar({}, [e.B], false)
        assert.equal(reporte.totales.total, '592.00')
        assert.equal(reporte.totales.total, await cxp(e.B))
        const fila = reporte.filas.find((f) => f.proveedor_id === proveedor.id)!
        assert.equal(fila.total, '480.00')
        assert.equal(fila.por_vencer, '224.00')
        assert.equal(fila.vencido, '256.00')
        await afirmarLibroFase5(assert, [e.B, e.C])
    })

    test('rutas: pagar, anular, estado de cuenta y antigüedad de proveedores (json y xlsx)', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const proveedor = await proveedorEn(e.B, e.ctx)
        await compraCredito(e.ctx, proveedor.id, '448.00', haceMeses(0))
        const pago = await estado(
            client
                .post('/api/v1/pagos-proveedores')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('pp'))
                .json({
                    proveedor_id: proveedor.id,
                    monto: '100.00',
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                }),
            201,
        )
        const lista = await estado(
            client
                .get('/api/v1/pagos-proveedores')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ proveedor_id: proveedor.id }),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((p: { id: number }) => p.id),
            [pago.body().id],
        )
        const cuenta = await estado(
            client
                .get(`/api/v1/proveedores/${proveedor.id}/estado-cuenta`)
                .bearerToken(e.token)
                .headers(cabecera),
            200,
        )
        assert.equal(cuenta.body().saldo_final, '348.00')
        const reporte = await estado(
            client.get('/api/v1/reportes/cuentas-por-pagar').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(reporte.body().totales.total, '348.00')
        const xlsx = await client
            .get('/api/v1/reportes/cuentas-por-pagar')
            .bearerToken(e.token)
            .headers(cabecera)
            .qs({ formato: 'xlsx' })
        xlsx.assertStatus(200)
        await estado(
            client
                .post(`/api/v1/pagos-proveedores/${pago.body().id}/anular`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'transferencia devuelta' }),
            200,
        )
        await afirmarLibroFase5(assert, [e.B, e.C])
    })
})
