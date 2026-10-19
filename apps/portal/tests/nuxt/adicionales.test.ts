import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarCuentaFixture, fijarSesionFixture } from '~~/fixtures'
import { ADICIONALES_FIXTURE, CUENTA_DOS_EMPRESAS_FIXTURE } from '~~/fixtures/cuenta'
import CuentaAdicionales from '~/components/cuenta/Adicionales.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * Adicionales y tipo de plan en el inicio de /cuenta (contrato `adicionales.md`): nombre,
 * identificador y modalidad de cada adicional activo, nunca la credencial.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)

async function montarCuenta() {
    clearNuxtData('portal:cuenta')
    const wrapper = await mountSuspended(PaginaCuenta, { route: '/cuenta' })
    await flushPromises()
    await flushPromises()
    return wrapper
}

afterEach(() => {
    fijarSesionFixture(false)
    fijarCuentaFixture(null)
    navegar.mockReset()
})

describe('modalidad de un adicional', () => {
    it('incluido, cortesía o el precio al mes; sin precio no inventa un monto', () => {
        expect(textoModalidad({ modalidad: 'incluido', precio: null })).toBe('Incluido en tu plan')
        expect(textoModalidad({ modalidad: 'cortesia', precio: null })).toBe('Cortesía')
        expect(textoModalidad({ modalidad: 'cobrado', precio: '35' })).toBe('Q 35.00 al mes')
        expect(textoModalidad({ modalidad: 'cobrado', precio: '1234.5' })).toBe('Q 1,234.50 al mes')
        expect(textoModalidad({ modalidad: 'cobrado', precio: null })).toBe('Cobrado aparte')
    })
})

describe('/cuenta: adicionales y tipo de plan', () => {
    it('cada servicio muestra su tipo de plan y sus adicionales con su modalidad', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        const servicio = wrapper.find('[data-testid="servicio-cuenta"]')
        expect(servicio.find('[data-testid="plan-tipo"]').text()).toBe('Residencial')

        const filas = servicio.findAll('[data-testid="adicional"]')
        expect(filas).toHaveLength(ADICIONALES_FIXTURE.length)
        expect(filas.map(f => f.find('[data-testid="adicional-modalidad"]').text())).toEqual([
            'Incluido en tu plan',
            'Cortesía',
            'Q 35.00 al mes',
        ])
        expect(filas[0]!.text()).toContain('Streaming Plus')
        expect(filas[0]!.find('[data-testid="adicional-identificador"]').text()).toBe('maria@example.com')
        // Sin identificador no se pinta una línea vacía
        expect(filas[1]!.find('[data-testid="adicional-identificador"]').exists()).toBe(false)
        // El servicio está suspendido: cada adicional dice que está bloqueado
        expect(filas.map(f => f.find('[data-testid="adicional-bloqueado"]').text())).toEqual([
            'Bloqueado por suspensión',
            'Bloqueado por suspensión',
            'Bloqueado por suspensión',
        ])
        // Nada que sugiera la credencial
        expect(servicio.text()).not.toMatch(/contraseña|credencial/i)
    })

    it('un servicio sin adicionales no muestra la sección; el tipo de plan sale igual', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(CUENTA_DOS_EMPRESAS_FIXTURE)
        const wrapper = await montarCuenta()
        const servicios = wrapper.findAll('[data-testid="servicio-cuenta"]')
        const fibra = servicios.find(s => s.text().includes('Fibra 50 Mbps'))!
        expect(fibra.find('[data-testid="plan-tipo"]').text()).toBe('Empresarial')
        expect(fibra.find('[data-testid="adicionales"]').exists()).toBe(false)
        // el servicio activo muestra sus adicionales sin el aviso de bloqueo
        const hogar = servicios.find(s => s.text().includes('Hogar 20 Mbps'))!
        expect(hogar.findAll('[data-testid="adicional"]')).toHaveLength(3)
        expect(hogar.find('[data-testid="adicional-bloqueado"]').exists()).toBe(false)
    })

    it('el componente no usa controles crudos y sin lista no pinta nada', async () => {
        const vacio = await mountSuspended(CuentaAdicionales, { props: { adicionales: [] } })
        expect(vacio.find('[data-testid="adicionales"]').exists()).toBe(false)
        const lleno = await mountSuspended(CuentaAdicionales, { props: { adicionales: ADICIONALES_FIXTURE } })
        expect(lleno.findAll('button, input, table')).toHaveLength(0)
    })
})
