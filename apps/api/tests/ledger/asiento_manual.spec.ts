import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, usuarioConRoles } from '#tests/ayudas'
import { eventosDe } from '#tests/billing/ayudas_billing'
import { leerAjustesCobro } from '#billing/ajustes_cobro'
import EditarAjustesCobro from '#billing/actions/editar_ajustes_cobro'

/**
 * Asiento manual de ajuste (decisión del PM 10): `POST /libro/asientos` directo (de fábrica) y con el
 * ajuste de aprobación por otro usuario (borrador, aprobar, rechazar, autoaprobación prohibida).
 */

const MOVIMIENTOS = [
    { cuenta: '5.2.99', debe: '125.50' },
    { cuenta: '1.1.01.01', haber: '125.50' },
]

async function fijarAprobacion(valor: boolean) {
    const actual = await leerAjustesCobro(1)
    if (actual.asientos_requieren_aprobacion === valor) return
    await new EditarAjustesCobro().execute(
        { empresa_id: 1, version: actual.version, asientos_requieren_aprobacion: valor },
        contextoPrueba(),
    )
}

async function cuadre(asientoId: number) {
    const fila = await db
        .from('ledger.movimientos')
        .where('asiento_id', asientoId)
        .select(db.raw('sum(debe)::text as debe'), db.raw('sum(haber)::text as haber'))
        .first()
    return [fila.debe, fila.haber]
}

