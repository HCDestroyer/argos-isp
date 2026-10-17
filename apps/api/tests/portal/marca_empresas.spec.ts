import { readFileSync } from 'node:fs'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import { textoDePdf } from '#tests/portal/ayudas_pdf'
import { crearServicio, crearSesion, sesionDirecta } from '#tests/portal/ayudas_portal'
import { guardarArchivoLogo, nuevaRutaLogo, prepararLogo } from '#core/logos'
import { avisoCobroPdf } from '#portal/documentos/render'

/**
 * Multiempresa en el portal (`contratos/multiempresa.md` § Marca): un cliente con un servicio en
 * cada empresa ve dos marcas con la sesión, `/corte` por IP muestra la de ese servicio, los datos
 * de pago y el logo son de la empresa pedida y el aviso de cobro sale con los datos fiscales de la
 * empresa de la factura.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

const PNG = readFileSync(new URL('../../../portal/public/iconos/icono-192.png', import.meta.url))
const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>'

async function ponerLogo(empresaId: number, contenido: Uint8Array): Promise<string> {
    const logo = prepararLogo(contenido)
    const ruta = nuevaRutaLogo(empresaId, logo.tipo)
    await guardarArchivoLogo(ruta, logo.contenido)
    await db
        .from('core.empresas')
        .where('id', empresaId)
        .update({ logo: ruta, logo_tipo: logo.tipo, logo_etag: logo.etag })
    return logo.etag
}

/** Cuerpo de una respuesta 200. */
async function leer(peticion: Parameters<typeof estado>[0]) {
    const respuesta = await estado(peticion, 200)
    return respuesta.body()
}

interface Marca {
    id: number
    nombre_comercial: string
    logo_url: string | null
    nit: string | null
    direccion_fiscal: string | null
    telefono: string | null
    whatsapp: string | null
}

