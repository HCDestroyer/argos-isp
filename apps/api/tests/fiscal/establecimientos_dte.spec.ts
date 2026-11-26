import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import CrearEstablecimiento from '#fiscal/actions/crear_establecimiento'
import EditarEstablecimiento from '#fiscal/actions/editar_establecimiento'
import RegistrarPago from '#billing/actions/registrar_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { dteParaEnviar, verDte } from '#fiscal/fel/dte'
import { xmlDte } from '#fiscal/fel/xml_gt'
import { errorDe, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Establecimiento de cada DTE (`contratos/fel-establecimientos.md` lote 4 con la decisión del PM P1):
 * la factura sale de la sucursal de la caja que la cobra; lo que no pasa por caja, del por defecto;
 * las notas, del DTE de su factura. Código postal del establecimiento en el XML.
 */
test.group('FEL · establecimiento por caja', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('la caja que cobra decide el establecimiento; sin caja, el por defecto; la NCRE, el de su factura', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const matriz = await new CrearEstablecimiento().execute(
            { empresa_id: e.B, codigo: 1, nombre: 'Casa matriz', por_defecto: true },
            e.ctx,
        )
        const cajaB = e.cajas.get(e.B)!
        const xela = await new CrearEstablecimiento().execute(
            {
                empresa_id: e.B,
                codigo: 2,
                nombre: 'Sucursal Xela',
                municipio: 'Quetzaltenango',
                departamento: 'Quetzaltenango',
                codigo_postal: '09001',
                cajas: [cajaB],
            },
            e.ctx,
        )
        assert.deepEqual(xela.cajas, [cajaB])
        const cambiosCaja = await db.from('audit.cambios').where({ entidad_tipo: 'caja', entidad_id: cajaB })
        assert.isAtLeast(cambiosCaja.length, 1)

        // cobrada en la caja de Xela: su DTE sale por el 2 con su código postal
        const s = await servicioFel(e, 'pagar', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', caja_id: cajaB, monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(Number(dte!.establecimiento_id), xela.id)
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        assert.include(envio.emisor, {
            establecimiento: 2,
            nombre_comercial: 'Sucursal Xela',
            codigo_postal: '09001',
        })
        const xml = xmlDte(envio)
        assert.include(xml, 'CodigoEstablecimiento="2"')
        assert.include(xml, '<dte:CodigoPostal>09001</dte:CodigoPostal>')

        // sin caja (a mano, sin pago): el por defecto
        const otra = await servicioFel(e, 'nunca', '150.00', await crearClienteFila(datosNit()))
        await estado(
            client
                .post(`/api/v1/facturas/${otra.facturas[0]!.id}/certificar`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        const [dteMatriz] = await dtesDe('factura', otra.facturas[0]!.id)
        assert.equal(Number(dteMatriz!.establecimiento_id), matriz.id)

        // pago parcial en la caja de Xela y certificada a mano: su DTE va por el 2 (la caja del pago)
        const parcial = await servicioFel(e, 'nunca', '150.00', await crearClienteFila(datosNit()))
        const fp = parcial.facturas[0]!
        await new RegistrarPago().execute(
            {
                cliente_id: parcial.clienteId,
                metodo: 'caja',
                caja_id: cajaB,
                monto: '100.00',
                empresa_id: e.B,
            },
            e.ctx,
        )
        await estado(
            client
                .post(`/api/v1/facturas/${fp.id}/certificar`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        await cola(e)
        const [dteParcial] = await dtesDe('factura', fp.id)
        assert.equal(Number(dteParcial!.establecimiento_id), xela.id)

        // la caja pasa al establecimiento 1; la NCRE de esa factura sigue saliendo por el 2 (el de su DTE)
        const actualMatriz = await db.from('fiscal.establecimientos').where('id', matriz.id).firstOrFail()
        await new EditarEstablecimiento().execute(
            { id: matriz.id, version: Number(actualMatriz.version), cajas: [cajaB] },
            e.ctx,
        )
        const caja = await db.from('ledger.cajas').where('id', cajaB).firstOrFail()
        assert.equal(Number(caja.establecimiento_id), matriz.id)
        const vistaXela = await estado(
            client
                .get('/api/v1/fiscal/establecimientos')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        const xelaLeido = (vistaXela.body() as Array<{ id: number; cajas: number[] }>).find(
            (x) => x.id === xela.id,
        )
        assert.deepEqual(xelaLeido?.cajas, [], 'la caja se movió')
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: fp.id, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        const [dteNota] = await dtesDe('nota_credito', nota.id)
        assert.equal(Number(dteNota!.establecimiento_id), xela.id)
    })

    test('una caja de otra empresa: 422 en cajas.N; código postal de 5 dígitos', async ({ assert }) => {
        const e = await empresasFel('opcional')
        const r = await errorDe(
            new CrearEstablecimiento().execute(
                { empresa_id: e.B, codigo: 3, nombre: 'Otra', cajas: [e.cajas.get(e.C)!] },
                e.ctx,
            ),
        )
        assert.equal(r.status, 422)
        assert.include(r.reglas, 'empresa')
    })
})
