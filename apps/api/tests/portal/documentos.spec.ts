import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import {
    EnviadorFalso,
    cookieDeSesion,
    crearServicio,
    nitAleatorio,
    usarEnviadorCodigo,
} from '#tests/portal/ayudas_portal'
import { textoDePdf } from '#tests/portal/ayudas_pdf'
import { htmlAPdf } from '#portal/documentos/html_a_pdf'
import { PLANTILLA_AVISO_COBRO } from '#portal/documentos/plantilla_base'
import { renderizarHtml } from '#portal/documentos/render'
import { vistaDeEjemplo } from '#portal/documentos/variables'

/**
 * PDF del aviso de cobro (tarea 8) contra Postgres real. Con `PDF_SALIDA=/ruta` las pruebas dejan
 * ahí los PDF generados para revisarlos a mano (fuera del repo).
 */

let enviador: EnviadorFalso
let ipSecuencia = 0

function guardar(nombre: string, pdf: Buffer) {
    if (process.env.PDF_SALIDA) writeFileSync(`${process.env.PDF_SALIDA}/${nombre}.pdf`, pdf)
}

async function entrar(client: ApiClient, nit: string): Promise<string> {
    ipSecuencia += 1
    const ip = `198.18.0.${ipSecuencia}`
    const pedido = await client
        .post('/api/v1/portal/codigo')
        .header('X-Forwarded-For', ip)
        .json({ identificador: nit })
    const verificado = await client
        .post('/api/v1/portal/verificar')
        .header('X-Forwarded-For', ip)
        .json({ solicitud: pedido.body().solicitud, codigo: enviador.ultimoCodigo() })
    verificado.assertStatus(200)
    return cookieDeSesion(verificado)!
}

/** Factura vencida de julio del servicio de prueba, con una línea. */
async function facturaConLinea(clienteId: number): Promise<number> {
    const factura = (await db
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .where('periodo', '2026-07-01')
        .select('id')
        .firstOrFail()) as { id: number }
    await db.table('billing.facturas_lineas').insert({
        factura_id: factura.id,
        concepto: 'Internet Hogar 20 Mbps (julio)',
        tipo: 'servicio',
        cantidad: '1',
        precio_unitario: '133.93',
        gravable: true,
        iva: '16.07',
        total: '150.00',
    })
    return Number(factura.id)
}

test.group('Documentos: HTML a PDF', () => {
    test('genera un PDF con tildes, tablas y listas', async ({ assert }) => {
        const pdf = await htmlAPdf(
            `<h1>Aviso de cobro</h1><p>Señor <strong>Núñez</strong>: ¿pagará?</p>
             <table><thead><tr><th width="70%">Concepto</th><th class="derecha">Total</th></tr></thead>
             <tbody><tr><td>Internet</td><td class="derecha">Q 175.00</td></tr></tbody></table>
             <ul><li>Uno</li><li>Dos</li></ul><hr><p class="tenue centro"><small>pie</small></p>`,
            { comprimir: false },
        )
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
        const texto = textoDePdf(pdf)
        for (const esperado of [
            'Aviso de cobro',
            'Núñez',
            '¿pagará?',
            'Concepto',
            'Q 175.00',
            'Uno',
            'Dos',
            'pie',
        ]) {
            assert.include(texto, esperado)
        }
    })

    test('tabla larga pasa a otra página', async ({ assert }) => {
        const filas = Array.from(
            { length: 120 },
            (_, i) => `<tr><td>Fila ${i + 1}</td><td>Q 1.00</td></tr>`,
        ).join('')
        const pdf = await htmlAPdf(`<table>${filas}</table>`)
        const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
        assert.isAbove(paginas, 1)
    })

    test('la plantilla de fábrica renderiza con los datos de ejemplo y escapa el HTML de los datos', async ({
        assert,
    }) => {
        const vista = await vistaDeEjemplo()
        vista.cliente.nombre = 'Ana <b>Robles</b>'
        const html = renderizarHtml(PLANTILLA_AVISO_COBRO, vista)
        assert.include(html, 'Ana &lt;b&gt;Robles')
        assert.notInclude(html, '<b>Robles')
        assert.include(html, 'Internet Hogar 20 Mbps')
        const texto = textoDePdf(await htmlAPdf(html))
        assert.include(texto, 'Ana <b>Robles</b>')
        assert.include(texto, 'Saldo a pagar')
    })
})

