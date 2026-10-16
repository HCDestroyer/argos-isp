import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarSesionFixture } from '~~/fixtures'
import PaginaEntrar from '~/pages/entrar.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))

mockNuxtImport('navigateTo', () => navegar)

function boton(wrapper: { findAll: (s: string) => { text: () => string }[] }, etiqueta: string) {
    return wrapper.findAll('button, a').find(b => b.text().includes(etiqueta)) as
        | { trigger: (e: string) => Promise<void>, attributes: (n: string) => string | undefined }
        | undefined
}

/** Casillas visibles del código (reka agrega un input oculto para el formulario). */
function casillasCodigo(wrapper: { findAll: (s: string) => Array<{ attributes: (n: string) => string | undefined, setValue: (v: string) => Promise<void> }> }) {
    return wrapper.findAll('input').filter(i => i.attributes('type') !== 'hidden' && i.attributes('aria-hidden') !== 'true' && i.attributes('tabindex') !== '-1')
}

async function montarCuenta() {
    clearNuxtData('portal:cuenta')
    const wrapper = await mountSuspended(PaginaCuenta)
    await flushPromises()
    await flushPromises()
    return wrapper
}

afterEach(() => {
    fijarSesionFixture(false)
    navegar.mockReset()
    window.history.replaceState({}, '', '/')
})

describe('portal autenticado /cuenta', () => {
    it('sin sesión manda a /entrar y no muestra montos', async () => {
        fijarSesionFixture(false)
        const wrapper = await montarCuenta()
        expect(navegar).toHaveBeenCalledWith('/entrar')
        expect(wrapper.find('[data-testid="saldo-cuenta"]').exists()).toBe(false)
    })

    it('con sesión: nombre, saldo, servicio y facturas', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        expect(wrapper.text()).toContain('Juan Pérez López')
        expect(wrapper.find('[data-testid="saldo-cuenta"]').text()).toBe('Q 550.00')
        expect(wrapper.find('[data-testid="servicio-cuenta"]').text()).toContain('Suspendido')
        const facturas = wrapper.findAll('[data-testid="factura"]')
        expect(facturas).toHaveLength(5)
        expect(facturas[0]!.text()).toContain('Servicio de octubre 2026')
        expect(facturas[0]!.text()).toContain('Aviso de cobro 1203')
        expect(facturas[0]!.text()).toContain('Vencida')
        expect(wrapper.text()).toContain('Recargo por mora')
    })

    it('no usa controles HTML crudos fuera de los de Nuxt UI', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        expect(wrapper.findAll('table')).toHaveLength(0)
        for (const control of wrapper.findAll('button, input')) {
            expect(control.attributes('class') ?? '').not.toBe('')
        }
    })
})

describe('entrada con código /entrar', () => {
    it('pide código por NIT y entra con el código correcto', async () => {
        fijarSesionFixture(false)
        const wrapper = await mountSuspended(PaginaEntrar)
        await wrapper.find('input').setValue('5769373-1')
        await wrapper.find('form').trigger('submit')
        await flushPromises()
        await flushPromises()
        expect(wrapper.find('[data-testid="destino-codigo"]').text()).toContain('correo o Telegram que tenemos registrado')

        const casillas = casillasCodigo(wrapper)
        expect(casillas).toHaveLength(6)
        for (const [i, casilla] of casillas.entries()) {
            await casilla.setValue(String([1, 2, 3, 4, 5, 6][i]))
        }
        await boton(wrapper, 'Entrar')!.trigger('click')
        await flushPromises()
        expect(navegar).toHaveBeenCalledWith('/cuenta')
    })

    it('código incorrecto muestra el error de la API y no entra', async () => {
        const wrapper = await mountSuspended(PaginaEntrar)
        await wrapper.find('input').setValue('5769373-1')
        await wrapper.find('form').trigger('submit')
        await flushPromises()
        await flushPromises()
        for (const casilla of casillasCodigo(wrapper)) {
            await casilla.setValue('9')
        }
        await boton(wrapper, 'Entrar')!.trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-testid="error-acceso"]').text()).toContain('El código no es correcto')
        expect(navegar).not.toHaveBeenCalledWith('/cuenta')
    })

    it('desde /corte por IP muestra el destino enmascarado', async () => {
        window.history.replaceState({}, '', '/entrar?por_ip=1')
        const wrapper = await mountSuspended(PaginaEntrar, { route: '/entrar?por_ip=1' })
        await boton(wrapper, 'Enviarme el código')!.trigger('click')
        await flushPromises()
        expect(wrapper.find('[data-testid="destino-codigo"]').text()).toContain('j***z@e***.com')
    })
})
