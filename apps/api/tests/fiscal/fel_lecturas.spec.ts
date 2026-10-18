import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import SustituirFactura from '#billing/actions/sustituir_factura'
import { controlFelFalso } from '#fiscal/fel/falso'
import { dteVigenteDe } from '#fiscal/fel/dte'
import { sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Lecturas de la fase 3 para el panel (A4), el portal y notify (A5, A6): catálogo de certificadores,
 * filtros de GET /dte, bitácora ante el certificador, sustituciones en la factura, la NCRE dentro
 * de la nota, diarios con su numeración y `dteVigenteDe`.
 */
test.group('FEL · lecturas para el panel, el portal y notify', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('GET /fel/proveedores: campos de credenciales, ambientes y capacidades de cada certificador', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('desactivada')
        const r = await estado(client.get('/api/v1/fel/proveedores').bearerToken(e.token), 200)
        const porCodigo = Object.fromEntries(
            (r.body() as Array<{ codigo: string }>).map((p) => [p.codigo, p]),
        )
        assert.containSubset(porCodigo.infile, {
            nombre: 'INFILE',
            campos_obligatorios: ['usuario_firma', 'llave_firma', 'usuario_api', 'llave_api'],
            campos_opcionales: ['correo_copia'],
            ambientes: ['pruebas', 'produccion'],
            solo_pruebas: false,
            capacidades: { pdf: false, consulta_nit: true },
        })
        assert.containSubset(porCodigo.falso, {
            campos_obligatorios: ['usuario', 'llave'],
            campos_visibles: ['usuario'],
            ambientes: ['pruebas'],
            solo_pruebas: true,
        })
    })

    test('GET /dte con varios estados y rango de fechas; GET /dte/:id/intentos con la bitácora', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('obligatoria')
        const a = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const b = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const c = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        // a se certifica, b queda en error temporal y c sigue pendiente (el orden de la cola es por id)
        controlFelFalso.siguiente.push('certificado', 'error_temporal')
        await cola(e)
        const dteA = await dtesDe('factura', a.facturas[0]!.id).then((r) => r[0]!)
        const dteB = await dtesDe('factura', b.facturas[0]!.id).then((r) => r[0]!)
        const dteC = await dtesDe('factura', c.facturas[0]!.id).then((r) => r[0]!)
        await db
            .from('fiscal.dte')
            .where('id', dteC.id)
            .update({ estado: 'pendiente', proximo_intento: null })
        const estados = [dteA.estado, dteB.estado]
        assert.deepEqual(estados, ['certificado', 'error_temporal'])

        const pedir = (qs: string) =>
            estado(
                client.get(`/api/v1/dte?${qs}`).bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
                200,
            ).then((r) => (r.body().data as Array<{ id: number }>).map((d) => Number(d.id)).sort())
        const ids = [dteA.id, dteB.id, dteC.id].map(Number)
        assert.deepEqual(await pedir('estado=pendiente&estado=error_temporal'), [ids[1], ids[2]].sort())
        assert.deepEqual(await pedir('estado[]=certificado'), [ids[0]])
        assert.deepEqual(await pedir('estado=certificado'), [ids[0]])
        const hoy = new Date(dteA.fecha_emision).toLocaleDateString('en-CA', {
            timeZone: 'America/Guatemala',
        })
        assert.includeMembers(await pedir(`desde=${hoy}&hasta=${hoy}`), ids)
        assert.deepEqual(await pedir('desde=2999-01-01'), [])
        await estado(
            client
                .get('/api/v1/dte?estado=inventado')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            422,
        )

        const intentos = await estado(
            client
                .get(`/api/v1/dte/${dteA.id}/intentos`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(intentos.body(), [{ dte_id: Number(dteA.id), operacion: 'certificar' }])
        assert.notInclude(JSON.stringify(intentos.body()), 'llave-secreta-1')
    })

    test('Factura con sustituida_por / sustituye_a; NotaCredito con su NCRE; dteVigenteDe', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await cola(e)
        const vigente = await dteVigenteDe('factura', f.id)
        assert.equal(vigente?.estado, 'certificado')
        assert.isNotNull(vigente?.autorizacion)
        assert.isNull(await dteVigenteDe('nota_credito', 999_999))

        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        assert.containSubset(nota, { fel_estado: 'pendiente', fel_uuid: null })
        await cola(e)
        const verNota = await estado(
            client
                .get(`/api/v1/notas-credito/${nota.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        const ncre = await dtesDe('nota_credito', nota.id).then((r) => r[0]!)
        assert.containSubset(verNota.body(), {
            dte_id: Number(ncre.id),
            fel_estado: 'certificado',
            fel_uuid: ncre.autorizacion,
        })
        assert.equal(await dteVigenteDe('nota_credito', nota.id).then((x) => x?.id), Number(ncre.id))

        const r = await new SustituirFactura().execute(
            {
                factura_id: f.id,
                motivo: 'NIT equivocado',
                cliente_fiscal: {
                    tipo_documento_fiscal: 'nit',
                    nit_cui: '1234567K',
                    nombre_fiscal: 'Otro, S.A.',
                },
            },
            e.ctx,
        )
        const ver = (id: number) =>
            estado(
                client.get(`/api/v1/facturas/${id}`).bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
                200,
            ).then((x) => x.body())
        assert.containSubset(await ver(f.id), { sustituida_por: r.nueva.id, sustituye_a: null })
        assert.containSubset(await ver(r.nueva.id), { sustituida_por: null, sustituye_a: f.id })
    })

    test('GET /libro/diarios: diarios de la empresa con su numeración por año', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('desactivada')
        await servicioFel(e, 'nunca', '150.00')
        const r = await estado(
            client.get('/api/v1/libro/diarios').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        const diarios = r.body() as Array<{
            id: number
            empresa_id: number
            codigo: string
            secuencias: Array<{ anio: number; ultimo: number }>
        }>
        assert.isTrue(diarios.every((d) => d.empresa_id === e.B))
        const ven = diarios.find((d) => d.codigo === 'VEN')!
        assert.isAbove(ven.secuencias.find((x) => x.anio === 2026)?.ultimo ?? 0, 0)
        const uno = await estado(
            client
                .get(`/api/v1/libro/diarios/${ven.id}`)
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(uno.body(), { codigo: 'VEN', tipo: 'ventas' })
    })
})
