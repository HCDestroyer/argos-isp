import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, cajeroDe, nuevaCaja } from '#tests/ledger/ayudas_libro'
import { cuentaBancariaPrueba, lineasAsiento } from '#tests/billing/ayudas_billing'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'

/**
 * Egresos: asiento Gasto / origen, anulación con reverso, efectivo del turno y permisos.
 */

test.group('ledger · egresos', () => {
    test('egreso por cuenta bancaria: asiento Gasto / subcuenta, anular revierte; 409 al repetir', async ({
        client,
        assert,
    }) => {
        const cuenta = await cuentaBancariaPrueba()
        const { token } = await usuarioConRoles(['contabilidad'])
        const proveedor = unico('EEGSA')
        const respuesta = await estado(
            client.post('/api/v1/egresos').bearerToken(token).header('Idempotency-Key', unico('e')).json({
                categoria: 'energia',
                monto: '1250.50',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: cuenta.id,
                proveedor,
                comprobante: 'FACT-A-998',
            }),
            201,
        )
        const egreso = respuesta.body()
        assert.equal(egreso.estado, 'registrado')
        assert.equal(egreso.categoria, 'energia')
        assert.equal(egreso.cuenta_codigo, '5.2.01')
        assert.equal(egreso.proveedor, proveedor)
        assert.isNotNull(egreso.asiento_id)
        assert.deepEqual(await lineasAsiento('egreso', egreso.id), [
            ['5.2.01', '1250.50', '0.00', null],
            [cuenta.cuenta_codigo, '0.00', '1250.50', null],
        ])
        await afirmarLibroCuadrado(assert)

        const lista = await estado(
            client
                .get('/api/v1/egresos')
                .qs({ categoria: 'energia', estado: 'registrado' })
                .bearerToken(token),
            200,
        )
        assert.isTrue(lista.body().data.some((e: { id: number }) => e.id === egreso.id))

        const anulado = await estado(
            client
                .post(`/api/v1/egresos/${egreso.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'registrado dos veces' }),
            200,
        )
        assert.equal(anulado.body().estado, 'anulado')
        assert.equal(anulado.body().motivo_anulacion, 'registrado dos veces')
        assert.isNotNull(anulado.body().asiento_reverso_id)
        const lineas = await lineasAsiento('egreso', egreso.id)
        assert.deepEqual(lineas.slice(2), [
            ['5.2.01', '0.00', '1250.50', null],
            [cuenta.cuenta_codigo, '1250.50', '0.00', null],
        ])
        await estado(
            client
                .post(`/api/v1/egresos/${egreso.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'otra vez' }),
            409,
        )
        const anulados = await estado(
            client.get('/api/v1/egresos').qs({ estado: 'anulado' }).bearerToken(token),
            200,
        )
        assert.isTrue(anulados.body().data.some((e: { id: number }) => e.id === egreso.id))
        await afirmarLibroCuadrado(assert)

        // el egreso es inmutable en base de datos
        await assert.rejects(() => db.from('ledger.egresos').where('id', egreso.id).update({ monto: '1.00' }))
    })

    test('egreso en efectivo baja el esperado del turno; anulado deja de restar', async ({ assert }) => {
        const cajaId = await nuevaCaja()
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: '500.00' }, contextoPrueba())
        const gasolina = await new RegistrarEgreso().execute(
            {
                categoria: 'vehiculos',
                monto: '200.00',
                metodo: 'caja',
                caja_id: cajaId,
                descripcion: 'Gasolina',
            },
            contextoPrueba(),
        )
        assert.isNotNull(gasolina.turno_id)
        const cafe = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '50.00', metodo: 'caja', caja_id: cajaId },
            contextoPrueba(),
        )
        await new AnularEgreso().execute({ egreso_id: cafe.id, motivo: 'error' }, contextoPrueba())
        const caja = await db
            .from('ledger.cajas as c')
            .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
            .where('c.id', cajaId)
            .select('cu.codigo')
            .firstOrFail()
        assert.deepEqual(await lineasAsiento('egreso', gasolina.id), [
            ['5.2.04', '200.00', '0.00', null],
            [caja.codigo, '0.00', '200.00', null],
        ])
        const turno = await new CerrarCaja().execute({ caja_id: cajaId, contado: '300.00' }, contextoPrueba())
        assert.equal(turno.esperado, '300.00')
        assert.equal(turno.diferencia, '0.00')
        await afirmarLibroCuadrado(assert)
    })

    test('validación por campo, banco principal por defecto, fecha futura y alcance de caja', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const invalido = await estado(
            client.post('/api/v1/egresos').bearerToken(token).json({
                categoria: 'nomina',
                monto: '100.00',
                metodo: 'banco',
                cuenta_bancaria_id: 1,
                fecha: '2999-01-01',
            }),
            422,
        )
        assert.sameMembers(
            invalido.body().errors.map((e: { field: string }) => e.field),
            ['cuenta_bancaria_id', 'fecha'],
        )

        const nomina = await estado(
            client
                .post('/api/v1/egresos')
                .bearerToken(token)
                .json({ categoria: 'nomina', monto: '3000.00', metodo: 'banco' }),
            201,
        )
        assert.equal(nomina.body().banco_nombre, 'Banco principal')
        assert.deepEqual(await lineasAsiento('egreso', nomina.body().id), [
            ['5.2.03', '3000.00', '0.00', null],
            ['1.1.02.01', '0.00', '3000.00', null],
        ])

        const categorias = await estado(client.get('/api/v1/egresos/categorias').bearerToken(token), 200)
        assert.sameMembers(
            categorias.body().map((c: { clave: string }) => c.clave),
            ['energia', 'transito', 'nomina', 'vehiculos', 'alquileres', 'otros'],
        )

        // cajero sin egresos.registrar → 403; tampoco ve la lista
        const cajaId = await nuevaCaja()
        const cajero = await cajeroDe(cajaId)
        await estado(
            client
                .post('/api/v1/egresos')
                .bearerToken(cajero.token)
                .json({ categoria: 'otros', monto: '1.00', metodo: 'caja', caja_id: cajaId }),
            403,
        )
        await estado(client.get('/api/v1/egresos').bearerToken(cajero.token), 403)
        await afirmarLibroCuadrado(assert)
    })
})
