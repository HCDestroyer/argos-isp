import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * Cierre mensual: nada con fecha en un mes cerrado (ni reversos), en la acción y en la base;
 * reapertura con su permiso, motivo y auditoría; volver a cerrar.
 */

function ajuste(fecha: string, monto = '10.00') {
    return new RegistrarAsiento().execute(
        {
            fecha,
            descripcion: 'Ajuste de prueba',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: '5.2.99', debe: monto },
                { cuenta: '1.1.02.01', haber: monto },
            ],
        },
        contextoPrueba(),
    )
}

test.group('ledger · cierre mensual', () => {
    test('cerrar mayo 2019: ningún asiento ni reverso con fecha en el mes; el reverso va a hoy', async ({
        client,
        assert,
    }) => {
        const primero = await ajuste('2019-05-10', '25.00')
        const segundo = await ajuste('2019-05-12', '5.00')
        const { token } = await usuarioConRoles(['contabilidad'])

        const cierre = await estado(
            client.post('/api/v1/libro/periodos/cerrar').bearerToken(token).json({ anio: 2019, mes: 5 }),
            201,
        )
        assert.equal(cierre.body().periodo, '2019-05')
        assert.equal(cierre.body().estado, 'cerrado')
        assert.equal(cierre.body().resumen.asientos, 2)
        assert.equal(cierre.body().resumen.debe, cierre.body().resumen.haber)
        assert.deepEqual(
            cierre.body().resumen.cuentas.map((c: { codigo: string; debe: string }) => [c.codigo, c.debe]),
            [
                ['1.1.02.01', '0.00'],
                ['5.2.99', '30.00'],
            ],
        )

        const repetido = await estado(
            client.post('/api/v1/libro/periodos/cerrar').bearerToken(token).json({ anio: 2019, mes: 5 }),
            409,
        )
        assert.equal(repetido.body().type, 'urn:argosisp:problema:periodo_cerrado')

        // en la acción
        await assert.rejects(() => ajuste('2019-05-20'), /Periodo 2019-05 cerrado/)
        await assert.rejects(
            () =>
                new RevertirAsiento().execute(
                    { asiento_id: segundo.id, motivo: 'con fecha del mes cerrado', fecha: '2019-05-31' },
                    contextoPrueba(),
                ),
            /Periodo 2019-05 cerrado/,
        )
        // el reverso sin fecha va al periodo abierto (hoy)
        const reverso = await new RevertirAsiento().execute(
            { asiento_id: primero.id, motivo: 'corrección' },
            contextoPrueba(),
        )
        assert.equal(reverso.fecha, hoyGuatemala())

        // en la base de datos, aunque se salte la acción
        await assert.rejects(
            () =>
                db.table('ledger.asientos').insert({
                    fecha: '2019-05-15',
                    descripcion: 'directo',
                    origen_tipo: 'ajuste',
                }),
            /cerrado/,
        )
        await assert.rejects(
            () => db.table('ledger.cierres_mensuales').insert({ periodo: '2019-05-01' }),
            /ya está cerrado/,
        )
        await assert.rejects(
            () => db.from('ledger.cierres_mensuales').where('id', cierre.body().id).delete(),
            /inmutable|no se permite|rechaz/i,
        )
        await afirmarLibroCuadrado(assert)
    })

    test('mes en curso o futuro no se cierra; reabrir exige permiso y motivo, queda auditado', async ({
        client,
        assert,
    }) => {
        const hoy = hoyGuatemala()
        await assert.rejects(
            () =>
                new CerrarPeriodo().execute(
                    { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) },
                    contextoPrueba(),
                ),
            /no ha terminado/,
        )
        await ajuste('2019-07-03')
        await new CerrarPeriodo().execute({ anio: 2019, mes: 7 }, contextoPrueba())

        const { token: contador } = await usuarioConRoles(['contabilidad'])
        await estado(
            client
                .post('/api/v1/libro/periodos/reabrir')
                .bearerToken(contador)
                .json({ anio: 2019, mes: 7, motivo: 'factura omitida' }),
            403,
        )
        const { token: admin, usuario } = await usuarioConRoles(['admin'])
        await estado(
            client.post('/api/v1/libro/periodos/reabrir').bearerToken(admin).json({ anio: 2019, mes: 7 }),
            422,
        )
        const reabierto = await estado(
            client
                .post('/api/v1/libro/periodos/reabrir')
                .bearerToken(admin)
                .json({ anio: 2019, mes: 7, motivo: 'factura omitida del proveedor' }),
            200,
        )
        assert.equal(reabierto.body().estado, 'reabierto')
        assert.equal(reabierto.body().motivo_reapertura, 'factura omitida del proveedor')
        assert.equal(reabierto.body().reabierto_por, usuario.id)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'libro.reabrir_periodo')
            .where('entidad_id', reabierto.body().id)
            .firstOrFail()
        assert.equal(auditoria.resultado, 'ok')
        assert.equal(auditoria.entrada.motivo, 'factura omitida del proveedor')

        // reabierto: se registra el asiento omitido y se vuelve a cerrar (cierre nuevo)
        await ajuste('2019-07-28')
        await estado(
            client
                .post('/api/v1/libro/periodos/reabrir')
                .bearerToken(admin)
                .json({ anio: 2019, mes: 7, motivo: 'otra vez' }),
            409,
        )
        const nuevo = await estado(
            client.post('/api/v1/libro/periodos/cerrar').bearerToken(contador).json({ anio: 2019, mes: 7 }),
            201,
        )
        assert.notEqual(nuevo.body().id, reabierto.body().id)
        assert.equal(nuevo.body().resumen.asientos, 2)
        await assert.rejects(() => ajuste('2019-07-29'), /cerrado/)

        const lista = await estado(client.get('/api/v1/libro/periodos').bearerToken(contador), 200)
        const julio = lista.body().data.filter((c: { periodo: string }) => c.periodo === '2019-07')
        assert.deepEqual(
            julio.map((c: { estado: string }) => c.estado),
            ['cerrado', 'reabierto'],
        )
        await afirmarLibroCuadrado(assert)
    })
})
