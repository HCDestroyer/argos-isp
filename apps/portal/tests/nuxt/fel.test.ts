import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarFallaFixture, fijarSesionFixture, limpiarFallasFixture } from '~~/fixtures'
import { FACTURAS_FIXTURE, NOTAS_CREDITO_FIXTURE } from '~~/fixtures/cuenta'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * FEL en el portal (contrato `localizacion-fiscal.md` §14, fila de A5): facturas con su DTE,
 * «Factura» solo con el DTE certificado, PDF y XML, sustituidas y anuladas como tales y las NCRE
 * del estado de cuenta.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

async function montarFacturas() {
    clearNuxtData('portal:cuenta')
    const wrapper = await mountSuspended(PaginaCuenta, { route: '/cuenta?seccion=facturas' })
    await flushPromises()
    await flushPromises()
    return wrapper
}

function tarjeta(wrapper: Awaited<ReturnType<typeof montarFacturas>>, texto: string) {
    const encontrada = wrapper.findAll('[data-testid="factura"]').find(t => t.text().includes(texto))
    expect(encontrada, texto).toBeDefined()
    return encontrada!
}

afterEach(() => {
    fijarSesionFixture(false)
    limpiarFallasFixture()
    navegar.mockReset()
})

describe('FEL en /cuenta?seccion=facturas', () => {
    it('un aviso sin DTE sigue siendo aviso de cobro, sin XML ni autorización', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarFacturas()
        const aviso = tarjeta(wrapper, 'Aviso de cobro 1203')
        expect(aviso.find('[data-testid="dte"]').exists()).toBe(false)
        expect(aviso.find('[data-testid="descargar-xml"]').exists()).toBe(false)
        expect(aviso.find('[data-testid="descargar-pdf"]').text()).toContain('Ver aviso de cobro (PDF)')
    })

    it('con el DTE certificado es «Factura» con serie-número, autorización, PDF y XML', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarFacturas()
        const certificada = FACTURAS_FIXTURE.find(f => f.id === 1040)!
        const fel = tarjeta(wrapper, `Factura ${certificada.numero}`)
        expect(fel.find('[data-testid="dte"]').text()).toContain(certificada.dte!.autorizacion)
        expect(fel.find('[data-testid="dte"]').text()).toContain('certificada el')
        expect(fel.find('[data-testid="descargar-pdf"]').text()).toContain('Ver factura (PDF)')
        expect(fel.find('[data-testid="descargar-pdf"]').attributes('href')).toBe('/api/v1/portal/facturas/1040/pdf')
        const xml = fel.find('[data-testid="descargar-xml"]')
        expect(xml.attributes('href')).toBe('/api/v1/portal/facturas/1040/xml')
        expect(xml.attributes('download')).toBeDefined()
    })

    it('la sustituida dice «Sustituida» y a cuál la reemplaza; la nueva, a cuál sustituye', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarFacturas()
        const original = FACTURAS_FIXTURE.find(f => f.id === 1020)!
        const nueva = FACTURAS_FIXTURE.find(f => f.id === 1021)!
        const sustituida = tarjeta(wrapper, `Factura ${original.numero}`)
        expect(sustituida.find('[data-testid="estado-factura"]').text()).toBe('Sustituida')
        expect(sustituida.find('[data-testid="sustituida"]').text()).toContain(`Reemplazada por la factura ${nueva.numero}`)
        expect(sustituida.find('[data-testid="acreditado"]').text()).toContain('Q 175.00')
        const sustituta = tarjeta(wrapper, `Factura ${nueva.numero}`)
        expect(sustituta.find('[data-testid="estado-factura"]').text()).toBe('Pagada')
        expect(sustituta.find('[data-testid="sustituye"]').text()).toContain(`Reemplaza a la factura ${original.numero}`)
    })

    it('las notas de crédito del estado de cuenta: NCRE con su XML y la anulada como tal', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarFacturas()
        const notas = wrapper.findAll('[data-testid="nota-credito"]')
        expect(notas).toHaveLength(NOTAS_CREDITO_FIXTURE.length)
        const ncre = notas.find(n => n.text().includes('Nota de crédito (NCRE)'))!
        expect(ncre.text()).toContain('Aplicada')
        expect(ncre.text()).toContain('−Q 175.00')
        expect(ncre.find('[data-testid="descargar-xml"]').attributes('href')).toBe('/api/v1/portal/notas-credito/298/xml')
        expect(ncre.find('[data-testid="descargar-pdf"]').attributes('href')).toBe('/api/v1/portal/notas-credito/298/pdf')
        const anulada = notas.find(n => n.text().includes('Nota de crédito 312'))!
        expect(anulada.text()).toContain('Anulada')
        expect(anulada.text()).toContain('volvió al saldo')
        expect(anulada.find('[data-testid="descargar-xml"]').exists()).toBe(false)
        expect(anulada.find('[data-testid="descargar-pdf"]').attributes('href')).toBe('/api/v1/portal/notas-credito/312/pdf')
    })

    it('si las notas no se pueden leer: error con «Reintentar» y ningún monto', async () => {
        fijarSesionFixture(true)
        fijarFallaFixture('GET /api/v1/portal/notas-credito', 'sin_conexion')
        const wrapper = await montarFacturas()
        const seccion = wrapper.find('[data-testid="seccion-notas-credito"]')
        expect(seccion.text()).toContain('No pudimos cargar esta información')
        expect(seccion.text()).not.toMatch(/Q \d/)
        const reintentar = seccion.findAll('button').find(b => b.text().includes('Reintentar'))!
        fijarFallaFixture('GET /api/v1/portal/notas-credito', null)
        await reintentar.trigger('click')
        await flushPromises()
        expect(wrapper.findAll('[data-testid="nota-credito"]')).toHaveLength(NOTAS_CREDITO_FIXTURE.length)
    })
})
