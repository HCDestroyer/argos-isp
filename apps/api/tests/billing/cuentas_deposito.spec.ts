import { test } from '@japa/runner'
import { contextoPrueba } from '#tests/ayudas'
import { listarCuentasBancarias, listarCuentasDeposito } from '#billing/cuentas_bancarias'
import CrearCuentaBancaria from '#billing/actions/crear_cuenta_bancaria'
import { bancoId, unicoBd } from '#tests/billing/ayudas_billing'

/** Consulta pública de cuentas para depósito (A5, `/corte`): activas, en quetzales, sin datos del libro. */
test.group('billing · cuentas para depósito', () => {
    test('solo activas en GTQ, con banco, alias, número completo y moneda', async ({ assert }) => {
        const crear = async (datos: { moneda?: 'GTQ' | 'USD'; activa?: boolean }) =>
            new CrearCuentaBancaria().execute(
                {
                    banco_id: await bancoId(),
                    numero: await unicoBd('3-123'),
                    alias: await unicoBd('Monetaria'),
                    ...datos,
                },
                contextoPrueba(),
            )
        const activa = await crear({})
        const inactiva = await crear({ activa: false })
        const dolares = await crear({ moneda: 'USD' })

        const cuentas = await listarCuentasDeposito()
        const ids = cuentas.map((c) => c.id)
        assert.include(ids, activa.id)
        assert.notInclude(ids, inactiva.id)
        assert.notInclude(ids, dolares.id)
        assert.deepEqual(
            cuentas.find((c) => c.id === activa.id),
            {
                id: activa.id,
                banco_nombre: 'Banrural',
                alias: activa.alias,
                numero: activa.numero,
                moneda: 'GTQ',
            },
        )
        // el listado completo sigue disponible para quien necesite también las USD
        const activas = await listarCuentasBancarias({ activa: true })
        const todas = activas.map((c) => c.id)
        assert.includeMembers(todas, [activa.id, dolares.id])
    })
})
