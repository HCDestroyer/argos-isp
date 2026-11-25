import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { verificadorNit } from '#core/nit_cui'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { dteParaEnviar, verDte } from '#fiscal/fel/dte'
import { ERROR_SANDBOX, ProveedorFelInfile } from '#fiscal/fel/infile'
import { xmlAnulacion, xmlDte } from '#fiscal/fel/xml_gt'
import type { DteParaEnviar } from '#fiscal/fel/proveedor'
import { sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import type { Empresas } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Adaptador de INFILE contra las respuestas de su documentación (`contratos/fel-establecimientos.md`
 * lote 5; documentación privada del PM, solo se copia la **forma** de las respuestas). Nunca hay red:
 * `fetch` se sustituye y cada respuesta se toma de una cola. Las credenciales son de mentira.
 */

const CRED = { usuario_api: 'u-api', llave_api: 'k-api', usuario_firma: 'u-firma', llave_firma: 'k-firma' }
const SANDBOX =
    'Este documento fue procesado en nuestro SandBox en modalidad de pruebas, por ningún motivo debe ser usado como comprobante fiscal.'
const UUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890'

/** `fiscal.dte.autorizacion` es única: cada respuesta certificada lleva su propio UUID. */
function uuidNuevo(): string {
    return randomUUID().toUpperCase()
}

interface Llamada {
    url: string
    cabeceras: Record<string, string>
    cuerpo: string
}

/** `fetch` falso: responde de la cola y guarda lo que se envió. */
const red = {
    respuestas: [] as Array<{ status: number; cuerpo: unknown } | 'caida'>,
    llamadas: [] as Llamada[],
    original: globalThis.fetch,
    instalar() {
        this.respuestas = []
        this.llamadas = []
        globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
            this.llamadas.push({
                url: String(url),
                cabeceras: Object.fromEntries(
                    Object.entries((init?.headers ?? {}) as Record<string, string>),
                ),
                cuerpo: String(init?.body ?? ''),
            })
            const r = this.respuestas.shift()
            if (!r || r === 'caida') throw Object.assign(new Error('conexión cortada'), { name: 'TypeError' })
            return new Response(typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo), {
                status: r.status,
            })
        }) as typeof fetch
    },
    quitar() {
        globalThis.fetch = this.original
    },
}

function certificado(extra: Record<string, unknown> = {}, uuid = uuidNuevo()) {
    return {
        status: 200,
        cuerpo: {
            resultado: true,
            fecha: '2026-11-25T10:30:05-06:00',
            descripcion: 'Documento certificado correctamente.',
            uuid,
            serie: uuid.slice(0, 8),
            numero: String(Number.parseInt(uuid.replace(/-/g, '').slice(8, 16), 16)),
            xml_certificado: Buffer.from('<dte:GTDocumento>certificado</dte:GTDocumento>').toString('base64'),
            saldo: '950',
            creditos: '1000',
            alertas_infile: false,
            alertas_sat: false,
            descripcion_alertas_infile: [],
            descripcion_alertas_sat: [],
            control_emision: { cupo_diario: 1000, saldo_diario: 950 },
            informacion_adicional: [],
            ...extra,
        },
    }
}

const RECHAZO_NIT = {
    status: 200,
    cuerpo: {
        resultado: false,
        fecha: '2026-11-25T10:30:05-06:00',
        descripcion: 'Documento rechazado. Se encontraron errores de validación.',
        uuid: null,
        serie: null,
        numero: null,
        xml_certificado: null,
        alertas_infile: false,
        alertas_sat: true,
        descripcion_alertas_sat: [
            {
                fuente: 'SAT',
                categoria: '2 - Datos del Emisor',
                numeral: '2.1',
                validacion: '2.1.3',
                mensaje_error: 'El NIT del emisor no se encuentra activo en el sistema SAT.',
            },
        ],
    },
}

