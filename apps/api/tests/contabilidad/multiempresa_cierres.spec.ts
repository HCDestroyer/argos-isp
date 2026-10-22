import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import RevisarCheck from '#ledger/actions/revisar_check'
import { balanceSaldos } from '#ledger/estados_financieros'
import { saldoCliente } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import { CUENTAS } from '#ledger/plan_cuentas'
import { dec } from '#ledger/dinero'
import { contarAsientos, afirmarLibro, normalizarResumen } from '#tests/contabilidad/verificar_libro'
import {
    errorDe,
    pendientes,
    prepararEmpresas,
    saldoCuenta,
    servicioEn,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Auditor contable · invariantes 6 (multiempresa), 7 (cierres) y 8 (importación modo B).
 */

/**
 * Cierra septiembre de B con la factura importada aún en 2.9.01: el check `apertura_cero` (§10.5) da
 * anomalía mientras no exista el cierre de apertura (pendiente en `pendientes_fases.spec.ts`), y aquí
 * se supervisa con su nota, como haría el contador; los demás checks tienen que pasar solos.
 */
async function cerrarSeptiembreConApertura(e: { B: number; ctx: Parameters<CerrarPeriodo['execute']>[1] }) {
    const verificacion = await new VerificarCierre().execute(
        { empresa_id: e.B, tipo: 'mensual', periodo: '2026-09' },
        e.ctx,
    )
    const apertura = verificacion.checks.find((c) => c.clave === 'apertura_cero')!
    if (apertura.estado === 'anomalia') {
        await new RevisarCheck().execute(
            {
                check_id: apertura.id,
                estado: 'supervisado',
                nota: 'Importación en curso: 2.9.01 se cancela con el cierre de apertura',
            },
            e.ctx,
        )
    }
    return new CerrarPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9 }, e.ctx)
}

