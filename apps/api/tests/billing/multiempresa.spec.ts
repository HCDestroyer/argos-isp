import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { bancoId, crearPlantillaFila, eventosDe, generar } from '#tests/billing/ayudas_billing'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RegistrarSaldoInicial from '#billing/actions/registrar_saldo_inicial'
import { saldoCliente } from '#ledger/consultas'
import { saldoPendienteServicio } from '#billing/facturas'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Multiempresa en billing y ledger (`contratos/multiempresa.md`): cada documento financiero es de
 * una empresa (NIT), un usuario acotado no ve ni cobra lo de otra, un cobro de caja que cubre
 * facturas de dos empresas se divide en un pago por empresa, el libro cuadra y se cierra por
 * empresa, y el consolidado solo existe con alcance global.
 */

const A = 1

/** Saldo CxC del cliente (en una empresa o consolidado) con 2 decimales. */
async function saldo(clienteId: number, cliente?: undefined, empresaId: number | null = null) {
    const valor = await saldoCliente(clienteId, cliente, empresaId)
    return valor.toFixed(2)
}

async function pendiente(servicioId: number) {
    const valor = await saldoPendienteServicio(servicioId)
    return valor.toFixed(2)
}

/** Usuario con esos roles acotado a esas empresas (sin alcance global). */
async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

/**
 * Un cliente con un servicio en la empresa A (la 1) y otro en la B (nueva), instalados el
 * 2026-09-01, con septiembre y octubre facturados (Q150 cada factura).
 */
async function clienteDeDosEmpresas() {
    const B = await crearEmpresaFila()
    const plantillaId = await crearPlantillaFila()
    const planId = await crearPlanFila({
        precio: '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const clienteId = await crearClienteFila()
    const datos = {
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        fecha_instalacion: '2026-09-01',
    }
    const servicioA = await crearServicioFila({ ...datos, empresa_id: A })
    const servicioB = await crearServicioFila({ ...datos, empresa_id: B })
    await generar(servicioA, '2026-10-01')
    await generar(servicioB, '2026-10-01')
    const facturas = async (servicioId: number) =>
        (
            (await db
                .from('billing.facturas')
                .where('servicio_id', servicioId)
                .orderBy('id', 'asc')
                .select('id', 'empresa_id')) as Array<{ id: number; empresa_id: number }>
        ).map((f) => ({ id: Number(f.id), empresa_id: Number(f.empresa_id) }))
    return {
        B,
        clienteId,
        servicioA,
        servicioB,
        facturasA: await facturas(servicioA),
        facturasB: await facturas(servicioB),
    }
}

/** Caja nueva de la empresa (por la API) con su turno abierto por el usuario. */
async function cajaAbierta(client: any, token: string, empresaId: number): Promise<number> {
    const caja = await estado(
        client
            .post('/api/v1/cajas')
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ nombre: unico('Caja') }),
        201,
    )
    await estado(
        client
            .post(`/api/v1/cajas/${caja.body().id}/abrir`)
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ fondo_inicial: '0.00' }),
        201,
    )
    return caja.body().id as number
}

/** Debe = Haber dentro de cada empresa. */
async function afirmarCuadrePorEmpresa(assert: any) {
    const resultado = await db.rawQuery(`
        SELECT a.empresa_id, sum(m.debe) AS debe, sum(m.haber) AS haber
          FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
         GROUP BY a.empresa_id
        HAVING sum(m.debe) <> sum(m.haber)
    `)
    assert.deepEqual(resultado.rows, [], 'hay empresas con el libro descuadrado')
    await afirmarLibroCuadrado(assert)
}

