import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import PDFDocument from 'pdfkit'
import { randomInt } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { nitUnico } from '#tests/ledger/ayudas_compras'
import { afirmarCuadre, bodegaEn, productoEn, saldoInventario } from '#tests/inventario/ayudas_inventario'
import { pngFirma } from '#tests/inventario/ayudas_fase_d'
import { hoyGuatemala } from '#ledger/fechas'
import { parsearFel } from '#inventario/facturas_compra/fel_xml'
import { textoDePdf } from '#inventario/facturas_compra/pdf_texto'
import {
    ErrorIa,
    interpretarRespuesta,
    registrarExtractorDePrueba,
    type ExtractorFactura,
} from '#inventario/facturas_compra/ia'
import type { ExtraccionCompra } from '#inventario/facturas_compra/extraccion'

/**
 * Fase D, pedido 5 (`contratos/inventario.md` D.5): factura de compra desde un archivo. Parser FEL
 * determinístico con un XML de ejemplo, IA con un proveedor falso (nunca una API real), coincidencia de
 * productos y proveedor, duplicados, y la compra que nace solo al confirmar, con su asiento y su kardex.
 */

const PLANTILLA = readFileSync(new URL('./fixtures/fel_fact.xml', import.meta.url), 'utf8')

function xmlFel(datos: {
    nit: string
    receptor: string
    serie: string
    numero: string
    desc1?: string
    cantidad2?: string
}) {
    return Buffer.from(
        PLANTILLA.replaceAll('{{NIT}}', datos.nit)
            .replaceAll('{{RECEPTOR}}', datos.receptor)
            .replaceAll('{{SERIE}}', datos.serie)
            .replaceAll('{{NUMERO}}', datos.numero)
            .replaceAll('{{FECHA}}', hoyGuatemala())
            .replaceAll('{{DESC1}}', datos.desc1 ?? 'CABLE UTP Cat 6 (exterior)')
            .replaceAll('{{CANT2}}', datos.cantidad2 ?? '50'),
    )
}

function documento() {
    return {
        serie: `A${randomInt(1_000_000, 9_999_999)}`,
        numero: String(randomInt(100_000_000, 999_999_999)),
    }
}

class ExtractorFalso implements ExtractorFactura {
    readonly proveedor = 'falso'
    readonly modelo = 'falso-1'
    llamadas = 0

    constructor(
        private readonly respuesta: () => Promise<{
            datos: ExtraccionCompra
            confianza: Record<string, number>
        }>,
    ) {}

    async extraer() {
        this.llamadas++
        return this.respuesta()
    }
}

async function empresaNit(empresaId: number) {
    const fila = await db.from('core.empresas').where('id', empresaId).select('nit').firstOrFail()
    return String(fila.nit)
}

