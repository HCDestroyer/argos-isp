import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, nuevaCaja } from '#tests/ledger/ayudas_libro'
import { facturasDe, servicioCortado, unicoBd } from '#tests/billing/ayudas_billing'
import CrearPlantilla from '#billing/actions/crear_plantilla'
import EditarPlantilla from '#billing/actions/editar_plantilla'
import { plantillaPorDefectoId } from '#billing/plantillas'
import { soloFacturasPropias } from '#billing/estado_cuenta'

/**
 * Semana 2 · pendientes de A4: nombres de cliente en las vistas, filtros nuevos, `servicios[]` al
 * anular un pago, descripción del pago de terceros y plantilla por defecto.
 */

async function nombreDe(clienteId: number): Promise<string> {
    const fila = await db.from('core.clientes').where('id', clienteId).select('nombre').firstOrFail()
    return fila.nombre as string
}

test.group('billing · pendientes de A4', () => {
    test('cliente_nombre en facturas, pagos y promesas; filtros tipo, factura_id y origen_id', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado({ plantilla: { mora_tipo: 'fija', mora_valor: '10.00' } })
        const nombre = await nombreDe(datos.clienteId)
        const { token } = await usuarioConRoles(['admin'])

        const facturas = await estado(
            client.get('/api/v1/facturas').qs({ cliente_id: datos.clienteId }).bearerToken(token),
            200,
        )
        assert.isAbove(facturas.body().data.length, 2)
        for (const f of facturas.body().data) assert.equal(f.cliente_nombre, nombre)

        const moras = await estado(
            client
                .get('/api/v1/facturas')
                .qs({ cliente_id: datos.clienteId, tipo: 'mora' })
                .bearerToken(token),
            200,
        )
        assert.isAbove(moras.body().data.length, 0)
        assert.isTrue(moras.body().data.every((f: { tipo: string }) => f.tipo === 'mora'))
        const deServicio = await estado(
            client
                .get('/api/v1/facturas')
                .qs({ cliente_id: datos.clienteId, tipo: 'servicio' })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(deServicio.body().data, 2)

        const [septiembre] = await facturasDe(datos.servicioId)
        const detalle = await estado(client.get(`/api/v1/facturas/${septiembre!.id}`).bearerToken(token), 200)
        assert.equal(detalle.body().cliente_nombre, nombre)

        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: datos.clienteId, metodo: 'caja', monto: '100.00' }),
            201,
        )
        assert.equal(pago.body().cliente_nombre, nombre)
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: datos.clienteId,
                    metodo: 'caja',
                    monto: '5.00',
                    facturas: [septiembre!.id],
                }),
            201,
        )
        const deFactura = await estado(
            client.get('/api/v1/pagos').qs({ factura_id: septiembre!.id }).bearerToken(token),
            200,
        )
        assert.lengthOf(deFactura.body().data, 2)
        assert.equal(deFactura.body().data[0].cliente_nombre, nombre)

        const diario = await estado(
            client
                .get('/api/v1/libro/diario')
                .qs({ origen_tipo: 'pago', origen_id: pago.body().id })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(diario.body().data, 1)
        const cxc = diario
            .body()
            .data[0].movimientos.find((m: { cuenta_codigo: string }) => m.cuenta_codigo === '1.1.03')
        assert.equal(cxc.cliente_nombre, nombre)
        const caja = diario
            .body()
            .data[0].movimientos.find((m: { cliente_id: number | null }) => m.cliente_id === null)
        assert.isNull(caja.cliente_nombre)

        const promesa = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .json({
                    servicio_id: datos.servicioId,
                    vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                    monto: '50.00',
                }),
            201,
        )
        assert.equal(promesa.body().cliente_nombre, nombre)
        const promesas = await estado(
            client.get('/api/v1/promesas').qs({ servicio_id: datos.servicioId }).bearerToken(token),
            200,
        )
        assert.equal(promesas.body().data[0].cliente_nombre, nombre)
        await afirmarLibroCuadrado(assert)
    })

    test('anular pago devuelve servicios[] con el nuevo corte', async ({ client, assert }) => {
        const datos = await servicioCortado()
        const { token } = await usuarioConRoles(['contabilidad'])
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: datos.clienteId, metodo: 'caja', monto: '300.00' }),
            201,
        )
        assert.equal(pago.body().servicios[0].estado, 'activo')
        const anulado = await estado(
            client
                .post(`/api/v1/pagos/${pago.body().id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'billete falso' }),
            200,
        )
        assert.deepEqual(
            anulado
                .body()
                .servicios.map(
                    (s: { servicio_id: number; de: string; estado: string; cambiado: boolean }) => [
                        s.servicio_id,
                        s.de,
                        s.estado,
                        s.cambiado,
                    ],
                ),
            [[datos.servicioId, 'activo', 'suspendido', true]],
        )
        await afirmarLibroCuadrado(assert)
    })

    test('anular: servicios[] llega también en la repetición idempotente y vacío sin facturas', async ({
        client,
        assert,
    }) => {
        const datos = await servicioCortado()
        const { token } = await usuarioConRoles(['contabilidad'])
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: datos.clienteId, metodo: 'caja', monto: '150.00' }),
            201,
        )
        const clave = unico('anular')
        const anular = () =>
            client
                .post(`/api/v1/pagos/${pago.body().id}/anular`)
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ motivo: 'error de digitación' })
        const respuestaPrimero = await estado(anular(), 200)
        const respuestaRepetido = await estado(anular(), 200)
        const primero = respuestaPrimero.body()
        const repetido = respuestaRepetido.body()
        assert.lengthOf(primero.servicios, 1)
        assert.equal(primero.servicios[0].servicio_id, datos.servicioId)
        assert.equal(primero.servicios[0].estado, 'suspendido')
        assert.deepEqual(repetido.servicios, primero.servicios)

        // con todo pagado, un pago nuevo va completo a anticipos y anularlo no re-evalúa nada
        const otro = await servicioCortado()
        const anticipo = await estado(
            client.post('/api/v1/pagos').bearerToken(token).json({
                cliente_id: otro.clienteId,
                metodo: 'caja',
                monto: '1000.00',
            }),
            201,
        )
        const sobrante = await estado(
            client.post('/api/v1/pagos').bearerToken(token).json({
                cliente_id: otro.clienteId,
                metodo: 'caja',
                monto: '25.00',
            }),
            201,
        )
        assert.deepEqual(sobrante.body().aplicaciones, [])
        const sinFacturas = await estado(
            client
                .post(`/api/v1/pagos/${sobrante.body().id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'devuelto al cliente' }),
            200,
        )
        assert.deepEqual(sinFacturas.body().servicios, [])
        assert.equal(anticipo.body().servicios[0].estado, 'activo')
        await afirmarLibroCuadrado(assert)
    })

    test('estado de cuenta del dependiente: el pago lista solo sus facturas', async ({ client, assert }) => {
        const pagador = await servicioCortado()
        const familiar = await servicioCortado()
        const [sepF, octF] = await facturasDe(familiar.servicioId)
        const [sepP] = await facturasDe(pagador.servicioId)
        const { token } = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: pagador.clienteId,
                    metodo: 'caja',
                    monto: '450.00',
                    facturas: [sepF!.id, octF!.id, sepP!.id],
                }),
            201,
        )
        const cuentaF = await estado(
            client.get(`/api/v1/clientes/${familiar.clienteId}/estado-cuenta`).bearerToken(token),
            200,
        )
        const descripcion = cuentaF.body().movimientos.at(-1).descripcion as string
        assert.include(descripcion, `facturas ${sepF!.id}, ${octF!.id}`)
        assert.notMatch(descripcion, new RegExp(`facturas[^·]*\\b${sepP!.id}\\b`))
        assert.match(descripcion, /pagado por /)

        assert.equal(
            soloFacturasPropias('Pago 9 · caja · facturas 1, 2, 3', [2]),
            'Pago 9 · caja · factura 2',
        )
        assert.equal(soloFacturasPropias('Pago 9 · caja · anticipo', []), 'Pago 9 · caja · anticipo')
    })

    test('nombres de quien abrió y cerró el turno de caja', async ({ client, assert }) => {
        const cajaId = await nuevaCaja()
        const { token, usuario } = await usuarioConRoles(['admin'])
        await estado(
            client.post(`/api/v1/cajas/${cajaId}/abrir`).bearerToken(token).json({ fondo_inicial: '100.00' }),
            201,
        )
        const cajas = await estado(client.get('/api/v1/cajas').bearerToken(token), 200)
        const caja = cajas.body().find((c: { id: number }) => c.id === cajaId)
        assert.equal(caja.turno_abierto_por, usuario.id)
        assert.equal(caja.turno_abierto_por_nombre, usuario.nombre)
        const cerrado = await estado(
            client.post(`/api/v1/cajas/${cajaId}/cerrar`).bearerToken(token).json({ contado: '100.00' }),
            200,
        )
        assert.equal(cerrado.body().abierto_por_nombre, usuario.nombre)
        assert.equal(cerrado.body().cerrado_por_nombre, usuario.nombre)
        const turnos = await estado(client.get(`/api/v1/cajas/${cajaId}/turnos`).bearerToken(token), 200)
        assert.equal(turnos.body().data[0].cerrado_por_nombre, usuario.nombre)
    })

    test('plantilla por defecto: solo una; marcar otra desmarca la anterior con auditoría', async ({
        client,
        assert,
    }) => {
        const primera = await new CrearPlantilla().execute(
            { nombre: await unicoBd('Defecto A'), ciclo: 'dia_fijo', dia: 1, por_defecto: true },
            contextoPrueba(),
        )
        assert.isTrue(primera.por_defecto)
        assert.equal(await plantillaPorDefectoId(), primera.id)

        const { token } = await usuarioConRoles(['admin'])
        const segunda = await estado(
            client
                .post('/api/v1/plantillas-facturacion')
                .bearerToken(token)
                .json({ nombre: await unicoBd('Defecto B'), ciclo: 'aniversario', por_defecto: true }),
            201,
        )
        assert.isTrue(segunda.body().por_defecto)
        assert.equal(await plantillaPorDefectoId(), segunda.body().id)
        const antes = await estado(
            client.get(`/api/v1/plantillas-facturacion/${primera.id}`).bearerToken(token),
            200,
        )
        assert.isFalse(antes.body().por_defecto)
        assert.equal(antes.body().version, primera.version + 1)
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_facturacion')
            .where('entidad_id', primera.id)
            .where('campo', 'por_defecto')
            .orderBy('id', 'desc')
            .first()
        assert.exists(cambio)

        // editar: volver a marcar la primera
        await new EditarPlantilla().execute(
            { id: primera.id, version: antes.body().version, por_defecto: true },
            contextoPrueba(),
        )
        assert.equal(await plantillaPorDefectoId(), primera.id)
        const marcadas = await db
            .from('billing.plantillas_facturacion')
            .where('por_defecto', true)
            .count('* as n')
        assert.equal(Number(marcadas[0].n), 1)

        // quitar la marca: ninguna por defecto
        const actual = await estado(
            client.get(`/api/v1/plantillas-facturacion/${primera.id}`).bearerToken(token),
            200,
        )
        await estado(
            client
                .put(`/api/v1/plantillas-facturacion/${primera.id}`)
                .bearerToken(token)
                .json({ version: actual.body().version, por_defecto: false }),
            200,
        )
        assert.isNull(await plantillaPorDefectoId())
    })
})
