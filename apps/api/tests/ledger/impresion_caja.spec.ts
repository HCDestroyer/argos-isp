import { test } from '@japa/runner'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { eventosDe, unicoBd } from '#tests/billing/ayudas_billing'
import CrearCaja from '#ledger/actions/crear_caja'

/**
 * Impresión por caja (decisión del PM 20): recibo en 80 mm y factura en carta de fábrica; cada caja
 * recuerda lo que se elige (`PUT /cajas/:id/impresion`).
 */

test.group('ledger · impresión por caja (decisión 20)', () => {
    test('valores de fábrica, cambio con versión, evento y permiso', async ({ client, assert }) => {
        const caja = await new CrearCaja().execute(
            { nombre: await unicoBd('Caja impresión', 'ledger.cajas'), empresa_id: 1 },
            contextoPrueba(),
        )
        assert.equal(caja.formato_recibo, 'pos_80')
        assert.equal(caja.formato_factura, 'carta')

        const { token } = await usuarioConRoles(['contabilidad'])
        const r = await estado(
            client
                .put(`/api/v1/cajas/${caja.id}/impresion`)
                .bearerToken(token)
                .json({ version: caja.version, formato_recibo: 'carta' }),
            200,
        )
        assert.equal(r.body().formato_recibo, 'carta')
        assert.equal(r.body().formato_factura, 'carta')
        assert.equal(r.body().version, caja.version + 1)
        const [evento] = await eventosDe('caja.impresion_cambiada', 'caja_id', caja.id)
        assert.deepEqual(evento.payload.campos, ['formato_recibo'])

        const viejo = await estado(
            client
                .put(`/api/v1/cajas/${caja.id}/impresion`)
                .bearerToken(token)
                .json({ version: caja.version, formato_factura: 'pos_80' }),
            409,
        )
        assert.match(viejo.body().type, /conflicto_version$/)

        const lista = await estado(client.get('/api/v1/cajas').bearerToken(token), 200)
        const fila = lista.body().find((c: { id: number }) => c.id === caja.id)
        assert.equal(fila.formato_recibo, 'carta')

        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .put(`/api/v1/cajas/${caja.id}/impresion`)
                .bearerToken(cajero)
                .json({ version: r.body().version, formato_recibo: 'pos_80' }),
            403,
        )
    })
})