test.group('Portal: marca de la empresa de cada servicio', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-marca')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return async () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
            await soloEmpresaPrincipal()
        }
    })

    /**
     * Norte (con logo PNG, dos servicios: es la principal) y Sur (logo SVG, un servicio suspendido
     * con deuda). La IP .31 es de Sur; la .30, de Norte.
     */
    async function escenario() {
        const norte = await crearEmpresaFila({
            nombre_comercial: unico('Cable Norte'),
            direccion_fiscal: '4a calle 1-10 zona 1, Huehuetenango',
            telefono: '7764-1000',
            whatsapp: '5000-1000',
        })
        const sur = await crearEmpresaFila({
            nombre_comercial: unico('Fibra Sur'),
            razon_social: 'Fibra del Sur, Sociedad Anónima',
            direccion_fiscal: '2a avenida 3-20 zona 2, Escuintla',
            telefono: '7888-2000',
            whatsapp: '5000-2000',
        })
        const etagNorte = await ponerLogo(norte, PNG)
        await ponerLogo(sur, Buffer.from(SVG))

        const n1 = await crearServicio({ estado: 'activo', empresaId: norte, sinFacturas: true })
        const n2 = await crearServicio({
            estado: 'activo',
            empresaId: norte,
            clienteId: n1.clienteId,
            sinFacturas: true,
        })
        const s1 = await crearServicio({ estado: 'suspendido', empresaId: sur, clienteId: n1.clienteId })
        await crearSesion(n1, { ipv4: '198.51.108.30' })
        await crearSesion(s1, { ipv4: '198.51.108.31', delegado: '2001:db8:5b1::/56' })
        return { norte, sur, etagNorte, n1, n2, s1, clienteId: n1.clienteId }
    }

    test('/corte por IPv4 e IPv6: la marca es la de la empresa del servicio de esa IP', async ({
        client,
        assert,
    }) => {
        const e = await escenario()
        const sur = await db.from('core.empresas').where('id', e.sur).firstOrFail()

        for (const ip of ['198.51.108.31', '2001:db8:5b1:4::9']) {
            const quien = await leer(client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', ip))
            assert.equal(quien.estado, 'suspendido', ip)
            assert.containsSubset(quien.empresa, {
                id: e.sur,
                nombre_comercial: sur.nombre_comercial,
                nit: sur.nit,
                direccion_fiscal: '2a avenida 3-20 zona 2, Escuintla',
                telefono: '7888-2000',
                whatsapp: '5000-2000',
            })
            assert.match(quien.empresa.logo_url, new RegExp(`^/api/v1/portal/empresas/${e.sur}/logo\\?v=`))

            // Datos de pago y contacto de /corte: de la misma empresa, sin parámetros.
            const empresa = await leer(client.get('/api/v1/portal/empresa').header('X-Forwarded-For', ip))
            assert.equal(empresa.id, e.sur)
            assert.equal(empresa.nombre, sur.nombre_comercial)
            assert.equal(empresa.whatsapp, '5000-2000')
        }

        const norte = await leer(
            client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', '198.51.108.30'),
        )
        assert.equal(norte.empresa.id, e.norte)
        assert.notEqual(norte.empresa.nombre_comercial, sur.nombre_comercial)
    })

    test('con la sesión: cada servicio y cada factura con su empresa; la principal es Norte', async ({
        client,
        assert,
    }) => {
        const e = await escenario()
        const { cookie } = await sesionDirecta(e.clienteId)

        const cuenta = await leer(client.get('/api/v1/portal/cuenta').header('Cookie', cookie))
        const porServicio = Object.fromEntries(
            cuenta.servicios.map((s: { id: number; empresa: Marca }) => [s.id, s.empresa.id]),
        )
        assert.deepEqual(porServicio, {
            [e.n1.servicioId]: e.norte,
            [e.n2.servicioId]: e.norte,
            [e.s1.servicioId]: e.sur,
        })
        const marcas = new Set(cuenta.servicios.map((s: { empresa: Marca }) => s.empresa.nombre_comercial))
        assert.equal(marcas.size, 2)
        assert.equal(cuenta.empresa_principal.id, e.norte)
        assert.equal(
            cuenta.empresa_principal.logo_url,
            `/api/v1/portal/empresas/${e.norte}/logo?v=${e.etagNorte.slice(0, 16)}`,
        )

        const facturas = await leer(client.get('/api/v1/portal/facturas').header('Cookie', cookie))
        assert.isAbove(facturas.data.length, 0)
        for (const factura of facturas.data as Array<{ servicio_id: number; empresa: Marca }>) {
            assert.equal(factura.servicio_id, e.s1.servicioId)
            assert.equal(factura.empresa.id, e.sur)
        }
        const detalle = await leer(
            client.get(`/api/v1/portal/facturas/${facturas.data[0].id}`).header('Cookie', cookie),
        )
        assert.equal(detalle.empresa.id, e.sur)

        // Encabezado y manifiesto: la principal del cliente; una sección por empresa con `empresa_id`.
        const principal = await leer(client.get('/api/v1/portal/empresa?de=cliente').header('Cookie', cookie))
        assert.equal(principal.id, e.norte)
        const deSur = await leer(
            client.get(`/api/v1/portal/empresa?empresa_id=${e.sur}`).header('Cookie', cookie),
        )
        assert.equal(deSur.id, e.sur)
        assert.equal(deSur.direccion, '2a avenida 3-20 zona 2, Escuintla')
    })

    test('GET /portal/empresa: sin sesión `de=cliente` es 401; una empresa que no existe, 404', async ({
        client,
    }) => {
        await escenario()
        await estado(client.get('/api/v1/portal/empresa?de=cliente'), 401)
        await estado(client.get('/api/v1/portal/empresa?empresa_id=999999'), 404)
        // Sin IP identificada ni sesión: la principal de la instalación.
        const principal = await estado(
            client.get('/api/v1/portal/empresa').header('X-Forwarded-For', '198.51.108.99'),
            200,
        )
        principal.assertBodyContains({ id: 1 })
    })

    test('cuentas de depósito: nunca las de otra empresa', async ({ client, assert }) => {
        const e = await escenario()
        const cuenta = await cuentaBancariaPrueba()
        const ids = async (url: string) => {
            const empresa = await leer(client.get(url))
            return (empresa.cuentas_deposito as Array<{ id: number }>).map((c) => c.id)
        }
        const deSur = await cuentaBancariaPrueba('Banrural', e.sur)
        // Cada cuenta es de su empresa (`billing.cuentas_bancarias.empresa_id`): nunca se cruzan.
        assert.include(await ids('/api/v1/portal/empresa?empresa_id=1'), cuenta.id)
        assert.notInclude(await ids('/api/v1/portal/empresa?empresa_id=1'), deSur.id)
        assert.deepEqual(await ids(`/api/v1/portal/empresa?empresa_id=${e.norte}`), [])
        assert.deepEqual(await ids(`/api/v1/portal/empresa?empresa_id=${e.sur}`), [deSur.id])
    })

    test('logo por el portal: PNG con ETag, 304 con If-None-Match y 404 sin logo', async ({
        client,
        assert,
    }) => {
        const e = await escenario()
        const respuesta = await estado(client.get(`/api/v1/portal/empresas/${e.norte}/logo`), 200)
        assert.equal(respuesta.header('content-type'), 'image/png')
        assert.equal(respuesta.header('etag'), `"${e.etagNorte}"`)
        assert.include(respuesta.header('cache-control'), 'public')
        await estado(
            client.get(`/api/v1/portal/empresas/${e.norte}/logo`).header('If-None-Match', `"${e.etagNorte}"`),
            304,
        )
        const svg = await estado(client.get(`/api/v1/portal/empresas/${e.sur}/logo`), 200)
        assert.equal(svg.header('content-type'), 'image/svg+xml')
        assert.include(svg.header('content-security-policy'), 'sandbox')
        const sinLogo = await crearEmpresaFila()
        await estado(client.get(`/api/v1/portal/empresas/${sinLogo}/logo`), 404)
        await estado(client.get('/api/v1/portal/empresas/999999/logo'), 404)
    })

    test('aviso de cobro: logo, razón social, NIT y dirección fiscal de la empresa de la factura', async ({
        assert,
    }) => {
        const e = await escenario()
        const sur = await db.from('core.empresas').where('id', e.sur).firstOrFail()
        const factura = await db
            .from('billing.facturas')
            .where('servicio_id', e.s1.servicioId)
            .orderBy('id')
            .firstOrFail()

        const { pdf } = await avisoCobroPdf(Number(factura.id), { comprimir: false })
        const texto = textoDePdf(pdf)
        for (const esperado of [
            sur.nombre_comercial,
            'Fibra del Sur, Sociedad Anónima',
            `NIT ${sur.nit}`,
            '2a avenida 3-20 zona 2, Escuintla',
        ]) {
            assert.include(texto, esperado)
        }
        assert.notInclude(texto, 'Huehuetenango')
        // El SVG de Sur se dibuja como vectores: el color de marca (#0f766e) en el PDF.
        assert.match(pdf.toString('latin1'), /0\.05882\d* 0\.46274\d* 0\.43137\d* scn/)

        // Norte (PNG): una imagen en el PDF.
        const deNorte = await crearServicio({ estado: 'activo', empresaId: e.norte, clienteId: e.clienteId })
        const facturaNorte = await db
            .from('billing.facturas')
            .where('servicio_id', deNorte.servicioId)
            .firstOrFail()
        const { pdf: pdfNorte } = await avisoCobroPdf(Number(facturaNorte.id), { comprimir: false })
        assert.include(pdfNorte.toString('latin1'), '/Subtype /Image')
        assert.include(textoDePdf(pdfNorte), 'Huehuetenango')
    })
})
