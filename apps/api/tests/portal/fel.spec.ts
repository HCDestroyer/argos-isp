import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { textoDePdf } from '#tests/portal/ayudas_pdf'
import { sesionDirecta } from '#tests/portal/ayudas_portal'
import {
    adelantarReintento,
    cola,
    configurarModo,
    datosNit,
    dtesDe,
    empresasFel,
    servicioFel,
} from '#tests/fiscal/ayudas_fel'
import RegistrarPago from '#billing/actions/registrar_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AnularNotaCredito from '#billing/actions/anular_nota_credito'
import AnularFactura from '#billing/actions/anular_factura'
import SustituirFactura from '#billing/actions/sustituir_factura'
import { controlFelFalso } from '#fiscal/fel/falso'

/**
 * FEL en el portal (contrato `localizacion-fiscal.md` §14, fila de A5), con el certificador falso:
 * las facturas `por_certificar` no salen; un aviso pasa a «Factura» solo con su DTE certificado; PDF
 * con la marca de la empresa y XML solo para el cliente dueño; NCRE, sustituidas y anuladas
 * visibles como tales.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

let ip = 0

/** GET de la sesión del portal (cada uno desde su IP para no tocar el límite por IP). */
function get(client: ApiClient, ruta: string, cookie?: string) {
    ip += 1
    const peticion = client.get(`/api/v1${ruta}`).header('X-Forwarded-For', `198.18.40.${ip % 250}`)
    return cookie ? peticion.header('Cookie', cookie) : peticion
}

async function leer(client: ApiClient, ruta: string, cookie: string) {
    const respuesta = await estado(get(client, ruta, cookie), 200)
    return respuesta.body()
}

async function facturaDelPortal(client: ApiClient, cookie: string, id: number) {
    const lista = await leer(client, '/portal/facturas?limit=50', cookie)
    return (lista.data as Array<Record<string, any>>).find((f) => f.id === id)
}

