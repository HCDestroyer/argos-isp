import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarCuentaFixture, fijarEmpresaFixture, fijarSesionFixture } from '~~/fixtures'
import { EMPRESA_FIXTURE, MARCA_FIXTURE, MARCA_SUR_FIXTURE } from '~~/fixtures/empresa'
import { CUENTA_DOS_EMPRESAS_FIXTURE, CUENTA_FIXTURE } from '~~/fixtures/cuenta'
import { empresaDelManifiesto } from '~~/server/utils/manifiesto'
import PaginaCuenta from '~/pages/cuenta.vue'
import PaginaContacto from '~/pages/contacto.vue'
import Layout from '~/layouts/default.vue'
import DatosDeposito from '~/components/corte/DatosDeposito.vue'
import MarcaEmpresa from '~/components/portal/MarcaEmpresa.vue'

/**
 * Multiempresa (`contratos/multiempresa.md` § Marca): el portal muestra la marca de la empresa de
 * cada servicio; con varias, una sección por empresa, y los accesos de pago, depósito y soporte
 * de cada sección usan los datos de SU empresa, nunca mezclados.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

const montados: { unmount: () => void }[] = []

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montar(componente: Parameters<typeof mountSuspended>[0], opciones: Record<string, unknown> = {}) {
    clearNuxtData('portal:cuenta')
    clearNuxtData('portal:quien-soy')
    clearNuxtData(clave => clave.startsWith('portal:empresa'))
    const wrapper = await mountSuspended(componente, opciones as Parameters<typeof mountSuspended>[1])
    montados.push(wrapper)
    await esperar()
    return wrapper
}

afterEach(() => {
    for (const wrapper of montados.splice(0)) {
        wrapper.unmount()
    }
    fijarSesionFixture(false)
    fijarCuentaFixture(null)
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    navegar.mockReset()
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
})

describe('agruparPorEmpresa con la empresa real de cada servicio', () => {
    it('con el estado de cuenta: el saldo de cada empresa sale de su sección', () => {
        const secciones = CUENTA_DOS_EMPRESAS_FIXTURE.empresas
        const grupos = agruparPorEmpresa(CUENTA_DOS_EMPRESAS_FIXTURE.servicios, MARCA_FIXTURE.id, [
            secciones[0]!,
            { ...secciones[1]!, saldo: '420.50' },
        ])
        expect(grupos.map(g => g.montoAdeudado)).toEqual(['175.00', '420.50'])
        expect(grupos[1]!.cuenta?.facturas_pendientes.map(f => f.id)).toEqual([2201, 2250])

        // Una empresa con deuda y sin servicios vigentes también tiene su sección
        const sinServicios = agruparPorEmpresa([CUENTA_DOS_EMPRESAS_FIXTURE.servicios[0]!], MARCA_FIXTURE.id, secciones)
        expect(sinServicios.map(g => [g.empresa.id, g.servicios.length, g.montoAdeudado])).toEqual([[1, 1, '175.00'], [2, 0, '398.00']])
    })

    it('resumenFacturas: pendientes y vencidas en palabras', () => {
        const [norte, sur] = CUENTA_DOS_EMPRESAS_FIXTURE.empresas
        expect(resumenFacturas(null)).toBeNull()
        expect(resumenFacturas({ ...norte!, facturas_pendientes: [] })).toBeNull()
        expect(resumenFacturas(norte!)).toBe('1 factura pendiente')
        expect(resumenFacturas(sur!)).toBe('2 facturas pendientes, todas vencidas')
        expect(resumenFacturas(CUENTA_FIXTURE.empresas[0]!)).toBe('4 facturas pendientes, todas vencidas')
        const mezcla = { ...sur!, facturas_pendientes: [...sur!.facturas_pendientes, ...norte!.facturas_pendientes] }
        expect(resumenFacturas(mezcla)).toBe('3 facturas pendientes, 2 vencidas')
        expect(resumenFacturas({ ...sur!, facturas_pendientes: [sur!.facturas_pendientes[0]!] })).toBe('1 factura pendiente, vencida')
    })

    it('un grupo por empresa, con su saldo; la principal primero', () => {
        const grupos = agruparPorEmpresa(CUENTA_DOS_EMPRESAS_FIXTURE.servicios, MARCA_SUR_FIXTURE.id)
        expect(grupos.map(g => g.empresa.nombre_comercial)).toEqual(['Fibra Sur', 'Red Altiplano'])
        expect(grupos.map(g => g.montoAdeudado)).toEqual(['398.00', '175.00'])
        expect(grupos[0]!.servicios.map(s => s.id)).toEqual([57])

        const enOrden = agruparPorEmpresa(CUENTA_DOS_EMPRESAS_FIXTURE.servicios, null)
        expect(enOrden.map(g => g.clave)).toEqual(['empresa-1', 'empresa-2'])
    })

    it('servicios de la misma empresa en un solo grupo aunque no vengan juntos', () => {
        const [a, b] = CUENTA_DOS_EMPRESAS_FIXTURE.servicios
        const grupos = agruparPorEmpresa([a!, b!, { ...a!, id: 99, monto_adeudado: '0.50' }], 1)
        expect(grupos).toHaveLength(2)
        expect(grupos[0]!.servicios.map(s => s.id)).toEqual([41, 99])
        expect(grupos[0]!.montoAdeudado).toBe('175.50')
        expect(grupoDeServicio(grupos, 57)?.empresa.id).toBe(2)
        expect(grupoDeServicio(grupos, 1234)).toBeNull()
    })

    it('manifiesto: la URL lleva la empresa principal; el servidor solo acepta un id', () => {
        expect(urlManifiesto(2)).toBe('/manifest.webmanifest?empresa=2')
        expect(urlManifiesto(null)).toBe('/manifest.webmanifest')
        expect(empresaDelManifiesto('7')).toBe(7)
        for (const malo of ['0', '-1', 'abc', '1.5', '', undefined, '99999999999999999999']) {
            expect(empresaDelManifiesto(malo), String(malo)).toBeNull()
        }
        expect(empresaDelManifiesto(['3', '4'])).toBe(3)
    })

    it('soporte de una empresa sin teléfono: su página de contacto', () => {
        expect(soporteDe({ telefono: null, telefono_alterno: null, whatsapp: null, correo: null }, rutaContactoEmpresa(2)).to)
            .toBe('/contacto?empresa=2')
        expect(rutaContactoEmpresa(null)).toBe('/contacto')
    })
})

describe('/cuenta con una sola empresa', () => {
    it('sin secciones de marca: la marca va en el encabezado', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_FIXTURE)
        const wrapper = await montar(PaginaCuenta, { route: '/cuenta' })
        expect(wrapper.findAll('[data-testid="marca-grupo"]')).toHaveLength(0)

        const layout = await montar(Layout, { route: '/cuenta' })
        expect(layout.find('[data-testid="marca-encabezado"]').text()).toBe('Red Altiplano')
    })
})

describe('/cuenta con servicios en dos empresas', () => {
    async function montarCuenta() {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_DOS_EMPRESAS_FIXTURE)
        return montar(PaginaCuenta, { route: '/cuenta' })
    }

    it('una sección por empresa con su marca, su NIT y sus servicios', async () => {
        const wrapper = await montarCuenta()
        const secciones = wrapper.findAll('[data-testid^="grupo-empresa-"]')
        expect(secciones.map(s => s.attributes('data-testid'))).toEqual(['grupo-empresa-1', 'grupo-empresa-2'])
        expect(secciones[0]!.find('[data-testid="marca-grupo"]').text()).toBe('Red Altiplano')
        expect(secciones[1]!.find('[data-testid="marca-grupo"]').text()).toBe('Fibra Sur')
        expect(secciones[1]!.text()).toContain('NIT 7654321-0')
        expect(secciones[1]!.text()).toContain('Fibra 50 Mbps')
        expect(secciones[1]!.text()).not.toContain('Hogar 20 Mbps')
        // Sin logo: las iniciales de la empresa, nunca el logo de otra.
        expect(secciones[1]!.find('[data-testid="marca-empresa"]').text()).toBe('FS')
    })

    it('cada sección con el saldo y las facturas pendientes de SU empresa (estado de cuenta)', async () => {
        const wrapper = await montarCuenta()
        const saldo = (grupo: number) => wrapper.find(`[data-testid="grupo-empresa-${grupo}"] [data-testid="saldo-grupo"]`).text()
        const facturas = (grupo: number) => wrapper.find(`[data-testid="grupo-empresa-${grupo}"] [data-testid="facturas-grupo"]`).text()
        expect(saldo(1)).toContain('175.00')
        expect(saldo(2)).toContain('398.00')
        expect(facturas(1)).toBe('1 factura pendiente')
        expect(facturas(2)).toContain('2 facturas pendientes, todas vencidas')
        expect(facturas(2)).toContain('Saldo a favor Q')
        expect(facturas(1)).not.toContain('Saldo a favor')
    })

    it('Telegram: una tarjeta por empresa con su bot', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_DOS_EMPRESAS_FIXTURE)
        const wrapper = await montar(PaginaCuenta, { route: '/cuenta?seccion=cuenta' })
        expect(wrapper.find('[data-testid="telegram"]').exists()).toBe(false)
        const tarjetas = wrapper.findAll('[data-testid^="telegram-empresa-"]')
        expect(tarjetas.map(t => t.attributes('data-testid'))).toEqual(['telegram-empresa-1', 'telegram-empresa-2'])
        expect(tarjetas[1]!.text()).toContain('Telegram de Fibra Sur')
        expect(tarjetas[1]!.text()).toContain('@FibraSurBot')
    })

    it('el soporte de cada sección es el de su empresa', async () => {
        const wrapper = await montarCuenta()
        const soporte = (grupo: number) => wrapper
            .find(`[data-testid="grupo-empresa-${grupo}"] [data-testid="acceso-soporte"]`)
        expect(soporte(1).attributes('href')).toBe('tel:77654321')
        expect(soporte(2).attributes('href')).toBe('tel:78882000')
        expect(soporte(2).text()).toContain('7888-2000')
    })

    it('"Ver datos de depósito" de Fibra Sur muestra solo sus cuentas', async () => {
        const wrapper = await montarCuenta()
        await wrapper.find('[data-testid="grupo-empresa-2"] [data-testid="acceso-deposito"]').trigger('click')
        await esperar()
        const cuentas = [...document.querySelectorAll('[data-testid="cuenta-deposito"]')].map(c => c.textContent ?? '')
        expect(cuentas).toHaveLength(1)
        expect(cuentas[0]).toContain('900-111222-3')
        expect(document.body.textContent).toContain('Datos para depósito · Fibra Sur')
        expect(document.body.textContent).not.toContain('123-456789-0')
    })

    it('"Pagar en línea" de una empresa elige su servicio y la sección Pagar dice a quién', async () => {
        const wrapper = await montarCuenta()
        await wrapper.find('[data-testid="grupo-empresa-2"] [data-testid="acceso-pagar"]').trigger('click')
        expect(navegar).toHaveBeenCalledWith('/cuenta?seccion=pagar')

        const pagar = await montar(PaginaCuenta, { route: '/cuenta?seccion=pagar' })
        expect(pagar.find('[data-testid="servicio-a-pagar"]').exists()).toBe(true)
        expect(pagar.find('[data-testid="deposito-pagar"]').text()).toMatch(/Datos de depósito de (Red Altiplano|Fibra Sur)/)
    })

    it('título y manifiesto con la empresa principal del cliente', async () => {
        await montarCuenta()
        await esperar()
        expect(document.title).toContain('Mi cuenta · Red Altiplano')
        const manifiesto = document.head.querySelector('link[rel="manifest"]')
        expect(manifiesto?.getAttribute('href')).toBe(`/manifest.webmanifest?empresa=${MARCA_FIXTURE.id}`)
    })
})

describe('depósito y contacto de una empresa concreta', () => {
    it('DatosDeposito con empresaId: las cuentas de esa empresa', async () => {
        await montar(DatosDeposito, { props: { open: true, empresaId: 2 } })
        const cuentas = document.querySelectorAll('[data-testid="cuenta-deposito"]')
        expect(cuentas).toHaveLength(1)
        expect(cuentas[0]!.textContent).toContain('Banco G&T Continental')
    })

    it('/contacto?empresa=2: marca, NIT y teléfonos de Fibra Sur', async () => {
        const wrapper = await montar(PaginaContacto, { route: '/contacto?empresa=2' })
        expect(wrapper.find('[data-testid="contacto-empresa"]').text()).toContain('Fibra Sur')
        expect(wrapper.find('[data-testid="contacto-empresa"]').text()).toContain('NIT 7654321-0')
        expect(wrapper.find('[data-testid="contacto-telefono"]').attributes('href')).toBe('tel:78882000')
    })
})

describe('logo de la empresa', () => {
    it('con logo: la imagen del mismo origen; si no carga, las iniciales', async () => {
        const wrapper = await mountSuspended(MarcaEmpresa, {
            props: { nombre: 'Cable Norte', logoUrl: '/api/v1/portal/empresas/3/logo?v=abc' },
        })
        const img = wrapper.find('img')
        expect(img.attributes('src')).toBe('/api/v1/portal/empresas/3/logo?v=abc')
        expect(img.attributes('alt')).toBe('')
        await img.trigger('error')
        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toBe('CN')
    })

    it('encabezado sin logo: el ojo de ArgosIsp', async () => {
        const wrapper = await mountSuspended(MarcaEmpresa, { props: { nombre: 'Red Altiplano', respaldo: 'argos' } })
        expect(wrapper.find('svg').exists()).toBe(true)
        expect(wrapper.text()).toBe('')
    })
})
