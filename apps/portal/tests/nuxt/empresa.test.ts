import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { fijarEmpresaFixture } from '~~/fixtures'
import { EMPRESA_FIXTURE, EMPRESA_SIN_CONFIGURAR } from '~~/fixtures/empresa'
import PaginaCorte from '~/pages/corte.vue'
import PaginaContacto from '~/pages/contacto.vue'
import DatosDeposito from '~/components/corte/DatosDeposito.vue'

async function montar(componente: Parameters<typeof mountSuspended>[0], props: Record<string, unknown> = {}) {
    clearNuxtData('portal:empresa')
    clearNuxtData('portal:quien-soy')
    const wrapper = await mountSuspended(componente, { props } as Parameters<typeof mountSuspended>[1])
    await flushPromises()
    await flushPromises()
    return wrapper
}

function textoDocumento(): string {
    return document.body.textContent ?? ''
}

afterEach(() => {
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    document.body.innerHTML = ''
})

describe('datos de la empresa configurados en el panel', () => {
    it('depósito: cuentas activas de A3 e instrucciones de pago', async () => {
        await montar(DatosDeposito, { open: true })
        const cuentas = document.querySelectorAll('[data-testid="cuenta-deposito"]')
        expect(cuentas).toHaveLength(2)
        expect(cuentas[0]!.textContent).toContain('Banco Industrial')
        expect(cuentas[0]!.textContent).toContain('123-456789-0')
        expect(cuentas[0]!.textContent).toContain('Monetaria Red Altiplano · Quetzales')
        expect(document.querySelector('[data-testid="instrucciones-pago"]')?.textContent).toContain('Escribe tu NIT')
    })

    it('sin cuentas no muestra la sección ni datos inventados', async () => {
        fijarEmpresaFixture({ ...EMPRESA_FIXTURE, cuentas_deposito: [], instrucciones_pago: null })
        await montar(DatosDeposito, { open: true })
        expect(document.querySelectorAll('[data-testid="cuenta-deposito"]')).toHaveLength(0)
        expect(textoDocumento()).toContain('Llámanos al 7765-4321')
    })

    it('si la configuración no se pudo leer: error con Reintentar', async () => {
        fijarEmpresaFixture(null)
        await montar(DatosDeposito, { open: true })
        expect(textoDocumento()).toContain('No pudimos cargar los datos de pago')
        expect(textoDocumento()).toContain('Reintentar')
        expect(document.querySelectorAll('[data-testid="cuenta-deposito"]')).toHaveLength(0)
    })

    it('/corte sin nada configurado: oculta "Ver datos de depósito" y manda a /contacto', async () => {
        fijarEmpresaFixture(EMPRESA_SIN_CONFIGURAR)
        window.history.replaceState({}, '', '/corte')
        const wrapper = await montar(PaginaCorte)
        expect(wrapper.findAll('button').some(b => b.text().includes('Ver datos de depósito'))).toBe(false)
        const contacto = wrapper.find('[data-testid="contacto-corte"]')
        expect(contacto.text()).toContain('Teléfonos, correo y horario')
        expect(contacto.attributes('href')).toBe('/contacto')
        window.history.replaceState({}, '', '/')
    })

    it('/contacto: teléfono, WhatsApp, correo y horario del panel', async () => {
        const wrapper = await montar(PaginaContacto)
        expect(wrapper.find('[data-testid="contacto-telefono"]').attributes('href')).toBe('tel:77654321')
        expect(wrapper.find('[data-testid="contacto-whatsapp"]').attributes('href')).toBe('https://wa.me/50255550000')
        expect(wrapper.find('[data-testid="contacto-correo"]').attributes('href')).toBe('mailto:cobros@redaltiplano.example')
        expect(wrapper.find('[data-testid="contacto-horario"]').text()).toBe('Lunes a sábado de 8:00 a 18:00')
    })

    it('/contacto con error: Reintentar y ningún dato', async () => {
        fijarEmpresaFixture(null)
        const wrapper = await montar(PaginaContacto)
        expect(wrapper.text()).toContain('No pudimos cargar los datos de contacto')
        expect(wrapper.find('[data-testid="contacto-telefono"]').exists()).toBe(false)
    })
})