test.group('Documentos: aviso de cobro del portal y del panel', (group) => {
    group.each.setup(() => {
        const previo = process.env.PORTAL_PROXIES_CONFIABLES
        const prefijo = process.env.PORTAL_REDIS_PREFIJO
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-docs')
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            if (previo === undefined) delete process.env.PORTAL_PROXIES_CONFIABLES
            else process.env.PORTAL_PROXIES_CONFIABLES = previo
            if (prefijo === undefined) delete process.env.PORTAL_REDIS_PREFIJO
            else process.env.PORTAL_REDIS_PREFIJO = prefijo
        }
    })

    test('el cliente descarga su aviso de cobro: datos, montos y fechas de Guatemala', async ({
        client,
        assert,
    }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit, nombre: 'José Ángel Núñez' })
        const facturaId = await facturaConLinea(s.clienteId)
        const cookie = await entrar(client, nit)

        const respuesta = await estado(
            client.get(`/api/v1/portal/facturas/${facturaId}/pdf`).header('Cookie', cookie),
            200,
        )
        assert.equal(respuesta.header('content-type'), 'application/pdf')
        assert.equal(
            respuesta.header('content-disposition'),
            `inline; filename="aviso-cobro-${facturaId}.pdf"`,
        )
        const pdf = Buffer.from(respuesta.body() as Buffer)
        guardar('aviso-cobro', pdf)
        const texto = textoDePdf(pdf)
        for (const esperado of [
            'Aviso de cobro',
            String(facturaId),
            'José Ángel Núñez',
            `NIT ${nit}`,
            'julio 2026',
            'Vence: 10/07/2026',
            'Internet Hogar 20 Mbps (julio)',
            'Q 150.00',
            'no es una factura electrónica',
        ]) {
            assert.include(texto, esperado)
        }
        // Fechas de factura siempre dd/mm/aaaa: emisión, vencimiento y generación, nunca ISO.
        assert.match(texto, /Emitido: \d{2}\/\d{2}\/\d{4}/)
        assert.match(texto, /Generado el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)
        assert.notMatch(texto, /\d{4}-\d{2}-\d{2}/)
        assert.notInclude(texto, 'Invalid')
    })

    test('factura ajena 404 y sin sesión 401', async ({ client }) => {
        const nit = nitAleatorio()
        await crearServicio({ nit })
        const ajeno = await crearServicio({ nit: nitAleatorio() })
        const facturaAjena = await facturaConLinea(ajeno.clienteId)
        const cookie = await entrar(client, nit)
        await estado(client.get(`/api/v1/portal/facturas/${facturaAjena}/pdf`).header('Cookie', cookie), 404)
        await estado(client.get(`/api/v1/portal/facturas/${facturaAjena}/pdf`), 401)
    })

    test('con FEL se llama factura y muestra serie, número y autorización', async ({ client, assert }) => {
        const nit = nitAleatorio()
        const s = await crearServicio({ nit })
        const facturaId = await facturaConLinea(s.clienteId)
        // FEL fase 3: los datos salen del DTE certificado (`fiscal.dte`), no de `billing.facturas.fel_*`
        const factura = await db.from('billing.facturas').where('id', facturaId).firstOrFail()
        await db.table('fiscal.dte').insert({
            empresa_id: factura.empresa_id,
            documento_tipo: 'factura',
            documento_id: facturaId,
            tipo_dte: 'FACT',
            estado: 'certificado',
            proveedor: 'falso',
            ambiente: 'pruebas',
            identificador: randomUUID(),
            autorizacion: `ABCD1234-5678-90EF-1234-${String(facturaId).padStart(12, '0')}`,
            serie: 'ABCD1234',
            numero: `1449${facturaId}`,
            certificado_en: new Date(),
            receptor: JSON.stringify({ tipo: 'nit', id: nit, nombre: 'Prueba' }),
            total: factura.total,
            iva: factura.iva,
        })
        const cookie = await entrar(client, nit)
        const respuesta = await estado(
            client.get(`/api/v1/portal/facturas/${facturaId}/pdf`).header('Cookie', cookie),
            200,
        )
        assert.equal(
            respuesta.header('content-disposition'),
            `inline; filename="factura-ABCD1234-1449${facturaId}.pdf"`,
        )
        const texto = textoDePdf(Buffer.from(respuesta.body() as Buffer))
        guardar('factura-fel', Buffer.from(respuesta.body() as Buffer))
        assert.include(texto, 'Factura')
        assert.include(texto, `ABCD1234-1449${facturaId}`)
        assert.include(texto, `Autorización ABCD1234-5678-90EF-1234-${String(facturaId).padStart(12, '0')}`)
        assert.notInclude(texto, 'no es una factura electrónica')
    })

    test('panel: con facturas.ver descarga el PDF; sin el permiso, 403', async ({ client, assert }) => {
        const s = await crearServicio({ nit: nitAleatorio() })
        const facturaId = await facturaConLinea(s.clienteId)
        const { token } = await usuarioConRoles(['cajero'])
        const ok = await estado(
            client.get(`/api/v1/documentos/aviso-cobro/${facturaId}`).bearerToken(token),
            200,
        )
        assert.equal(ok.header('content-type'), 'application/pdf')
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(
            client.get(`/api/v1/documentos/aviso-cobro/${facturaId}`).bearerToken(tecnico.token),
            403,
        )
    })
})

