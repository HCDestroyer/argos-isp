import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, cajeroDe, nuevaCaja } from '#tests/ledger/ayudas_libro'
import { escenario, generar, lineasAsiento, unicoBd } from '#tests/billing/ayudas_billing'
import AbrirCaja from '#ledger/actions/abrir_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import Usuario from '#core/models/usuario'

/**
 * Tarea 9: cajas y turnos. Cada prueba crea su propia caja (con su cuenta hija de 1.1.01) y un
 * cajero con el rol `cajero` acotado a esa caja (alcance ACL).
 */

test.group('ledger · cajas y turnos', () => {
    test('el cajero solo ve y opera su caja; cobra en efectivo sin caja_id en su turno', async ({
        client,
        assert,
    }) => {
        const cajaId = await nuevaCaja()
        const otraCaja = await nuevaCaja()
        const { token, usuario } = await cajeroDe(cajaId)

        const cajas = await estado(client.get('/api/v1/cajas').bearerToken(token), 200)
        assert.deepEqual(
            cajas.body().map((c: { id: number }) => c.id),
            [cajaId],
        )
        assert.containSubset(cajas.body()[0], { id: cajaId, activa: true, turno_abierto_id: null })

        await estado(
            client.post(`/api/v1/cajas/${otraCaja}/abrir`).bearerToken(token).json({ fondo_inicial: '0' }),
            403,
        )
        await estado(client.get(`/api/v1/cajas/${otraCaja}/turnos`).bearerToken(token), 403)
        await estado(
            client.post('/api/v1/cajas/999999/abrir').bearerToken(token).json({ fondo_inicial: '0' }),
            404,
        )

        const abierto = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/abrir`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('abrir'))
                .json({ fondo_inicial: '200.00' }),
            201,
        )
        assert.containSubset(abierto.body(), {
            caja_id: cajaId,
            fondo_inicial: '200.00',
            cerrado_en: null,
            esperado: null,
            abierto_por: usuario.id,
        })
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '0' }),
            409,
        )
        const conTurno = await estado(client.get('/api/v1/cajas').bearerToken(token), 200)
        assert.equal(conTurno.body()[0].turno_abierto_id, abierto.body().id)

        // cobro en efectivo sin caja_id → su caja y su turno
        const { clienteId, servicioId } = await escenario()
        await generar(servicioId, '2026-09-01')
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '150.00' }),
            201,
        )
        assert.equal(pago.body().caja_id, cajaId)
        const fila = await db.from('billing.pagos').where('id', pago.body().id).firstOrFail()
        assert.equal(fila.turno_id, abierto.body().id)
        // y no puede cobrar en otra caja
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '10.00', caja_id: otraCaja }),
            403,
        )

        // cierre exacto: sin asiento, evento caja.cerrada
        const cerrado = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .header('Idempotency-Key', unico('cerrar'))
                .json({ contado: '350.00' }),
            200,
        )
        assert.containSubset(cerrado.body(), {
            esperado: '350.00',
            contado: '350.00',
            diferencia: '0.00',
            motivo: null,
            cerrado_por: usuario.id,
        })
        assert.isNotNull(cerrado.body().cerrado_en)
        assert.lengthOf(await lineasAsiento('cierre_caja', cerrado.body().id), 0)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'caja.cerrada')
            .whereRaw(`(payload->>'caja_id')::bigint = ?`, [cajaId])
            .firstOrFail()
        assert.deepEqual(evento.payload, {
            empresa_id: 1,
            caja_id: cajaId,
            cajero_id: usuario.id,
            esperado: '350.00',
            contado: '350.00',
            diferencia: '0.00',
        })
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({ contado: '0' }),
            409,
        )

        // sin turno abierto, el efectivo vuelve a la caja principal (fuera de su alcance → 403)
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: clienteId, metodo: 'caja', monto: '10.00' }),
            403,
        )
        await afirmarLibroCuadrado(assert)
    })

    test('cerrar con diferencia exige motivo y deja asiento (faltante y sobrante); los pagos anulados no cuentan', async ({
        client,
        assert,
    }) => {
        const cajaId = await nuevaCaja()
        const { token } = await cajeroDe(cajaId)
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const cuentaCaja = await db
            .from('ledger.cajas as c')
            .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
            .where('c.id', cajaId)
            .select('cu.codigo')
            .firstOrFail()
        const { clienteId } = await escenario()

        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '100.00' }),
            201,
        )
        const cobro = (monto: string) =>
            estado(
                client
                    .post('/api/v1/pagos')
                    .bearerToken(token)
                    .json({ cliente_id: clienteId, metodo: 'caja', monto }),
                201,
            )
        await cobro('50.00')
        const anulado = await cobro('30.00')
        await estado(
            client
                .post(`/api/v1/pagos/${anulado.body().id}/anular`)
                .bearerToken(contador)
                .json({ motivo: 'cobro duplicado' }),
            200,
        )

        const sinMotivo = await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({ contado: '140.00' }),
            422,
        )
        assert.containSubset(sinMotivo.body().errors, [{ field: 'motivo', rule: 'required' }])
        assert.match(sinMotivo.body().errors[0].message, /diferencia de Q-10\.00 \(esperado Q150\.00/)

        const faltante = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .json({ contado: '140.00', motivo: 'billete falso' }),
            200,
        )
        assert.containSubset(faltante.body(), {
            esperado: '150.00',
            contado: '140.00',
            diferencia: '-10.00',
            motivo: 'billete falso',
        })
        assert.deepEqual(await lineasAsiento('cierre_caja', faltante.body().id), [
            ['5.2.06', '10.00', '0.00', null],
            [cuentaCaja.codigo, '0.00', '10.00', null],
        ])
        await afirmarLibroCuadrado(assert)

        // sobrante en el turno siguiente
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '140.00' }),
            201,
        )
        const sobrante = await estado(
            client
                .post(`/api/v1/cajas/${cajaId}/cerrar`)
                .bearerToken(token)
                .json({ contado: '145.50', motivo: 'vuelto no entregado' }),
            200,
        )
        assert.equal(sobrante.body().diferencia, '5.50')
        assert.deepEqual(await lineasAsiento('cierre_caja', sobrante.body().id), [
            [cuentaCaja.codigo, '5.50', '0.00', null],
            ['4.1.04', '0.00', '5.50', null],
        ])
        await afirmarLibroCuadrado(assert)

        const turnos = await estado(client.get(`/api/v1/cajas/${cajaId}/turnos`).bearerToken(token), 200)
        assert.deepEqual(
            turnos.body().data.map((t: { id: number; diferencia: string }) => [t.id, t.diferencia]),
            [
                [sobrante.body().id, '5.50'],
                [faltante.body().id, '-10.00'],
            ],
        )
        const pagina = await estado(
            client.get(`/api/v1/cajas/${cajaId}/turnos`).qs({ limit: 1 }).bearerToken(token),
            200,
        )
        assert.lengthOf(pagina.body().data, 1)
        assert.isString(pagina.body().nextCursor)
    })

    test('depósitos de caja (pedido de A4): el cajero lee los de su caja o turno; con bancos.ver, todos', async ({
        client,
        assert,
    }) => {
        const cajaId = await nuevaCaja()
        const otraCaja = await nuevaCaja()
        const { token } = await cajeroDe(cajaId)
        await estado(client.get('/api/v1/bancos/depositos').bearerToken(token), 422)
        await estado(client.get(`/api/v1/bancos/depositos?caja_id=${otraCaja}`).bearerToken(token), 403)
        const propia = await estado(
            client.get(`/api/v1/bancos/depositos?caja_id=${cajaId}`).bearerToken(token),
            200,
        )
        assert.deepEqual(propia.body().data, [])

        const { token: admin } = await usuarioConRoles(['admin'])
        const abierto = await estado(
            client
                .post(`/api/v1/cajas/${otraCaja}/abrir`)
                .bearerToken(admin)
                .header('Idempotency-Key', unico('abrir'))
                .json({ fondo_inicial: '0' }),
            201,
        )
        await estado(
            client.get(`/api/v1/bancos/depositos?turno_id=${abierto.body().id}`).bearerToken(token),
            403,
        )
        await estado(
            client
                .get(`/api/v1/bancos/depositos?caja_id=${cajaId}&turno_id=${abierto.body().id}`)
                .bearerToken(token),
            422,
        )
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        await estado(client.get('/api/v1/bancos/depositos').bearerToken(contador), 200)
    })

    test('lecturas del cajero (pedidos de A4): egresos de su caja o turno con cajas.ver; depósitos con bancos.ver o cajas.ver', async ({
        client,
        assert,
    }) => {
        const cajaId = await nuevaCaja()
        const otraCaja = await nuevaCaja()
        const turno = await new AbrirCaja().execute(
            { caja_id: cajaId, fondo_inicial: '300.00' },
            contextoPrueba(),
        )
        await new AbrirCaja().execute({ caja_id: otraCaja, fondo_inicial: '300.00' }, contextoPrueba())
        const propio = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '25.00', metodo: 'caja', caja_id: cajaId, descripcion: 'Agua' },
            contextoPrueba(),
        )
        const ajeno = await new RegistrarEgreso().execute(
            { categoria: 'otros', monto: '30.00', metodo: 'caja', caja_id: otraCaja },
            contextoPrueba(),
        )
        const { token } = await cajeroDe(cajaId)
        // egresos: sin caja ni turno 422; otra caja 403; su caja o su turno, solo lo suyo
        await estado(client.get('/api/v1/egresos').bearerToken(token), 422)
        await estado(client.get(`/api/v1/egresos?caja_id=${otraCaja}`).bearerToken(token), 403)
        const deLaCaja = await estado(client.get(`/api/v1/egresos?caja_id=${cajaId}`).bearerToken(token), 200)
        assert.deepEqual(
            deLaCaja.body().data.map((e: { id: number }) => e.id),
            [propio.id],
        )
        const delTurno = await estado(
            client.get(`/api/v1/egresos?turno_id=${turno.id}`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            delTurno.body().data.map((e: { id: number }) => e.id),
            [propio.id],
        )
        // con egresos.ver, todos (caja opcional)
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const todos = await estado(client.get('/api/v1/egresos?limit=100').bearerToken(contador), 200)
        const ids = todos.body().data.map((e: { id: number }) => e.id)
        assert.includeMembers(ids, [propio.id, ajeno.id])

        // depósitos: un rol a la medida con solo bancos.ver ve todos; sin ninguno de los dos, 403
        const soloBancos = await rolConPermisos(['bancos.ver'])
        await estado(client.get('/api/v1/bancos/depositos').bearerToken(soloBancos), 200)
        await estado(client.get(`/api/v1/bancos/depositos?caja_id=${otraCaja}`).bearerToken(soloBancos), 200)
        const ninguno = await rolConPermisos(['clientes.ver'])
        const sinPermiso = await estado(client.get('/api/v1/bancos/depositos').bearerToken(ninguno), 403)
        assert.include(sinPermiso.body().detail, 'bancos.ver o cajas.ver')
        await estado(client.get(`/api/v1/egresos?caja_id=${cajaId}`).bearerToken(ninguno), 403)
        // solo bancos.ver no da egresos
        await estado(client.get(`/api/v1/egresos?caja_id=${cajaId}`).bearerToken(soloBancos), 403)
        await afirmarLibroCuadrado(assert)
    })
})

/** Usuario con un rol a la medida que solo tiene estos permisos. */
async function rolConPermisos(permisos: string[]): Promise<string> {
    const [rol] = (await db
        .table('core.roles')
        .insert({ nombre: await unicoBd('rol'), descripcion: 'a la medida' })
        .returning('id')) as Array<{ id: number }>
    const filas = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(filas.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    const usuario = await Usuario.create({
        nombre: unico('Usuario'),
        email: `${unico('u')}@prueba.local`,
        password: 'clave-de-prueba',
        activo: true,
    })
    await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol!.id })
    const token = await Usuario.accessTokens.create(usuario)
    return token.value!.release()
}