test.group('Auditor contable · multiempresa, cierres e importación (6, 7, 8)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('6. cobro repartido: un pago por empresa, cada uno en su libro y su caja; el total cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        await servicioFacturado(e.B, '2026-10-01', { clienteId, precio: '199.99', instalacion: '2026-09-01' })
        await servicioFacturado(e.C, '2026-10-01', { clienteId, precio: '99.01', instalacion: '2026-09-01' })
        const cobro = await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '650.00' },
            e.ctx,
        )
        assert.lengthOf(cobro.pagos, 2)
        const total = cobro.pagos.reduce((s, p) => s.plus(p.monto), dec('0'))
        assert.equal(total.toFixed(2), '650.00')
        for (const pago of cobro.pagos) {
            assert.equal(pago.caja_id, e.cajas.get(pago.empresa_id!))
            const asientos = await db
                .from('ledger.asientos')
                .where('origen_tipo', 'pago')
                .where('origen_id', pago.id)
            assert.isTrue(asientos.every((a) => Number(a.empresa_id) === pago.empresa_id))
        }
        assert.lengthOf(await pendientes([e.B, e.C], clienteId), 0)
        // el consolidado = Σ empresas (también lo revisa verificarLibro con las dos)
        const balance = await balanceSaldos({}, [e.B, e.C])
        const cxc = balance.total.cuentas.find((c) => c.codigo === CUENTAS.ANTICIPOS_CLIENTES)
        const porEmpresa = balance.empresas.map(
            (s) => s.cuentas.find((c) => c.codigo === CUENTAS.ANTICIPOS_CLIENTES)?.saldo ?? '0.00',
        )
        assert.equal(cxc?.saldo, porEmpresa.reduce((s, x) => s.plus(x), dec('0')).toFixed(2))
        // anular el pago de una empresa no toca el de la otra
        await new AnularPago().execute({ pago_id: cobro.pagos[1]!.id, motivo: 'auditoría' }, e.ctx)
        const vigente = await db.from('billing.pagos').where('id', cobro.pagos[0]!.id).firstOrFail()
        assert.equal(vigente.estado, 'registrado')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('6. no se cruzan dineros entre NIT: depósito en la cuenta de B con facturas de C → 422 sin escribir', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const c = await servicioFacturado(e.C, '2026-10-01', { clienteId, instalacion: '2026-09-01' })
        const antes = await contarAsientos([e.B, e.C])
        const error = await errorDe(
            new RegistrarPago().execute(
                {
                    cliente_id: clienteId,
                    metodo: 'deposito',
                    monto: '150.00',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                    referencia: unico('BOL'),
                    facturas: [c.facturas[0]!.id],
                },
                e.ctx,
            ),
        )
        assert.equal(error.status, 422)
        assert.equal(error.codigo, 'cuenta_de_otra_empresa')
        assert.equal(await contarAsientos([e.B, e.C]), antes)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('7. periodo cerrado: 422 al registrar, el reverso va a hoy, y reabrir y volver a cerrar deja la misma foto', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B)
        // septiembre con movimiento histórico
        const factura = await new ImportarFacturaPendiente().execute(
            {
                origen: 'auditoria',
                id_externo: unico('f'),
                cliente_id: s.clienteId,
                empresa_id: e.B,
                cargo_unico: true,
                emitida_en: '2026-09-05',
                total: '300.00',
            },
            e.ctx,
        )
        const manual = await new RegistrarAsiento().execute(
            {
                empresa_id: e.B,
                fecha: '2026-09-20',
                descripcion: 'auditoría: gasto de septiembre',
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.GASTO_OTROS, debe: '45.67' },
                    { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '45.67' },
                ],
            },
            e.ctx,
        )
        const primero = await cerrarSeptiembreConApertura(e)
        const foto = normalizarResumen(primero.resumen)
        assert.equal(foto.asientos, 2)
        assert.equal(foto.debe, '345.67')

        const antes = await contarAsientos([e.B])
        const intentos = [
            () =>
                new RegistrarAsiento().execute(
                    {
                        empresa_id: e.B,
                        fecha: '2026-09-30',
                        descripcion: 'auditoría: en mes cerrado',
                        origen_tipo: 'ajuste',
                        movimientos: [
                            { cuenta: CUENTAS.GASTO_OTROS, debe: '1.00' },
                            { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '1.00' },
                        ],
                    },
                    e.ctx,
                ),
            () =>
                new RegistrarPagoHistorico().execute(
                    {
                        historico: true,
                        origen: 'auditoria',
                        id_externo: unico('p'),
                        cliente_id: s.clienteId,
                        metodo: 'deposito',
                        monto: '10.00',
                        fecha: '2026-09-10',
                        empresa_id: e.B,
                    },
                    e.ctx,
                ),
            () =>
                new ImportarFacturaPendiente().execute(
                    {
                        origen: 'auditoria',
                        id_externo: unico('f'),
                        cliente_id: s.clienteId,
                        empresa_id: e.B,
                        cargo_unico: true,
                        emitida_en: '2026-09-11',
                        total: '10.00',
                    },
                    e.ctx,
                ),
            () =>
                new RevertirAsiento().execute(
                    { asiento_id: manual.id, motivo: 'en el mes cerrado', fecha: '2026-09-30' },
                    e.ctx,
                ),
            () =>
                new RegistrarSaldoInicial().execute(
                    {
                        origen: 'auditoria',
                        id_externo: unico('s'),
                        cliente_id: s.clienteId,
                        monto: '10.00',
                        fecha: '2026-09-12',
                        empresa_id: e.B,
                    },
                    e.ctx,
                ),
        ]
        for (const intento of intentos) {
            const error = await errorDe(intento())
            assert.equal(error.status, 422, error.detalle)
            assert.equal(error.codigo, 'periodo_cerrado', error.detalle)
        }
        assert.equal(await contarAsientos([e.B]), antes)
        // el mismo mes en C sigue abierto
        await new RegistrarAsiento().execute(
            {
                empresa_id: e.C,
                fecha: '2026-09-30',
                descripcion: 'auditoría: C no está cerrada',
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.GASTO_OTROS, debe: '1.00' },
                    { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '1.00' },
                ],
            },
            e.ctx,
        )
        // el reverso de un asiento del mes cerrado va con fecha de hoy
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: manual.id, motivo: 'corrección' },
            e.ctx,
        )
        assert.notEqual(reverso.fecha.slice(0, 7), '2026-09')

        // reabrir y cerrar sin cambios: la misma foto
        await new ReabrirPeriodo().execute({ empresa_id: e.B, anio: 2026, mes: 9, motivo: 'revisión' }, e.ctx)
        const segundo = await cerrarSeptiembreConApertura(e)
        assert.deepEqual(normalizarResumen(segundo.resumen), foto)
        // reabrir, registrar y cerrar: la foto cambia exactamente en ese asiento
        await new ReabrirPeriodo().execute(
            { empresa_id: e.B, anio: 2026, mes: 9, motivo: 'faltó un pago' },
            e.ctx,
        )
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                origen: 'auditoria',
                id_externo: unico('p'),
                cliente_id: s.clienteId,
                metodo: 'deposito',
                monto: '100.00',
                fecha: '2026-09-15',
                facturas: [factura.factura_id!],
                empresa_id: e.B,
            },
            e.ctx,
        )
        const cierre = await cerrarSeptiembreConApertura(e)
        const tercero = normalizarResumen(cierre.resumen)
        assert.equal(tercero.asientos, foto.asientos + 1)
        assert.equal(tercero.debe, dec(foto.debe).plus('100.00').toFixed(2))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('8. importación modo B: saldoCliente − anticipos = saldo del origen y el libro cuadra; repetir no duplica', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { instalacion: '2026-05-01' })
        // origen: 4 facturas de 150, pagos de 150 + 200 (50 a la siguiente) y una de 150 sin pagar → saldo 250
        // y un cliente con saldo a favor en el origen (−35.50)
        const importar = async () => {
            const facturas: number[] = []
            for (const periodo of ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']) {
                const f = await new ImportarFacturaPendiente().execute(
                    {
                        origen: 'auditoria',
                        id_externo: `fact-${s.servicioId}-${periodo}`,
                        servicio_id: s.servicioId,
                        periodo,
                        emitida_en: periodo,
                        total: '150.00',
                        empresa_id: e.B,
                    },
                    e.ctx,
                )
                facturas.push(f.factura_id!)
            }
            await new RegistrarPagoHistorico().execute(
                {
                    historico: true,
                    origen: 'auditoria',
                    id_externo: `pago-${s.servicioId}-1`,
                    cliente_id: s.clienteId,
                    metodo: 'deposito',
                    monto: '150.00',
                    fecha: '2026-05-10',
                    facturas: [facturas[0]!],
                    empresa_id: e.B,
                },
                e.ctx,
            )
            await new RegistrarPagoHistorico().execute(
                {
                    historico: true,
                    origen: 'auditoria',
                    id_externo: `pago-${s.servicioId}-2`,
                    cliente_id: s.clienteId,
                    metodo: 'caja',
                    monto: '200.00',
                    fecha: '2026-06-10',
                    facturas: [facturas[1]!, facturas[2]!],
                    empresa_id: e.B,
                },
                e.ctx,
            )
        }
        await importar()
        const saldo = await saldoCliente(s.clienteId, undefined, e.B)
        const anticipos = await saldoAnticipos(db.connection(), s.clienteId, e.B)
        assert.equal(saldo.minus(anticipos).toFixed(2), '250.00')

        const aFavor = await crearClienteFila()
        await new RegistrarSaldoInicial().execute(
            {
                origen: 'auditoria',
                id_externo: `saldo-${aFavor}`,
                cliente_id: aFavor,
                monto: '-35.50',
                fecha: '2026-08-31',
                empresa_id: e.B,
            },
            e.ctx,
        )
        const saldoFavor = await saldoCliente(aFavor, undefined, e.B)
        const anticiposFavor = await saldoAnticipos(db.connection(), aFavor, e.B)
        assert.equal(saldoFavor.minus(anticiposFavor).toFixed(2), '-35.50')

        // la segunda corrida del importador no escribe nada
        const antes = await contarAsientos([e.B])
        await importar()
        assert.equal(await contarAsientos([e.B]), antes)
        // 2.9.01 = contrapartida de lo importado: facturas − pagos − saldo a favor
        assert.equal(
            await saldoCuenta(e.B, CUENTAS.SALDOS_APERTURA),
            dec('-600.00').plus('350.00').plus('35.50').toFixed(2),
        )
        await afirmarLibro(assert, e.B)
    })
})
