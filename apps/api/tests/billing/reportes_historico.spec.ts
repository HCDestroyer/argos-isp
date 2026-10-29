import { test } from '@japa/runner'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { hoyGuatemala } from '#ledger/fechas'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import RegistrarPago from '#billing/actions/registrar_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { escenario, facturasDe, generar, unicoBd } from '#tests/billing/ayudas_billing'

/**
 * Reportes con histórico (decisión del PM, semana 3): los pagos históricos importados cuentan en
 * su mes de origen en «Ingresos» y «Facturado vs cobrado», y se separan con `origen`
 * (`sistema`/`importado`) o con las columnas `*_importado`. Las notas de crédito no son cobro.
 */

interface FilaIngresos {
    periodo: string
    metodo: string
    pagos: number
    monto: string
    pagos_importados: number
    monto_importado: string
}

interface FilaFacturado {
    periodo: string
    facturas: number
    facturado: string
    cobrado: string
    pendiente: string
    acreditado: string
    facturado_importado: string
    cobrado_importado: string
}

test.group('billing · reportes con histórico', () => {
    test('ingresos y facturado vs cobrado incluyen lo importado en su mes y lo separan por origen', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await escenario({ fecha_instalacion: '2026-09-01' })
        const importada = await new ImportarFacturaPendiente().execute(
            {
                clave_externa: await unicoBd('origen-fact'),
                servicio_id: servicioId,
                periodo: '2025-02-01',
                total: '150.00',
                hoy: '2026-10-16',
            },
            contextoPrueba(),
        )
        await new RegistrarPagoHistorico().execute(
            {
                historico: true,
                id_externo: await unicoBd('origen-pago'),
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '150.00',
                fecha: '2025-02-10',
                facturas: [importada.factura_id!],
            },
            contextoPrueba(),
        )
        await generar(servicioId, '2026-10-01')
        await new RegistrarPago().execute(
            { cliente_id: clienteId, metodo: 'caja', monto: '150.00' },
            contextoPrueba(),
        )
        const facturas = await facturasDe(servicioId)
        const octubre = facturas.find((f) => f.periodo === '2026-10-01')!
        await new EmitirNotaCredito().execute(
            { factura_id: octubre.id, monto: '50.00', motivo: 'descuento' },
            contextoPrueba(),
        )

        const { token } = await usuarioConRoles(['contabilidad'])
        const hoy = hoyGuatemala()
        const mesHoy = hoy.slice(0, 7)
        const leer = async (ruta: string, qs: Record<string, unknown> = {}) => {
            const respuesta = await estado(
                client
                    .get(`/api/v1/reportes/${ruta}`)
                    .qs({ cliente_id: clienteId, desde: '2025-01-01', hasta: hoy, ...qs })
                    .bearerToken(token),
                200,
            )
            return respuesta.body()
        }

        // ingresos: el pago histórico en febrero de 2025, el de caja en el mes actual
        const ingresos = await leer('ingresos')
        assert.deepEqual(
            ingresos.filas.map((f: FilaIngresos) => [
                f.periodo,
                f.metodo,
                f.pagos,
                f.monto,
                f.pagos_importados,
                f.monto_importado,
            ]),
            [
                ['2025-02', 'deposito', 1, '150.00', 1, '150.00'],
                [mesHoy, 'caja', 1, '150.00', 0, '0.00'],
            ],
        )
        assert.equal(ingresos.totales.monto, '300.00')
        assert.equal(ingresos.totales.monto_importado, '150.00')
        assert.deepEqual(
            ingresos.columnas.find((c: { clave: string }) => c.clave === 'monto_importado'),
            { clave: 'monto_importado', titulo: 'Monto importado', tipo: 'dinero' },
        )
        const soloImportado = await leer('ingresos', { origen: 'importado' })
        assert.deepEqual(
            soloImportado.filas.map((f: FilaIngresos) => f.periodo),
            ['2025-02'],
        )
        const soloSistema = await leer('ingresos', { origen: 'sistema' })
        assert.deepEqual(
            soloSistema.filas.map((f: FilaIngresos) => [f.periodo, f.monto]),
            [[mesHoy, '150.00']],
        )

        // facturado vs cobrado: la factura importada cobrada en su periodo; la nota no es cobro
        const facturado = await leer('facturado-vs-cobrado')
        assert.deepEqual(
            facturado.filas.map((f: FilaFacturado) => [
                f.periodo,
                f.facturado,
                f.cobrado,
                f.acreditado,
                f.pendiente,
                f.facturado_importado,
                f.cobrado_importado,
            ]),
            [
                ['2025-02', '150.00', '150.00', '0.00', '0.00', '150.00', '150.00'],
                ['2026-09', '150.00', '150.00', '0.00', '0.00', '0.00', '0.00'],
                ['2026-10', '150.00', '0.00', '50.00', '100.00', '0.00', '0.00'],
            ],
        )
        assert.equal(facturado.totales.cobrado, '300.00')
        assert.equal(facturado.totales.acreditado, '50.00')
        const facturadoImportado = await leer('facturado-vs-cobrado', { origen: 'importado' })
        assert.deepEqual(
            facturadoImportado.filas.map((f: FilaFacturado) => f.periodo),
            ['2025-02'],
        )
        const facturadoSistema = await leer('facturado-vs-cobrado', { origen: 'sistema' })
        assert.deepEqual(
            facturadoSistema.filas.map((f: FilaFacturado) => f.periodo),
            ['2026-09', '2026-10'],
        )
        await estado(
            client.get('/api/v1/reportes/ingresos').qs({ origen: 'mikrowisp' }).bearerToken(token),
            422,
        )
    })
})