test.group('Documentos: plantilla editable', (group) => {
    group.each.teardown(async () => {
        await db.from('core.plantillas_documentos').where('tipo', 'aviso_cobro').delete()
    })

    test('lee la de fábrica con sus variables, guarda con diff y el PDF usa la nueva', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const leida = await estado(
            client.get('/api/v1/documentos/plantillas/aviso_cobro').bearerToken(token),
            200,
        )
        assert.equal(leida.body().version, 0)
        assert.equal(leida.body().html, PLANTILLA_AVISO_COBRO)
        const nombres = leida.body().variables.map((v: { nombre: string }) => v.nombre)
        for (const v of [
            'cliente.nombre',
            'factura.numero',
            'factura.total',
            'factura.vence',
            'factura.lineas',
            'empresa.nombre',
        ]) {
            assert.include(nombres, v)
        }

        const html =
            '<h1>{{empresa.nombre}}</h1><p>Hola {{cliente.nombre}}, debes {{factura.saldo}}.</p>{{factura.lineas}}'
        const guardada = await estado(
            client
                .put('/api/v1/documentos/plantillas/aviso_cobro')
                .bearerToken(token)
                .json({ html, version: 0 }),
            200,
        )
        assert.equal(guardada.body().version, 1)
        const cambio = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_documento')
            .where('campo', 'html')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(JSON.parse(JSON.stringify(cambio.despues)), html)
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'documentos.editar')
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        await estado(
            client
                .put('/api/v1/documentos/plantillas/aviso_cobro')
                .bearerToken(token)
                .json({ html, version: 0 }),
            409,
        )

        const s = await crearServicio({ nit: nitAleatorio(), nombre: 'Lucía Ramírez' })
        const facturaId = await facturaConLinea(s.clienteId)
        const pdf = await estado(
            client.get(`/api/v1/documentos/aviso-cobro/${facturaId}`).bearerToken(token),
            200,
        )
        assert.include(textoDePdf(Buffer.from(pdf.body() as Buffer)), 'Hola Lucía Ramírez, debes Q 150.00.')
    })

    test('rechaza Mustache inválido y triple bigote; la vista previa responde un PDF', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        for (const html of [
            '<p>{{#factura.fel}}sin cerrar</p>',
            '<p>{{{cliente.nombre}}}</p>',
            '<p>{{& cliente.nombre}}</p>',
        ]) {
            const r = await estado(
                client
                    .put('/api/v1/documentos/plantillas/aviso_cobro')
                    .bearerToken(token)
                    .json({ html, version: 0 }),
                422,
            )
            assert.equal(r.body().errors[0].field, 'html')
        }
        const previa = await estado(
            client
                .post('/api/v1/documentos/plantillas/aviso_cobro/vista-previa')
                .bearerToken(token)
                .json({ html: '<p>Prueba {{cliente.nombre}}</p>' }),
            200,
        )
        assert.equal(previa.header('content-type'), 'application/pdf')
        assert.include(textoDePdf(Buffer.from(previa.body() as Buffer)), 'Prueba María José García López')
        await estado(client.get('/api/v1/documentos/plantillas/otro').bearerToken(token), 404)
        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client
                .put('/api/v1/documentos/plantillas/aviso_cobro')
                .bearerToken(lectura.token)
                .json({ html: '<p>x</p>', version: 0 }),
            403,
        )
    })
})