test.group('Portal · FEL', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-fel')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return async () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
            await soloEmpresaPrincipal()
        }
    })

    test('por_certificar no sale (lista, detalle, PDF, XML ni cuenta); al certificarse es Factura con su DTE', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const clienteId = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', clienteId)
        const f = s.facturas[0]!
        assert.equal(f.estado, 'por_certificar')
        const { cookie } = await sesionDirecta(clienteId)

        assert.isUndefined(await facturaDelPortal(client, cookie, f.id))
        await estado(get(client, `/portal/facturas/${f.id}`, cookie), 404)
        await estado(get(client, `/portal/facturas/${f.id}/pdf`, cookie), 404)
        await estado(get(client, `/portal/facturas/${f.id}/xml`, cookie), 404)
        const cuenta = await leer(client, '/portal/cuenta', cookie)
        const pendientes = (cuenta.empresas as Array<{ facturas_pendientes: Array<{ id: number }> }>).flatMap(
            (x) => x.facturas_pendientes,
        )
        assert.notInclude(
            pendientes.map((p) => p.id),
            f.id,
        )

        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        const visible = await facturaDelPortal(client, cookie, f.id)
        assert.containSubset(visible, {
            estado: 'emitida',
            documento: 'factura',
            numero: `${dte!.serie}-${dte!.numero}`,
            fel_uuid: dte!.autorizacion,
            fel_serie: dte!.serie,
            fel_numero: dte!.numero,
            dte: {
                tipo_dte: 'FACT',
                estado: 'certificado',
                autorizacion: dte!.autorizacion,
                serie: dte!.serie,
                numero: dte!.numero,
                xml_disponible: true,
            },
            sustituida: false,
            sustituida_por: null,
            sustituye_a: null,
            acreditado: '0.00',
            empresa: { id: e.B },
        })
        assert.isNotNull(visible!.dte.certificado_en)
        const detalle = await leer(client, `/portal/facturas/${f.id}`, cookie)
        assert.equal(detalle.documento, 'factura')
    })

    test('un aviso de cobro solo pasa a Factura con el DTE certificado (no con error temporal)', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar')
        const f = s.facturas[0]!
        const { cookie } = await sesionDirecta(s.clienteId)
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            documento: 'aviso_cobro',
            numero: String(f.id),
            dte: null,
            fel_uuid: null,
        })

        controlFelFalso.siguiente.push('error_temporal')
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const [conError] = await dtesDe('factura', f.id)
        assert.equal(conError!.estado, 'error_temporal')
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            estado: 'pagada',
            documento: 'aviso_cobro',
            dte: null,
        })
        await estado(get(client, `/portal/facturas/${f.id}/xml`, cookie), 404)

        await adelantarReintento(Number(conError!.id))
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            documento: 'factura',
            numero: `${dte!.serie}-${dte!.numero}`,
            dte: { estado: 'certificado', autorizacion: dte!.autorizacion },
        })
    })

    test('PDF con la marca de la empresa de la factura y XML certificado; nunca de otro cliente', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const marca = unico('Fibra Altiplano')
        await db.from('core.empresas').where('id', e.B).update({ nombre_comercial: marca })
        const clienteId = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', clienteId)
        const f = s.facturas[0]!
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        const empresa = await db.from('core.empresas').where('id', e.B).firstOrFail()
        const { cookie } = await sesionDirecta(clienteId)

        const pdf = await estado(get(client, `/portal/facturas/${f.id}/pdf`, cookie), 200)
        assert.equal(pdf.header('content-type'), 'application/pdf')
        assert.equal(
            pdf.header('content-disposition'),
            `inline; filename="factura-${dte!.serie}-${dte!.numero}.pdf"`,
        )
        const texto = textoDePdf(Buffer.from(pdf.body() as Buffer))
        assert.include(texto, marca)
        if (empresa.nit) assert.include(texto, `NIT ${empresa.nit}`)
        assert.include(texto, 'Factura')
        assert.include(texto, `${dte!.serie}-${dte!.numero}`)
        assert.include(texto, `Autorización ${dte!.autorizacion}`)
        assert.include(texto, 'Certificado el')
        assert.notInclude(texto, 'no es una factura electrónica')

        const xml = await estado(get(client, `/portal/facturas/${f.id}/xml`, cookie), 200)
        assert.match(String(xml.header('content-type')), /^application\/xml/)
        assert.equal(
            xml.header('content-disposition'),
            `attachment; filename="fact-${dte!.serie}-${dte!.numero}.xml"`,
        )
        assert.equal(xml.header('cache-control'), 'private, no-store')
        assert.equal(xml.text(), dte!.xml)

        // otro cliente con su sesión: 404 en todo (igual que una factura inexistente); sin sesión, 401
        const otro = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        await cola(e)
        const { cookie: ajena } = await sesionDirecta(otro.clienteId)
        assert.isUndefined(await facturaDelPortal(client, ajena, f.id))
        for (const ruta of [
            `/portal/facturas/${f.id}`,
            `/portal/facturas/${f.id}/pdf`,
            `/portal/facturas/${f.id}/xml`,
        ]) {
            const respuesta = await estado(get(client, ruta, ajena), 404)
            assert.notInclude(respuesta.text(), String(dte!.autorizacion), ruta)
            await estado(get(client, ruta), 401)
        }
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        await cola(e)
        await estado(get(client, `/portal/notas-credito/${nota.id}/xml`, ajena), 404)
        await estado(get(client, `/portal/notas-credito/${nota.id}/xml`), 401)
        const notasAjenas = await leer(client, '/portal/notas-credito', ajena)
        assert.notInclude(
            (notasAjenas.data as Array<{ id: number }>).map((n) => n.id),
            nota.id,
        )
        await estado(get(client, `/portal/notas-credito/${nota.id}/xml`, cookie), 200)
    })

    test('NCRE en el estado de cuenta; una nota anulada sale anulada y sin DTE', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const clienteId = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', clienteId)
        const f = s.facturas[0]!
        await cola(e)
        const [dteFactura] = await dtesDe('factura', f.id)
        const { cookie } = await sesionDirecta(clienteId)

        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '50.00', motivo: 'descuento comercial' },
            e.ctx,
        )
        // en cola: todavía es nota interna
        const enCola = await leer(client, '/portal/notas-credito', cookie)
        assert.containSubset(enCola.data, [
            { id: nota.id, documento: 'nota_credito', dte: null, estado: 'vigente' },
        ])
        await cola(e)
        const [ncre] = await dtesDe('nota_credito', nota.id)
        assert.equal(ncre!.estado, 'certificado')
        const notas = await leer(client, '/portal/notas-credito', cookie)
        assert.containSubset(notas.data, [
            {
                id: nota.id,
                documento: 'ncre',
                numero: `${ncre!.serie}-${ncre!.numero}`,
                factura_id: f.id,
                factura_numero: `${dteFactura!.serie}-${dteFactura!.numero}`,
                monto: '50.00',
                motivo: 'descuento comercial',
                estado: 'vigente',
                dte: { tipo_dte: 'NCRE', estado: 'certificado', autorizacion: ncre!.autorizacion },
                empresa: { id: e.B },
            },
        ])
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            acreditado: '50.00',
            saldo: '100.00',
            estado: 'parcial',
        })
        const xml = await estado(get(client, `/portal/notas-credito/${nota.id}/xml`, cookie), 200)
        assert.include(xml.text(), 'ReferenciasNota')

        // NCRE rechazada por la SAT y la nota anulada: el monto vuelve al saldo
        const rechazada = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '20.00', motivo: 'cargo duplicado' },
            e.ctx,
        )
        controlFelFalso.siguiente.push('rechazado')
        await cola(e)
        await new AnularNotaCredito().execute({ nota_id: rechazada.id, motivo: 'La SAT la rechazó' }, e.ctx)
        const despues = await leer(client, '/portal/notas-credito', cookie)
        assert.containSubset(despues.data, [
            { id: rechazada.id, documento: 'nota_credito', estado: 'anulada', dte: null },
        ])
        await estado(get(client, `/portal/notas-credito/${rechazada.id}/xml`, cookie), 404)
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            acreditado: '50.00',
            saldo: '100.00',
        })
    })

    test('sustituida y sustituta enlazadas cuando la nueva es visible; anulada (con y sin DTE) como tal', async ({
        client,
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const clienteId = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', clienteId)
        const f = s.facturas[0]!
        await cola(e)
        const { cookie } = await sesionDirecta(clienteId)

        const r = await new SustituirFactura().execute({ factura_id: f.id, motivo: 'NIT equivocado' }, e.ctx)
        assert.equal(r.tipo, 'nota_credito')
        // la nueva aún por_certificar: la original dice sustituida, sin enlace
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            estado: 'pagada',
            sustituida: true,
            sustituida_por: null,
            documento: 'factura',
        })
        assert.isUndefined(await facturaDelPortal(client, cookie, r.nueva.id))

        await cola(e)
        const [dteNueva] = await dtesDe('factura', r.nueva.id)
        const [dteOriginal] = await dtesDe('factura', f.id)
        assert.containSubset(await facturaDelPortal(client, cookie, f.id), {
            sustituida: true,
            sustituida_por: { id: r.nueva.id, numero: `${dteNueva!.serie}-${dteNueva!.numero}` },
        })
        assert.containSubset(await facturaDelPortal(client, cookie, r.nueva.id), {
            documento: 'factura',
            sustituida: false,
            sustituye_a: { id: f.id, numero: `${dteOriginal!.serie}-${dteOriginal!.numero}` },
        })

        // anular una factura certificada: en trámite sigue vigente; anulada conserva su DTE
        const otra = await servicioFel(e, 'emitir', '150.00', clienteId)
        const g = otra.facturas[0]!
        await cola(e)
        await new AnularFactura().execute({ factura_id: g.id, motivo: 'error de plan' }, e.ctx)
        assert.containSubset(await facturaDelPortal(client, cookie, g.id), {
            estado: 'emitida',
            documento: 'factura',
            dte: { estado: 'anulacion_pendiente' },
        })
        await cola(e)
        assert.containSubset(await facturaDelPortal(client, cookie, g.id), {
            estado: 'anulada',
            documento: 'factura',
            saldo: '0.00',
            dte: { estado: 'anulado' },
        })
        const pdf = await estado(get(client, `/portal/facturas/${g.id}/pdf`, cookie), 200)
        assert.include(textoDePdf(Buffer.from(pdf.body() as Buffer)), 'Documento anulado ante la SAT')

        // sin FEL: la sustitución anula la original (aviso de cobro anulado, sin DTE)
        await configurarModo(e, e.C, 'desactivada')
        const sinFel = await servicioFel(e, 'pagar', '150.00', clienteId, e.C)
        const r2 = await new SustituirFactura().execute(
            { factura_id: sinFel.facturas[0]!.id, motivo: 'plan mal asignado' },
            e.ctx,
        )
        assert.equal(r2.tipo, 'anulacion')
        assert.containSubset(await facturaDelPortal(client, cookie, sinFel.facturas[0]!.id), {
            estado: 'anulada',
            documento: 'aviso_cobro',
            dte: null,
            sustituida: true,
            sustituida_por: { id: r2.nueva.id, numero: String(r2.nueva.id) },
            empresa: { id: e.C },
        })
    })
})