test.group('Multiempresa · billing y ledger', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('las facturas salen con la empresa del servicio y sus eventos la llevan', async ({ assert }) => {
        const e = await clienteDeDosEmpresas()
        assert.isTrue(e.facturasA.every((f) => f.empresa_id === A))
        assert.isTrue(e.facturasB.every((f) => f.empresa_id === e.B))
        const [emitida] = await eventosDe('factura.emitida', 'factura_id', e.facturasB[0]!.id)
        assert.equal(emitida.payload.empresa_id, e.B)
        // cada asiento de factura va al libro de su empresa
        const asiento = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'factura')
            .where('origen_id', e.facturasB[0]!.id)
            .firstOrFail()
        assert.equal(Number(asiento.empresa_id), e.B)
        // saldo por empresa y consolidado; saldo pendiente del servicio (para cambiar de empresa)
        assert.equal(await saldo(e.clienteId, undefined, A), '300.00')
        assert.equal(await saldo(e.clienteId, undefined, e.B), '300.00')
        assert.equal(await saldo(e.clienteId), '600.00')
        assert.equal(await pendiente(e.servicioB), '300.00')
        await afirmarCuadrePorEmpresa(assert)
    })

    test('aislamiento: el usuario de la empresa A no ve ni cobra lo de la B (403)', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token } = await usuarioEnEmpresas(['admin'], [A])
        const { token: global } = await usuarioConRoles(['admin'])

        // listas: solo lo de A
        const lista = await estado(
            client.get('/api/v1/facturas').qs({ cliente_id: e.clienteId }).bearerToken(token),
            200,
        )
        assert.sameMembers(
            lista.body().data.map((f: { id: number }) => f.id),
            e.facturasA.map((f) => f.id),
        )
        assert.isTrue(lista.body().data.every((f: { empresa_id: number }) => f.empresa_id === A))
        // el consolidado no es para él
        await estado(client.get('/api/v1/facturas').qs({ empresas: 'todas' }).bearerToken(token), 403)
        await estado(
            client.get('/api/v1/facturas').header('X-Empresa-Id', String(e.B)).bearerToken(token),
            403,
        )
        // un documento de B: 403
        await estado(client.get(`/api/v1/facturas/${e.facturasB[0]!.id}`).bearerToken(token), 403)
        // cobrar una factura de B: 403
        const ajeno = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: e.clienteId,
                    metodo: 'caja',
                    monto: '150.00',
                    facturas: [e.facturasB[0]!.id],
                }),
            403,
        )
        assert.equal(ajeno.body().type, 'urn:argosisp:problema:empresa_no_permitida')

        // cobrar sin facturas: solo toma las de A (una sola empresa: la caja principal de A)
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: e.clienteId, metodo: 'caja', monto: '300.00' }),
            201,
        )
        assert.equal(pago.body().empresa_id, A)
        assert.lengthOf(pago.body().pagos, 1)
        assert.sameMembers(
            pago.body().aplicaciones.map((a: { factura_id: number }) => a.factura_id),
            e.facturasA.map((f) => f.id),
        )
        assert.equal(await saldo(e.clienteId, undefined, e.B), '300.00')

        // un pago de B (lo registra el global con la empresa activa B) no es visible para él
        const cuentaB = await estado(
            client
                .post('/api/v1/cuentas-bancarias')
                .bearerToken(global)
                .header('X-Empresa-Id', String(e.B))
                .json({ banco_id: await bancoId(), numero: unico('900'), alias: unico('Cobros B') }),
            201,
        )
        assert.equal(cuentaB.body().empresa_id, e.B)
        const pagoB = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(global)
                .json({
                    cliente_id: e.clienteId,
                    metodo: 'deposito',
                    monto: '150.00',
                    cuenta_bancaria_id: cuentaB.body().id,
                    referencia: unico('boleta'),
                }),
            201,
        )
        assert.equal(pagoB.body().empresa_id, e.B)
        await estado(client.get(`/api/v1/pagos/${pagoB.body().id}`).bearerToken(token), 403)
        await estado(
            client
                .post(`/api/v1/pagos/${pagoB.body().id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'no es mía' }),
            403,
        )
        const pagos = await estado(
            client.get('/api/v1/pagos').qs({ cliente_id: e.clienteId }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            pagos.body().data.map((p: { id: number }) => p.id),
            [pago.body().id],
        )
        await estado(client.get(`/api/v1/cuentas-bancarias/${cuentaB.body().id}`).bearerToken(token), 403)

        // estado de cuenta: solo la sección de A; el global ve las dos
        const cuenta = await estado(
            client.get(`/api/v1/clientes/${e.clienteId}/estado-cuenta`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            cuenta.body().empresas.map((s: { empresa_id: number; saldo: string }) => [s.empresa_id, s.saldo]),
            [[A, '0.00']],
        )
        const todo = await estado(
            client.get(`/api/v1/clientes/${e.clienteId}/estado-cuenta`).bearerToken(global),
            200,
        )
        assert.deepEqual(
            todo.body().empresas.map((s: { empresa_id: number; saldo: string }) => [s.empresa_id, s.saldo]),
            [
                [A, '0.00'],
                [e.B, '150.00'],
            ],
        )
        assert.equal(todo.body().saldo, '150.00')
        await afirmarCuadrePorEmpresa(assert)
    })

    test('cobro repartido: un pago por empresa con su caja, su asiento, su evento y un recibo por empresa', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token, usuario } = await usuarioConRoles(['admin'])
        const cajaA = await cajaAbierta(client, token, A)
        const cajaB = await cajaAbierta(client, token, e.B)
        const cuentaCajaB = await db
            .from('ledger.cajas as c')
            .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
            .where('c.id', cajaB)
            .select('c.empresa_id', 'cu.empresa_id as cuenta_empresa', 'cu.codigo')
            .firstOrFail()
        assert.equal(Number(cuentaCajaB.empresa_id), e.B)
        assert.equal(Number(cuentaCajaB.cuenta_empresa), e.B)

        // 400: A-sep 150, B-sep 150 (mismo vencimiento), A-oct 100
        const cobro = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(A))
                .json({ cliente_id: e.clienteId, metodo: 'caja', monto: '400.00' }),
            201,
        )
        const pagos = cobro.body().pagos as Array<{
            id: number
            empresa_id: number
            cobro_id: number
            monto: string
            caja_id: number
            aplicaciones: Array<{ factura_id: number; monto: string }>
        }>
        assert.lengthOf(pagos, 2)
        assert.deepEqual(
            pagos.map((p) => [p.empresa_id, p.monto, p.caja_id]),
            [
                [A, '250.00', cajaA],
                [e.B, '150.00', cajaB],
            ],
        )
        assert.equal(pagos[0]!.cobro_id, pagos[1]!.cobro_id)
        assert.deepEqual(
            pagos[1]!.aplicaciones.map((a) => [a.factura_id, a.monto]),
            [[e.facturasB[0]!.id, '150.00']],
        )
        // cada pago con su asiento en el libro de su empresa
        for (const pago of pagos) {
            const asientos = await db
                .from('ledger.asientos')
                .where('origen_tipo', 'pago')
                .where('origen_id', pago.id)
            assert.lengthOf(asientos, 1)
            assert.equal(Number(asientos[0].empresa_id), pago.empresa_id)
            const [evento] = await eventosDe('pago.registrado', 'pago_id', pago.id)
            assert.equal(evento.payload.empresa_id, pago.empresa_id)
            assert.equal(evento.payload.cobro_id, pago.cobro_id)
        }
        assert.equal(await saldo(e.clienteId, undefined, A), '50.00')
        assert.equal(await saldo(e.clienteId, undefined, e.B), '150.00')

        // recibo: una sección por empresa con su marca
        const recibo = await estado(
            client.get(`/api/v1/cobros/${pagos[0]!.cobro_id}`).bearerToken(token),
            200,
        )
        assert.equal(recibo.body().monto, '400.00')
        assert.deepEqual(
            recibo
                .body()
                .secciones.map((s: { empresa: { id: number }; pago: { id: number } }) => [
                    s.empresa.id,
                    s.pago.id,
                ]),
            pagos.map((p) => [p.empresa_id, p.id]),
        )
        const empresaB = await db.from('core.empresas').where('id', e.B).firstOrFail()
        assert.equal(recibo.body().secciones[1].empresa.nit, empresaB.nit)
        // un usuario solo de A ve solo su sección
        const { token: soloA } = await usuarioEnEmpresas(['admin'], [A])
        const parcial = await estado(
            client.get(`/api/v1/cobros/${pagos[0]!.cobro_id}`).bearerToken(soloA),
            200,
        )
        assert.lengthOf(parcial.body().secciones, 1)

        // anular el pago de B no toca el de A
        await estado(
            client
                .post(`/api/v1/pagos/${pagos[1]!.id}/anular`)
                .bearerToken(token)
                .json({ motivo: 'error de caja' }),
            200,
        )
        const pagoA = await db.from('billing.pagos').where('id', pagos[0]!.id).firstOrFail()
        assert.equal(pagoA.estado, 'registrado')
        const [anulado] = await eventosDe('pago.anulado', 'pago_id', pagos[1]!.id)
        assert.equal(anulado.payload.empresa_id, e.B)

        // cierre de caja por empresa: el esperado de B no incluye lo cobrado en A
        const cierre = await estado(
            client.post(`/api/v1/cajas/${cajaA}/cerrar`).bearerToken(token).json({ contado: '250.00' }),
            200,
        )
        assert.equal(cierre.body().esperado, '250.00')
        const [cerrada] = await eventosDe('caja.cerrada', 'caja_id', cajaA)
        assert.equal(cerrada.payload.empresa_id, A)
        assert.isDefined(usuario)
        await afirmarCuadrePorEmpresa(assert)
    })

    test('caja_no_abierta con la empresa, cuenta_de_otra_empresa y nada cruza NIT en la base', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token } = await usuarioConRoles(['admin'])
        await cajaAbierta(client, token, A)

        // efectivo para A y B sin caja abierta en B → 422 con la empresa B
        const sinCaja = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({ cliente_id: e.clienteId, metodo: 'caja', monto: '300.00' }),
            422,
        )
        assert.equal(sinCaja.body().type, 'urn:argosisp:problema:caja_no_abierta')
        assert.equal(sinCaja.body().errors[0].rule, String(e.B))
        assert.equal(
            await db
                .from('billing.pagos')
                .where('cliente_id', e.clienteId)
                .count('* as n')
                .first()
                .then((f) => Number(f.n)),
            0,
        )

        // depósito a una cuenta de B para una factura de A → 422 cuenta_de_otra_empresa
        const cuentaB = await estado(
            client
                .post('/api/v1/cuentas-bancarias')
                .bearerToken(token)
                .json({
                    banco_id: await bancoId(),
                    numero: unico('901'),
                    alias: unico('B'),
                    empresa_id: e.B,
                }),
            201,
        )
        const cruzado = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: e.clienteId,
                    metodo: 'deposito',
                    monto: '150.00',
                    cuenta_bancaria_id: cuentaB.body().id,
                    referencia: unico('boleta'),
                    facturas: [e.facturasA[0]!.id],
                }),
            422,
        )
        assert.equal(cruzado.body().type, 'urn:argosisp:problema:cuenta_de_otra_empresa')

        // la base también lo impide: aplicar un pago de B a una factura de A
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .json({
                    cliente_id: e.clienteId,
                    metodo: 'deposito',
                    monto: '10.00',
                    cuenta_bancaria_id: cuentaB.body().id,
                    referencia: unico('boleta'),
                }),
            201,
        )
        assert.equal(pago.body().empresa_id, e.B)
        await assert.rejects(
            () =>
                db.table('billing.pagos_aplicaciones').insert({
                    pago_id: pago.body().id,
                    factura_id: e.facturasA[0]!.id,
                    monto: '1.00',
                }),
            /empresa/,
        )
        // un asiento de A no puede usar la subcuenta bancaria de B
        const subcuenta = await db
            .from('billing.cuentas_bancarias')
            .where('id', cuentaB.body().id)
            .firstOrFail()
        const cruce = await new RegistrarAsiento()
            .execute(
                {
                    empresa_id: A,
                    descripcion: 'cruce prohibido',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: Number(subcuenta.cuenta_id), debe: '1.00' },
                        { cuenta: CUENTAS.OTROS_INGRESOS, haber: '1.00' },
                    ],
                },
                contextoPrueba(),
            )
            .then(
                () => null,
                (error: { errores?: Array<{ rule?: string }> }) => error,
            )
        assert.equal(cruce?.errores?.[0]?.rule, 'cuenta_de_otra_empresa')
        await afirmarCuadrePorEmpresa(assert)
    })

    test('asientos y cierre de mes por empresa; balance y resultados por empresa y consolidado', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token } = await usuarioConRoles(['admin'])
        const { token: soloB } = await usuarioEnEmpresas(['admin'], [e.B])

        // cerrar marzo de 2005 solo en B
        const cierre = await estado(
            client.post('/api/v1/libro/periodos/cerrar').bearerToken(soloB).json({ anio: 2005, mes: 3 }),
            201,
        )
        assert.equal(cierre.body().empresa_id, e.B)
        const ajuste = (empresaId: number) =>
            new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha: '2005-03-10',
                    descripcion: 'ajuste',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: CUENTAS.BANCO_PRINCIPAL, debe: '5.00' },
                        { cuenta: CUENTAS.OTROS_INGRESOS, haber: '5.00' },
                    ],
                },
                contextoPrueba(),
            )
        await assert.rejects(() => ajuste(e.B), /cerrado/)
        const enA = await ajuste(A)
        assert.equal(enA.empresa_id, A)
        // los periodos de B no son de A: el usuario de B no ve los cierres de A ni puede cerrarlos
        const periodos = await estado(client.get('/api/v1/libro/periodos').bearerToken(soloB), 200)
        assert.isTrue(periodos.body().data.every((c: { empresa_id: number }) => c.empresa_id === e.B))
        await estado(
            client
                .post('/api/v1/libro/periodos/cerrar')
                .bearerToken(soloB)
                .json({ anio: 2005, mes: 4, empresa_id: A }),
            403,
        )
        // el asiento de A no se ve desde B
        await estado(client.get(`/api/v1/libro/asientos/${enA.id}`).bearerToken(soloB), 403)

        // balance de B: solo su libro y cuadra
        const balanceB = await estado(client.get('/api/v1/libro/balance').bearerToken(soloB), 200)
        assert.deepEqual(
            balanceB.body().empresas.map((s: { empresa_id: number }) => s.empresa_id),
            [e.B],
        )
        assert.isTrue(balanceB.body().total.totales.cuadra)
        const cxcB = balanceB
            .body()
            .empresas[0].cuentas.find((c: { codigo: string }) => c.codigo === '1.1.03')
        assert.exists(cxcB)
        await estado(client.get('/api/v1/libro/balance').qs({ empresas: 'todas' }).bearerToken(soloB), 403)

        // consolidado del global: una sección por empresa y el total del grupo
        const consolidado = await estado(
            client.get('/api/v1/libro/balance').qs({ empresas: 'todas' }).bearerToken(token),
            200,
        )
        assert.isTrue(consolidado.body().consolidado)
        const secciones = consolidado.body().empresas.map((s: { empresa_id: number }) => s.empresa_id)
        assert.includeMembers(secciones, [A, e.B])
        assert.isTrue(consolidado.body().total.totales.cuadra)
        const resultados = await estado(
            client
                .get('/api/v1/libro/estado-resultados')
                .qs({ desde: '2026-09-01', hasta: '2026-12-31' })
                .bearerToken(soloB),
            200,
        )
        assert.equal(resultados.body().empresas[0].empresa_id, e.B)
        // B facturó Q300 con IVA incluido: ingresos 267.86 (dos líneas de 133.93)
        assert.equal(resultados.body().empresas[0].totales.ingresos, '267.86')

        // diario de B: solo asientos de B
        const diario = await estado(client.get('/api/v1/libro/diario').bearerToken(soloB), 200)
        assert.isTrue(diario.body().data.every((a: { empresa_id: number }) => a.empresa_id === e.B))
        await afirmarCuadrePorEmpresa(assert)
    })

    test('reportes y dashboard: la empresa activa sin columna de empresa; el consolidado con ella', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token } = await usuarioConRoles(['admin'])
        const { token: soloB } = await usuarioEnEmpresas(['admin'], [e.B])

        const deB = await estado(
            client
                .get('/api/v1/reportes/facturado-vs-cobrado')
                .qs({ cliente_id: e.clienteId })
                .bearerToken(soloB),
            200,
        )
        assert.notInclude(
            deB.body().columnas.map((c: { clave: string }) => c.clave),
            'empresa_id',
        )
        assert.equal(deB.body().totales.facturado, '300.00')
        await estado(
            client.get('/api/v1/reportes/facturado-vs-cobrado').qs({ empresas: 'todas' }).bearerToken(soloB),
            403,
        )

        const todas = await estado(
            client
                .get('/api/v1/reportes/facturado-vs-cobrado')
                .qs({ cliente_id: e.clienteId, empresas: 'todas' })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            todas
                .body()
                .columnas.slice(0, 2)
                .map((c: { clave: string }) => c.clave),
            ['empresa_id', 'empresa'],
        )
        assert.sameMembers(
            [...new Set(todas.body().filas.map((f: { empresa_id: number }) => f.empresa_id))],
            [A, e.B],
        )
        assert.equal(todas.body().totales.facturado, '600.00')

        const cartera = await estado(
            client
                .get('/api/v1/reportes/cartera-vencida')
                .qs({ empresas: 'todas', cliente_id: e.clienteId })
                .bearerToken(token),
            200,
        )
        assert.lengthOf(cartera.body().filas, 2)
        const iva = await estado(
            client
                .get('/api/v1/reportes/iva')
                .qs({ desde: '2026-09-01', hasta: '2026-12-31' })
                .bearerToken(soloB),
            200,
        )
        assert.equal(iva.body().totales.iva_neto, iva.body().totales.iva_libro)
        assert.equal(iva.body().totales.iva_facturado, '32.14')

        const csv = await estado(
            client
                .get('/api/v1/reportes/ingresos')
                .qs({ empresas: 'todas', formato: 'csv' })
                .bearerToken(token),
            200,
        )
        assert.match(csv.text(), /Empresa/)

        await estado(client.get('/api/v1/dashboard/resumen').bearerToken(soloB), 200)
        await estado(
            client.get('/api/v1/dashboard/resumen').qs({ empresas: 'todas' }).bearerToken(soloB),
            403,
        )
    })

    test('importación: empresa explícita, la de los servicios del cliente o la activa', async ({
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const soloB = await crearClienteFila()
        await crearServicioFila({ cliente_id: soloB, empresa_id: e.B })

        // cliente con servicios solo en B: el saldo inicial es de B
        const deB = await new RegistrarSaldoInicial().execute(
            {
                origen: 'pruebamulti',
                id_externo: unico('si'),
                cliente_id: soloB,
                monto: '80.00',
                fecha: '2026-10-01',
            },
            contextoPrueba(),
        )
        const fila = await db.from('billing.saldos_iniciales').where('id', deB.saldo_inicial_id).firstOrFail()
        assert.equal(Number(fila.empresa_id), e.B)
        const factura = await db.from('billing.facturas').where('id', deB.factura_id!).firstOrFail()
        assert.equal(Number(factura.empresa_id), e.B)
        assert.equal(await saldo(soloB, undefined, e.B), '80.00')

        // cliente con servicios en A y B: la explícita
        const explicita = await new RegistrarSaldoInicial().execute(
            {
                origen: 'pruebamulti',
                id_externo: unico('si'),
                cliente_id: e.clienteId,
                monto: '-20.00',
                fecha: '2026-10-01',
                empresa_id: e.B,
            },
            contextoPrueba(),
        )
        const aFavor = await db
            .from('billing.saldos_iniciales')
            .where('id', explicita.saldo_inicial_id)
            .firstOrFail()
        assert.equal(Number(aFavor.empresa_id), e.B)
        // el saldo a favor de B solo paga facturas de B (se aplicó a la de septiembre de B)
        const aplicado = await db
            .from('billing.saldos_iniciales_aplicaciones')
            .where('saldo_inicial_id', explicita.saldo_inicial_id)
            .select('factura_id')
        assert.deepEqual(
            aplicado.map((a) => Number(a.factura_id)),
            [e.facturasB[0]!.id],
        )
        // sin empresa y con servicios en dos empresas: la activa del contexto
        const activa = await new RegistrarSaldoInicial().execute(
            {
                origen: 'pruebamulti',
                id_externo: unico('si'),
                cliente_id: e.clienteId,
                monto: '5.00',
                fecha: '2026-10-01',
            },
            { ...contextoPrueba(), empresaId: A },
        )
        const deA = await db
            .from('billing.saldos_iniciales')
            .where('id', activa.saldo_inicial_id)
            .firstOrFail()
        assert.equal(Number(deA.empresa_id), A)
        await afirmarCuadrePorEmpresa(assert)
    })
})