test.group('Inventario · factura de compra desde un archivo (fase D)', (group) => {
    group.each.teardown(async () => {
        registrarExtractorDePrueba(null)
        await soloEmpresaPrincipal()
    })

    test('parser FEL: emisor, receptor, número y serie, fecha, líneas con descuento e IVA, y totales', ({
        assert,
    }) => {
        const datos = parsearFel(
            xmlFel({ nit: '1234567-8', receptor: 'CF', serie: 'ABCD1234', numero: '987654321' }),
        )
        assert.deepEqual(datos.emisor, {
            nit: '12345678',
            nombre: 'DISTRIBUIDORA DE REDES, SOCIEDAD ANONIMA',
        })
        assert.deepEqual(datos.receptor, { nit: 'CF', nombre: 'ISP DE PRUEBA, S.A.' })
        assert.equal(datos.tipo_documento, 'FACT')
        assert.equal(datos.serie, 'ABCD1234')
        assert.equal(datos.numero, '987654321')
        assert.equal(datos.autorizacion, 'ABCD1234-1A2B-4C3D-9E8F-0123456789AB')
        assert.equal(datos.fecha, hoyGuatemala())
        assert.equal(datos.moneda, 'GTQ')
        assert.lengthOf(datos.lineas, 3)
        assert.deepEqual(datos.lineas[1], {
            codigo: null,
            descripcion: 'Conector RJ45 blindado',
            cantidad: '50',
            unidad: 'UND',
            precio_unitario: '1.20',
            descuento: '4.00',
            total: '56.00',
            iva: '6.00',
            bien_o_servicio: 'B',
        })
        assert.equal(datos.lineas[2]!.bien_o_servicio, 'S')
        assert.deepEqual(datos.totales, { total: '392.00', iva: '42.00' })
        try {
            parsearFel(Buffer.from('<?xml version="1.0"?><factura/>'))
            assert.fail('debía rechazar un XML que no es un DTE')
        } catch (error) {
            assert.equal((error as { errores?: Array<{ rule: string }> }).errores?.[0]?.rule, 'xml_no_fel')
        }
    })

    test('XML: borrador con propuesta, nunca la compra; confirmar crea la compra, su asiento y su kardex; duplicados', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const cable = await productoEn(e.B, e.ctx, { nombre: 'Cable UTP cat 6 exterior', unidad: 'metro' })
        const bodega = await bodegaEn(e.B, e.ctx)
        const nit = await nitUnico()
        const doc = documento()
        const xml = xmlFel({ nit, receptor: await empresaNit(e.B), ...doc })
        const comprasAntes = await db.from('ledger.compras').where('empresa_id', e.B).count('* as n').first()

        const cargado = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', xml, { filename: 'factura.xml' }),
            201,
        )
        const b = cargado.body()
        assert.equal(b.fuente, 'xml_fel')
        assert.equal(b.estado, 'borrador')
        assert.isNull(b.error_extraccion)
        assert.equal(b.datos.numero, doc.numero)
        assert.deepEqual(b.propuesta.proveedor, {
            id: null,
            nit: nit.toUpperCase(),
            nombre: 'DISTRIBUIDORA DE REDES, SOCIEDAD ANONIMA',
            crear: true,
        })
        assert.equal(b.propuesta.lineas[0].coincidencia, 'nombre')
        assert.equal(b.propuesta.lineas[0].producto_id, cable.id)
        assert.isNull(b.propuesta.lineas[1].coincidencia)
        assert.equal(b.propuesta.lineas[1].crear.nombre, 'Conector RJ45 blindado')
        assert.isTrue(b.propuesta.lineas[2].gasto)
        const comprasDespues = await db
            .from('ledger.compras')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(comprasDespues.n), Number(comprasAntes.n), 'cargar nunca crea la compra')

        // el mismo archivo otra vez
        const repetido = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', xml, { filename: 'otra-vez.xml' }),
            409,
        )
        assert.equal(repetido.body().type, 'urn:argosisp:problema:archivo_duplicado')
        // la misma factura en otro archivo (otro formato)
        const otroArchivo = Buffer.concat([xml, Buffer.from('\n')])
        const mismaFactura = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', otroArchivo, { filename: 'copia.xml' }),
            409,
        )
        assert.equal(mismaFactura.body().type, 'urn:argosisp:problema:borrador_duplicado')

        // confirmar: un producto existente, uno nuevo y el flete a gasto
        const sku = unico('RJ45')
        const confirmado = await estado(
            client
                .post(`/api/v1/compras/borradores/${b.id}/confirmar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    version: b.version,
                    proveedor: { crear: { nombre: 'Distribuidora de Redes' } },
                    condicion: 'credito',
                    lineas: [
                        { indice: 0, producto: { id: cable.id }, bodega_id: bodega.id },
                        {
                            indice: 1,
                            producto: { crear: { sku, nombre: 'Conector RJ45 blindado', tipo: 'material' } },
                            bodega_id: bodega.id,
                        },
                    ],
                }),
            200,
        )
        const c = confirmado.body()
        assert.equal(c.estado, 'confirmado')
        assert.isNumber(c.compra_id)
        const compra = await db.from('ledger.compras').where('id', c.compra_id).firstOrFail()
        assert.equal(compra.numero, doc.numero)
        assert.equal(compra.total, '392.00')
        assert.deepEqual(await saldoInventario(cable.id, bodega.id), ['100.000', '200.00'])
        const conector = await db.from('inventario.productos').where({ empresa_id: e.B, sku }).firstOrFail()
        assert.deepEqual(await saldoInventario(conector.id, bodega.id), ['50.000', '50.00'])
        // otra vez: ya está confirmado
        await estado(
            client
                .post(`/api/v1/compras/borradores/${b.id}/confirmar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: c.version, proveedor: { id: 1 }, condicion: 'credito' }),
            409,
        )
        // la misma factura ya registrada como compra
        const yaRegistrada = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', Buffer.concat([xml, Buffer.from('\n\n')]), { filename: 'tercera.xml' }),
            409,
        )
        assert.include(
            ['urn:argosisp:problema:compra_duplicada', 'urn:argosisp:problema:borrador_duplicado'],
            yaRegistrada.body().type,
        )
        await afirmarCuadre(assert, e.B)
    })

    test('confirmar exige cantidad entera a inventario, el receptor de la empresa y no crea nada si falla', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const bodega = await bodegaEn(e.B, e.ctx)
        const cable = await productoEn(e.B, e.ctx)
        const xml = xmlFel({ nit: await nitUnico(), receptor: '99999999', ...documento(), cantidad2: '2.5' })
        const cargado = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', xml, { filename: 'f.xml' }),
            201,
        )
        const b = cargado.body()
        const confirmar = (extra: Record<string, unknown>) =>
            client
                .post(`/api/v1/compras/borradores/${b.id}/confirmar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    version: b.version,
                    proveedor: { crear: { nombre: 'Proveedor nuevo' } },
                    condicion: 'credito',
                    lineas: [
                        { indice: 0, producto: { id: cable.id }, bodega_id: bodega.id },
                        { indice: 1, producto: { id: cable.id }, bodega_id: bodega.id },
                    ],
                    ...extra,
                })
        const decimal = await estado(confirmar({ forzar_receptor: true }), 422)
        assert.equal(decimal.body().errors[0].rule, 'cantidad_entera')
        const receptor = await estado(confirmar({ lineas: [] }), 422)
        assert.equal(receptor.body().errors[0].rule, 'receptor_distinto')
        const proveedores = await db
            .from('ledger.proveedores')
            .where('empresa_id', e.B)
            .count('* as n')
            .first()
        assert.equal(Number(proveedores.n), 0, 'el proveedor no quedó creado')
        // forzando el receptor y con todo a gasto, sí
        const ok = await estado(confirmar({ lineas: [], forzar_receptor: true }), 200)
        assert.equal(ok.body().estado, 'confirmado')
        await afirmarCuadre(assert, e.B)
    })

    test('IA: sin configurar, captura a mano; configurada con un proveedor falso; la clave nunca sale; aprende el código', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const bodega = await bodegaEn(e.B, e.ctx)
        const router = await productoEn(e.B, e.ctx, { nombre: 'Router AX', unidad: 'unidad' })
        const nit = await nitUnico()
        const imagen = pngFirma(400, 300)

        // sin IA: el borrador queda vacío con el error visible
        const sinIa = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', imagen, { filename: 'factura.png' }),
            201,
        )
        assert.equal(sinIa.body().fuente, 'ia')
        assert.match(sinIa.body().error_extraccion, /^ia_no_configurada/)
        assert.deepEqual(sinIa.body().datos, {})
        await estado(
            client
                .post(`/api/v1/compras/borradores/${sinIa.body().id}/descartar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 1, motivo: 'Se cargará con IA' }),
            200,
        )

        // configurar: la privada exige URL; la clave se guarda cifrada y nunca sale
        await estado(
            client
                .post('/api/v1/inventario/ia/configuracion')
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ proveedor: 'privada', modelo: 'llava', activo: true, version: 0 }),
            422,
        )
        const clave = `sk-ant-${unico('secreto')}`
        const config = await estado(
            client.post('/api/v1/inventario/ia/configuracion').bearerToken(e.token).headers(cabecera).json({
                proveedor: 'anthropic',
                modelo: 'claude-opus-5-5',
                api_key: clave,
                activo: true,
                version: 0,
            }),
            200,
        )
        assert.equal(config.body().clave_configurada, true)
        assert.notProperty(config.body(), 'api_key')
        assert.notInclude(JSON.stringify(config.body()), clave)
        const leida = await estado(
            client.get('/api/v1/inventario/ia/configuracion').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.notInclude(JSON.stringify(leida.body()), clave)
        const fila = await db.from('inventario.ia_configuracion').where('empresa_id', e.B).firstOrFail()
        assert.match(fila.api_key_cifrada, /^v1\./)
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'inventario.configurar_ia', resultado: 'ok' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.notInclude(JSON.stringify(auditoria.entrada), clave)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'ia_configuracion', entidad_id: fila.id, campo: 'api_key' })
            .firstOrFail()
        assert.equal(cambio.despues, '***')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'inventario.ia_config_cambiada')
            .whereRaw(`payload->>'configuracion_id' = ?`, [String(fila.id)])
            .firstOrFail()
        assert.includeMembers(evento.payload.campos, ['proveedor', 'modelo', 'api_key'])
        assert.notInclude(JSON.stringify(evento.payload), clave)

        // un proveedor falso (CI nunca llama a una API real)
        const doc = documento()
        const extraccion = (numero: string): ExtraccionCompra => ({
            emisor: { nit, nombre: 'Equipos de Red' },
            receptor: { nit: null, nombre: null },
            tipo_documento: 'FACT',
            serie: doc.serie,
            numero,
            autorizacion: null,
            fecha: hoyGuatemala(),
            moneda: 'GTQ',
            lineas: [
                {
                    codigo: 'AX-3000',
                    descripcion: 'Router inalámbrico doble banda',
                    cantidad: '2',
                    unidad: 'UND',
                    precio_unitario: '560.00',
                    descuento: '0.00',
                    total: '1120.00',
                    iva: '120.00',
                    bien_o_servicio: 'B',
                },
            ],
            totales: { total: '1120.00', iva: '120.00' },
        })
        const falso = new ExtractorFalso(async () => ({
            datos: extraccion(doc.numero),
            confianza: { emisor: 0.98, numero: 0.91 },
        }))
        registrarExtractorDePrueba(falso)
        const conIa = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', pngFirma(401, 300), { filename: 'factura.png' }),
            201,
        )
        assert.equal(falso.llamadas, 1)
        const b = conIa.body()
        assert.isNull(b.error_extraccion)
        assert.equal(b.ia_proveedor, 'falso')
        assert.equal(b.confianza.emisor, 0.98)
        assert.isNull(b.propuesta.lineas[0].coincidencia, 'aún no se conoce el código')
        const confirmado = await estado(
            client
                .post(`/api/v1/compras/borradores/${b.id}/confirmar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({
                    version: b.version,
                    proveedor: { crear: { nombre: 'Equipos de Red' } },
                    condicion: 'credito',
                    lineas: [{ indice: 0, producto: { id: router.id }, bodega_id: bodega.id }],
                }),
            200,
        )
        assert.deepEqual(await saldoInventario(router.id, bodega.id), ['2.000', '1000.00'])

        // la siguiente factura del mismo proveedor reconoce el código
        const doc2 = String(Number(doc.numero) + 1)
        registrarExtractorDePrueba(
            new ExtractorFalso(async () => ({ datos: extraccion(doc2), confianza: {} })),
        )
        const segunda = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', pngFirma(402, 300), { filename: 'factura2.png' }),
            201,
        )
        assert.equal(segunda.body().propuesta.lineas[0].coincidencia, 'codigo_proveedor')
        assert.equal(segunda.body().propuesta.lineas[0].producto_id, router.id)
        assert.equal(segunda.body().propuesta.proveedor.crear, false)
        assert.isNumber(confirmado.body().compra_id)

        // la IA falla: error visible y captura a mano (editar los datos)
        registrarExtractorDePrueba(
            new ExtractorFalso(async () => {
                throw new ErrorIa('ia_fallo', 'el proveedor respondió 529')
            }),
        )
        const fallo = await estado(
            client
                .post('/api/v1/compras/borradores')
                .bearerToken(e.token)
                .headers(cabecera)
                .file('archivo', pngFirma(403, 300), { filename: 'factura3.png' }),
            201,
        )
        assert.equal(fallo.body().error_extraccion, 'ia_fallo: el proveedor respondió 529')
        const editado = await estado(
            client
                .post(`/api/v1/compras/borradores/${fallo.body().id}/editar`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ version: 1, datos: extraccion(String(Number(doc.numero) + 2)) }),
            200,
        )
        assert.equal(editado.body().version, 2)
        assert.equal(editado.body().propuesta.lineas[0].coincidencia, 'codigo_proveedor')
        assert.isNull(editado.body().extraccion, 'la extracción original no cambia')
        await afirmarCuadre(assert, e.B)
    })

    test('respuesta de la IA: JSON en bloque de código, validado con el mismo esquema', async ({
        assert,
    }) => {
        const valido = {
            emisor: { nit: '12345678', nombre: 'X' },
            receptor: { nit: null, nombre: null },
            tipo_documento: 'fact',
            serie: null,
            numero: '1',
            autorizacion: null,
            fecha: '2026-10-30',
            moneda: 'gtq',
            lineas: [
                {
                    codigo: null,
                    descripcion: 'Cable',
                    cantidad: '1',
                    unidad: null,
                    precio_unitario: '1.12',
                    descuento: '0.00',
                    total: '1.12',
                    iva: '0.12',
                    bien_o_servicio: 'B',
                },
            ],
            totales: { total: '1.12', iva: '0.12' },
            confianza: { numero: 0.5 },
        }
        const r = await interpretarRespuesta(`\`\`\`json\n${JSON.stringify(valido)}\n\`\`\``)
        assert.equal(r.datos.tipo_documento, 'FACT')
        assert.equal(r.datos.moneda, 'GTQ')
        assert.deepEqual(r.confianza, { numero: 0.5 })
        await assert.rejects(() => interpretarRespuesta('no hay json aquí'), /respuesta_invalida/)
        await assert.rejects(
            () => interpretarRespuesta(JSON.stringify({ ...valido, fecha: '30/10/2026' })),
            /respuesta_invalida: fecha/,
        )
    })

    test('IA privada (compatible con OpenAI) contra un servidor local: manda el texto del PDF y lee el JSON', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const nit = await nitUnico()
        const numero = String(randomInt(100_000_000, 999_999_999))
        const pdf = await new Promise<Buffer>((resolve) => {
            const doc = new PDFDocument()
            const partes: Buffer[] = []
            doc.on('data', (p: Buffer) => partes.push(p))
            doc.on('end', () => resolve(Buffer.concat(partes)))
            doc.text(`Factura FACT numero ${numero} NIT ${nit}`)
            doc.text('Cable UTP 10 metros Q 22.40')
            doc.end()
        })
        assert.include(textoDePdf(pdf), `Factura FACT numero ${numero}`)

        const pedidos: Array<{ url: string; autorizacion: string | undefined; cuerpo: any }> = []
        const servidor = createServer((req, res) => {
            let datos = ''
            req.on('data', (c) => (datos += c))
            req.on('end', () => {
                pedidos.push({
                    url: req.url ?? '',
                    autorizacion: req.headers.authorization,
                    cuerpo: JSON.parse(datos),
                })
                const factura = {
                    emisor: { nit, nombre: 'Proveedor local' },
                    receptor: { nit: null, nombre: null },
                    tipo_documento: 'FACT',
                    serie: null,
                    numero,
                    autorizacion: null,
                    fecha: hoyGuatemala(),
                    moneda: 'GTQ',
                    lineas: [
                        {
                            codigo: null,
                            descripcion: 'Cable UTP',
                            cantidad: '10',
                            unidad: 'MTS',
                            precio_unitario: '2.24',
                            descuento: '0.00',
                            total: '22.40',
                            iva: '2.40',
                            bien_o_servicio: 'B',
                        },
                    ],
                    totales: { total: '22.40', iva: '2.40' },
                    confianza: { numero: 0.8 },
                }
                res.setHeader('content-type', 'application/json')
                res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(factura) } }] }))
            })
        })
        await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
        try {
            const puerto = (servidor.address() as AddressInfo).port
            await estado(
                client
                    .post('/api/v1/inventario/ia/configuracion')
                    .bearerToken(e.token)
                    .headers(cabecera)
                    .json({
                        proveedor: 'privada',
                        modelo: 'qwen2.5-vl',
                        url_base: `http://127.0.0.1:${puerto}/v1`,
                        api_key: 'clave-local',
                        activo: true,
                        version: 0,
                    }),
                200,
            )
            const cargado = await estado(
                client
                    .post('/api/v1/compras/borradores')
                    .bearerToken(e.token)
                    .headers(cabecera)
                    .file('archivo', pdf, { filename: 'factura.pdf' }),
                201,
            )
            assert.isNull(cargado.body().error_extraccion)
            assert.equal(cargado.body().ia_proveedor, 'privada')
            assert.equal(cargado.body().datos.numero, numero)
            assert.lengthOf(pedidos, 1)
            assert.equal(pedidos[0]!.url, '/v1/chat/completions')
            assert.equal(pedidos[0]!.autorizacion, 'Bearer clave-local')
            assert.equal(pedidos[0]!.cuerpo.model, 'qwen2.5-vl')
            assert.include(pedidos[0]!.cuerpo.messages[1].content, `Factura FACT numero ${numero}`)
        } finally {
            servidor.close()
        }
    })
})
