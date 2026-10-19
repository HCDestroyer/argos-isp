import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarCuentaFixture, fijarFallaFixture, fijarSesionFixture, limpiarFallasFixture } from '~~/fixtures'
import { BONIFICACIONES_FIXTURE, CUENTA_DOS_EMPRESAS_FIXTURE, FACTURAS_FIXTURE } from '~~/fixtures/cuenta'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * Bonificaciones (decisión del PM: nunca una factura de Q0): en las facturas y en el estado de cuenta
 * un periodo bonificado dice «Mes bonificado: <concepto>», sin monto a pagar ni documento.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

async function montar(ruta: string) {
    clearNuxtData('portal:cuenta')
    const wrapper = await mountSuspended(PaginaCuenta, { route: ruta })
    for (let i = 0; i < 6; i += 1) {
        await flushPromises()
    }
    return wrapper
}

afterEach(() => {
    fijarSesionFixture(false)
    fijarCuentaFixture(null)
    limpiarFallasFixture()
    navegar.mockReset()
})

describe('textos', () => {
    it('«Mes bonificado: <concepto>» y por qué no se paga, sin el motivo interno', () => {
        expect(textoBonificacion({ concepto: 'Servicio de internet Hogar 20 Mbps' })).toBe('Mes bonificado: Servicio de internet Hogar 20 Mbps')
        expect(origenBonificacion('canje')).toBe('Canje de puntos')
        expect(origenBonificacion('cargo_sin_costo')).toBe('Sin costo')
    })
})

describe('facturas', () => {
    it('cada bonificación va en su lugar por periodo, sin monto ni PDF', async () => {
        fijarSesionFixture(true)
        const wrapper = await montar('/cuenta?seccion=facturas')
        const lista = wrapper.findAll('[data-testid="factura"], [data-testid="bonificacion"]')
        expect(wrapper.findAll('[data-testid="factura"]')).toHaveLength(FACTURAS_FIXTURE.length)
        const bonificadas = wrapper.findAll('[data-testid="bonificacion"]')
        expect(bonificadas).toHaveLength(BONIFICACIONES_FIXTURE.length)
        // noviembre (la más reciente) va arriba de las facturas de octubre
        expect(lista[0]!.attributes('data-testid')).toBe('bonificacion')
        const noviembre = bonificadas[0]!
        expect(noviembre.text()).toContain('Mes bonificado: Servicio de internet Hogar 20 Mbps')
        expect(noviembre.text()).toContain('noviembre 2026')
        expect(noviembre.text()).toContain('sin monto a pagar')
        expect(noviembre.find('[data-testid="origen-bonificacion"]').text()).toBe('Canje de puntos')
        expect(noviembre.find('[data-testid="descargar-pdf"]').exists()).toBe(false)
        expect(noviembre.text()).not.toMatch(/Q\s?\d/)
        // julio (cargo sin costo) entre las facturas de agosto y las más viejas
        const indices = lista.map(e => e.attributes('data-testid'))
        expect(indices.lastIndexOf('bonificacion')).toBeGreaterThan(indices.indexOf('factura'))
    })

    it('si las bonificaciones no se pueden leer, las facturas siguen y se avisa aparte', async () => {
        fijarSesionFixture(true)
        fijarFallaFixture('GET /api/v1/portal/bonificaciones', 'sin_conexion')
        const wrapper = await montar('/cuenta?seccion=facturas')
        expect(wrapper.findAll('[data-testid="factura"]')).toHaveLength(FACTURAS_FIXTURE.length)
        expect(wrapper.find('[data-testid="bonificaciones-error"]').text()).toContain('Reintentar')
        expect(wrapper.find('[data-testid="bonificacion"]').exists()).toBe(false)
    })
})

describe('estado de cuenta del inicio', () => {
    it('la empresa con un mes bonificado lo muestra; la otra no', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_DOS_EMPRESAS_FIXTURE)
        const wrapper = await montar('/cuenta')
        const grupos = wrapper.findAll('[data-testid^="grupo-empresa-"]')
        expect(grupos).toHaveLength(2)
        const altiplano = grupos[0]!.find('[data-testid="bonificaciones-grupo"]')
        expect(altiplano.text()).toContain('Mes bonificado: Servicio de internet Hogar 20 Mbps')
        expect(altiplano.text()).toContain('noviembre 2026')
        expect(grupos[1]!.find('[data-testid="bonificaciones-grupo"]').exists()).toBe(false)
    })
})