function nitValidoNuevo(): string {
    const cuerpo = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

/** B con INFILE (opcional) en el ambiente dado y credenciales de mentira. */
async function conInfile(ambiente: 'pruebas' | 'produccion' = 'pruebas'): Promise<Empresas> {
    const e = await empresasFel('opcional')
    if (ambiente === 'produccion') {
        await db.from('core.empresas').where('id', e.B).update({ nit: nitValidoNuevo() })
    }
    const actual = await configuracionFel(e.B)
    await new ConfigurarFel().execute(
        { empresa_id: e.B, proveedor: 'infile', ambiente, modo: 'opcional', version: actual.version },
        e.ctx,
    )
    await new GuardarCredencialesFel().execute(
        { empresa_id: e.B, ambiente, proveedor: 'infile', secreto: CRED },
        e.ctx,
    )
    return e
}

/** Factura de B con su DTE pedido a mano (aún sin enviar). */
async function dtePedido(e: Empresas, clienteId?: number) {
    const s = await servicioFel(e, 'emitir', '120.00', clienteId ?? (await crearClienteFila(datosNit())))
    const facturaId = s.facturas[0]!.id
    await new SolicitarCertificacion().execute({ factura_id: facturaId }, e.ctx)
    return { facturaId, s }
}

test.group('INFILE · adaptador con fetch sustituido', (group) => {
    group.each.setup(async () => {
        // ningún DTE de otra suite en la cola: cada respuesta falsa es para el DTE de la prueba
        await sacarDeLaColaFel()
        red.instalar()
    })
    group.each.teardown(async () => {
        red.quitar()
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('certifica: autorización, serie y número; cabeceras con el nombre de la documentación', async ({
        assert,
    }) => {
        const e = await conInfile()
        const { facturaId } = await dtePedido(e)
        const uuid = uuidNuevo()
        red.respuestas.push(certificado({}, uuid))
        await cola(e)
        const [dte] = await dtesDe('factura', facturaId)
        // serie = primeros 8 hexadecimales del UUID; número = decimal de las posiciones 9-16
        assert.containSubset(dte, {
            estado: 'certificado',
            autorizacion: uuid,
            serie: uuid.slice(0, 8),
            numero: String(Number.parseInt(uuid.replace(/-/g, '').slice(8, 16), 16)),
        })
        const envio = red.llamadas[0]!
        assert.equal(envio.url, 'https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml')
        assert.includeMembers(Object.keys(envio.cabeceras), [
            'UsuarioAPI',
            'LlaveAPI',
            'UsuarioFirma',
            'LlaveFirma',
            'Identificador',
        ])
        assert.equal(envio.cabeceras.Identificador, dte!.identificador)
        // la bitácora no guarda credenciales
        const intentos = await db.from('fiscal.dte_intentos').where('dte_id', dte!.id)
        assert.notInclude(JSON.stringify(intentos), 'k-api')
        assert.notInclude(JSON.stringify(intentos), 'k-firma')
    })

    test('rechazo de la SAT: el motivo de descripcion_alertas_sat llega a ultimo_error', async ({
        assert,
    }) => {
        const e = await conInfile()
        const { facturaId } = await dtePedido(e)
        red.respuestas.push(RECHAZO_NIT)
        await cola(e)
        const [dte] = await dtesDe('factura', facturaId)
        assert.equal(dte!.estado, 'rechazado')
        assert.include(
            dte!.ultimo_error,
            'SAT · 2.1.3 · El NIT del emisor no se encuentra activo en el sistema SAT.',
        )
    })

    test('sandbox: en pruebas certifica y lo marca; en producción no se da por certificado', async ({
        assert,
    }) => {
        const conAlerta = certificado({
            alertas_infile: true,
            descripcion_alertas_infile: [{ fuente: 'INFILE', mensaje_error: SANDBOX }],
        })
        const pruebas = await conInfile('pruebas')
        const enPruebas = await dtePedido(pruebas)
        red.respuestas.push(conAlerta)
        await cola(pruebas)
        const [dteP] = await dtesDe('factura', enPruebas.facturaId)
        assert.equal(dteP!.estado, 'certificado')
        const intento = await db
            .from('fiscal.dte_intentos')
            .where({ dte_id: dteP!.id, operacion: 'certificar' })
            .orderBy('id', 'desc')
            .first()
        assert.isTrue(intento.respuesta.sandbox)
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()

        const prod = await conInfile('produccion')
        const enProd = await dtePedido(prod)
        red.respuestas.push(conAlerta)
        await cola(prod)
        const [dteProd] = await dtesDe('factura', enProd.facturaId)
        assert.equal(dteProd!.estado, 'rechazado')
        assert.equal(dteProd!.ultimo_error, ERROR_SANDBOX)
    })

    test('reintento: se reenvía con el mismo identificador y el resultado anterior da un solo DTE', async ({
        assert,
    }) => {
        const e = await conInfile()
        const { facturaId } = await dtePedido(e)
        red.respuestas.push('caida')
        await cola(e)
        const [primero] = await dtesDe('factura', facturaId)
        assert.equal(primero!.estado, 'error_temporal')
        await db.from('fiscal.dte').where('id', primero!.id).update({ proximo_intento: new Date() })
        const uuid = uuidNuevo()
        red.respuestas.push(
            certificado(
                {
                    alertas_infile: true,
                    descripcion_alertas_infile: [
                        'Documento enviado previamente.',
                        'Documento consultado en modalidad de re-intento.',
                    ],
                },
                uuid,
            ),
        )
        await cola(e)
        const dtes = await dtesDe('factura', facturaId)
        assert.lengthOf(dtes, 1)
        assert.containSubset(dtes[0], { estado: 'certificado', autorizacion: uuid })
        // dos envíos al mismo servicio con el mismo identificador; ninguna consulta aparte
        assert.deepEqual(
            red.llamadas.map((l) => [l.url.split('/').slice(-3).join('/'), l.cabeceras.Identificador]),
            [
                ['transaccion/v2/xml', primero!.identificador],
                ['transaccion/v2/xml', primero!.identificador],
            ],
        )
    })

    test('consultarNit: razón social, no encontrado (null) y error de red (lanza)', async ({ assert }) => {
        const infile = new ProveedorFelInfile()
        red.respuestas.push({
            status: 200,
            cuerpo: { resultado: true, razon_social: 'CLIENTE EJEMPLO, S.A.' },
        })
        assert.deepEqual(await infile.consultarNit('76365204', CRED), { nombre: 'CLIENTE EJEMPLO, S.A.' })
        assert.deepEqual(JSON.parse(red.llamadas[0]!.cuerpo), {
            emisor_codigo: 'u-api',
            emisor_clave: 'k-api',
            nit_consulta: '76365204',
        })
        red.respuestas.push({
            status: 200,
            cuerpo: {
                resultado: false,
                razon_social: null,
                descripcion: 'NIT no encontrado en base de datos.',
            },
        })
        assert.isNull(await infile.consultarNit('1234567', CRED))
        red.respuestas.push({ status: 500, cuerpo: 'error' })
        let lanzo = false
        await infile.consultarNit('76365204', CRED).catch(() => {
            lanzo = true
        })
        assert.isTrue(lanzo)
    })

    test('probarCredenciales consulta el NIT de la empresa y nombra la razón social; 401 no es ok', async ({
        assert,
    }) => {
        const infile = new ProveedorFelInfile()
        red.respuestas.push({
            status: 200,
            cuerpo: { resultado: true, razon_social: 'DEMO COMERCIAL, S.A.' },
        })
        const ok = await infile.probarCredenciales(CRED, 'pruebas', { nit_emisor: '1170142K' })
        assert.isTrue(ok.ok)
        assert.include(ok.detalle, 'DEMO COMERCIAL, S.A.')
        assert.equal(JSON.parse(red.llamadas[0]!.cuerpo).nit_consulta, '1170142K')
        red.respuestas.push({ status: 401, cuerpo: { mensaje: 'no autorizado' } })
        const rechazada = await infile.probarCredenciales(CRED, 'pruebas', { nit_emisor: '1170142K' })
        assert.isFalse(rechazada.ok)
        // HTTP 200 sin forma de consulta: no se da por buena
        red.respuestas.push({ status: 200, cuerpo: '<html>login</html>' })
        const sinForma = await infile.probarCredenciales(CRED, 'pruebas', { nit_emisor: '1170142K' })
        assert.isFalse(sinForma.ok)
    })

    test('anular: proceso unificado; un documento ya anulado no es error', async ({ assert }) => {
        const infile = new ProveedorFelInfile()
        const certificadoDte = {
            identificador: 'b2d6b5e2-0000-4000-8000-000000000001',
            autorizacion: UUID,
            serie: 'A1B2C3D4',
            numero: '3858238710',
            fecha_emision: '2026-11-25T10:30:00-06:00',
            emisor_nit: '1170142K',
            receptor_id: '76365204',
        }
        red.respuestas.push({ status: 200, cuerpo: { resultado: true, fecha: '2026-11-25T12:00:00-06:00' } })
        const anulado = await infile.anular(certificadoDte, 'Error en datos del receptor', CRED)
        assert.equal(anulado.resultado, 'anulado')
        assert.equal(
            red.llamadas[0]!.url,
            'https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml',
        )
        assert.include(red.llamadas[0]!.cuerpo, 'GTAnulacionDocumento')
        assert.include(red.llamadas[0]!.cuerpo, UUID)

        red.respuestas.push({
            status: 200,
            cuerpo: {
                resultado: false,
                descripcion: 'El documento ya se encuentra anulado [2026-11-25T12:00:00-06:00]',
            },
        })
        const otraVez = await infile.anular(certificadoDte, 'Otra vez', CRED)
        assert.equal(otraVez.resultado, 'anulado')
    })
})

test.group('INFILE · XML según los ejemplos de la documentación', (group) => {
    group.each.teardown(async () => {
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    function base(): DteParaEnviar {
        return {
            identificador: '0b0c7d8e-1111-4222-8333-444455556666',
            tipo: 'FACT',
            fecha_emision: '2026-11-25T10:30:00-06:00',
            moneda: 'GTQ',
            emisor: {
                nit: '1170142K',
                nombre: 'DEMO COMERCIAL, S.A.',
                nombre_comercial: 'DEMO',
                establecimiento: 1,
                direccion: 'CIUDAD',
                municipio: 'GUATEMALA',
                departamento: 'GUATEMALA',
                codigo_postal: '01001',
                correo: null,
                afiliacion_iva: 'GEN',
            },
            receptor: { tipo: 'nit', id: '76365204', nombre: 'CLIENTE', direccion: null, correo: null },
            frases: [{ tipo: 1, escenario: 1 }],
            lineas: [
                {
                    numero: 1,
                    bien_o_servicio: 'S',
                    descripcion: 'Internet',
                    cantidad: '1',
                    unidad: 'UND',
                    precio_unitario: '120.00',
                    precio: '120.00',
                    descuento: '0.00',
                    gravable: '107.14',
                    iva: '12.86',
                    total: '120.00',
                },
            ],
            total: '120.00',
            iva: '12.86',
            referencia: null,
            contingencia: false,
        }
    }

    test('emisor con nodos separados, UND, CUI con TipoEspecial, CF y contingencia con NumeroAcceso', async ({
        assert,
    }) => {
        const xml = xmlDte(base())
        assert.include(xml, 'CodigoEstablecimiento="1"')
        assert.include(xml, 'NombreComercial="DEMO"')
        for (const nodo of ['Direccion', 'CodigoPostal', 'Municipio', 'Departamento']) {
            assert.match(xml, new RegExp(`<dte:DireccionEmisor>.*<dte:${nodo}>`))
        }
        assert.include(xml, '<dte:UnidadMedida>UND</dte:UnidadMedida>')
        const cui = xmlDte({ ...base(), receptor: { ...base().receptor, tipo: 'cui', id: '2984561320101' } })
        assert.include(cui, 'TipoEspecial="CUI"')
        const cf = xmlDte({ ...base(), receptor: { ...base().receptor, tipo: 'cf', id: 'CF' } })
        assert.include(cf, 'IDReceptor="CF"')
        const contingencia = xmlDte({ ...base(), contingencia: true })
        const acceso = Number(/NumeroAcceso="(\d+)"/.exec(contingencia)?.[1])
        assert.isAtLeast(acceso, 100_000_000)
        assert.isAtMost(acceso, 999_999_999)
    })

    test('anulación: los datos del documento y la fecha de emisión que se envió', async ({ assert }) => {
        const xml = xmlAnulacion(
            {
                identificador: 'x',
                autorizacion: UUID,
                serie: null,
                numero: null,
                fecha_emision: '2026-11-25T10:30:00-06:00',
                emisor_nit: '1170142K',
                receptor_id: '76365204',
            },
            'Error en datos del receptor',
            new Date('2026-11-25T18:00:00Z'),
        )
        for (const dato of [
            UUID,
            '1170142K',
            '76365204',
            '2026-11-25T10:30:00-06:00',
            '2026-11-25T12:00:00-06:00',
        ]) {
            assert.include(xml, dato)
        }
    })

    test('NCRE de un cliente que cambió de NIT después de la factura: IDReceptor = el de la factura', async ({
        assert,
    }) => {
        const e = await empresasFel('opcional')
        const clienteId = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', clienteId)
        const facturaId = s.facturas[0]!.id
        await new SolicitarCertificacion().execute({ factura_id: facturaId }, e.ctx)
        await cola(e)
        const [dteFactura] = await dtesDe('factura', facturaId)
        assert.equal(dteFactura!.estado, 'certificado')
        await db.from('core.clientes').where('id', clienteId).update({ nit_cui: '16693949' })
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: facturaId, monto: '10.00', motivo: 'descuento' },
            e.ctx,
        )
        const [dteNota] = await dtesDe('nota_credito', nota.id)
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dteNota!.id)))
        assert.equal(envio.receptor.id, dteFactura!.receptor.id)
        assert.include(xmlDte(envio), `IDReceptor="${dteFactura!.receptor.id}"`)
    })
})
