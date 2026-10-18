import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import DepositarCaja from '#ledger/actions/depositar_caja'
import TrasladarFondos from '#ledger/actions/trasladar_fondos'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import CrearReglaConciliacion from '#ledger/actions/crear_regla_conciliacion'
import EditarReglaConciliacion from '#ledger/actions/editar_regla_conciliacion'
import AplicarReglasConciliacion from '#ledger/actions/aplicar_reglas_conciliacion'
import { lineasDeExtracto, movimientosSinConciliar, reporteConciliacion } from '#ledger/conciliacion'
import { resumenFondosEnTransito } from '#ledger/transitos'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { errorDe, lineas, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { fotoLibro, compararFotoLibro, marcasAuditoria } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroFase4 } from '#tests/ledger/verificar_bancos'

/**
 * Fase 4 (§10.3): extractos y conciliación bancaria de solo inserción. Conciliar liga líneas con lo
 * que ya está en el libro y nunca reescribe un asiento; lo que llega en tránsito o no tiene
 * documento entra con un asiento nuevo.
 */

test.group('Fase 4 · extractos y conciliación bancaria', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('ciclo completo: importar, reglas, depósito en tránsito, liquidación, partida sin documento, anular y reporte', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const hoy = hoyGuatemala()
        const banco = e.banco.get(e.B)!
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-07-01' })
        const boleta = unico('DEP')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'deposito',
                monto: '150.00',
                referencia: boleta,
                cuenta_bancaria_id: banco.id,
                empresa_id: e.B,
            },
            e.ctx,
        )
        const deposito = await new DepositarCaja().execute(
            { caja_id: e.cajas.get(e.B)!, monto: '100.00', boleta: 'C-1', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        const proveedor = await new CrearProveedorCobro().execute(
            {
                empresa_id: e.B,
                metodo: 'pasarela',
                pasarela: 'falsa',
                nombre: 'Falsa',
                cuenta_bancaria_id: banco.id,
            },
            e.ctx,
        )
        const pp = await new RegistrarPago().execute(
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
        const liq = await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedor.id,
                referencia: 'L-1',
                bruto: '100.00',
                comision: '3.50',
                pagos: [pp.id],
            },
            e.ctx,
        )
        const marcas = await marcasAuditoria()
        const antes = await fotoLibro([e.B], marcas.acciones, marcas.outbox)

        const entrada = {
            empresa_id: e.B,
            cuenta_bancaria_id: banco.id,
            desde: hoy,
            hasta: hoy,
            saldo_inicial: '0.00',
            saldo_final: '333.85',
            archivo: 'banrural.csv',
            lineas: [
                { fecha: hoy, descripcion: 'DEPOSITO EN AGENCIA', referencia: boleta, monto: '150.00' },
                { fecha: hoy, descripcion: 'DEPOSITO EFECTIVO', referencia: 'C-1', monto: '100.00' },
                { fecha: hoy, descripcion: 'CREDITO PASARELA FALSA L-1', referencia: 'L-1', monto: '96.50' },
                { fecha: hoy, descripcion: 'COMISION MANEJO DE CUENTA', monto: '-15.00' },
                { fecha: hoy, descripcion: 'INTERESES', monto: '2.35' },
            ],
        }
        const descuadrado = await errorDe(
            new ImportarExtracto().execute({ ...entrada, saldo_final: '300.00' }, e.ctx),
        )
        assert.equal(descuadrado.codigo, 'extracto_descuadrado')
        const extracto = await new ImportarExtracto().execute(entrada, e.ctx)
        assert.equal(extracto.lineas, 5)
        assert.equal(extracto.cuenta_codigo, banco.codigo)
        const duplicado = await errorDe(new ImportarExtracto().execute(entrada, e.ctx))
        assert.equal(duplicado.status, 409)
        assert.equal(duplicado.codigo, 'extracto_duplicado')
        const noEncadena = await errorDe(
            new ImportarExtracto().execute(
                {
                    ...entrada,
                    saldo_inicial: '0.00',
                    saldo_final: '1.00',
                    lineas: [{ fecha: hoy, descripcion: 'OTRO', monto: '1.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(noEncadena.codigo, 'extracto_no_encadena')

        // antes de conciliar: el extracto = libro ± partidas en tránsito
        let [reporte] = await reporteConciliacion([e.B], { cuenta_id: banco.cuenta_id })
        assert.equal(reporte!.saldo_libro, '246.50')
        assert.equal(reporte!.saldo_extracto, '333.85')
        assert.equal(reporte!.total_libro_en_transito, '246.50')
        assert.equal(reporte!.total_extracto_en_transito, '333.85')
        assert.isTrue(reporte!.cuadra)

        // reglas: la referencia del depósito del cliente y la comisión del banco
        await new CrearReglaConciliacion().execute(
            {
                empresa_id: e.B,
                nombre: 'Depósitos',
                tipo_condicion: 'regex',
                patron: '^DEPOSITO EN',
                accion: 'cliente',
            },
            e.ctx,
        )
        const comision = await new CrearReglaConciliacion().execute(
            {
                empresa_id: e.B,
                nombre: 'Comisiones',
                tipo_condicion: 'contiene',
                patron: 'comision',
                monto_max: '0.00',
                accion: 'contrapartida',
                contrapartida: '5.2.99',
            },
            e.ctx,
        )
        const editada = await new EditarReglaConciliacion().execute(
            {
                ...comision,
                id: comision.id,
                version: comision.version,
                contrapartida: CUENTAS_GT.GASTOS_BANCARIOS,
            },
            e.ctx,
        )
        assert.equal(editada.contrapartida, CUENTAS_GT.GASTOS_BANCARIOS)
        assert.exists(
            await db
                .from('audit.cambios')
                .where({
                    entidad_tipo: 'regla_conciliacion',
                    entidad_id: comision.id,
                    campo: 'contrapartida_cuenta_id',
                })
                .first(),
        )
        const malaRegla = await errorDe(
            new CrearReglaConciliacion().execute(
                {
                    empresa_id: e.B,
                    nombre: 'Mala',
                    tipo_condicion: 'contiene',
                    patron: 'x',
                    accion: 'contrapartida',
                    contrapartida: '1.1.03',
                },
                e.ctx,
            ),
        )
        assert.include(malaRegla.reglas, 'contrapartida')
        const aplicado = await new AplicarReglasConciliacion().execute({ extracto_id: extracto.id }, e.ctx)
        assert.lengthOf(aplicado.conciliadas, 2)
        assert.sameMembers(
            aplicado.conciliadas.map((c) => c.accion),
            ['cliente', 'contrapartida'],
        )
        const filas = await lineasDeExtracto(extracto.id)
        const [lDep, lCaja, lLiq, lCom, lInt] = filas
        assert.isTrue(lDep!.conciliada)
        assert.equal(lDep!.movimientos[0]!.origen_tipo, 'pago')
        assert.equal(lDep!.movimientos[0]!.origen_id, pago.id)
        assert.deepEqual(await lineas('banco', lCom!.id), [
            [CUENTAS_GT.GASTOS_BANCARIOS, '15.00', '0.00'],
            [banco.codigo, '0.00', '15.00'],
        ])

        // depósito en tránsito: llega con un asiento nuevo Banco / 1.1.11
        const descuadre = await errorDe(
            new ConciliarLinea().execute(
                { linea_id: lCaja!.id, depositos: [deposito.id], movimientos: [lLiq!.id] },
                e.ctx,
            ),
        )
        assert.equal(descuadre.status, 422)
        const llegada = await new ConciliarLinea().execute(
            { linea_id: lCaja!.id, depositos: [deposito.id] },
            e.ctx,
        )
        assert.equal(llegada.monto, '100.00')
        assert.equal(llegada.movimientos[0]!.origen_tipo, 'deposito')
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '0.00')
        const [transito] = await resumenFondosEnTransito([e.B])
        assert.isTrue(transito!.cuadra)
        const lineasDeposito = await lineas('deposito', deposito.id)
        assert.deepEqual(lineasDeposito.slice(2), [
            [banco.codigo, '100.00', '0.00'],
            [CUENTAS_GT.FONDOS_EN_TRANSITO, '0.00', '100.00'],
        ])

        // la liquidación ya está en el libro: se liga su movimiento del banco
        const pendientes = await movimientosSinConciliar(e.B, banco.cuenta_id)
        const movLiq = pendientes.find(
            (m) => m.origen_tipo === 'liquidacion_cobro' && m.origen_id === liq.id,
        )!
        assert.equal(movLiq.monto, '96.50')
        const repetida = await errorDe(
            new ConciliarLinea().execute({ linea_id: lDep!.id, movimientos: [movLiq.movimiento_id] }, e.ctx),
        )
        assert.equal(repetida.codigo, 'linea_conciliada')
        await new ConciliarLinea().execute({ linea_id: lLiq!.id, movimientos: [movLiq.movimiento_id] }, e.ctx)
        const otraVez = await errorDe(
            new ConciliarLinea().execute({ linea_id: lInt!.id, movimientos: [movLiq.movimiento_id] }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'movimiento_conciliado')

        // abono sin documento: la contrapartida es obligatoria
        const sinCuenta = await errorDe(new RegistrarDesdeExtracto().execute({ linea_id: lInt!.id }, e.ctx))
        assert.include(sinCuenta.reglas, 'required')
        await new RegistrarDesdeExtracto().execute({ linea_id: lInt!.id, cuenta: '4.1.03' }, e.ctx)
        const dos = await errorDe(
            new RegistrarDesdeExtracto().execute({ linea_id: lInt!.id, cuenta: '4.1.03' }, e.ctx),
        )
        assert.equal(dos.codigo, 'linea_registrada')

        // deshacer no toca el libro y deja volver a conciliar
        const anulada = await new AnularConciliacion().execute(
            { conciliacion_id: llegada.id, motivo: 'línea equivocada' },
            e.ctx,
        )
        assert.isTrue(anulada.anulada)
        const anularDos = await errorDe(
            new AnularConciliacion().execute({ conciliacion_id: llegada.id, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(anularDos.codigo, 'conciliacion_anulada')
        await new ConciliarLinea().execute(
            { linea_id: lCaja!.id, movimientos: [llegada.movimientos[0]!.movimiento_id] },
            e.ctx,
        )

        ;[reporte] = await reporteConciliacion([e.B], { cuenta_id: banco.cuenta_id })
        assert.equal(reporte!.saldo_libro, '333.85')
        assert.equal(reporte!.saldo_extracto, '333.85')
        assert.lengthOf(reporte!.libro_en_transito, 0)
        assert.lengthOf(reporte!.extracto_en_transito, 0)
        assert.isTrue(reporte!.cuadra)

        // nada de lo que ya estaba en el libro cambió: conciliar solo agrega filas
        const despues = await fotoLibro([e.B], marcas.acciones, marcas.outbox)
        assert.deepEqual(compararFotoLibro(antes, despues), [])
        await afirmarLibroFase4(assert, [e.B, e.C])
        const eventos = await db
            .from('audit.outbox')
            .whereIn('evento', ['banco.extracto_importado', 'banco.conciliado'])
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [e.B])
            .count('* as n')
        assert.equal(Number(eventos[0]!.n), 1 + 6)
    })

    test('traslado: llega a la cuenta de destino al conciliar su extracto; una conciliación nunca cruza cuentas', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const hoy = hoyGuatemala()
        const a = e.banco.get(e.B)!
        const destino = await cuentaBancariaPrueba('Banrural', e.B)
        const traslado = await new TrasladarFondos().execute(
            {
                monto: '50.00',
                referencia: 'TR-9',
                origen: { cuenta_bancaria_id: a.id },
                destino: { cuenta_bancaria_id: destino.id },
            },
            e.ctx,
        )
        const extracto = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: destino.id,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: '0.00',
                saldo_final: '50.00',
                lineas: [
                    { fecha: hoy, descripcion: 'TRANSFERENCIA RECIBIDA', referencia: 'TR-9', monto: '50.00' },
                ],
            },
            e.ctx,
        )
        assert.equal(extracto.empresa_id, e.B)
        const [linea] = await lineasDeExtracto(extracto.id)
        // el movimiento de salida está en la cuenta A, no en la del extracto
        const [salida] = await movimientosSinConciliar(e.B, a.cuenta_id)
        const cruzada = await errorDe(
            new ConciliarLinea().execute(
                { linea_id: linea!.id, movimientos: [salida!.movimiento_id] },
                e.ctx,
            ),
        )
        assert.include(cruzada.reglas, 'otra_cuenta')
        await new ConciliarLinea().execute({ linea_id: linea!.id, traslados: [traslado.id] }, e.ctx)
        assert.equal(await saldoCuenta(e.B, CUENTAS_GT.FONDOS_EN_TRANSITO), '0.00')
        assert.equal(await saldoCuenta(e.B, destino.cuenta_codigo), '50.00')
        assert.equal(await saldoCuenta(e.B, a.codigo), '-50.00')
        const [reporte] = await reporteConciliacion([e.B], { cuenta_id: destino.cuenta_id })
        assert.isTrue(reporte!.cuadra)
        await afirmarLibroFase4(assert, [e.B, e.C])
    })
})
