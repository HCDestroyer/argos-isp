import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    API_CAIDA_FIXTURE,
    fijarFallaFixture,
    fijarPuntosFixture,
    fijarSesionFixture,
    limpiarFallasFixture,
} from '~~/fixtures'
import { PREMIOS_FIXTURE, PUNTOS_FIXTURE } from '~~/fixtures/puntos'
import PaginaCuenta from '~/pages/cuenta.vue'
import Layout from '~/layouts/default.vue'
import PuntosSaldo from '~/components/puntos/Saldo.vue'

/**
 * Puntos de lealtad en el portal (contrato `lealtad.md` §12): solo con el programa visible, saldo,
 * vencimientos, premios con «Canjear» apagado y el porqué, confirmación del canje e historial.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montarPuntos(ruta = '/cuenta?seccion=puntos') {
    clearNuxtData(clave => clave === 'portal:cuenta' || clave === 'portal:puntos' || clave === 'portal:premios')
    useSesionPortal().confirmar()
    const wrapper = await mountSuspended(PaginaCuenta, { route: ruta })
    await esperar()
    return wrapper
}

function tarjeta(wrapper: Awaited<ReturnType<typeof montarPuntos>>, id: number) {
    return wrapper.find(`[data-testid="premio-${id}"]`)
}

afterEach(() => {
    fijarSesionFixture(false)
    fijarPuntosFixture(null)
    limpiarFallasFixture()
    navegar.mockReset()
    useSesionPortal().cerrar()
})

describe('textos de puntos', () => {
    it('puntos con miles, premios y movimientos en palabras del cliente', () => {
        expect(formatearPuntos(1250)).toBe('1,250')
        expect(puntosEnTexto(1)).toBe('1 punto')
        expect(puntosEnTexto(-80)).toBe('-80 puntos')
        expect(descripcionPremio(PREMIOS_FIXTURE[0]!)).toBe('Q 25.00 de descuento en tu próxima factura')
        expect(descripcionPremio(PREMIOS_FIXTURE[1]!)).toBe('Mejora a Fibra 50 Mbps por 30 días')
        expect(descripcionPremio({ ...PREMIOS_FIXTURE[0]!, descuento_tipo: 'porcentaje', descuento_valor: '10.00', tope: '50.00' }))
            .toBe('10 % de descuento en tu próxima factura (hasta Q 50.00)')
        expect(textoNoCanjeable({ ...PREMIOS_FIXTURE[2]!, motivo_no_canjeable: 'puntos_insuficientes', faltan: 160 })).toBe('Te faltan 160 puntos')
        expect(conceptoMovimiento({ tipo: 'acumulacion', origen_tipo: 'referido' })).toBe('Recomendaste a un amigo')
        expect(conceptoMovimiento({ tipo: 'vencimiento', origen_tipo: 'lote' })).toBe('Puntos vencidos')
        expect(avanceHacia({ costo_puntos: 300, faltan: 160 })).toBe(47)
        expect(avanceHacia({ costo_puntos: 300, faltan: 0 })).toBe(100)
    })
})

describe('programa no activado en el portal', () => {
    it('sin pestaña «Puntos», sin atajo en el inicio y la sección lo explica', async () => {
        fijarSesionFixture(true)
        useSesionPortal().confirmar()
        const layout = await mountSuspended(Layout, { route: '/cuenta' })
        await esperar()
        const barra = layout.find('[data-testid="navegacion-inferior"]')
        expect(barra.findAll('a').map(a => a.text())).toEqual(['Inicio', 'Pagar', 'Facturas', 'Cuenta'])

        const inicio = await montarPuntos('/cuenta')
        expect(inicio.find('[data-testid="resumen-puntos"]').exists()).toBe(false)
        const seccion = await montarPuntos()
        expect(seccion.find('[data-testid="puntos-no-disponible"]').exists()).toBe(true)
        expect(seccion.find('[data-testid="puntos-saldo"]').exists()).toBe(false)
    })
})

describe('programa visible', () => {
    it('pestaña «Puntos» y atajo con el saldo en el inicio', async () => {
        fijarSesionFixture(true)
        fijarPuntosFixture('visible')
        useSesionPortal().confirmar()
        clearNuxtData('portal:puntos')
        const layout = await mountSuspended(Layout, { route: '/cuenta?seccion=puntos' })
        await esperar()
        const barra = layout.find('[data-testid="navegacion-inferior"]')
        expect(barra.findAll('a').map(a => a.text())).toEqual(['Inicio', 'Pagar', 'Facturas', 'Puntos', 'Cuenta'])
        expect(barra.find('ul').classes()).toContain('grid-cols-5')
        expect(barra.find('[data-testid="nav-puntos"]').attributes('aria-current')).toBe('page')

        const inicio = await montarPuntos('/cuenta')
        const resumen = inicio.find('[data-testid="resumen-puntos"]')
        expect(resumen.text()).toContain('140 puntos')
        expect(resumen.text()).toContain('90 puntos vencen pronto')
        expect(resumen.attributes('href')).toBe('/cuenta?seccion=puntos')
    })

    it('saldo, lo que vence fecha por fecha, historial y premios con «Canjear» apagado y el porqué', async () => {
        fijarSesionFixture(true)
        fijarPuntosFixture('visible')
        const wrapper = await montarPuntos()
        expect(wrapper.find('[data-testid="saldo-puntos"]').text()).toBe('Tienes 140 puntos')
        const vencen = wrapper.find('[data-testid="puntos-por-vencer"]')
        expect(vencen.text()).toContain('90 puntos vencen pronto')
        expect(vencen.text()).toContain('40 puntos el')
        expect(vencen.text()).toContain('50 puntos el')

        const movimientos = wrapper.findAll('[data-testid="movimiento-puntos"]')
        expect(movimientos).toHaveLength(PUNTOS_FIXTURE.movimientos.length)
        expect(movimientos[0]!.text()).toContain('Pago a tiempo')
        expect(movimientos[0]!.text()).toContain('+10')
        expect(movimientos[1]!.text()).toContain('-60')

        // canje apagado en el panel: todos los botones apagados con el mismo porqué
        for (const premio of PREMIOS_FIXTURE) {
            const t = tarjeta(wrapper, premio.id)
            expect(t.find('[data-testid="canjear"]').attributes('disabled')).toBeDefined()
            expect(t.find('[data-testid="por-que-no"]').text()).toBe('El canje en línea aún no está activo')
        }
        expect(wrapper.find('[data-testid="terminos-puntos"]').text()).toContain('Términos de Puntos Altiplano')
        expect(wrapper.findAll('table')).toHaveLength(0)
    })

    it('con canje: confirma, descuenta el saldo y lo muestra en «Mis canjes»', async () => {
        fijarSesionFixture(true)
        fijarPuntosFixture('canje')
        const wrapper = await montarPuntos()

        const caro = tarjeta(wrapper, 503)
        expect(caro.find('[data-testid="canjear"]').attributes('disabled')).toBeDefined()
        expect(caro.find('[data-testid="por-que-no"]').text()).toBe('Te faltan 160 puntos')
        expect(caro.find('[role="progressbar"]').exists()).toBe(true)
        expect(tarjeta(wrapper, 504).find('[data-testid="por-que-no"]').text()).toBe('Canjéalo en nuestras oficinas')

        const descuento = tarjeta(wrapper, 501).find('[data-testid="canjear"]')
        expect(descuento.attributes('disabled')).toBeUndefined()
        await descuento.trigger('click')
        await esperar()
        expect(document.querySelector('[data-testid="quedaran"]')?.textContent).toContain('80 puntos')
        document.querySelector<HTMLElement>('[data-testid="confirmar-canje"]')!.click()
        await esperar()

        const hecho = document.querySelector('[data-testid="canje-hecho"]')
        expect(hecho?.textContent).toContain('Q 25 de descuento')
        expect(hecho?.textContent).toContain('Se aplicará en tu próxima factura')
        expect(wrapper.find('[data-testid="saldo-puntos"]').text()).toBe('Tienes 80 puntos')
        const canjes = wrapper.findAll('[data-testid="canje"]')
        expect(canjes[0]!.text()).toContain('Q 25 de descuento')
        expect(canjes[0]!.text()).toContain('En tu próxima factura')
        // con 80 puntos el de 120 ya no alcanza
        expect(tarjeta(wrapper, 502).find('[data-testid="por-que-no"]').text()).toBe('Te faltan 40 puntos')
    })

    it('si los puntos no se pueden leer: error con «Reintentar» y ningún saldo', async () => {
        fijarSesionFixture(true)
        fijarPuntosFixture('visible')
        fijarFallaFixture('GET /api/v1/portal/puntos', API_CAIDA_FIXTURE)
        const wrapper = await montarPuntos()
        const error = wrapper.find('[data-testid="puntos-error"]')
        expect(error.text()).toContain('No pudimos cargar tus puntos')
        expect(error.text()).toContain('Reintentar')
        expect(wrapper.find('[data-testid="puntos-saldo"]').exists()).toBe(false)
        expect(wrapper.text()).not.toMatch(/\b0 puntos/)
    })

    it('con movimiento reducido el saldo aparece sin animar', async () => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({
            matches: true,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        } as unknown as MediaQueryList)
        const saldo = await mountSuspended(PuntosSaldo, { props: { puntos: PUNTOS_FIXTURE } })
        await flushPromises()
        expect(saldo.find('[data-testid="saldo-animado"]').text()).toBe('140')
        expect(saldo.find('[data-testid="saldo-animado"]').attributes('aria-hidden')).toBe('true')
        vi.restoreAllMocks()
    })
})
