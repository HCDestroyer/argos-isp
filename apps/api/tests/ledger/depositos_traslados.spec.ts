import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import RegistrarPago from '#billing/actions/registrar_pago'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import DepositarCaja from '#ledger/actions/depositar_caja'
import TrasladarFondos from '#ledger/actions/trasladar_fondos'
import { resumenFondosEnTransito } from '#ledger/transitos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    codigoCaja,
    errorDe,
    lineas,
    saldoCuenta,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarLibroFase4 } from '#tests/ledger/verificar_bancos'

/**
 * Fase 4 (§10.3): depósitos de caja y traslados vía 1.1.11 Fondos en tránsito.
 */

const TRANSITO = CUENTAS_GT.FONDOS_EN_TRANSITO

test.group('Fase 4 · depósitos de caja y traslados (1.1.11)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('depósito: 1.1.11 / Caja, baja el esperado del turno, no supera el efectivo; el cierre cuadra', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cajaId = e.cajas.get(e.B)!
        const caja = await codigoCaja(cajaId)
        const banco = e.banco.get(e.B)!
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-09-01' })
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', caja_id: cajaId, empresa_id: e.B },
            e.ctx,
        )
        const deposito = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: '200.00', boleta: 'B-001', cuenta_bancaria_id: banco.id },
            e.ctx,
        )
        assert.equal(deposito.estado, 'en_transito')
        assert.equal(deposito.cuenta_codigo, banco.codigo)
        assert.deepEqual(await lineas('deposito', deposito.id), [
            [TRANSITO, '200.00', '0.00'],
            [caja, '0.00', '200.00'],
        ])
        assert.equal(await saldoCuenta(e.B, TRANSITO), '200.00')
        assert.equal(await saldoCuenta(e.B, banco.codigo), '0', 'el banco lo recibe al conciliar')
        const [resumen] = await resumenFondosEnTransito([e.B])
        assert.deepEqual(
            { pendiente: resumen!.pendiente, cuadra: resumen!.cuadra, depositos: resumen!.depositos },
            { pendiente: '200.00', cuadra: true, depositos: 1 },
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.depositada')
            .whereRaw(`(payload->>'deposito_id')::bigint = ?`, [deposito.id])
            .select('payload')
            .firstOrFail()
        assert.equal(evento.payload.monto, '200.00')
        assert.equal(evento.payload.cuenta_bancaria_id, banco.id)

        // efectivo del turno: 100 fondo + 150 cobro − 200 depositado = 50
        const excede = await errorDe(
            new DepositarCaja().execute(
                { caja_id: cajaId, monto: '50.01', boleta: 'B-002', cuenta_bancaria_id: banco.id },
                e.ctx,
            ),
        )
        assert.equal(excede.codigo, 'deposito_excede_efectivo')
        const repetida = await errorDe(
            new DepositarCaja().execute(
                { caja_id: cajaId, monto: '10.00', boleta: 'B-001', cuenta_bancaria_id: banco.id },
                e.ctx,
            ),
        )
        assert.equal(repetida.codigo, 'deposito_duplicado')
        const ajena = await errorDe(
            new DepositarCaja().execute(
                {
                    caja_id: cajaId,
                    monto: '10.00',
                    boleta: 'B-003',
                    cuenta_bancaria_id: e.banco.get(e.C)!.id,
                },
                e.ctx,
            ),
        )
        assert.include(ajena.reglas, 'cuenta_de_otra_empresa')

        const turno = await new CerrarCaja().execute({ caja_id: cajaId, contado: '50.00' }, e.ctx)
        assert.equal(turno.esperado, '50.00')
        assert.equal(turno.diferencia, '0.00')
        const sinTurno = await errorDe(
            new DepositarCaja().execute(
                { caja_id: cajaId, monto: '1.00', boleta: 'B-004', cuenta_bancaria_id: banco.id },
                e.ctx,
            ),
        )
        assert.equal(sinTurno.codigo, 'sin_turno_abierto')
        await afirmarLibroFase4(assert, [e.B, e.C])
    })

    test('traslado entre cuentas propias: 1.1.11 / Banco A; nunca entre empresas', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const a = e.banco.get(e.B)!
        const otra = await cuentaBancariaPrueba('Banrural', e.B)
        const traslado = await new TrasladarFondos().execute(
            {
                monto: '75.50',
                referencia: 'TR-1',
                origen: { cuenta_bancaria_id: a.id },
                destino: { cuenta_bancaria_id: otra.id },
            },
            e.ctx,
        )
        assert.equal(traslado.empresa_id, e.B)
        assert.equal(traslado.estado, 'en_transito')
        assert.deepEqual(await lineas('traslado', traslado.id), [
            [TRANSITO, '75.50', '0.00'],
            [a.codigo, '0.00', '75.50'],
        ])
        const dup = await errorDe(
            new TrasladarFondos().execute(
                {
                    monto: '1.00',
                    referencia: 'TR-1',
                    origen: { cuenta_bancaria_id: a.id },
                    destino: { cuenta_bancaria_id: otra.id },
                },
                e.ctx,
            ),
        )
        assert.equal(dup.codigo, 'traslado_duplicado')
        const cruzado = await errorDe(
            new TrasladarFondos().execute(
                {
                    monto: '1.00',
                    referencia: 'TR-2',
                    origen: { cuenta_bancaria_id: a.id },
                    destino: { cuenta_bancaria_id: e.banco.get(e.C)!.id },
                },
                e.ctx,
            ),
        )
        assert.include(cruzado.reglas, 'cuenta_de_otra_empresa')
        const misma = await errorDe(
            new TrasladarFondos().execute(
                {
                    monto: '1.00',
                    referencia: 'TR-3',
                    origen: { cuenta_id: a.cuenta_id },
                    destino: { cuenta_bancaria_id: a.id },
                },
                e.ctx,
            ),
        )
        assert.include(misma.reglas, 'distinta')
        const [resumen] = await resumenFondosEnTransito([e.B])
        assert.equal(resumen!.pendiente, '75.50')
        assert.isTrue(resumen!.cuadra)
        await afirmarLibroFase4(assert, [e.B, e.C])
    })
})