test.group('ledger · asiento manual con aprobación (decisión 10)', (group) => {
    group.each.teardown(() => fijarAprobacion(false))

    test('de fábrica registra directo; valida cuadre y debe o haber', async ({ client, assert }) => {
        await fijarAprobacion(false)
        const { token } = await usuarioConRoles(['contabilidad'])
        const r = await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(token)
                .json({ descripcion: 'Ajuste de gasto de papelería', movimientos: MOVIMIENTOS }),
            201,
        )
        assert.equal(r.body().estado, 'registrado')
        assert.isNull(r.body().borrador)
        const asientoId = r.body().asiento_id
        const asiento = await db.from('ledger.asientos').where('id', asientoId).first()
        assert.equal(asiento.origen_tipo, 'ajuste')
        assert.deepEqual(await cuadre(asientoId), ['125.50', '125.50'])
        const eventos = await eventosDe('libro.asiento_manual_registrado', 'asiento_id', asientoId)
        assert.lengthOf(eventos, 1)
        assert.isNull(eventos[0].payload.borrador_id)

        const descuadre = await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(token)
                .json({
                    descripcion: 'Descuadrado',
                    movimientos: [
                        { cuenta: '5.2.99', debe: '10.00' },
                        { cuenta: '1.1.01.01', haber: '9.99' },
                    ],
                }),
            422,
        )
        assert.equal(descuadre.body().errors[0].rule, 'descuadre')
        const ambos = await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(token)
                .json({
                    descripcion: 'Doble',
                    movimientos: [
                        { cuenta: '5.2.99', debe: '10.00', haber: '10.00' },
                        { cuenta: '1.1.01.01', haber: '10.00' },
                    ],
                }),
            422,
        )
        assert.equal(ambos.body().errors[0].rule, 'debe_o_haber')
        // cajero sin el permiso
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(cajero)
                .json({ descripcion: 'Ajuste', movimientos: MOVIMIENTOS }),
            403,
        )
    })

    test('con aprobación: borrador sin libro, autoaprobación prohibida, otro aprueba; rechazo con motivo', async ({
        client,
        assert,
    }) => {
        await fijarAprobacion(true)
        const autor = await usuarioConRoles(['contabilidad'])
        const revisor = await usuarioConRoles(['contabilidad'])
        const asientosAntes = await db.from('ledger.asientos').count('* as n').first()

        const r = await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(autor.token)
                .json({ descripcion: 'Reclasificación de gasto', movimientos: MOVIMIENTOS }),
            201,
        )
        assert.equal(r.body().estado, 'pendiente_aprobacion')
        assert.isNull(r.body().asiento_id)
        const borrador = r.body().borrador
        assert.equal(borrador.estado, 'pendiente')
        assert.equal(borrador.total, '125.50')
        assert.equal(borrador.creado_por, autor.usuario.id)
        const asientosDespues = await db.from('ledger.asientos').count('* as n').first()
        assert.equal(Number(asientosDespues.n), Number(asientosAntes.n), 'el borrador no toca el libro')
        assert.lengthOf(await eventosDe('libro.asiento_pendiente', 'borrador_id', borrador.id), 1)

        // un borrador con una cuenta que no existe no nace
        await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(autor.token)
                .json({
                    descripcion: 'Cuenta inexistente',
                    movimientos: [
                        { cuenta: '9.9.99', debe: '1.00' },
                        { cuenta: '1.1.01.01', haber: '1.00' },
                    ],
                }),
            422,
        )

        const propio = await estado(
            client.post(`/api/v1/libro/borradores/${borrador.id}/aprobar`).bearerToken(autor.token),
            403,
        )
        assert.match(propio.body().type, /autoaprobacion$/)

        const pendientes = await estado(
            client.get('/api/v1/libro/borradores?estado=pendiente').bearerToken(revisor.token),
            200,
        )
        assert.include(
            pendientes.body().data.map((b: { id: number }) => b.id),
            borrador.id,
        )

        const aprobado = await estado(
            client.post(`/api/v1/libro/borradores/${borrador.id}/aprobar`).bearerToken(revisor.token),
            200,
        )
        assert.equal(aprobado.body().estado, 'aprobado')
        assert.equal(aprobado.body().decidido_por, revisor.usuario.id)
        const asientoId = aprobado.body().asiento_id
        assert.deepEqual(await cuadre(asientoId), ['125.50', '125.50'])
        const [evento] = await eventosDe('libro.asiento_manual_registrado', 'asiento_id', asientoId)
        assert.equal(evento.payload.borrador_id, borrador.id)
        assert.equal(evento.payload.aprobado_por, revisor.usuario.id)
        assert.equal(evento.payload.registrado_por, autor.usuario.id)

        const otraVez = await estado(
            client.post(`/api/v1/libro/borradores/${borrador.id}/aprobar`).bearerToken(revisor.token),
            409,
        )
        assert.match(otraVez.body().type, /borrador_decidido$/)

        // rechazo
        const otro = await estado(
            client
                .post('/api/v1/libro/asientos')
                .bearerToken(autor.token)
                .json({ descripcion: 'Ajuste dudoso', movimientos: MOVIMIENTOS }),
            201,
        )
        const rechazado = await estado(
            client
                .post(`/api/v1/libro/borradores/${otro.body().borrador.id}/rechazar`)
                .bearerToken(revisor.token)
                .json({ motivo: 'Falta el respaldo' }),
            200,
        )
        assert.equal(rechazado.body().estado, 'rechazado')
        assert.equal(rechazado.body().motivo_rechazo, 'Falta el respaldo')
        assert.isNull(rechazado.body().asiento_id)
        assert.lengthOf(await eventosDe('libro.asiento_rechazado', 'borrador_id', otro.body().borrador.id), 1)
        await assert.rejects(() =>
            db.from('billing.asientos_borradores').where('id', borrador.id).update({ descripcion: 'x' }),
        )
    })

    test('ajustes de cobro: lectura de fábrica, versión y evento', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const actual = await estado(client.get('/api/v1/ajustes-cobro').bearerToken(token), 200)
        const guardados = await leerAjustesCobro(1)
        assert.equal(actual.body().pausa_tope_dias, guardados.pausa_tope_dias)
        const conflicto = await estado(
            client
                .put('/api/v1/ajustes-cobro')
                .bearerToken(token)
                .json({ version: actual.body().version + 5, pausa_tope_dias: 60 }),
            409,
        )
        assert.match(conflicto.body().type, /conflicto_version$/)
        const nuevo = await estado(
            client
                .put('/api/v1/ajustes-cobro')
                .bearerToken(token)
                .json({ version: actual.body().version, pausa_tope_dias: 60 }),
            200,
        )
        assert.equal(nuevo.body().pausa_tope_dias, 60)
        assert.equal(nuevo.body().version, actual.body().version + 1)
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'ajustes_cobro.cambiados')
            .orderBy('id', 'desc')
            .first()
        assert.deepEqual(eventos.payload.campos, ['pausa_tope_dias'])
        await estado(
            client
                .put('/api/v1/ajustes-cobro')
                .bearerToken(token)
                .json({ version: nuevo.body().version, pausa_tope_dias: 90 }),
            200,
        )
        const { token: cajero } = await usuarioConRoles(['cajero'])
        await estado(client.put('/api/v1/ajustes-cobro').bearerToken(cajero).json({ version: 0 }), 403)
    })
})
