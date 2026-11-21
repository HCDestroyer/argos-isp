import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, cajeroDe, nuevaCaja } from '#tests/ledger/ayudas_libro'
import { cuentaBancariaPrueba, escenario, generar, lineasAsiento } from '#tests/billing/ayudas_billing'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'

/**
 * Rediseño del panel (`a4.md`, 21 nov): resumen del turno de caja para el menú de la barra superior
 * y cierre con denominaciones, fondo para el turno siguiente y a quién se entrega el resto.
 */

test.group('ledger · resumen del turno y cierre con denominaciones', () => {
    test('el resumen da fondo, cobros por método, retiros, ingresos y el esperado del cierre', async ({
        client,
        assert,
    }) => {
        const cajaId = await nuevaCaja()
        const { token, usuario } = await cajeroDe(cajaId)

        // sin turno: 404 sin_turno_abierto (por caja y sin caja)
        const sin = await estado(client.get('/api/v1/cajas/turno-actual/resumen').bearerToken(token), 404)
        assert.match(sin.body().type, /sin_turno_abierto$/)
        await estado(
            client.get(`/api/v1/cajas/turno-actual/resumen?caja_id=${cajaId}`).bearerToken(token),
            404,
        )
        // otra caja: fuera de su alcance
        const otra = await nuevaCaja()
        await estado(client.get(`/api/v1/cajas/turno-actual/resumen?caja_id=${otra}`).bearerToken(token), 403)

        const abierto = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/abrir`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('abrir'))
                .json({ fondo_inicial: '500.00' }),
            201,
        )
        const { clienteId, servicioId } = await escenario()
        await generar(servicioId, '2026-09-01')
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '200.00' }),
            201,
        )
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '50.00' }),
            201,
        )
        const cuenta = await cuentaBancariaPrueba()
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: clienteId,
                    metodo: 'deposito',
                    monto: '30.00',
                    referencia: unico('dep'),
                    cuenta_bancaria_id: cuenta.id,
                }),
            201,
        )
        await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '75.50', metodo: 'caja', caja_id: cajaId, descripcion: 'Agua' },
            contextoPrueba(usuario.id),
        )

        const resumen = await estado(client.get('/api/v1/cajas/turno-actual/resumen').bearerToken(token), 200)
        assert.containSubset(resumen.body(), {
            caja_id: cajaId,
            turno_id: abierto.body().id,
            abierto_por: usuario.id,
            fondo_inicial: '500.00',
            cerrado_en: null,
            efectivo_cobrado: { cantidad: 2, monto: '250.00' },
            otros_medios: { cantidad: 1, monto: '30.00' },
            cobros: {
                cantidad: 3,
                monto: '280.00',
                por_metodo: [
                    { metodo: 'caja', cantidad: 2, monto: '250.00' },
                    { metodo: 'deposito', cantidad: 1, monto: '30.00' },
                ],
            },
            ingresos: { cantidad: 2, monto: '250.00' },
            retiros: {
                cantidad: 1,
                monto: '75.50',
                egresos: { cantidad: 1, monto: '75.50' },
                depositos: { cantidad: 0, monto: '0.00' },
                pagos_proveedores: { cantidad: 0, monto: '0.00' },
            },
            esperado: '674.50',
        })
        // lo mismo por caja_id
        const porCaja = await estado(
            client.get(`/api/v1/cajas/turno-actual/resumen?caja_id=${cajaId}`).bearerToken(token),
            200,
        )
        assert.equal(porCaja.body().esperado, '674.50')

        // cierre por denominaciones: 3×200 + 1×50 + 2×10 + 4×0.25 = 671.00 → faltante 3.50
        const supervisor = await usuarioConRoles(['admin'])
        const denominaciones = [
            { valor: '200', cantidad: 3 },
            { valor: '0.25', cantidad: 4 },
            { valor: '50', cantidad: 1 },
            { valor: '10', cantidad: 2 },
        ]
        // sin motivo: 422 motivo
        const sinMotivo = await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({ denominaciones }),
            422,
        )
        assert.equal(sinMotivo.body().errors[0].field, 'motivo')
        // contado que no es la suma
        const distinto = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .json({ denominaciones, contado: '670.00', motivo: 'faltante' }),
            422,
        )
        assert.equal(distinto.body().errors[0].rule, 'denominaciones')
        // fondo sin a quién entregar el resto
        const sinEntrega = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .json({ denominaciones, motivo: 'faltante de vuelto', fondo_siguiente: '500.00' }),
            422,
        )
        assert.equal(sinEntrega.body().errors[0].field, 'entregado_a')
        // fondo mayor que el contado
        await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .json({ denominaciones, motivo: 'faltante', fondo_siguiente: '700.00' }),
            422,
        )

        const cerrado = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('cerrar'))
                .json({
                    denominaciones,
                    motivo: 'vuelto mal entregado',
                    fondo_siguiente: '500.00',
                    entregado_a: supervisor.usuario.id,
                }),
            200,
        )
        assert.containSubset(cerrado.body(), {
            esperado: '674.50',
            contado: '671.00',
            diferencia: '-3.50',
            fondo_siguiente: '500.00',
            entregado_a: supervisor.usuario.id,
            entregado_monto: '171.00',
            denominaciones: [
                { valor: '200', cantidad: 3 },
                { valor: '50', cantidad: 1 },
                { valor: '10', cantidad: 2 },
                { valor: '0.25', cantidad: 4 },
            ],
        })
        assert.equal(cerrado.body().entregado_a_nombre, supervisor.usuario.nombre)
        // faltante con su asiento
        const caja = await db
            .from('ledger.cajas as c')
            .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
            .where('c.id', cajaId)
            .select('cu.codigo')
            .firstOrFail()
        const lineas = await lineasAsiento('cierre_caja', cerrado.body().id)
        assert.deepEqual(
            lineas.map(([codigo, debe, haber]) => [codigo, debe, haber]),
            [
                [lineas[0]![0], '3.50', '0.00'],
                [caja.codigo, '0.00', '3.50'],
            ],
        )
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.cerrada')
            .whereRaw(`(payload->>'caja_id')::bigint = ?`, [cajaId])
            .firstOrFail()
        assert.containSubset(evento.payload, { esperado: '674.50', contado: '671.00', diferencia: '-3.50' })
        // cerrado: ya no hay turno actual
        await estado(client.get('/api/v1/cajas/turno-actual/resumen').bearerToken(token), 404)
        await afirmarLibroCuadrado(assert)
    })

    test('cierre sin diferencia con solo el contado sigue igual que antes', async ({ client, assert }) => {
        const cajaId = await nuevaCaja()
        const { token } = await cajeroDe(cajaId)
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '100.00' }),
            201,
        )
        const cerrado = await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({ contado: '100.00' }),
            200,
        )
        assert.containSubset(cerrado.body(), {
            diferencia: '0.00',
            denominaciones: null,
            fondo_siguiente: null,
            entregado_a: null,
            entregado_monto: null,
        })
        // sin contado ni denominaciones: 422
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '0.00' }),
            201,
        )
        const vacio = await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({}),
            422,
        )
        assert.equal(vacio.body().errors[0].field, 'contado')
    })
})
